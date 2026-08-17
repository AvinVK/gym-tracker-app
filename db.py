import json
import os
import sqlite3

from flask import g

import config

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, config.get("DB_NAME"))

EXERCISE_SEED_PATH = os.path.join(BASE_DIR, "data", "exercise_seed.json")


def _load_seed_exercises():
    """Each row is {target_muscle, exercise, images, curated}: images is a
    list of /exercise-images/... URLs (possibly empty); curated marks the
    app's original hand-picked 73 (vs. the ~850 bulk-imported from
    free-exercise-db) so the picker can default to the familiar list instead
    of dumping every imported variant on someone at once - see
    data/exercise_seed.json for full provenance. Matched by name against the
    original list so historical exercise_log rows keep resolving to the same
    exercise text."""
    with open(EXERCISE_SEED_PATH, encoding="utf-8") as f:
        return json.load(f)


SCHEMA = """
CREATE TABLE IF NOT EXISTS exercise_plan (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    target_muscle TEXT NOT NULL,
    exercise TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'strength',
    images TEXT,
    curated INTEGER NOT NULL DEFAULT 0
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
    notes TEXT,
    edited_at TEXT
);

CREATE TABLE IF NOT EXISTS exercise_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    date TEXT NOT NULL,
    muscle_group TEXT NOT NULL,
    exercise TEXT NOT NULL,
    set_number INTEGER,
    reps INTEGER,
    weight_kg REAL,
    duration_minutes REAL,
    intensity_level INTEGER,
    extra_attributes TEXT,
    notes TEXT,
    edited_at TEXT,
    previous_values TEXT,
    added_at TEXT,
    deleted_at TEXT
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
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    longest_streak INTEGER NOT NULL DEFAULT 0,
    shield_count INTEGER NOT NULL DEFAULT 0,
    shield_milestone_progress INTEGER NOT NULL DEFAULT 0
);

-- Calendar weeks (Monday date, ISO format) that would otherwise have broken
-- a user's streak - fewer than the required visits that week - healed by
-- spending one of their streak shields (see streaks.py). Kept as its own
-- table rather than a counter because "which weeks were shielded" is a real
-- historical decision that has to stay stable across repeated recomputation,
-- not something derivable from the log dates alone.
CREATE TABLE IF NOT EXISTS streak_shield_uses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    week_start TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, week_start)
);
"""


def _ensure_column(conn, table, column, coltype):
    cols = [r[1] for r in conn.execute(f"PRAGMA table_info({table})").fetchall()]
    if column not in cols:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {coltype}")


EXERCISE_LOG_KNOWN_ATTRS = ("reps", "weight_kg", "duration_minutes", "intensity_level")


def _migrate_exercise_log_split_attributes(conn):
    """Second migration on top of the attributes-JSON refactor above: reps/
    weight_kg/duration_minutes/intensity_level turned out not to be one-off
    fields at all - they're used consistently across most exercises, so
    folding them into a single JSON blob traded the original permanent-null
    sparsity for a JSON-parse tax on the common case, with no upside. Splits
    them back into real columns and keeps `extra_attributes` JSON only for
    genuinely rare, exercise-specific fields (inclination_percent,
    speed_kmh, ...), which is what that column was actually meant to solve.
    Only runs while the old `attributes` column is still present, so it's
    safe (and a no-op) on every startup once it's done its job, and only
    drops that column if this SQLite build supports DROP COLUMN (added in
    3.35) - if it doesn't, it's just left behind unused, same as any other
    column removal in this app.
    """
    cols = [r[1] for r in conn.execute("PRAGMA table_info(exercise_log)").fetchall()]
    if "attributes" not in cols:
        return
    rows = conn.execute("SELECT id, attributes FROM exercise_log").fetchall()
    for row_id, raw in rows:
        attrs = json.loads(raw) if raw else {}
        known = {k: attrs.get(k) for k in EXERCISE_LOG_KNOWN_ATTRS}
        extra = {k: v for k, v in attrs.items() if k not in EXERCISE_LOG_KNOWN_ATTRS}
        conn.execute(
            "UPDATE exercise_log SET reps = ?, weight_kg = ?, duration_minutes = ?, intensity_level = ?, "
            "extra_attributes = ? WHERE id = ?",
            (known["reps"], known["weight_kg"], known["duration_minutes"], known["intensity_level"],
             json.dumps(extra) if extra else None, row_id),
        )
    try:
        conn.execute("ALTER TABLE exercise_log DROP COLUMN attributes")
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
    _ensure_column(conn, "exercise_log", "reps", "INTEGER")
    _ensure_column(conn, "exercise_log", "weight_kg", "REAL")
    _ensure_column(conn, "exercise_log", "duration_minutes", "REAL")
    _ensure_column(conn, "exercise_log", "intensity_level", "INTEGER")
    _ensure_column(conn, "exercise_log", "extra_attributes", "TEXT")
    _ensure_column(conn, "exercise_log", "edited_at", "TEXT")
    _ensure_column(conn, "exercise_log", "previous_values", "TEXT")
    _ensure_column(conn, "workout_log", "edited_at", "TEXT")
    _ensure_column(conn, "exercise_log", "added_at", "TEXT")
    _ensure_column(conn, "exercise_log", "deleted_at", "TEXT")
    _migrate_exercise_log_split_attributes(conn)
    # username retained only for rows created before this column existed;
    # no longer written to by the app (email is the login identifier now).
    _ensure_column(conn, "users", "username", "TEXT")
    _ensure_column(conn, "users", "password_hash", "TEXT")
    _ensure_column(conn, "users", "email", "TEXT")
    conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email)")
    _ensure_column(conn, "exercise_plan", "images", "TEXT")
    _ensure_column(conn, "exercise_plan", "curated", "INTEGER NOT NULL DEFAULT 0")
    _ensure_column(conn, "users", "longest_streak", "INTEGER NOT NULL DEFAULT 0")
    _ensure_column(conn, "users", "shield_count", "INTEGER NOT NULL DEFAULT 0")
    _ensure_column(conn, "users", "shield_milestone_progress", "INTEGER NOT NULL DEFAULT 0")
    if first_run:
        conn.executemany(
            "INSERT INTO exercise_plan (target_muscle, exercise, images, curated) VALUES (?, ?, ?, ?)",
            [(r["target_muscle"], r["exercise"], json.dumps(r["images"]) if r["images"] else None,
              1 if r.get("curated") else 0)
             for r in _load_seed_exercises()],
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
    """Replace all exercise_plan rows with the current data/exercise_seed.json contents."""
    conn = sqlite3.connect(DB_PATH)
    conn.executescript(SCHEMA)
    _ensure_column(conn, "exercise_plan", "images", "TEXT")
    _ensure_column(conn, "exercise_plan", "curated", "INTEGER NOT NULL DEFAULT 0")
    seed = _load_seed_exercises()
    conn.execute("DELETE FROM exercise_plan")
    conn.executemany(
        "INSERT INTO exercise_plan (target_muscle, exercise, images, curated) VALUES (?, ?, ?, ?)",
        [(r["target_muscle"], r["exercise"], json.dumps(r["images"]) if r["images"] else None,
          1 if r.get("curated") else 0) for r in seed],
    )
    conn.execute("UPDATE exercise_plan SET type = 'cardio' WHERE target_muscle = 'Cardio'")
    conn.commit()
    conn.close()
    print(f"Reseeded exercise_plan with {len(seed)} exercises.")

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

