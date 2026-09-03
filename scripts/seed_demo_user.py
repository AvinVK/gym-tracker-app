#!/usr/bin/env python3
"""One-off: create (or reuse) a demo user with ~6 months of realistic,
randomized workout/cycle history, for showing investors what a long-time
user's data looks like. Idempotent on email - re-running against the same
--email wipes and regenerates that user's logs instead of duplicating them.

Usage (from the project root, correct branch checked out so config.py picks
the right DB - see config.py):

    python3 scripts/seed_demo_user.py --email demo@example.com --pin 1234

Then, separately, promote a user to admin with scripts/make_admin.py.
"""
import argparse
import json
import random
from datetime import date, datetime, timedelta

from werkzeug.security import generate_password_hash

import db

MONTHS_OF_HISTORY = 6
WORKOUTS_PER_WEEK = (4, 5)  # inclusive range, chosen randomly per week
CYCLE_LENGTH_DAYS = 28
PERIOD_LENGTH_DAYS = 5

MEALS = ["Oatmeal + banana", "Chicken + rice", "Protein shake", "Greek yogurt + berries",
         "Eggs + toast", "Peanut butter sandwich", "Nothing - fasted"]

NOTES_POOL = [
    "", "", "", "Felt strong today", "Tired but pushed through", "New PR!",
    "Short on time, kept it quick", "Great pump", "Left knee felt off, went lighter",
    "Best session in weeks", "Low energy, still showed up",
]

# (target_muscle, exercise, rep_range, starting_weight_kg) - names match the
# curated rows in data/exercise_seed.json so they resolve to real catalog
# entries, not proposed/pending ones.
PUSH = [
    ("Chest", "Pushups", (10, 15), None),
    ("Chest", "Lower chest cable crossover", (10, 12), 12),
    ("Shoulders", "Dumbell Shoulder Press", (8, 12), 10),
    ("Shoulders", "Machine Shoulder Press", (8, 12), 20),
    ("Triceps", "Tricep Pushdown", (10, 15), 15),
    ("Triceps", "Overhead Triceps Press", (10, 12), 8),
]
PULL = [
    ("Back", "Seated Cable Row", (8, 12), 25),
    ("Back", "Sled Rowing", (8, 12), 30),
    ("Back", "Pull ups", (5, 10), None),
    ("Biceps", "Hammer Curls", (10, 12), 8),
    ("Biceps", "Preacher Curls", (8, 12), 10),
    ("Shoulders", "Face Pulls", (12, 15), 12),
]
LEGS = [
    ("Legs", "Romanian Deadlift", (8, 10), 30),
    ("Legs", "Leg Press", (10, 12), 60),
    ("Legs", "Leg Extensions", (10, 15), 20),
]
ABS = [
    ("Abs", "Crunches", (15, 20), None),
    ("Abs", "Russian Twists", (15, 20), None),
    ("Abs", "Plancks", (1, 1), None),
    ("Abs", "Cable Crunches", (12, 15), 15),
]
CARDIO = [
    ("Cardio", "Jogging, Treadmill", None, None),
    ("Cardio", "Elliptical Trainer", None, None),
    ("Cardio", "Rope Jumping", None, None),
]

SPLIT = [PUSH, PULL, LEGS, PUSH, PULL]  # rotated across the week's workout days

# Ovulation day is pinned 14 days before the cycle's end, same as the
# client's CYCLE_PHASES (see cyclePhaseForDate in app.js) - phase boundaries
# here must match that exactly, or the seeded PR-by-phase breakdown would
# just be describing a different cycle than the one the app draws.
OVULATION_DAY = CYCLE_LENGTH_DAYS - 14

# Session-to-session strength isn't just a smooth overload curve - real
# output actually varies with cycle phase (see the HORMONE_CURVES comment
# in app.js: estrogen/testosterone peak late-follicular/ovulation, both are
# low during menstruation), and the app's own "X of your Y PRs landed in
# this phase" insight only means something if that's reflected here. Without
# this, a purely monotonic-increasing weight trend would scatter PRs
# uniformly across whichever session happened to be an exercise's most
# recent - not the biologically-informed distribution a "train with your
# cycle" app is supposed to demonstrate.
PHASE_WEIGHT_MULT = {
    "menstrual": (0.88, 0.94),
    "follicular": (0.98, 1.03),
    "ovulation": (1.03, 1.08),
    "luteal": (0.95, 1.01),
}
PHASE_ENERGY_RANGE = {
    "menstrual": (1, 3),
    "follicular": (3, 5),
    "ovulation": (4, 5),
    "luteal": (2, 4),
}


