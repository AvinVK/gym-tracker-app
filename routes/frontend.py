from flask import Blueprint, send_from_directory

from paths import STATIC_DIR

bp = Blueprint("frontend", __name__)


@bp.route("/")
def index():
    return send_from_directory(STATIC_DIR, "index.html")
