import os
import secrets
from datetime import timedelta

from flask import Flask, jsonify

import config
from db import close_db, init_db
from paths import BASE_DIR, STATIC_DIR
from routes import register_blueprints

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
# Only the avatar upload accepts a file today, and it's re-encoded to a
# small JPEG right after - 12MB comfortably covers a raw phone-camera photo
# (see upload_avatar's own comment) while still rejecting anything wild
# before Werkzeug spools it or PIL decodes it into memory.
app.config["MAX_CONTENT_LENGTH"] = 12 * 1024 * 1024


@app.errorhandler(413)
def _request_too_large(e):
    return jsonify({"error": "file is too large"}), 413
if config.is_dev():
    # Flask's default 12-hour static-file cache is fine in production but
    # actively harmful here - see config.is_dev()'s docstring.
    app.config["SEND_FILE_MAX_AGE_DEFAULT"] = 0

register_blueprints(app)


if __name__ == "__main__":
    init_db()
    app.run(host="0.0.0.0", port=int(config.get("PORT")), debug=False)
else:
    init_db()
