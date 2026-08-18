"""Exercise Plan API: the muscle -> exercise picker used by Log Workout/History."""
import json

from flask import Blueprint, jsonify

from db import get_db

bp = Blueprint("exercise_plan", __name__)


def _exercise_plan_dict(row):
    d = dict(row)
    d["images"] = json.loads(d["images"]) if d.get("images") else []
    return d


@bp.route("/api/muscles", methods=["GET"])
def list_muscles():
    db = get_db()
    rows = db.execute(
        "SELECT DISTINCT target_muscle FROM exercise_plan ORDER BY target_muscle"
    ).fetchall()
    return jsonify([r["target_muscle"] for r in rows])


@bp.route("/api/exercises-by-muscle/<muscle>", methods=["GET"])
def exercises_by_muscle(muscle):
    db = get_db()
    rows = db.execute(
        "SELECT id, exercise, type, images, curated FROM exercise_plan WHERE target_muscle = ? "
        "ORDER BY curated DESC, exercise",
        (muscle,),
    ).fetchall()
    return jsonify([_exercise_plan_dict(r) for r in rows])
