"""Streak API: weekly workout streak + this-month period-power count."""
from flask import Blueprint, jsonify

from cycle import compute_period_power
from db import get_db
from helpers import require_login
from streaks import compute_streak_status

bp = Blueprint("streak", __name__)


@bp.route("/api/streak", methods=["GET"])
def get_streak():
    user_id, err = require_login()
    if err:
        return err
    db = get_db()
    status = compute_streak_status(db, user_id)
    status["period_power"] = compute_period_power(db, user_id)
    return jsonify(status)
