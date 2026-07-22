import os
from datetime import datetime
from flask import Flask, jsonify, request, send_from_directory

from db import close_db, get_db, init_db

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "static")

app = Flask(__name__, static_folder=STATIC_DIR, static_url_path="")
app.teardown_appcontext(close_db)


# ---------------------------------------------------------------
# Static frontend
# ---------------------------------------------------------------
@app.route("/")
def index():
    return send_from_directory(STATIC_DIR, "index.html")


# ---------------------------------------------------------------
# Exercise Plan API
# ---------------------------------------------------------------
@app.route("/api/exercise-plan", methods=["GET"])
def list_exercise_plan():
    db = get_db()
    rows = db.execute(
        "SELECT * FROM exercise_plan ORDER BY target_muscle, id"
    ).fetchall()
    return jsonify([dict(r) for r in rows])


@app.route("/api/muscles", methods=["GET"])
def list_muscles():
    db = get_db()
    rows = db.execute(
        "SELECT DISTINCT target_muscle FROM exercise_plan ORDER BY target_muscle"
    ).fetchall()
    return jsonify([r["target_muscle"] for r in rows])


@app.route("/api/exercises-by-muscle/<muscle>", methods=["GET"])
def exercises_by_muscle(muscle):
    db = get_db()
    rows = db.execute(
        "SELECT id, exercise FROM exercise_plan WHERE target_muscle = ? ORDER BY exercise",
        (muscle,),
    ).fetchall()
    return jsonify([dict(r) for r in rows])


# ---------------------------------------------------------------
# Workout Log API
# ---------------------------------------------------------------
def compute_duration(start_time, end_time):
    if not start_time or not end_time:
        return None
    try:
        fmt = "%H:%M"
        t1 = datetime.strptime(start_time, fmt)
        t2 = datetime.strptime(end_time, fmt)
        delta = (t2 - t1).total_seconds() / 3600.0
        if delta < 0:
            delta += 24
        return round(delta, 2)
    except ValueError:
        return None


@app.route("/api/workout-log", methods=["GET"])
def list_workout_log():
    db = get_db()
    rows = db.execute("SELECT * FROM workout_log ORDER BY date DESC, id DESC").fetchall()
    return jsonify([dict(r) for r in rows])


@app.route("/api/workout-log", methods=["POST"])
def add_workout_log():
    data = request.get_json(force=True)
    date = (data.get("date") or "").strip()
    if not date:
        return jsonify({"error": "date is required"}), 400
    start_time = data.get("start_time") or None
    end_time = data.get("end_time") or None
    duration = compute_duration(start_time, end_time)
    db = get_db()
    cur = db.execute(
        "INSERT INTO workout_log (date, start_time, end_time, duration_hours, energy_level, notes) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        (date, start_time, end_time, duration, data.get("energy_level"), data.get("notes", "")),
    )
    db.commit()
    return jsonify({"id": cur.lastrowid, "duration_hours": duration}), 201


@app.route("/api/workout-log/<int:row_id>", methods=["DELETE"])
def delete_workout_log(row_id):
    db = get_db()
    db.execute("DELETE FROM workout_log WHERE id = ?", (row_id,))
    db.commit()
    return "", 204


# ---------------------------------------------------------------
# Exercise Log API (exercises done per session)
# ---------------------------------------------------------------
@app.route("/api/exercise-log", methods=["GET"])
def list_exercise_log():
    date_filter = request.args.get("date")
    db = get_db()
    if date_filter:
        rows = db.execute(
            "SELECT * FROM exercise_log WHERE date = ? ORDER BY id", (date_filter,)
        ).fetchall()
    else:
        rows = db.execute(
            "SELECT * FROM exercise_log ORDER BY date DESC, id DESC"
        ).fetchall()
    return jsonify([dict(r) for r in rows])


@app.route("/api/exercise-log", methods=["POST"])
def add_exercise_log():
    data = request.get_json(force=True)
    date = (data.get("date") or "").strip()
    exercises = data.get("exercises") or []
    if not date or not exercises:
        return jsonify({"error": "date and at least one exercise are required"}), 400

    rows = []
    for ex in exercises:
        muscle_group = (ex.get("muscle_group") or "").strip()
        exercise = (ex.get("exercise") or "").strip()
        sets = ex.get("sets") or []
        if not muscle_group or not exercise or not sets:
            return jsonify({"error": "each exercise needs a muscle_group, exercise and at least one set"}), 400
        notes = ex.get("notes", "")
        for i, s in enumerate(sets):
            rows.append((date, muscle_group, exercise, i + 1, s.get("reps"), s.get("weight_kg"), notes))

    db = get_db()
    cur = db.executemany(
        "INSERT INTO exercise_log (date, muscle_group, exercise, set_number, reps, weight_kg, notes) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        rows,
    )
    db.commit()
    return jsonify({"inserted": cur.rowcount}), 201


@app.route("/api/exercise-log/<int:row_id>", methods=["DELETE"])
def delete_exercise_log(row_id):
    db = get_db()
    db.execute("DELETE FROM exercise_log WHERE id = ?", (row_id,))
    db.commit()
    return "", 204


if __name__ == "__main__":
    init_db()
    app.run(host="0.0.0.0", port=5000, debug=False)
else:
    init_db()
