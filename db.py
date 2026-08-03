import json
import os
import sqlite3

from flask import g

import config

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, config.get("DB_NAME"))

SEED_EXERCISES = [
    ("Chest", "Bench Press"),
    ("Chest", "Incline Press"),
    ("Chest", "Decline Press"),
    ("Chest", "Pec Deck Fly"),
    ("Chest", "Upper chest cable crossover"),
    ("Chest", "Lower chest cable crossover"),
    ("Chest", "Pushups"),
    ("Chest", "decline Pushups"),
    ("Shoulders", "Dumbell Shoulder Press"),
    ("Shoulders", "Machine Shoulder Press"),
    ("Shoulders", "Face Pulls"),
    ("Shoulders", "Lateral Raises"),
    ("Shoulders", "Front Raises"),
    ("Shoulders", "Arnold Press"),
    ("Shoulders", "Rotation using plates"),
    ("Triceps", "Tricep Pushdown"),
    ("Triceps", "Tricep Dips"),
    ("Triceps", "Skullcrushers"),
    ("Triceps", "Overhead Cable Extension"),
    ("Triceps", "Cable Kickback"),
    ("Triceps", "Overhead Triceps Press"),
    ("Back", "Deadlift"),
    ("Back", "Lat pulldown"),
    ("Back", "Close grip pulldown"),
    ("Back", "Normal grip pulldown"),
    ("Back", "Close grip machine pulldown"),
    ("Back", "Single hand rowing"),
    ("Back", "Seated Cable Row"),
    ("Back", "Barbell / Dumbbell Row"),
    ("Back", "Single arm pulldown"),
    ("Back", "Cable Pulldown"),
    ("Back", "Machine Rowing"),
    ("Back", "Sled Rowing"),
    ("Back", "Pull ups"),
    ("Legs", "Squats"),
    ("Legs", "Romanian Deadlift"),
    ("Legs", "Leg Press"),
    ("Legs", "Walking Lunges"),
    ("Legs", "Leg Curl"),
    ("Legs", "Calf Raises"),
    ("Legs", "Leg Extensions"),
    ("Legs", "Bulgarian Squats"),
    ("Legs", "Jump Squats"),
    ("Legs", "Box Jumps"),
    ("Legs", "Sled Pull Push"),
    ("Legs", "Hip Thrusts"),
    ("Biceps", "Bicep Curls"),
    ("Biceps", "Hammer Curls"),
    ("Biceps", "Wall supported Curls"),
    ("Biceps", "Preacher Curls"),
    ("Biceps", "21ones"),
    ("Biceps", "Decline Bench Curls"),
    ("Biceps", "Cable Curls"),
    ("Abs", "Crunches"),
    ("Abs", "Abs Machine"),
    ("Abs", "Leg raises"),
    ("Abs", "Russian Twists"),
    ("Abs", "Decline Sit ups"),
    ("Abs", "Dumbell Side bends"),
    ("Abs", "Standing Crunches"),
    ("Abs", "Plancks"),
    ("Abs", "Cable Crunches"),
    ("Abs", "Knee Raises"),
    ("Cardio", "Treadmill Walk"),
    ("Cardio", "Step Machine"),
    ("Cardio", "Burpees"),
    ("Cardio", "Mountain Climbers"),
    ("Cardio", "Stepper"),
    ("Cardio", "Rope waves"),
    ("Cardio", "Kettle Swings"),
    ("Cardio", "Ball Slams"),
    ("Cardio", "Knee Touches"),
    ("Cardio", "Skipping")]

SCHEMA = """
CREATE TABLE IF NOT EXISTS exercise_plan (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    target_muscle TEXT NOT NULL,
    exercise TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'strength'
);

CREATE TABLE IF NOT EXISTS workout_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    date TEXT NOT NULL,
    start_time TEXT,
    end_time TEXT,
    duration_hours REAL,
    energy_level INTEGER,
    pre_workout_meal TEXT,
    hours_since_meal REAL,
    notes TEXT
);

CREATE TABLE IF NOT EXISTS exercise_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    date TEXT NOT NULL,
    muscle_group TEXT NOT NULL,
    exercise TEXT NOT NULL,
    set_number INTEGER,
    attributes TEXT,
    notes TEXT
);

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT,
    username TEXT,
    password_hash TEXT,
    age INTEGER,
    last_period_date TEXT,
    avatar TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
"""


def _ensure_column(conn, table, column, coltype):
    cols = [r[1] for r in conn.execute(f"PRAGMA table_info({table})").fetchall()]
    if column not in cols:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {coltype}")


