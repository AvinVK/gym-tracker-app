import os
import secrets
import uuid
from datetime import datetime, timedelta
from flask import Flask, jsonify, request, send_from_directory, session
from werkzeug.security import check_password_hash, generate_password_hash
from werkzeug.utils import secure_filename

import config
from db import close_db, get_db, init_db

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
@app.route("/api/workout-log", methods=["GET"])
def list_workout_log():
    user_id = get_current_user_id()
    if not user_id:
        return jsonify({"error": "missing user"}), 401
    db = get_db()
    rows = db.execute(
        "SELECT wl.*, ("
        "  SELECT GROUP_CONCAT(DISTINCT el.muscle_group) FROM exercise_log el"
        "  WHERE el.user_id = wl.user_id AND el.date = wl.date"
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
        "notes = ? WHERE id = ? AND user_id = ?",
        (
            date, data.get("energy_level"),
            data.get("pre_workout_meal", ""), data.get("hours_since_meal") or None, data.get("notes", ""),
            row_id, user_id,
        ),
    )
    db.commit()
    return jsonify({"id": row_id})


# ---------------------------------------------------------------
# Exercise Log API (exercises done per session)
# ---------------------------------------------------------------
@app.route("/api/exercise-log", methods=["GET"])
def list_exercise_log():
    user_id = get_current_user_id()
    if not user_id:
        return jsonify({"error": "missing user"}), 401
    date_filter = request.args.get("date")
    db = get_db()
    if date_filter:
        rows = db.execute(
            "SELECT * FROM exercise_log WHERE user_id = ? AND date = ? ORDER BY id", (user_id, date_filter)
        ).fetchall()
    else:
        rows = db.execute(
            "SELECT * FROM exercise_log WHERE user_id = ? ORDER BY date DESC, id DESC", (user_id,)
        ).fetchall()
    return jsonify([dict(r) for r in rows])


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

    rows = []
    for ex in exercises:
        muscle_group = (ex.get("muscle_group") or "").strip()
        exercise = (ex.get("exercise") or "").strip()
        sets = ex.get("sets") or []
        if not muscle_group or not exercise or not sets:
            return jsonify({"error": "each exercise needs a muscle_group, exercise and at least one set"}), 400
        for i, s in enumerate(sets):
            rows.append((user_id, date, muscle_group, exercise, i + 1, s.get("reps"), s.get("weight_kg"), s.get("notes", "")))

    cur = db.executemany(
        "INSERT INTO exercise_log (user_id, date, muscle_group, exercise, set_number, reps, weight_kg, notes) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        rows,
    )
    db.commit()
    return jsonify({"inserted": cur.rowcount}), 201


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
    db.execute(
        "UPDATE exercise_log SET muscle_group = ?, exercise = ?, set_number = ?, reps = ?, "
        "weight_kg = ?, notes = ? WHERE id = ? AND user_id = ?",
        (muscle_group, exercise, data.get("set_number"), data.get("reps"),
         data.get("weight_kg"), data.get("notes", ""), row_id, user_id),
    )
    db.commit()
    return jsonify({"id": row_id})


@app.route("/api/exercise-log/<int:row_id>", methods=["DELETE"])
def delete_exercise_log(row_id):
    user_id = get_current_user_id()
    if not user_id:
        return jsonify({"error": "missing user"}), 401
    db = get_db()
    db.execute("DELETE FROM exercise_log WHERE id = ? AND user_id = ?", (row_id, user_id))
    db.commit()
    return "", 204


if __name__ == "__main__":
    init_db()
    app.run(host="0.0.0.0", port=int(config.get("PORT")), debug=False)
else:
    init_db()