def cycle_phase(d, period_starts):
    """Mirrors cyclePhaseForDate()/CYCLE_PHASES in app.js: menstrual is days
    1..PERIOD_LENGTH_DAYS of the cycle, ovulation is the single day
    OVULATION_DAY, follicular fills the gap between them, luteal is
    everything after. `period_starts` must be sorted ascending."""
    governing = None
    for s in period_starts:
        if s > d:
            break
        governing = s
    if governing is None:
        governing = period_starts[0]
    day_in_cycle = ((d - governing).days % CYCLE_LENGTH_DAYS) + 1
    if day_in_cycle <= PERIOD_LENGTH_DAYS:
        return "menstrual"
    if day_in_cycle < OVULATION_DAY:
        return "follicular"
    if day_in_cycle == OVULATION_DAY:
        return "ovulation"
    return "luteal"


def _progressive_weight(base, week_index, total_weeks, phase):
    """Progressive overload (~15-25% heavier by the end of the history)
    modulated by cycle phase, not a smooth curve independent of it - see
    PHASE_WEIGHT_MULT above. Rounded to the nearest 2.5kg plate increment."""
    if base is None:
        return None
    growth = 1 + (0.20 * week_index / total_weeks)
    phase_mult = random.uniform(*PHASE_WEIGHT_MULT[phase])
    raw = base * growth * phase_mult
    return round(raw / 2.5) * 2.5


def get_or_create_user(conn, name, email, pin, age):
    row = conn.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone()
    if row:
        user_id = row[0]
        print(f"Reusing existing user id={user_id} ({email}); clearing its old logs first.")
        conn.execute("DELETE FROM exercise_log WHERE user_id = ?", (user_id,))
        conn.execute("DELETE FROM workout_log WHERE user_id = ?", (user_id,))
        conn.execute("DELETE FROM period_logs WHERE user_id = ?", (user_id,))
        conn.execute("DELETE FROM streak_shield_uses WHERE user_id = ?", (user_id,))
        conn.execute(
            "UPDATE users SET name = ?, password_hash = ?, age = ?, "
            "longest_streak = 0, shield_count = 0, shield_milestone_progress = 0, "
            "cycle_length_days = ?, period_length_days = ? WHERE id = ?",
            (name, generate_password_hash(pin), age, CYCLE_LENGTH_DAYS, PERIOD_LENGTH_DAYS, user_id),
        )
        return user_id
    cur = conn.execute(
        "INSERT INTO users (name, email, password_hash, age, cycle_length_days, period_length_days) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        (name, email, generate_password_hash(pin), age, CYCLE_LENGTH_DAYS, PERIOD_LENGTH_DAYS),
    )
    print(f"Created new user id={cur.lastrowid} ({email}).")
    return cur.lastrowid


def seed_periods(conn, user_id, start, end):
    """One period every CYCLE_LENGTH_DAYS, anchored so the most recent one
    lands a few days before `end` (today) - a realistic "currently mid-cycle"
    state rather than a period ending exactly on the seed date."""
    last_start = end - timedelta(days=random.randint(3, 10))
    starts = []
    d = last_start
    while d >= start:
        starts.append(d)
        d -= timedelta(days=CYCLE_LENGTH_DAYS)
    starts.reverse()
    for s in starts:
        conn.execute(
            "INSERT OR IGNORE INTO period_logs (user_id, start_date, length_days) VALUES (?, ?, ?)",
            (user_id, s.isoformat(), PERIOD_LENGTH_DAYS),
        )
    if starts:
        conn.execute(
            "UPDATE users SET last_period_date = ?, period_length_days = ? WHERE id = ?",
            (starts[-1].isoformat(), PERIOD_LENGTH_DAYS, user_id),
        )
    print(f"Logged {len(starts)} periods, most recent starting {starts[-1] if starts else 'none'}.")
    return starts


