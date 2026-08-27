"""Auth API: signup/login/logout, profile updates, period logging, avatar upload."""
import os
import random
import re
import time
import uuid

from flask import Blueprint, jsonify, request, session
from PIL import Image, ImageOps
from werkzeug.security import check_password_hash, generate_password_hash
from werkzeug.utils import secure_filename

from db import get_db
from helpers import get_current_user_id, is_future_date, require_login
from mail import send_otp_email
from paths import UPLOAD_DIR

bp = Blueprint("auth", __name__)

PIN_LENGTH = 4
ALLOWED_AVATAR_EXTENSIONS = {"png", "jpg", "jpeg", "gif", "webp"}
# Uploads come straight from a phone camera/gallery with no client-side
# resizing - a raw photo can be several MB. Re-encoding down to a small,
# uniform JPEG here is what keeps 1000 users' avatars from costing gigabytes
# of disk instead of tens of megabytes.
AVATAR_MAX_DIMENSION = 256
AVATAR_JPEG_QUALITY = 80
OTP_LENGTH = 6
OTP_TTL_SECONDS = 10 * 60
OTP_RESEND_COOLDOWN_SECONDS = 30
OTP_MAX_ATTEMPTS = 5
# 1, not higher: the Your Cycle calendar lets a period be logged as a single
# tapped day (Log Period -> tap one day -> Save), which is a legitimate,
# easily-produced selection, not an input error.
MIN_PERIOD_DAYS = 1
MAX_PERIOD_DAYS = 10


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


EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


def _valid_email(email):
    # Deliberately loose — this isn't verified by a real email round-trip,
    # just enough to catch obvious typos (e.g. "com1" with no "@", or a
    # domain with no "." like "user@com1") before it becomes the login key.
    return bool(email) and bool(EMAIL_RE.match(email))


def _user_public_dict(row):
    d = dict(row)
    d.pop("password_hash", None)
    d.pop("username", None)
    return d


@bp.route("/api/me", methods=["GET"])
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


@bp.route("/api/check-email", methods=["POST"])
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


def _generate_otp():
    return "".join(random.choices("0123456789", k=OTP_LENGTH))


@bp.route("/api/send-otp", methods=["POST"])
def send_otp():
    """Emails a 6-digit code to prove the signup step 2 owns this address,
    before it becomes their login key. Session-stored (not DB-stored): it's
    only ever needed for the lifetime of this one signup attempt."""
    data = request.get_json(force=True)
    email = _normalize_email(data.get("email"))
    if not _valid_email(email):
        return jsonify({"error": "enter a valid email"}), 400

    db = get_db()
    if db.execute("SELECT 1 FROM users WHERE email = ?", (email,)).fetchone():
        return jsonify({"error": "that email is already registered"}), 409

    now = time.time()
    existing = session.get("otp")
    if existing and existing["email"] == email and now - existing["sent_at"] < OTP_RESEND_COOLDOWN_SECONDS:
        wait = int(OTP_RESEND_COOLDOWN_SECONDS - (now - existing["sent_at"]))
        return jsonify({"error": f"wait {wait}s before requesting another code"}), 429

    code = _generate_otp()
    try:
        send_otp_email(email, code)
    except Exception:
        return jsonify({"error": "couldn't send the verification email - try again"}), 502

    session["otp"] = {"email": email, "code": code, "sent_at": now, "attempts": 0}
    session.pop("otp_verified_email", None)
    return jsonify({"ok": True})


@bp.route("/api/verify-otp", methods=["POST"])
def verify_otp():
    data = request.get_json(force=True)
    email = _normalize_email(data.get("email"))
    code = (data.get("code") or "").strip()

    otp = session.get("otp")
    if not otp or otp["email"] != email:
        return jsonify({"error": "request a new code"}), 400
    if time.time() - otp["sent_at"] > OTP_TTL_SECONDS:
        session.pop("otp", None)
        return jsonify({"error": "code expired - request a new one"}), 400
    if otp["attempts"] >= OTP_MAX_ATTEMPTS:
        session.pop("otp", None)
        return jsonify({"error": "too many attempts - request a new code"}), 400

    if code != otp["code"]:
        otp["attempts"] += 1
        session["otp"] = otp
        return jsonify({"error": "incorrect code"}), 401

    session.pop("otp", None)
    session["otp_verified_email"] = email
    return jsonify({"ok": True})


