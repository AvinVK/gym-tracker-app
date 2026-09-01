"""Workout Log API: one row per logged gym visit."""
from flask import Blueprint, jsonify, request

from db import get_db
from helpers import get_current_user_id, is_future_date

bp = Blueprint("workout_log", __name__)


@bp.route("/api/workout-log", methods=["GET"])
def list_workout_log():
    user_id = get_current_user_id()
    if not user_id:
        return jsonify({"error": "missing user"}), 401
    db = get_db()
    rows = db.execute(
        "SELECT wl.*, ("
        "  SELECT GROUP_CONCAT(DISTINCT el.muscle_group) FROM exercise_log el"
        "  WHERE el.user_id = wl.user_id AND el.date = wl.date AND el.deleted_at IS NULL"
        ") AS muscles "
        "FROM workout_log wl WHERE wl.user_id = ? ORDER BY wl.date DESC, wl.id DESC",
        (user_id,),
    ).fetchall()
    return jsonify([dict(r) for r in rows])


@bp.route("/api/workout-log", methods=["POST"])
def add_workout_log():
    user_id = get_current_user_id()
    if not user_id:
        return jsonify({"error": "missing user"}), 401
    data = request.get_json(force=True) or {}
    date = (data.get("date") or "").strip()
    if not date:
        return jsonify({"error": "date is required"}), 400
    if is_future_date(date):
        return jsonify({"error": "date cannot be in the future"}), 400
    db = get_db()
    cur = db.execute(
        "INSERT INTO workout_log (user_id, date, energy_level, pre_workout_meal, hours_since_meal, notes) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        (
            user_id, date, data.get("energy_level"),
            data.get("pre_workout_meal", ""), data.get("hours_since_meal") or None, data.get("notes", ""),
        ),
    )
    db.commit()
    return jsonify({"id": cur.lastrowid}), 201


@bp.route("/api/workout-log/<int:row_id>", methods=["PUT"])
def update_workout_log(row_id):
    user_id = get_current_user_id()
    if not user_id:
        return jsonify({"error": "missing user"}), 401
    data = request.get_json(force=True) or {}
    date = (data.get("date") or "").strip()
    if not date:
        return jsonify({"error": "date is required"}), 400
    if is_future_date(date):
        return jsonify({"error": "date cannot be in the future"}), 400
    db = get_db()
    db.execute(
        "UPDATE workout_log SET date = ?, energy_level = ?, pre_workout_meal = ?, hours_since_meal = ?, "
        "notes = ?, edited_at = datetime('now') WHERE id = ? AND user_id = ?",
        (
            date, data.get("energy_level"),
            data.get("pre_workout_meal", ""), data.get("hours_since_meal") or None, data.get("notes", ""),
            row_id, user_id,
        ),
    )
    db.commit()
    return jsonify({"id": row_id})


@bp.route("/api/workout-log/<int:row_id>", methods=["DELETE"])
def delete_workout_log(row_id):
    """Only ever called for a visit row that turned out to have zero
    exercises logged against it (see submitExerciseLog in app.js) - a
    workout_log row gets created eagerly the moment the session-strip's
    energy/meal chips are touched (see ensureVisitSaved), before any
    exercise is necessarily added, so hitting Done with nothing logged
    needs to clean that speculative row back up rather than leaving an
    empty visit sitting in History."""
    user_id = get_current_user_id()
    if not user_id:
        return jsonify({"error": "missing user"}), 401
    db = get_db()
    row = db.execute("SELECT date FROM workout_log WHERE id = ? AND user_id = ?", (row_id, user_id)).fetchone()
    if row:
        # Enforces the invariant this endpoint's callers already rely on
        # (see the docstring above) - exercise_log rows for the date are
        # matched by (user_id, date), not this row's id, so deleting the
        # visit out from under them would silently orphan them: still in
        # History's date grouping, but no longer counted as "a visit" (e.g.
        # add_exercise_log's visit-count gate).
        has_exercises = db.execute(
            "SELECT 1 FROM exercise_log WHERE user_id = ? AND date = ? AND deleted_at IS NULL LIMIT 1",
            (user_id, row["date"]),
        ).fetchone()
        if has_exercises:
            return jsonify({"error": "can't delete a visit that has logged exercises"}), 409
    db.execute("DELETE FROM workout_log WHERE id = ? AND user_id = ?", (row_id, user_id))
    db.commit()
    return jsonify({"id": row_id})
