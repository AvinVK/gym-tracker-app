import os
import sqlite3

from flask import g

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "gym_tracker.db")

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
    exercise TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workout_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    start_time TEXT,
    end_time TEXT,
    duration_hours REAL,
    energy_level INTEGER,
    notes TEXT
);

CREATE TABLE IF NOT EXISTS exercise_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    muscle_group TEXT NOT NULL,
    exercise TEXT NOT NULL,
    set_number INTEGER,
    reps INTEGER,
    weight_kg REAL,
    notes TEXT
);
"""


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
    if first_run:
        conn.executemany(
            "INSERT INTO exercise_plan (target_muscle, exercise) VALUES (?, ?)",
            SEED_EXERCISES,
        )
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

VALID_TABLES = {"exercise_plan", "workout_log", "exercise_log"}


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

