import json
import os
import secrets
import subprocess
import uuid
from datetime import datetime, timedelta
from flask import Flask, jsonify, request, send_from_directory, session
from werkzeug.security import check_password_hash, generate_password_hash
from werkzeug.utils import secure_filename

import config
from db import close_db, get_db, init_db
from streaks import compute_streak_status

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "static")
UPLOAD_DIR = os.path.join(STATIC_DIR, "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)
ALLOWED_AVATAR_EXTENSIONS = {"png", "jpg", "jpeg", "gif", "webp"}
SECRET_KEY_PATH = os.path.join(BASE_DIR, "secret_key.txt")


def get_secret_key():
    """Session cookies are signed with this. Prefer a real SECRET_KEY env var
    (set one on the production host); fall back to a local file generated on
    first run so sessions survive restarts without committing a secret to git."""
    env_key = os.environ.get("SECRET_KEY")
    if env_key:
        return env_key
    if os.path.exists(SECRET_KEY_PATH):
        return open(SECRET_KEY_PATH, "r", encoding="utf-8").read().strip()
    key = secrets.token_hex(32)
    with open(SECRET_KEY_PATH, "w", encoding="utf-8") as f:
        f.write(key)
    return key


app = Flask(__name__, static_folder=STATIC_DIR, static_url_path="")
app.teardown_appcontext(close_db)
app.secret_key = get_secret_key()
app.config["PERMANENT_SESSION_LIFETIME"] = timedelta(days=30)
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"


def is_future_date(date_str):
    try:
        return datetime.strptime(date_str, "%Y-%m-%d").date() > datetime.now().date()
    except ValueError:
        return False


def get_current_user_id():
    """The logged-in user, from the signed session cookie Flask verifies for
    us — unlike a client-supplied header, this can't be spoofed to read or
    write someone else's data."""
    return session.get("user_id")


def require_login():
    user_id = get_current_user_id()
    if not user_id:
        return None, (jsonify({"error": "not logged in"}), 401)
    return user_id, None


# ---------------------------------------------------------------
# Static frontend
# ---------------------------------------------------------------
@app.route("/")
def index():
    return send_from_directory(STATIC_DIR, "index.html")


# ---------------------------------------------------------------
# CI deploy webhook
#
# PythonAnywhere's Consoles API blocks programmatic console creation on
# free accounts, so CI can't drive a `git pull` through a console. This
# route does the pull itself, from inside the already-running app, which
# needs no special API access. GitHub Actions POSTs here with the
# DEPLOY_SECRET (set as an env var on PythonAnywhere's Web tab) after
# every push to main.
# ---------------------------------------------------------------
DEPLOY_WSGI_FILE = "/var/www/avin0406_pythonanywhere_com_wsgi.py"


@app.route("/deploy", methods=["POST"])
def deploy():
    expected = (os.environ.get("DEPLOY_SECRET") or "").strip()
    provided = request.headers.get("X-Deploy-Secret", "").strip()
    if not expected or not secrets.compare_digest(provided, expected):
        return jsonify({"error": "forbidden"}), 403

    result = subprocess.run(
        ["git", "pull", "origin", "main"],
        cwd=BASE_DIR,
        capture_output=True,
        text=True,
        timeout=60,
    )
    output = result.stdout + result.stderr
    if result.returncode != 0:
        return jsonify({"ok": False, "step": "git pull", "output": output}), 500

    try:
        os.utime(DEPLOY_WSGI_FILE, None)
    except OSError as e:
        return jsonify({"ok": False, "step": "reload", "output": output, "error": str(e)}), 500

    return jsonify({"ok": True, "output": output})


# ---------------------------------------------------------------
# Auth API
# ---------------------------------------------------------------
PIN_LENGTH = 4


def _valid_pin(pin):
    return isinstance(pin, str) and len(pin) == PIN_LENGTH and pin.isdigit()


def _normalize_email(email):
    return (email or "").strip().lower()


def _capitalize_name(name):
    """Only the first character — deliberately not .title(), which would
    also force-capitalize every subsequent word (breaks names like
    "van Dyke" or hyphenated/multi-word names)."""
    name = (name or "").strip()
    return name[:1].upper() + name[1:] if name else name


def _valid_email(email):
    # Deliberately loose — this isn't verified by a real email round-trip,
    # just enough to catch obvious typos before it becomes the login key.
    return bool(email) and "@" in email and "." in email.split("@")[-1]


def _user_public_dict(row):
    d = dict(row)
    d.pop("password_hash", None)
    d.pop("username", None)
    return d


@app.route("/api/me", methods=["GET"])
def get_me():
    user_id = get_current_user_id()
    if not user_id:
        return jsonify(None)
    db = get_db()
    row = db.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    if not row:
        session.clear()
        return jsonify(None)
    return jsonify(_user_public_dict(row))


@app.route("/api/check-email", methods=["POST"])
def check_email():
    """Step 2 of the login wizard: does this email already have an account?
    Drives whether the frontend shows the new-user setup step or the
    returning-user PIN step next."""
    data = request.get_json(force=True)
    email = _normalize_email(data.get("email"))
    if not _valid_email(email):
        return jsonify({"error": "enter a valid email"}), 400
    db = get_db()
    row = db.execute("SELECT id, name FROM users WHERE email = ?", (email,)).fetchone()
    if row:
        return jsonify({"exists": True, "name": row["name"]})
    return jsonify({"exists": False})


@app.route("/api/signup", methods=["POST"])
def signup():
    data = request.get_json(force=True)
    name = _capitalize_name(data.get("name"))
    email = _normalize_email(data.get("email"))
    pin = data.get("pin") or ""
    if not name:
        return jsonify({"error": "name is required"}), 400
    if not _valid_email(email):
        return jsonify({"error": "enter a valid email"}), 400
    if not _valid_pin(pin):
        return jsonify({"error": f"PIN must be exactly {PIN_LENGTH} digits"}), 400
    if data.get("last_period_date") and is_future_date(data["last_period_date"]):
        return jsonify({"error": "last_period_date cannot be in the future"}), 400

    db = get_db()
    if db.execute("SELECT 1 FROM users WHERE email = ?", (email,)).fetchone():
        return jsonify({"error": "that email is already registered"}), 409

    cur = db.execute(
        "INSERT INTO users (name, email, password_hash, age, last_period_date) VALUES (?, ?, ?, ?, ?)",
        (name, email, generate_password_hash(pin), data.get("age"), data.get("last_period_date") or None),
    )
    db.commit()
    session.clear()
    session.permanent = True
    session["user_id"] = cur.lastrowid
    return jsonify({"id": cur.lastrowid}), 201


@app.route("/api/login", methods=["POST"])
def login():
    data = request.get_json(force=True)
    email = _normalize_email(data.get("email"))
    pin = data.get("pin") or ""
    db = get_db()
    row = db.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
    if not row or not row["password_hash"] or not check_password_hash(row["password_hash"], pin):
        return jsonify({"error": "incorrect email or PIN"}), 401
    session.clear()
    session.permanent = True
    session["user_id"] = row["id"]
    return jsonify(_user_public_dict(row))


@app.route("/api/logout", methods=["POST"])
def logout():
    session.clear()
    return jsonify({"ok": True})


@app.route("/api/user/<int:user_id>", methods=["PUT"])
def update_user(user_id):
    current_id, err = require_login()
    if err:
        return err
    if current_id != user_id:
        return jsonify({"error": "forbidden"}), 403
    data = request.get_json(force=True)
    name = _capitalize_name(data.get("name"))
    if not name:
        return jsonify({"error": "name is required"}), 400
    if data.get("last_period_date") and is_future_date(data["last_period_date"]):
        return jsonify({"error": "last_period_date cannot be in the future"}), 400
    db = get_db()
    db.execute(
        "UPDATE users SET name = ?, age = ?, last_period_date = ? WHERE id = ?",
        (name, data.get("age"), data.get("last_period_date") or None, user_id),
    )
    db.commit()
    return jsonify({"id": user_id})


@app.route("/api/user/<int:user_id>/avatar", methods=["POST"])
def upload_avatar(user_id):
    current_id, err = require_login()
    if err:
        return err
    if current_id != user_id:
        return jsonify({"error": "forbidden"}), 403
    file = request.files.get("avatar")
    if not file or file.filename == "":
        return jsonify({"error": "avatar file is required"}), 400
    ext = file.filename.rsplit(".", 1)[-1].lower() if "." in file.filename else ""
    if ext not in ALLOWED_AVATAR_EXTENSIONS:
        return jsonify({"error": "unsupported file type"}), 400
    filename = secure_filename(f"user{user_id}_{uuid.uuid4().hex}.{ext}")
    file.save(os.path.join(UPLOAD_DIR, filename))
    avatar_url = f"/uploads/{filename}"
    db = get_db()
    db.execute("UPDATE users SET avatar = ? WHERE id = ?", (avatar_url, user_id))
    db.commit()
    return jsonify({"avatar": avatar_url})


# ---------------------------------------------------------------
# Exercise Plan API
# ---------------------------------------------------------------
def _exercise_plan_dict(row):
    d = dict(row)
    d["images"] = json.loads(d["images"]) if d.get("images") else []
    return d


@app.route("/api/exercise-plan", methods=["GET"])
def list_exercise_plan():
    db = get_db()
    rows = db.execute(
        "SELECT * FROM exercise_plan ORDER BY target_muscle, id"
    ).fetchall()
    return jsonify([_exercise_plan_dict(r) for r in rows])


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
        "SELECT id, exercise, type, images, curated FROM exercise_plan WHERE target_muscle = ? "
        "ORDER BY curated DESC, exercise",
        (muscle,),
    ).fetchall()
    return jsonify([_exercise_plan_dict(r) for r in rows])


