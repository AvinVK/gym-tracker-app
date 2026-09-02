"""Auth API: signup/login/logout, profile updates, period logging, avatar upload."""
import os
import random
import re
import sqlite3
import time
import uuid

from flask import Blueprint, jsonify, request, session
from PIL import Image, ImageOps
from werkzeug.security import check_password_hash, generate_password_hash
from werkzeug.utils import secure_filename

from db import get_db
from helpers import get_current_user_id, is_future_date, require_login
from mail import send_otp_email, send_pin_reset_email
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
RESET_OTP_MAX_PER_HOUR = 5
RESET_OTP_RATE_WINDOW_SECONDS = 60 * 60
# A 4-digit PIN is only 10,000 combinations - without a lockout it's
# brute-forceable over the API. In-memory (not DB/session) since this needs
# to catch attempts across different devices/cookies for the same email, not
# just repeats from one browser.
LOGIN_MAX_ATTEMPTS = 5
LOGIN_ATTEMPT_WINDOW_SECONDS = 15 * 60
LOGIN_LOCKOUT_SECONDS = 15 * 60
# 1, not higher: the Your Cycle calendar lets a period be logged as a single
# tapped day (Log Period -> tap one day -> Save), which is a legitimate,
# easily-produced selection, not an input error.
MIN_PERIOD_DAYS = 1
MAX_PERIOD_DAYS = 10
DEFAULT_CYCLE_LENGTH_DAYS = 28
# Real menstrual cycles commonly range ~21-35 days; a wider band up to 45
# still covers longer irregular cycles without accepting obvious typos.
MIN_CYCLE_LENGTH_DAYS = 21
MAX_CYCLE_LENGTH_DAYS = 45
VALID_WEIGHT_UNITS = {"kg", "lb"}


def _valid_cycle_length(value):
    try:
        n = int(value)
    except (TypeError, ValueError):
        return None
    return n if MIN_CYCLE_LENGTH_DAYS <= n <= MAX_CYCLE_LENGTH_DAYS else None


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


def _user_public_dict(row, db=None):
    d = dict(row)
    d.pop("password_hash", None)
    d.pop("username", None)
    # Full per-cycle period history (see period_logs in db.py) - the client
    # needs every logged cycle's own length, not just last_period_date/
    # period_length_days, so an earlier or later cycle's phase display never
    # gets repainted by a different cycle's length.
    if db is not None:
        d["period_logs"] = [
            {"start_date": r["start_date"], "length_days": r["length_days"]}
            for r in db.execute(
                "SELECT start_date, length_days FROM period_logs WHERE user_id = ? ORDER BY start_date",
                (d["id"],),
            ).fetchall()
        ]
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
    return jsonify(_user_public_dict(row, db))


@bp.route("/api/check-email", methods=["POST"])
def check_email():
    """Step 2 of the login wizard: does this email already have an account?
    Drives whether the frontend shows the new-user setup step or the
    returning-user PIN step next."""
    data = request.get_json(force=True) or {}
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
    data = request.get_json(force=True) or {}
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
    data = request.get_json(force=True) or {}
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
    data = request.get_json(force=True) or {}
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

    last_period_date = data.get("last_period_date") or None
    try:
        cur = db.execute(
            "INSERT INTO users (name, email, password_hash, age, last_period_date) VALUES (?, ?, ?, ?, ?)",
            (name, email, generate_password_hash(pin), data.get("age"), last_period_date),
        )
    except sqlite3.IntegrityError:
        # Two signups for the same email raced past the SELECT check above -
        # the UNIQUE index on users.email is the real guard; this just turns
        # its rejection into the same clean 409 the check above normally
        # gives, instead of an unhandled 500.
        db.rollback()
        return jsonify({"error": "that email is already registered"}), 409
    if last_period_date:
        # Mirrors the users.period_length_days column default (5) - signup
        # doesn't collect a length yet, so this first period_logs row starts
        # out the same as every other unconfirmed cycle until the user
        # explicitly edits it via Log Period.
        db.execute(
            "INSERT INTO period_logs (user_id, start_date, length_days) VALUES (?, ?, 5)",
            (cur.lastrowid, last_period_date),
        )
    db.commit()
    session.clear()
    session.permanent = True
    session["user_id"] = cur.lastrowid
    return jsonify({"id": cur.lastrowid}), 201


