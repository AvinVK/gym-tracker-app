"""Small pieces shared across route blueprints."""
from datetime import datetime, timedelta

from flask import jsonify, session

from db import get_db


def is_future_date(date_str):
    """Rejects dates the client couldn't legitimately mean as "today" or
    earlier. Compared against the server's clock (PythonAnywhere runs UTC),
    not the client's - so a user in a timezone ahead of UTC (e.g. IST,
    UTC+5:30) can have a local "today" that's still "tomorrow" server-side.
    A 1-day grace window absorbs any timezone offset up to UTC+24 without
    weakening the check's actual purpose of catching genuine typos/far-future
    dates."""
    try:
        d = datetime.strptime(date_str, "%Y-%m-%d").date()
    except ValueError:
        return False
    return d > datetime.now().date() + timedelta(days=1)


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


def require_admin():
    """Gates the pending-exercise approval queue (see
    routes/exercise_plan.py) to whichever user db.set_admin() promoted."""
    user_id, err = require_login()
    if err:
        return None, err
    row = get_db().execute("SELECT is_admin FROM users WHERE id = ?", (user_id,)).fetchone()
    if not row or not row["is_admin"]:
        return None, (jsonify({"error": "forbidden"}), 403)
    return user_id, None
