"""Weekly workout streak, with streak shields that auto-protect a week that
fell short instead of resetting the streak to zero. A shielded week holds
the streak at its current value - it doesn't add to it, since nothing was
actually logged - it just keeps the chain from breaking.

Most people don't hit the gym daily - 4-5x/week is a realistic routine - so
the streak unit is a week, not the day. A week "succeeds" once it has at
least MIN_VISITS_PER_WEEK distinct logged exercise_log dates in it.

The week isn't a fixed Monday-Sunday calendar week - it's anchored to
whatever weekday the user logged their very first workout on, so "this
week" always means "the 7 days since your streak week last rolled over",
not an arbitrary calendar boundary they may be mid-way through when they
first pick up the app.

Shields aren't handed out on a timer - they're earned by streak length.
Everyone starts with zero. Reaching a MILESTONE_START-week streak earns the
first one; every MILESTONE_STEP weeks of streak after that earns another,
capped at MAX_SHIELDS. Milestone progress is scoped to the *current* streak
- if the streak breaks back to zero, progress toward the next milestone
resets too (shields already banked are not taken away, only the progress
toward earning the next one).

A week that overlaps the user's period (per cycle.py's projection from the
user's logged period_logs) gets the same steady-hold treatment as a shielded week,
but for free - no shield spent, nothing persisted. It's recomputed live
every call, same as everything else here. This is naturally bounded, not a
loophole: a period only overlaps at most 2 of the ~4 streak-weeks in any
28-day cycle, so a genuinely inactive stretch still burns through real
shields and eventually breaks the streak on the non-period weeks in
between.

Nothing about the streak is stored as a running counter - a user's
exercise_log dates can be added, edited, or backfilled for a past date at
any time, so the only source of truth is the actual set of logged dates.
current_streak/longest_streak/shield state (and the week anchor itself)
are recomputed from that set (plus the persisted record of which weeks
were already healed by a shield) every time compute_streak_status() runs.
"""
from datetime import date, timedelta

from cycle import week_overlaps_period

MAX_SHIELDS = 3
MIN_VISITS_PER_WEEK = 4
MILESTONE_START = 3
MILESTONE_STEP = 4
WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]


def _week_start(d, anchor_weekday):
    """Start of the 7-day streak week containing d, given the user's
    anchor weekday (0=Monday..6=Sunday, from their first-ever logged date)."""
    return d - timedelta(days=(d.weekday() - anchor_weekday) % 7)


def _next_milestone(progress):
    """Smallest milestone streak-length strictly greater than progress."""
    if progress < MILESTONE_START:
        return MILESTONE_START
    return progress + (MILESTONE_STEP - (progress - MILESTONE_START) % MILESTONE_STEP)


def _milestones_crossed(prev_progress, new_streak):
    """How many milestone thresholds fall in (prev_progress, new_streak]."""
    count = 0
    t = _next_milestone(prev_progress)
    while t <= new_streak:
        count += 1
        t += MILESTONE_STEP
    return count