_login_attempts = {}  # email -> {"count", "window_start", "locked_until"}


def _login_lockout_remaining(email):
    rec = _login_attempts.get(email)
    if not rec or not rec["locked_until"]:
        return None
    remaining = rec["locked_until"] - time.time()
    return int(remaining) if remaining > 0 else None


def _record_login_failure(email):
    now = time.time()
    rec = _login_attempts.get(email)
    if not rec or now - rec["window_start"] > LOGIN_ATTEMPT_WINDOW_SECONDS:
        rec = {"count": 0, "window_start": now, "locked_until": None}
    rec["count"] += 1
    if rec["count"] >= LOGIN_MAX_ATTEMPTS:
        rec["locked_until"] = now + LOGIN_LOCKOUT_SECONDS
    _login_attempts[email] = rec


@bp.route("/api/login", methods=["POST"])
def login():
    data = request.get_json(force=True) or {}
    email = _normalize_email(data.get("email"))
    pin = data.get("pin") or ""

    wait = _login_lockout_remaining(email)
    if wait:
        return jsonify({"error": f"too many attempts - try again in {wait // 60 + 1} min"}), 429

    db = get_db()
    row = db.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
    if not row or not row["password_hash"] or not check_password_hash(row["password_hash"], pin):
        _record_login_failure(email)
        return jsonify({"error": "incorrect email or PIN"}), 401
    _login_attempts.pop(email, None)
    session.clear()
    session.permanent = True
    session["user_id"] = row["id"]
    return jsonify(_user_public_dict(row, db))


@bp.route("/api/logout", methods=["POST"])
def logout():
    session.clear()
    return jsonify({"ok": True})


@bp.route("/api/forgot-pin", methods=["POST"])
def forgot_pin():
    """Step 1 of PIN reset, reached from the login modal's "Forgot PIN?"
    link - only ever shown once /api/check-email has already confirmed this
    email has an account, so (unlike send_otp) this is the one place a
    missing account is reported as an error rather than stayed silent
    about."""
    data = request.get_json(force=True) or {}
    email = _normalize_email(data.get("email"))
    if not _valid_email(email):
        return jsonify({"error": "enter a valid email"}), 400

    db = get_db()
    if not db.execute("SELECT 1 FROM users WHERE email = ?", (email,)).fetchone():
        return jsonify({"error": "no account with that email"}), 404

    now = time.time()
    existing = session.get("reset_otp")
    if existing and existing["email"] == email and now - existing["sent_at"] < OTP_RESEND_COOLDOWN_SECONDS:
        wait = int(OTP_RESEND_COOLDOWN_SECONDS - (now - existing["sent_at"]))
        return jsonify({"error": f"wait {wait}s before requesting another code"}), 429

    # Caps total codes sent per hour (on top of the 30s resend cooldown
    # above) - without this, someone could keep requesting fresh codes
    # forever, each one giving them another 5 guesses (OTP_MAX_ATTEMPTS) at
    # the 6-digit code via /api/verify-reset-otp.
    rate = session.get("reset_otp_rate")
    if not rate or rate["email"] != email or now - rate["window_start"] > RESET_OTP_RATE_WINDOW_SECONDS:
        rate = {"email": email, "window_start": now, "count": 0}
    if rate["count"] >= RESET_OTP_MAX_PER_HOUR:
        return jsonify({"error": "too many reset attempts - try again later"}), 429

    code = _generate_otp()
    try:
        send_pin_reset_email(email, code)
    except Exception:
        return jsonify({"error": "couldn't send the verification email - try again"}), 502

    rate["count"] += 1
    session["reset_otp_rate"] = rate
    session["reset_otp"] = {"email": email, "code": code, "sent_at": now, "attempts": 0}
    session.pop("reset_verified_email", None)
    return jsonify({"ok": True})


