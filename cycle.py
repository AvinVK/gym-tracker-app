"""Shared period-cycle date math, used server-side by streaks.py (to give a
streak week a free pass if it overlaps the user's period) and by the
/api/streak period-power count below.

Mirrors the client-side cycleDayForDate()/getCyclePhases() logic in app.js:
the cycle is a fixed CYCLE_LENGTH_DAYS-day loop projected both forward and
backward from last_period_date. Same projection every phase-aware view in
the app already uses (History dots, hormone chart, PR-by-phase breakdown),
so a date's phase never disagrees depending on which part of the app is
asking, and it moves if the user corrects their period info, same as those
views do.
"""
from datetime import date, timedelta

CYCLE_LENGTH_DAYS = 28


def cycle_day_for_date(d, last_period):
    """1-indexed day within the cycle; last_period itself is day 1."""
    days_since = (d - last_period).days
    return ((days_since % CYCLE_LENGTH_DAYS) + CYCLE_LENGTH_DAYS) % CYCLE_LENGTH_DAYS + 1


def is_period_day(d, last_period, period_length_days):
    if last_period is None:
        return False
    return cycle_day_for_date(d, last_period) <= period_length_days


def week_overlaps_period(week_start, last_period, period_length_days):
    """True if any of the 7 days starting week_start falls on a period day."""
    if last_period is None:
        return False
    return any(
        is_period_day(week_start + timedelta(days=i), last_period, period_length_days)
        for i in range(7)
    )


def compute_period_power(db, user_id, today=None):
    """Count of distinct logged workout days *this calendar month* that fall
    on a period day, per the user's current last_period_date/
    period_length_days projected across the month. Not a running counter for
    the same reason streak state isn't one - logged dates can be added,
    edited, or backfilled at any time, and correcting last_period_date
    should move which days count, so it's recomputed from the log every
    time rather than persisted."""
    today = today or date.today()
    user = db.execute(
        "SELECT last_period_date, period_length_days FROM users WHERE id = ?", (user_id,)
    ).fetchone()
    if not user["last_period_date"]:
        return 0
    last_period = date.fromisoformat(user["last_period_date"])
    period_length_days = user["period_length_days"]
    log_dates = [date.fromisoformat(r["date"]) for r in db.execute(
        "SELECT DISTINCT date FROM workout_log WHERE user_id = ?", (user_id,)
    ).fetchall()]
    return sum(
        1 for d in log_dates
        if d.year == today.year and d.month == today.month
        and is_period_day(d, last_period, period_length_days)
    )
