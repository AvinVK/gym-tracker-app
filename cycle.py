"""Shared period-cycle date math, used server-side by streaks.py (to give a
streak week a free pass if it overlaps the user's period) and by the
/api/streak period-power count below.

Mirrors the client-side cycleDayForDate()/getCyclePhases() logic in app.js:
each user has their own cycle_length_days (users.cycle_length_days, default
DEFAULT_CYCLE_LENGTH_DAYS) which the cycle loops on, but period length is NOT
constant cycle-to-cycle - each row in period_logs (start_date, length_days)
is a period the user actually logged, and only governs the one-cycle-length
window starting at its own start_date. A date outside any logged window (a future
cycle the user hasn't confirmed yet, or before cycle tracking started)
defaults to DEFAULT_PERIOD_DAYS, never to whatever length a *different*
cycle happened to use. Same projection every phase-aware view in the app
already uses (History dots, hormone chart, PR-by-phase breakdown), so a
date's phase never disagrees depending on which part of the app is asking,
and only the specific cycle a user edits moves - past and future cycles stay
put.
"""
from datetime import date, timedelta

DEFAULT_CYCLE_LENGTH_DAYS = 28
DEFAULT_PERIOD_DAYS = 5


def _parse_periods(periods):
    """Normalizes to a list of (start_date: date, length_days: int) sorted
    ascending by start_date - the shape every function below expects.
    Accepts sqlite3.Row/dict-likes with start_date/length_days keys."""
    parsed = [
        (date.fromisoformat(p["start_date"]), int(p["length_days"]))
        for p in periods
    ]
    parsed.sort(key=lambda p: p[0])
    return parsed


def governing_period(d, periods):
    """The logged period (start_date, length_days) that governs date d - the
    latest one starting on or before d. If d is earlier than every logged
    period, falls back to the *earliest* one instead of None, so a date
    before any tracked period still gets a projected phase (28-day cycle
    math is symmetric - it works extrapolating backward from an anchor the
    same way it works extrapolating forward). None only if there are no
    periods logged at all. Note this means days_since (d - governing start)
    can come back negative - period_length_for_date/_is_period_day_parsed
    account for that by only trusting the governing period's own logged
    length when days_since is also >= 0."""
    governing = None
    for start, length in periods:
        if start > d:
            break
        governing = (start, length)
    if governing is None and periods:
        governing = periods[0]
    return governing


def cycle_day_for_date(d, periods, cycle_length=DEFAULT_CYCLE_LENGTH_DAYS):
    """1-indexed day within the cycle; the governing period's start_date is
    day 1. None if there's no logged period on or before d. `periods` is raw
    (unparsed) start_date/length_days rows."""
    governing = governing_period(d, _parse_periods(periods))
    if governing is None:
        return None
    start, _length = governing
    days_since = (d - start).days
    return ((days_since % cycle_length) + cycle_length) % cycle_length + 1


def period_length_for_date(d, periods, cycle_length=DEFAULT_CYCLE_LENGTH_DAYS):
    """The menstrual-phase length that applies to d's cycle: the governing
    period's own logged length if d falls within *that* period's own cycle
    window (days_since < cycle_length), otherwise DEFAULT_PERIOD_DAYS - a
    later, unconfirmed projected cycle never inherits an earlier cycle's
    custom length. `periods` is raw (unparsed) start_date/length_days rows."""
    governing = governing_period(d, _parse_periods(periods))
    if governing is None:
        return DEFAULT_PERIOD_DAYS
    start, length = governing
    days_since = (d - start).days
    return length if 0 <= days_since < cycle_length else DEFAULT_PERIOD_DAYS


def _is_period_day_parsed(d, parsed_periods, cycle_length):
    governing = governing_period(d, parsed_periods)
    if governing is None:
        return False
    start, length = governing
    days_since = (d - start).days
    cycle_day = ((days_since % cycle_length) + cycle_length) % cycle_length + 1
    applicable_length = length if 0 <= days_since < cycle_length else DEFAULT_PERIOD_DAYS
    return cycle_day <= applicable_length


def is_period_day(d, periods, cycle_length=DEFAULT_CYCLE_LENGTH_DAYS):
    """`periods` is raw (unparsed) start_date/length_days rows."""
    return _is_period_day_parsed(d, _parse_periods(periods), cycle_length)


def week_overlaps_period(week_start, periods, cycle_length=DEFAULT_CYCLE_LENGTH_DAYS):
    """True if any of the 7 days starting week_start falls on a period day."""
    parsed = _parse_periods(periods)
    if not parsed:
        return False
    return any(
        _is_period_day_parsed(week_start + timedelta(days=i), parsed, cycle_length)
        for i in range(7)
    )


def compute_period_power(db, user_id, today=None):
    """Count of distinct days with a real logged exercise (not just a
    visited-but-empty workout_log row - same reasoning as the streak fix,
    see streaks.py) that fall within the *current* period - the one
    governing `today` (see governing_period). "Current" picks which period's
    date range counts, not whether today itself is still in it: a day
    logged yesterday or the day before, during that same period, still
    counts even if today has nothing logged yet (or the period has since
    ended) - the message reports what happened during the period, it
    doesn't require the period to still be running right now. Deliberately
    not "any period day this calendar month" though: a calendar month can
    span the tail of one logged period and the start of a projected future
    one, and counting both would resurface an *older* period's gym visits
    long after a newer one started, or count days from a future estimated
    period nobody has lived through yet. Not a running counter for the same
    reason streak state isn't one - logged dates can be added, edited, or
    backfilled at any time, and logging/editing a period should only move
    which days count for *that* cycle, so it's recomputed from the log
    every time rather than persisted."""
    today = today or date.today()
    cycle_length = db.execute(
        "SELECT cycle_length_days FROM users WHERE id = ?", (user_id,)
    ).fetchone()["cycle_length_days"] or DEFAULT_CYCLE_LENGTH_DAYS
    periods = _parse_periods(db.execute(
        "SELECT start_date, length_days FROM period_logs WHERE user_id = ?", (user_id,)
    ).fetchall())
    if not periods:
        return 0
    governing = governing_period(today, periods)
    if governing is None:
        return 0
    start, length = governing
    days_since_today = (today - start).days
    applicable_length = length if 0 <= days_since_today < cycle_length else DEFAULT_PERIOD_DAYS
    period_end = start + timedelta(days=applicable_length - 1)
    log_dates = [date.fromisoformat(r["date"]) for r in db.execute(
        "SELECT DISTINCT date FROM exercise_log WHERE user_id = ?", (user_id,)
    ).fetchall()]
    return sum(1 for d in log_dates if start <= d <= period_end)
