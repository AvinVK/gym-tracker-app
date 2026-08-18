"""Small pieces shared across route blueprints."""
from datetime import datetime

from flask import jsonify, session


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
