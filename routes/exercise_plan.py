"""Exercise Plan API: the muscle -> exercise picker used by Log Workout/History,
plus the new-exercise proposal/approval flow.

exercise_plan.status distinguishes the shared catalog ('approved', everything
pre-existing) from a user's own not-yet-reviewed submission ('pending') - see
db.py's init_db for the column and matching.py for how a typed name is
checked against the catalog before it's proposed at all.
"""
import json
from datetime import datetime

from flask import Blueprint, jsonify, request

from db import get_db
from helpers import get_current_user_id, require_admin, require_login
from matching import best_matches

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
    # A user's own pending proposal is included alongside the approved
    # catalog so she can pick it again in a later exercise block/session
    # without re-triggering the match/propose flow - but it stays invisible
    # to everyone else (including the admin queue's proposer) until approved.
    user_id = get_current_user_id()
    rows = db.execute(
        "SELECT id, exercise, type, images, curated, status FROM exercise_plan "
        "WHERE target_muscle = ? AND (status = 'approved' OR proposed_by = ?) "
        "ORDER BY curated DESC, exercise",
        (muscle, user_id),
    ).fetchall()
    return jsonify([_exercise_plan_dict(r) for r in rows])


@bp.route("/api/exercise-plan/candidates", methods=["POST"])
def exercise_candidates():
    """Given a name that didn't match anything in the picker's own substring
    search, checks it semantically against the muscle group's approved
    exercises - the "did you mean" step before propose_exercise below."""
    user_id, err = require_login()
    if err:
        return err
    data = request.get_json(force=True)
    muscle = (data.get("muscle") or "").strip()
    name = (data.get("name") or "").strip()
    if not muscle or not name:
        return jsonify({"error": "muscle and name are required"}), 400
    db = get_db()
    existing = db.execute(
        "SELECT exercise FROM exercise_plan WHERE target_muscle = ? AND status = 'approved'",
        (muscle,),
    ).fetchall()
    candidates = best_matches(name, [r["exercise"] for r in existing])
    return jsonify({"candidates": candidates})


@bp.route("/api/exercise-plan/propose", methods=["POST"])
def propose_exercise():
    """Called once she's confirmed this is genuinely not one of the
    suggested candidates (or none were found) - logs immediately under the
    raw name regardless (see add_exercise_log; this only affects the shared
    catalog), and queues it for admin review."""
    user_id, err = require_login()
    if err:
        return err
    data = request.get_json(force=True)
    muscle = (data.get("muscle") or "").strip()
    name = (data.get("name") or "").strip()
    if not muscle or not name:
        return jsonify({"error": "muscle and name are required"}), 400

    db = get_db()
    # Defensive de-dup, case-insensitive: someone may have proposed (or an
    # admin approved) this exact name for this muscle since the client last
    # checked - reuse that row rather than creating a second one.
    existing = db.execute(
        "SELECT id, exercise, type, status FROM exercise_plan "
        "WHERE target_muscle = ? AND lower(exercise) = lower(?)",
        (muscle, name),
    ).fetchone()
    if existing:
        return jsonify({"exercise": existing["exercise"], "status": existing["status"], "type": existing["type"]})

    exercise_type = "cardio" if muscle == "Cardio" else "strength"
    now = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
    db.execute(
        "INSERT INTO exercise_plan (target_muscle, exercise, type, status, proposed_by, proposed_at) "
        "VALUES (?, ?, ?, 'pending', ?, ?)",
        (muscle, name, exercise_type, user_id, now),
    )
    db.commit()
    return jsonify({"exercise": name, "status": "pending", "type": exercise_type}), 201


@bp.route("/api/exercise-plan/pending", methods=["GET"])
def list_pending_exercises():
    _, err = require_admin()
    if err:
        return err
    db = get_db()
    rows = db.execute(
        "SELECT ep.id, ep.target_muscle, ep.exercise, ep.type, ep.proposed_at, "
        "u.name AS proposed_by_name "
        "FROM exercise_plan ep JOIN users u ON u.id = ep.proposed_by "
        "WHERE ep.status = 'pending' ORDER BY ep.proposed_at",
    ).fetchall()
    return jsonify([dict(r) for r in rows])


@bp.route("/api/exercise-plan/pending/<int:plan_id>/approve", methods=["POST"])
def approve_pending_exercise(plan_id):
    _, err = require_admin()
    if err:
        return err
    db = get_db()
    row = db.execute(
        "SELECT * FROM exercise_plan WHERE id = ? AND status = 'pending'", (plan_id,)
    ).fetchone()
    if not row:
        return jsonify({"error": "not found"}), 404
    data = request.get_json(force=True) or {}
    # Admin can clean up her raw typed text (capitalization, phrasing) before
    # it joins the shared catalog - defaults to what she typed unchanged.
    new_exercise = (data.get("exercise") or row["exercise"]).strip()
    new_muscle = (data.get("target_muscle") or row["target_muscle"]).strip()
    new_type = (data.get("type") or row["type"]).strip()
    db.execute(
        "UPDATE exercise_plan SET exercise = ?, target_muscle = ?, type = ?, status = 'approved' WHERE id = ?",
        (new_exercise, new_muscle, new_type, plan_id),
    )
    # Relabel any sets already logged under the raw proposed text so History
    # shows the same canonical name the catalog now uses.
    if new_exercise != row["exercise"] or new_muscle != row["target_muscle"]:
        db.execute(
            "UPDATE exercise_log SET exercise = ?, muscle_group = ? WHERE muscle_group = ? AND exercise = ?",
            (new_exercise, new_muscle, row["target_muscle"], row["exercise"]),
        )
    db.commit()
    return jsonify({"id": plan_id, "exercise": new_exercise, "target_muscle": new_muscle})


@bp.route("/api/exercise-plan/pending/<int:plan_id>/reject", methods=["POST"])
def reject_pending_exercise(plan_id):
    """Removes the proposal from the catalog. If the admin points it at an
    existing exercise (it was actually a typo/duplicate the matcher missed),
    her already-logged sets are relabeled to that one instead of being left
    under a name nothing in the picker resolves to anymore."""
    _, err = require_admin()
    if err:
        return err
    db = get_db()
    row = db.execute(
        "SELECT * FROM exercise_plan WHERE id = ? AND status = 'pending'", (plan_id,)
    ).fetchone()
    if not row:
        return jsonify({"error": "not found"}), 404
    data = request.get_json(force=True) or {}
    resolved_exercise = (data.get("resolved_exercise") or "").strip()
    resolved_muscle = (data.get("resolved_muscle") or "").strip()
    if resolved_exercise and resolved_muscle:
        db.execute(
            "UPDATE exercise_log SET exercise = ?, muscle_group = ? WHERE muscle_group = ? AND exercise = ?",
            (resolved_exercise, resolved_muscle, row["target_muscle"], row["exercise"]),
        )
    db.execute("DELETE FROM exercise_plan WHERE id = ?", (plan_id,))
    db.commit()
    return jsonify({"id": plan_id, "relabeled_to": resolved_exercise or None})