def compute_streak_status(db, user_id, today=None):
    today = today or date.today()

    user = db.execute(
        "SELECT shield_count, shield_milestone_progress, longest_streak FROM users WHERE id = ?",
        (user_id,),
    ).fetchone()
    shield_count = user["shield_count"]
    milestone_progress = user["shield_milestone_progress"]
    longest_streak = user["longest_streak"]
    periods = db.execute(
        "SELECT start_date, length_days FROM period_logs WHERE user_id = ?", (user_id,)
    ).fetchall()

    # Counts exercise_log dates, not workout_log dates - a workout_log row
    # can exist with nothing logged against it yet (created lazily the
    # moment the session-strip's energy/meal chips are touched, before any
    # exercise is added - see ensureVisitSaved() in app.js), and starting a
    # workout without finishing it (backgrounding the app, tapping the "X"
    # close button) shouldn't count as a day toward the streak. It only
    # counts once a real exercise is actually added; the visit row itself
    # can be resumed and filled in later without losing that in-progress
    # state either way.
    log_dates = [date.fromisoformat(r["date"]) for r in db.execute(
        "SELECT DISTINCT date FROM exercise_log WHERE user_id = ?", (user_id,)
    ).fetchall()]

    # Anchored to the weekday of the user's first-ever logged workout, not a
    # fixed Monday - recomputed from the log every time so a backfilled date
    # earlier than any seen so far correctly shifts the anchor.
    anchor_weekday = min(log_dates).weekday() if log_dates else today.weekday()

    visits_by_week = {}
    for d in log_dates:
        wk = _week_start(d, anchor_weekday).isoformat()
        visits_by_week[wk] = visits_by_week.get(wk, 0) + 1

    shielded_weeks = {
        r["week_start"] for r in db.execute(
            "SELECT week_start FROM streak_shield_uses WHERE user_id = ?", (user_id,)
        ).fetchall()
    }

    # A week that was auto-shielded in the past but later got enough real
    # logged visits backfilled onto it no longer needs the shield - refund it.
    refunded = {wk for wk in shielded_weeks if visits_by_week.get(wk, 0) >= MIN_VISITS_PER_WEEK}
    if refunded:
        db.executemany(
            "DELETE FROM streak_shield_uses WHERE user_id = ? AND week_start = ?",
            [(user_id, wk) for wk in refunded],
        )
        shield_count = min(MAX_SHIELDS, shield_count + len(refunded))
        shielded_weeks -= refunded

    # A shield bridges a gap between successful weeks - it must never
    # manufacture streak weeks stretching back before the user's actual
    # first-ever logged week.
    earliest_week = min(visits_by_week) if visits_by_week else None
    current_week = _week_start(today, anchor_weekday).isoformat()
    visits_this_week = visits_by_week.get(current_week, 0)

    streak = 0
    newly_shielded = []
    wk_date = _week_start(today, anchor_weekday)
    if visits_this_week < MIN_VISITS_PER_WEEK:
        # This week isn't over/decided yet - don't count or fail it, just
        # start the backward walk from last week.
        wk_date -= timedelta(days=7)

    while True:
        wk = wk_date.isoformat()
        visits = visits_by_week.get(wk, 0)
        if visits >= MIN_VISITS_PER_WEEK:
            streak += 1
        elif wk in shielded_weeks:
            # Already healed by a shield in an earlier computation - keeps
            # the chain alive but, same as a fresh shield use below, doesn't
            # add to the count: a shield holds your streak steady, it
            # doesn't manufacture progress out of a week you didn't log.
            # Otherwise a long stretch of inactivity would silently rack up
            # "streak" purely from banked shields (and milestones crossed
            # by that fake growth would even mint further shields) each
            # time this happens to get recomputed, however late, before
            # collapsing to 0 once shields ran out - a confusing climb-then-
            # crash with no real activity behind it.
            pass
        elif earliest_week and wk >= earliest_week and week_overlaps_period(wk_date, periods):
            # Free pass, not a shield use: a week she fell short on because
            # it overlapped her period shouldn't cost a banked shield, and
            # shouldn't need one either. Same earliest_week floor as a real
            # shield use, for the same reason - never manufacture weeks
            # before the account's first-ever logged one.
            pass
        elif earliest_week and wk >= earliest_week and shield_count > 0:
            shield_count -= 1
            shielded_weeks.add(wk)
            newly_shielded.append(wk)
        else:
            break
        wk_date -= timedelta(days=7)

    if newly_shielded:
        db.executemany(
            "INSERT OR IGNORE INTO streak_shield_uses (user_id, week_start) VALUES (?, ?)",
            [(user_id, wk) for wk in newly_shielded],
        )

    longest_streak = max(longest_streak, streak)

    # Earning shields: milestone progress tracks the current streak, so it
    # resets with it. A streak of 0 means nothing is "in progress" toward
    # the next shield; otherwise, award one for every milestone newly
    # crossed since the last time this ran (capped at MAX_SHIELDS).
    if streak == 0:
        milestone_progress = 0
    else:
        shield_count = min(MAX_SHIELDS, shield_count + _milestones_crossed(milestone_progress, streak))
        milestone_progress = streak

    db.execute(
        "UPDATE users SET shield_count = ?, shield_milestone_progress = ?, longest_streak = ? WHERE id = ?",
        (shield_count, milestone_progress, longest_streak, user_id),
    )
    db.commit()

    return {
        "current_streak": streak,
        "longest_streak": longest_streak,
        "shield_count": shield_count,
        "max_shields": MAX_SHIELDS,
        "visits_this_week": visits_this_week,
        "visits_needed": MIN_VISITS_PER_WEEK,
        "week_start_day": WEEKDAY_NAMES[anchor_weekday],
        "next_shield_at": _next_milestone(streak) if shield_count < MAX_SHIELDS else None,
        "milestone_start": MILESTONE_START,
        "milestone_step": MILESTONE_STEP,
    }
