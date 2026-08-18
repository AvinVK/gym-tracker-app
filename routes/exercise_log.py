"""Exercise Log API: individual sets logged against a workout_log visit."""
import json
from datetime import datetime

from flask import Blueprint, jsonify, request

from db import EXERCISE_LOG_KNOWN_ATTRS, get_db
from helpers import get_current_user_id, is_future_date

bp = Blueprint("exercise_log", __name__)


def _exercise_log_dict(row):
    """Flattens the `extra_attributes` JSON blob (rare, exercise-specific
    fields like inclination_percent/speed_kmh) back onto the row so API
    consumers see the same flat shape as the set data they submitted."""
    d = dict(row)
    extra = d.pop("extra_attributes", None)
    if extra:
        d.update(json.loads(extra))
    # previous_values (see update_exercise_log) is a nested snapshot, not
    # flattened like extra_attributes - it represents a separate point in
    # time, so merging it into the current row's fields would just look
    # like the row currently has two different values for the same key.
    prev = d.get("previous_values")
    if prev:
        d["previous_values"] = json.loads(prev)
    return d


@bp.route("/api/exercise-log", methods=["GET"])
def list_exercise_log():
    user_id = get_current_user_id()
    if not user_id:
        return jsonify({"error": "missing user"}), 401
    date_filter = request.args.get("date")
    # Soft-deleted rows (see delete_exercise_log) are excluded by default so
    # every other caller of this endpoint - PR detection, performance charts,
    # the workout-log muscle summary - never sees a set the user removed.
    # The History detail view is the one place that wants them (to show a
    # "you deleted this set" line, see startGroupEdit/saveGroupEdit in
    # app.js), so it opts in explicitly.
    deleted_clause = "" if request.args.get("include_deleted") == "1" else "AND deleted_at IS NULL"
    db = get_db()
    if date_filter:
        rows = db.execute(
            f"SELECT * FROM exercise_log WHERE user_id = ? AND date = ? {deleted_clause} ORDER BY id",
            (user_id, date_filter),
        ).fetchall()
    else:
        rows = db.execute(
            f"SELECT * FROM exercise_log WHERE user_id = ? {deleted_clause} ORDER BY date DESC, id DESC",
            (user_id,),
        ).fetchall()
    return jsonify([_exercise_log_dict(r) for r in rows])


@bp.route("/api/exercise-log", methods=["POST"])
def add_exercise_log():
    user_id = get_current_user_id()
    if not user_id:
        return jsonify({"error": "missing user"}), 401
    data = request.get_json(force=True)
    date = (data.get("date") or "").strip()
    exercises = data.get("exercises") or []
    if not date or not exercises:
        return jsonify({"error": "date and at least one exercise are required"}), 400
    if is_future_date(date):
        return jsonify({"error": "date cannot be in the future"}), 400

    db = get_db()
    visit_count = db.execute(
        "SELECT COUNT(*) AS c FROM workout_log WHERE user_id = ? AND date = ?", (user_id, date)
    ).fetchone()["c"]
    if visit_count == 0:
        return jsonify({"error": "Log a gym visit for this date before adding exercises"}), 400

    # Set by the History group-editor's Save (see startGroupEdit/saveGroupEdit
    # in app.js) when these rows are new sets being added to an
    # already-logged exercise, not the day's original entry - stamping
    # added_at lets the History view show an "Added" badge on them,
    # distinct from a set that's always been there. Computed once in Python
    # (rather than SQL's datetime('now')) so every row in this batch gets
    # the exact same value, bindable as a plain executemany() parameter.
    added_at = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S") if data.get("mark_edited") else None

    rows = []
    for ex in exercises:
        muscle_group = (ex.get("muscle_group") or "").strip()
        exercise = (ex.get("exercise") or "").strip()
        sets = ex.get("sets") or []
        if not muscle_group or not exercise or not sets:
            return jsonify({"error": "each exercise needs a muscle_group, exercise and at least one set"}), 400
        for i, s in enumerate(sets):
            extra = {
                k: v for k, v in s.items()
                if k not in ("notes", "set_number") and k not in EXERCISE_LOG_KNOWN_ATTRS and v is not None
            }
            rows.append((
                # The History group-editor's Save reconciles existing (PUT)
                # and newly-added (POST) sets within one group - new sets
                # need to land at the right position among ones that already
                # exist, not always restart at 1, so an explicit set_number
                # is honored when the caller sends one.
                user_id, date, muscle_group, exercise, s.get("set_number") or i + 1,
                s.get("reps"), s.get("weight_kg"), s.get("duration_minutes"), s.get("intensity_level"),
                json.dumps(extra) if extra else None, s.get("notes", ""), added_at,
            ))

    cur = db.executemany(
        "INSERT INTO exercise_log (user_id, date, muscle_group, exercise, set_number, "
        "reps, weight_kg, duration_minutes, intensity_level, extra_attributes, notes, added_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        rows,
    )
    # Set by the History group-editor's Save (see startGroupEdit/saveGroupEdit
    # in app.js) when these rows are new sets being added to an
    # already-logged exercise, not the original first-time entry for the
    # day - that's still editing today's log, so it cascades the same way a
    # value edit or a deleted set does (see update_exercise_log/
    # delete_exercise_log), even though nothing about the new rows
    # themselves is "edited" (they get edited_at = NULL, same as any other
    # freshly-logged set).
    if data.get("mark_edited"):
        db.execute(
            "UPDATE workout_log SET edited_at = datetime('now') WHERE user_id = ? AND date = ?",
            (user_id, date),
        )
    db.commit()
    return jsonify({"inserted": cur.rowcount}), 201


