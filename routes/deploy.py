"""CI deploy webhook.

PythonAnywhere's Consoles API blocks programmatic console creation on
free accounts, so CI can't drive a `git pull` through a console. This
route does the pull itself, from inside the already-running app, which
needs no special API access. GitHub Actions POSTs here with the
DEPLOY_SECRET (set as an env var on PythonAnywhere's Web tab) after
every push to main.
"""
import os
import secrets
import subprocess

from flask import Blueprint, jsonify, request

from paths import BASE_DIR

bp = Blueprint("deploy", __name__)

DEPLOY_WSGI_FILE = "/var/www/avin0406_pythonanywhere_com_wsgi.py"


@bp.route("/deploy", methods=["POST"])
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