@bp.route("/api/signup", methods=["POST"])
def signup():
    data = request.get_json(force=True)
    name = _capitalize_name(data.get("name"))
    email = _normalize_email(data.get("email"))
    pin = data.get("pin") or ""
    if not name:
        return jsonify({"error": "name is required"}), 400
    if not _valid_email(email):
        return jsonify({"error": "enter a valid email"}), 400
    if session.get("otp_verified_email") != email:
        return jsonify({"error": "verify your email first"}), 403
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


@bp.route("/api/login", methods=["POST"])
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


@bp.route("/api/logout", methods=["POST"])
def logout():
    session.clear()
    return jsonify({"ok": True})


@bp.route("/api/user/<int:user_id>", methods=["PUT"])
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


@bp.route("/api/user/<int:user_id>/period", methods=["PUT"])
def log_period(user_id):
    """Quick-action used by the "Log Period" button on the Your Cycle tab -
    deliberately separate from update_user (which requires a full profile
    payload incl. name) so logging a period start is a single lightweight
    call, not a full profile resubmit."""
    current_id, err = require_login()
    if err:
        return err
    if current_id != user_id:
        return jsonify({"error": "forbidden"}), 403
    data = request.get_json(force=True)
    last_period_date = (data.get("last_period_date") or "").strip()
    if not last_period_date:
        return jsonify({"error": "date is required"}), 400
    if is_future_date(last_period_date):
        return jsonify({"error": "date cannot be in the future"}), 400
    try:
        period_length_days = int(data.get("period_length_days"))
    except (TypeError, ValueError):
        return jsonify({"error": "period_length_days must be a number"}), 400
    if not (MIN_PERIOD_DAYS <= period_length_days <= MAX_PERIOD_DAYS):
        return jsonify({"error": f"period length must be between {MIN_PERIOD_DAYS} and {MAX_PERIOD_DAYS} days"}), 400
    db = get_db()
    db.execute(
        "UPDATE users SET last_period_date = ?, period_length_days = ? WHERE id = ?",
        (last_period_date, period_length_days, user_id),
    )
    db.commit()
    return jsonify({"last_period_date": last_period_date, "period_length_days": period_length_days})


@bp.route("/api/user/<int:user_id>/avatar", methods=["POST"])
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

    try:
        image = ImageOps.exif_transpose(Image.open(file.stream))  # undo phone camera rotation
        image = image.convert("RGB")
        image.thumbnail((AVATAR_MAX_DIMENSION, AVATAR_MAX_DIMENSION))
    except Exception:
        return jsonify({"error": "couldn't read that image"}), 400

    db = get_db()
    old_avatar = db.execute("SELECT avatar FROM users WHERE id = ?", (user_id,)).fetchone()["avatar"]

    # Always re-encoded to JPEG regardless of upload format, so size stays
    # predictable and every avatar on disk is small and uniform.
    filename = secure_filename(f"user{user_id}_{uuid.uuid4().hex}.jpg")
    image.save(os.path.join(UPLOAD_DIR, filename), "JPEG", quality=AVATAR_JPEG_QUALITY, optimize=True)
    avatar_url = f"/uploads/{filename}"
    db.execute("UPDATE users SET avatar = ? WHERE id = ?", (avatar_url, user_id))
    db.commit()

    if old_avatar and old_avatar.startswith("/uploads/"):
        try:
            os.remove(os.path.join(UPLOAD_DIR, os.path.basename(old_avatar)))
        except OSError:
            pass  # already gone - not worth failing the request over

    return jsonify({"avatar": avatar_url})