# ---------------------------------------------------------------
# Workout Log API
# ---------------------------------------------------------------
@app.route("/api/workout-log", methods=["GET"])
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


@app.route("/api/workout-log", methods=["POST"])
def add_workout_log():
    user_id = get_current_user_id()
    if not user_id:
        return jsonify({"error": "missing user"}), 401
    data = request.get_json(force=True)
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


@app.route("/api/workout-log/<int:row_id>", methods=["PUT"])
def update_workout_log(row_id):
    user_id = get_current_user_id()
    if not user_id:
        return jsonify({"error": "missing user"}), 401
    data = request.get_json(force=True)
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


# ---------------------------------------------------------------
# Streak API
# ---------------------------------------------------------------
@app.route("/api/streak", methods=["GET"])
def get_streak():
    user_id, err = require_login()
    if err:
        return err
    db = get_db()
    return jsonify(compute_streak_status(db, user_id))


# ---------------------------------------------------------------
# Exercise Log API (exercises done per session)
# ---------------------------------------------------------------
EXERCISE_LOG_KNOWN_ATTRS = ("reps", "weight_kg", "duration_minutes", "intensity_level")


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


@app.route("/api/exercise-log", methods=["GET"])
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


@app.route("/api/exercise-log", methods=["POST"])
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


@app.route("/api/exercise-log/<int:row_id>", methods=["PUT"])
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


@app.route("/api/exercise-log/<int:row_id>", methods=["DELETE"])
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


if __name__ == "__main__":
    init_db()
    app.run(host="0.0.0.0", port=int(config.get("PORT")), debug=False)
else:
    init_db()