# Identity/bookkeeping columns that don't belong in a "previous values"
# snapshot (see update_exercise_log) - everything else a set's summary line
# can display (reps, weight, duration, level/speed, notes) is kept.
EXERCISE_LOG_SNAPSHOT_EXCLUDE = {
    "id", "user_id", "date", "muscle_group", "exercise", "set_number",
    "edited_at", "previous_values", "added_at", "deleted_at",
}


@bp.route("/api/exercise-log/<int:row_id>", methods=["PUT"])
def update_exercise_log(row_id):
    user_id = get_current_user_id()
    if not user_id:
        return jsonify({"error": "missing user"}), 401
    data = request.get_json(force=True)
    muscle_group = (data.get("muscle_group") or "").strip()
    exercise = (data.get("exercise") or "").strip()
    if not muscle_group or not exercise:
        return jsonify({"error": "muscle_group and exercise are required"}), 400
    db = get_db()
    existing = db.execute(
        "SELECT * FROM exercise_log WHERE id = ? AND user_id = ?", (row_id, user_id)
    ).fetchone()
    if not existing:
        return jsonify({"error": "not found"}), 404
    # What the set actually looked like right before this edit - shown in
    # the History detail view as "was ..." next to the Edited badge.
    previous_snapshot = {
        k: v for k, v in _exercise_log_dict(existing).items()
        if k not in EXERCISE_LOG_SNAPSHOT_EXCLUDE
    }
    non_attr_keys = {"muscle_group", "exercise", "set_number", "notes", "edited_at", "previous_values", "added_at", "deleted_at"} | set(EXERCISE_LOG_KNOWN_ATTRS)
    extra = {k: v for k, v in data.items() if k not in non_attr_keys and v is not None}
    existing_extra = json.loads(existing["extra_attributes"]) if existing["extra_attributes"] else {}
    # set_number deliberately excluded - the History group-editor (see
    # startGroupEdit in app.js) PUTs every set in a group on every Save so
    # it can keep set_number sequential after an add/remove, which would
    # otherwise mark a set "Edited" just because a sibling was deleted and
    # it shifted from Set 3 to Set 2, even though nothing about *it* changed.
    data_changed = (
        muscle_group != existing["muscle_group"]
        or exercise != existing["exercise"]
        or data.get("reps") != existing["reps"]
        or data.get("weight_kg") != existing["weight_kg"]
        or data.get("duration_minutes") != existing["duration_minutes"]
        or data.get("intensity_level") != existing["intensity_level"]
        or (data.get("notes") or "") != (existing["notes"] or "")
        or extra != existing_extra
    )
    if data_changed:
        db.execute(
            "UPDATE exercise_log SET muscle_group = ?, exercise = ?, set_number = ?, "
            "reps = ?, weight_kg = ?, duration_minutes = ?, intensity_level = ?, extra_attributes = ?, notes = ?, "
            "edited_at = datetime('now'), previous_values = ? "
            "WHERE id = ? AND user_id = ?",
            (muscle_group, exercise, data.get("set_number"),
             data.get("reps"), data.get("weight_kg"), data.get("duration_minutes"), data.get("intensity_level"),
             json.dumps(extra) if extra else None,
             data.get("notes", ""),
             json.dumps(previous_snapshot),
             row_id, user_id),
        )
        # Editing a set is still editing that day's log, even though the
        # visit (workout_log) row itself wasn't directly touched - cascade
        # the timestamp up so the Workout Log table also flags the day as
        # edited, not just the History detail view's per-set badge.
        db.execute(
            "UPDATE workout_log SET edited_at = datetime('now') WHERE user_id = ? AND date = ?",
            (user_id, existing["date"]),
        )
    else:
        db.execute(
            "UPDATE exercise_log SET muscle_group = ?, exercise = ?, set_number = ?, "
            "reps = ?, weight_kg = ?, duration_minutes = ?, intensity_level = ?, extra_attributes = ?, notes = ? "
            "WHERE id = ? AND user_id = ?",
            (muscle_group, exercise, data.get("set_number"),
             data.get("reps"), data.get("weight_kg"), data.get("duration_minutes"), data.get("intensity_level"),
             json.dumps(extra) if extra else None,
             data.get("notes", ""),
             row_id, user_id),
        )
    db.commit()
    return jsonify({"id": row_id})


@bp.route("/api/exercise-log/<int:row_id>", methods=["DELETE"])
def delete_exercise_log(row_id):
    user_id = get_current_user_id()
    if not user_id:
        return jsonify({"error": "missing user"}), 401
    db = get_db()
    existing = db.execute(
        "SELECT date FROM exercise_log WHERE id = ? AND user_id = ?", (row_id, user_id)
    ).fetchone()
    # Soft delete (?soft=1) - used when removing one set from a group that
    # still has other sets left (see saveGroupEdit in app.js) - keeps the
    # row (marked deleted_at, hidden from every normal query by default, see
    # list_exercise_log) so the History detail view can still show a "you
    # deleted this set" line for it. The group-level "Delete" button (wiping
    # an entire exercise's log for the day) hard-deletes as before - an
    # intentional full removal shouldn't leave a lingering trace.
    if request.args.get("soft") == "1":
        db.execute(
            "UPDATE exercise_log SET deleted_at = datetime('now') WHERE id = ? AND user_id = ?",
            (row_id, user_id),
        )
    else:
        db.execute("DELETE FROM exercise_log WHERE id = ? AND user_id = ?", (row_id, user_id))
    # Removing a previously-logged set is still editing that day's log, same
    # as changing one of its values (see update_exercise_log) - cascades the
    # same way so the Workout Log table flags the day as edited here too.
    if existing:
        db.execute(
            "UPDATE workout_log SET edited_at = datetime('now') WHERE user_id = ? AND date = ?",
            (user_id, existing["date"]),
        )
    db.commit()
    return "", 204