@bp.route("/api/verify-reset-otp", methods=["POST"])
def verify_reset_otp():
    data = request.get_json(force=True) or {}
    email = _normalize_email(data.get("email"))
    code = (data.get("code") or "").strip()

    otp = session.get("reset_otp")
    if not otp or otp["email"] != email:
        return jsonify({"error": "request a new code"}), 400
    if time.time() - otp["sent_at"] > OTP_TTL_SECONDS:
        session.pop("reset_otp", None)
        return jsonify({"error": "code expired - request a new one"}), 400
    if otp["attempts"] >= OTP_MAX_ATTEMPTS:
        session.pop("reset_otp", None)
        return jsonify({"error": "too many attempts - request a new code"}), 400

    if code != otp["code"]:
        otp["attempts"] += 1
        session["reset_otp"] = otp
        return jsonify({"error": "incorrect code"}), 401

    session.pop("reset_otp", None)
    session["reset_verified_email"] = email
    return jsonify({"ok": True})


@bp.route("/api/reset-pin", methods=["POST"])
def reset_pin():
    data = request.get_json(force=True) or {}
    email = _normalize_email(data.get("email"))
    pin = data.get("pin") or ""
    if session.get("reset_verified_email") != email:
        return jsonify({"error": "verify your email first"}), 403
    if not _valid_pin(pin):
        return jsonify({"error": f"PIN must be exactly {PIN_LENGTH} digits"}), 400

    db = get_db()
    row = db.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone()
    if not row:
        return jsonify({"error": "no account with that email"}), 404

    db.execute("UPDATE users SET password_hash = ? WHERE id = ?", (generate_password_hash(pin), row["id"]))
    db.commit()
    session.pop("reset_verified_email", None)
    return jsonify({"ok": True})


