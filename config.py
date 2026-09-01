"""Branch-aware settings shared by app.py and db.py.

main and dev run side by side in the same working directory (checked out
one at a time) and need different ports/databases so they never clash.
Rather than hardcoding that difference into app.py/db.py — which makes
those files diverge between branches and forces a manual fix-up after
every merge — the values live here, keyed by whichever git branch is
currently checked out. The mapping itself is identical on every branch,
so this file never causes a merge conflict.

A real env var always wins, so a production host (e.g. PythonAnywhere)
can just set PORT / DB_NAME explicitly and ignore branch detection.
"""
import os
import subprocess

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

BRANCH_DEFAULTS = {
    "main": {"PORT": "5000", "DB_NAME": "gym_tracker.db"},
    "dev": {"PORT": "6000", "DB_NAME": "gym_tracker_dev.db"},
}
FALLBACK_DEFAULTS = {"PORT": "5000", "DB_NAME": "gym_tracker.db"}


def _current_branch():
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "--abbrev-ref", "HEAD"],
            cwd=BASE_DIR, stderr=subprocess.DEVNULL, timeout=2,
        ).decode().strip()
    except Exception:
        return None


def get(key):
    if key in os.environ:
        return os.environ[key]
    defaults = BRANCH_DEFAULTS.get(_current_branch(), FALLBACK_DEFAULTS)
    return defaults[key]


def is_dev():
    """True when this process is running off the dev branch - lets
    app.py turn off static-file caching there, and mail.py print OTP
    codes to the console instead of hard-failing when no Gmail creds are
    configured. Static assets (app.js/style.css) otherwise get Flask's
    default 12-hour cache header, which an Android WebView happily honors
    across app relaunches - editing a file and reloading the app can
    silently keep serving the old JS/CSS for hours, which is exactly the
    kind of thing that makes "I already fixed and verified that" wrong on
    a real device even though it tested fine against a fresh browser
    instance.

    Checks the git branch first, not PORT: a throwaway test copy of the
    dev DB started with PORT=6099 (or any other override) is still dev
    branch code and should still get dev behavior - keying off "PORT
    equals dev's default 6000" would wrongly say "not dev" for every one
    of those and (for mail.py specifically) turn a routine local test into
    a hard 502 instead of a printed code. PORT is only consulted as a
    fallback for a non-git deployment (e.g. a production host with no .git
    dir), where branch detection can't answer at all."""
    branch = _current_branch()
    if branch is not None:
        return branch == "dev"
    if "PORT" in os.environ:
        return os.environ["PORT"] == BRANCH_DEFAULTS["dev"]["PORT"]
    return False