def seed_workouts(conn, user_id, start, end, period_starts):
    total_days = (end - start).days
    total_weeks = max(total_days // 7, 1)
    day = start
    week_index = 0
    session_count = 0
    while day <= end:
        week_workouts = random.randint(*WORKOUTS_PER_WEEK)
        # Pick which weekdays this week get trained (skip Sunday most weeks).
        candidate_offsets = random.sample(range(6), k=min(week_workouts, 6))
        for offset in sorted(candidate_offsets):
            log_date = day + timedelta(days=offset)
            if log_date > end or log_date < start:
                continue
            split = SPLIT[session_count % len(SPLIT)]
            phase = cycle_phase(log_date, period_starts)
            _log_session(conn, user_id, log_date, split, week_index, total_weeks, session_count, phase)
            session_count += 1
        day += timedelta(days=7)
        week_index += 1
    print(f"Logged {session_count} workout sessions across {total_weeks} weeks.")


def _log_session(conn, user_id, log_date, split, week_index, total_weeks, session_count, phase):
    start_hour = random.choice([6, 7, 17, 18, 19])
    start_dt = datetime.combine(log_date, datetime.min.time()) + timedelta(hours=start_hour, minutes=random.randint(0, 59))
    duration_hours = round(random.uniform(0.75, 1.5), 2)
    end_dt = start_dt + timedelta(hours=duration_hours)

    cur = conn.execute(
        "INSERT INTO workout_log (user_id, date, start_time, end_time, duration_hours, "
        "energy_level, pre_workout_meal, hours_since_meal, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            user_id, log_date.isoformat(), start_dt.strftime("%H:%M"), end_dt.strftime("%H:%M"),
            duration_hours, random.randint(*PHASE_ENERGY_RANGE[phase]), random.choice(MEALS),
            round(random.uniform(1, 4), 1), random.choice(NOTES_POOL),
        ),
    )
    workout_id = cur.lastrowid

    exercises = list(split)
    # Every ~4th session, finish with an abs or cardio accessory - mirrors a
    # realistic split rather than four isolated body-part days in a vacuum.
    if session_count % 4 == 3:
        exercises = exercises + [random.choice(ABS)]
    elif session_count % 5 == 4:
        exercises = exercises + [random.choice(CARDIO)]

    for muscle, exercise, rep_range, base_weight in exercises:
        is_cardio = rep_range is None
        if is_cardio:
            duration_minutes = round(random.uniform(15, 30))
            conn.execute(
                "INSERT INTO exercise_log (user_id, date, muscle_group, exercise, set_number, "
                "duration_minutes, intensity_level, added_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (user_id, log_date.isoformat(), muscle, exercise, 1, duration_minutes,
                 random.randint(2, 4), start_dt.isoformat()),
            )
            continue
        num_sets = random.randint(3, 4)
        weight = _progressive_weight(base_weight, week_index, total_weeks, phase)
        for set_number in range(1, num_sets + 1):
            reps = random.randint(*rep_range)
            set_weight = None
            if weight is not None:
                # Slight per-set fatigue: later sets a touch lighter or same.
                set_weight = max(weight - (set_number - 1) * random.choice([0, 0, 2.5]), 2.5)
            conn.execute(
                "INSERT INTO exercise_log (user_id, date, muscle_group, exercise, set_number, "
                "reps, weight_kg, added_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (user_id, log_date.isoformat(), muscle, exercise, set_number, reps, set_weight,
                 start_dt.isoformat()),
            )
    conn.commit()
    _ = workout_id


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--name", default="Priya Sharma")
    parser.add_argument("--email", required=True)
    parser.add_argument("--pin", default="1234", help="4-digit login PIN (default: 1234)")
    parser.add_argument("--age", type=int, default=27)
    parser.add_argument("--seed", type=int, default=42, help="RNG seed, for reproducible demo data")
    args = parser.parse_args()

    if not (args.pin.isdigit() and len(args.pin) == 4):
        parser.error("--pin must be exactly 4 digits")

    random.seed(args.seed)
    db.init_db()

    import sqlite3
    conn = sqlite3.connect(db.DB_PATH)
    conn.execute("PRAGMA foreign_keys = ON")

    end = date.today()
    start = end - timedelta(days=30 * MONTHS_OF_HISTORY)

    user_id = get_or_create_user(conn, args.name, args.email, args.pin, args.age)
    conn.commit()
    period_starts = seed_periods(conn, user_id, start, end)
    conn.commit()
    seed_workouts(conn, user_id, start, end, period_starts)
    conn.close()

    print(f"\nDone. Log in with email={args.email} pin={args.pin}.")


if __name__ == "__main__":
    main()