def _migrate_exercise_log_attributes(conn):
    """One-time migration: reps/weight_kg/duration_minutes/intensity_level
    used to be their own columns, but a given set only ever fills in one pair
    (reps+weight OR duration+level) - the other two are always NULL, and any
    future one-off field (e.g. incline_percent on a treadmill set) would mean
    yet another mostly-empty column. Folding them into a single JSON
    `attributes` column avoids that. Only touches rows that haven't been
    migrated yet (attributes IS NULL), so it's safe to run on every startup,
    and only drops the old columns if this SQLite build supports DROP COLUMN
    (added in 3.35) - if it doesn't, they're just left behind unused, same as
    any other column removal in this app.
    """
    cols = [r[1] for r in conn.execute("PRAGMA table_info(exercise_log)").fetchall()]
    old_cols = [c for c in ("reps", "weight_kg", "duration_minutes", "intensity_level") if c in cols]
    if not old_cols:
        return
    select_cols = ", ".join(old_cols)
    rows = conn.execute(f"SELECT id, {select_cols} FROM exercise_log WHERE attributes IS NULL").fetchall()
    for row in rows:
        row_id = row[0]
        attrs = {col: val for col, val in zip(old_cols, row[1:]) if val is not None}
        conn.execute("UPDATE exercise_log SET attributes = ? WHERE id = ?", (json.dumps(attrs), row_id))
    for col in old_cols:
        try:
            conn.execute(f"ALTER TABLE exercise_log DROP COLUMN {col}")
        except sqlite3.OperationalError:
            pass


def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
    return g.db


def close_db(exception=None):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    first_run = not os.path.exists(DB_PATH)
    conn = sqlite3.connect(DB_PATH)
    conn.executescript(SCHEMA)
    _ensure_column(conn, "users", "avatar", "TEXT")
    # Nullable here even though fresh installs declare it NOT NULL: SQLite can't
    # ALTER TABLE ADD a NOT NULL column without a default, and existing rows on
    # an already-deployed DB have no owner yet. Backfill those separately.
    _ensure_column(conn, "workout_log", "user_id", "INTEGER REFERENCES users(id)")
    _ensure_column(conn, "exercise_log", "user_id", "INTEGER REFERENCES users(id)")
    _ensure_column(conn, "workout_log", "pre_workout_meal", "TEXT")
    _ensure_column(conn, "workout_log", "hours_since_meal", "REAL")
    _ensure_column(conn, "exercise_plan", "type", "TEXT NOT NULL DEFAULT 'strength'")
    _ensure_column(conn, "exercise_log", "attributes", "TEXT")
    _migrate_exercise_log_attributes(conn)
    # username retained only for rows created before this column existed;
    # no longer written to by the app (email is the login identifier now).
    _ensure_column(conn, "users", "username", "TEXT")
    _ensure_column(conn, "users", "password_hash", "TEXT")
    _ensure_column(conn, "users", "email", "TEXT")
    conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email)")
    if first_run:
        conn.executemany(
            "INSERT INTO exercise_plan (target_muscle, exercise) VALUES (?, ?)",
            SEED_EXERCISES,
        )
    # Cheap default classification, not a one-time migration: exercises under
    # the seeded "Cardio" muscle group are duration+level (treadmill, step
    # machine, ...) rather than reps+weight. Runs every startup (after the
    # seed insert above, so it actually applies to fresh installs too) rather
    # than once since there's no UI yet to reclassify an individual exercise
    # (e.g. rep-counted cardio like Burpees) away from this default — revisit
    # if that's ever added, so it doesn't stomp a manual override.
    conn.execute("UPDATE exercise_plan SET type = 'cardio' WHERE target_muscle = 'Cardio'")
    conn.commit()
    conn.close()


def reseed_exercise_plan():
    """Replace all exercise_plan rows with the current SEED_EXERCISES list."""
    conn = sqlite3.connect(DB_PATH)
    conn.executescript(SCHEMA)
    conn.execute("DELETE FROM exercise_plan")
    conn.executemany(
        "INSERT INTO exercise_plan (target_muscle, exercise) VALUES (?, ?)",
        SEED_EXERCISES,
    )
    conn.commit()
    conn.close()
    print(f"Reseeded exercise_plan with {len(SEED_EXERCISES)} exercises.")

def backfill_owner(user_id):
    """One-time cleanup: assign any pre-existing workout_log/exercise_log rows
    with no owner (from before multi-user support) to the given user_id."""
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA foreign_keys = ON")
    owner = conn.execute("SELECT id, name FROM users WHERE id = ?", (user_id,)).fetchone()
    if not owner:
        conn.close()
        raise ValueError(f"No user with id {user_id}")
    w = conn.execute("UPDATE workout_log SET user_id = ? WHERE user_id IS NULL", (user_id,)).rowcount
    e = conn.execute("UPDATE exercise_log SET user_id = ? WHERE user_id IS NULL", (user_id,)).rowcount
    conn.commit()
    conn.close()
    print(f"Assigned {w} workout_log row(s) and {e} exercise_log row(s) to user {user_id} ({owner[1]}).")


VALID_TABLES = {"exercise_plan", "workout_log", "exercise_log", "users"}


def delete_table(table_name):
    """Delete all rows from the table"""
    if table_name not in VALID_TABLES:
        raise ValueError(f"Unknown table: {table_name}")
    conn = sqlite3.connect(DB_PATH)
    cur = conn.execute(f"DELETE FROM {table_name}")
    conn.commit()
    conn.close()
    print(f"Deleted {cur.rowcount} row(s) from {table_name}.")


if __name__ == "__main__":
    # reseed_exercise_plan()
    delete_table("exercise_log")