@bp.route("/api/user/<int:user_id>", methods=["PUT"])
def update_user(user_id):
    current_id, err = require_login()
    if err:
        return err
    if current_id != user_id:
        return jsonify({"error": "forbidden"}), 403
    data = request.get_json(force=True) or {}
    name = _capitalize_name(data.get("name"))
    if not name:
        return jsonify({"error": "name is required"}), 400
    if data.get("last_period_date") and is_future_date(data["last_period_date"]):
        return jsonify({"error": "last_period_date cannot be in the future"}), 400
    # Optional: absent (e.g. a plain name/age edit from a form that doesn't
    # carry this field) must leave the existing value alone, not silently
    # reset it back to the 28-day default - COALESCE(?, cycle_length_days)
    # below is what makes "not sent" and "cleared to null" behave the same.
    cycle_length_days = None
    if data.get("cycle_length_days") is not None:
        cycle_length_days = _valid_cycle_length(data["cycle_length_days"])
        if cycle_length_days is None:
            return jsonify({"error": f"cycle length must be between {MIN_CYCLE_LENGTH_DAYS} and {MAX_CYCLE_LENGTH_DAYS} days"}), 400
    # Same "absent means unchanged" COALESCE treatment as cycle_length_days
    # above - weight_unit is a display/entry preference only (see
    # routes/exercise_log.py: weight_kg itself never changes), so it's safe
    # to default-preserve rather than require every profile save to resend it.
    weight_unit = None
    if data.get("weight_unit") is not None:
        weight_unit = data["weight_unit"]
        if weight_unit not in VALID_WEIGHT_UNITS:
            return jsonify({"error": "weight_unit must be 'kg' or 'lb'"}), 400
    last_period_date = data.get("last_period_date") or None
    db = get_db()
    db.execute(
        "UPDATE users SET name = ?, age = ?, last_period_date = ?, "
        "cycle_length_days = COALESCE(?, cycle_length_days), "
        "weight_unit = COALESCE(?, weight_unit) WHERE id = ?",
        (name, data.get("age"), last_period_date, cycle_length_days, weight_unit, user_id),
    )
    if last_period_date:
        # This form has no length field (unlike Log Period's date-range
        # picker) - INSERT OR IGNORE so re-saving an already-logged date
        # never clobbers a length the user set elsewhere; a genuinely new
        # date starts at the same 5-day default every unconfirmed cycle
        # gets.
        db.execute(
            "INSERT OR IGNORE INTO period_logs (user_id, start_date, length_days) VALUES (?, ?, 5)",
            (user_id, last_period_date),
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
    data = request.get_json(force=True) or {}
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
    # Its own row, keyed by start_date - re-logging the same start_date
    # updates that cycle's length rather than adding a duplicate, but never
    # touches any other cycle's row (see cycle.py: length is per-cycle, not
    # a single constant).
    db.execute(
        "INSERT INTO period_logs (user_id, start_date, length_days) VALUES (?, ?, ?) "
        "ON CONFLICT(user_id, start_date) DO UPDATE SET length_days = excluded.length_days",
        (user_id, last_period_date, period_length_days),
    )
    # Denormalized "most recent period" on users, derived from period_logs
    # rather than trusting this call's own payload directly - so a
    # retroactively-backfilled older period can't knock "today"'s anchor
    # backwards.
    latest = db.execute(
        "SELECT start_date, length_days FROM period_logs WHERE user_id = ? ORDER BY start_date DESC LIMIT 1",
        (user_id,),
    ).fetchone()
    db.execute(
        "UPDATE users SET last_period_date = ?, period_length_days = ? WHERE id = ?",
        (latest["start_date"], latest["length_days"], user_id),
    )
    db.commit()
    return jsonify({"last_period_date": latest["start_date"], "period_length_days": latest["length_days"]})


@bp.route("/api/user/<int:user_id>/period/<start_date>", methods=["DELETE"])
def delete_period(user_id, start_date):
    """Removes one wrongly-logged period entirely (see Log Period's
    already-logged days, shown as an outline in the calendar) - not a
    per-day edit, since a period_logs row is one start_date/length_days
    unit; fixing a bad entry means deleting the whole row, not shrinking it
    (that's what re-logging with a different day count already does)."""
    current_id, err = require_login()
    if err:
        return err
    if current_id != user_id:
        return jsonify({"error": "forbidden"}), 403
    db = get_db()
    db.execute("DELETE FROM period_logs WHERE user_id = ? AND start_date = ?", (user_id, start_date))
    # Same denormalized-recompute as log_period() above - whichever period
    # is now the latest remaining one (or none at all, if that was the only
    # one logged).
    latest = db.execute(
        "SELECT start_date, length_days FROM period_logs WHERE user_id = ? ORDER BY start_date DESC LIMIT 1",
        (user_id,),
    ).fetchone()
    db.execute(
        "UPDATE users SET last_period_date = ?, period_length_days = ? WHERE id = ?",
        (latest["start_date"] if latest else None, latest["length_days"] if latest else 5, user_id),
    )
    db.commit()
    return jsonify({
        "last_period_date": latest["start_date"] if latest else None,
        "period_length_days": latest["length_days"] if latest else None,
    })


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


@bp.route("/api/user/<int:user_id>/delete-account", methods=["POST"])
def delete_account(user_id):
    """Permanently wipes this account and everything logged under it -
    irreversible, so (unlike a normal profile save) this re-checks the PIN
    itself rather than trusting an already-open session alone: a session
    cookie can outlive the moment someone meant to be logged in (a shared/
    left-unlocked phone), and that's a much cheaper mistake to make on a
    "change your name" request than on "delete everything permanently"."""
    current_id, err = require_login()
    if err:
        return err
    if current_id != user_id:
        return jsonify({"error": "forbidden"}), 403
    data = request.get_json(force=True) or {}
    pin = data.get("pin") or ""
    db = get_db()
    row = db.execute("SELECT password_hash, avatar FROM users WHERE id = ?", (user_id,)).fetchone()
    if not row or not row["password_hash"] or not check_password_hash(row["password_hash"], pin):
        return jsonify({"error": "incorrect PIN"}), 401

    # Deleted in dependency order - PRAGMA foreign_keys=ON (see db.py) means
    # the users row can't go while any of these still reference it. Proposed
    # exercises stay in the shared catalog (other users may already be
    # logging them) - just anonymized rather than deleted.
    db.execute("UPDATE exercise_plan SET proposed_by = NULL WHERE proposed_by = ?", (user_id,))
    db.execute("DELETE FROM exercise_log WHERE user_id = ?", (user_id,))
    db.execute("DELETE FROM workout_log WHERE user_id = ?", (user_id,))
    db.execute("DELETE FROM period_logs WHERE user_id = ?", (user_id,))
    db.execute("DELETE FROM streak_shield_uses WHERE user_id = ?", (user_id,))
    db.execute("DELETE FROM users WHERE id = ?", (user_id,))
    db.commit()

    avatar = row["avatar"]
    if avatar and avatar.startswith("/uploads/"):
        try:
            os.remove(os.path.join(UPLOAD_DIR, os.path.basename(avatar)))
        except OSError:
            pass  # already gone - not worth failing the request over

    session.clear()
    return jsonify({"ok": True})
