#!/usr/bin/env python3
"""Trigger a deploy on PythonAnywhere via the app's own /deploy webhook.

PythonAnywhere's Consoles API blocks programmatic console creation on
free accounts, so this doesn't touch their API at all -- it POSTs to a
route baked into the running Flask app (see app.py's /deploy route),
which does `git pull` and touches the WSGI reload file itself.
"""

import os
import sys

import requests

DEPLOY_URL = "https://avin0406.pythonanywhere.com/deploy"


def get_secret() -> str:
    secret = os.environ.get("DEPLOY_SECRET")
    if not secret:
        print("FAILURE: DEPLOY_SECRET environment variable is not set.")
        sys.exit(1)
    return secret


def main() -> None:
    secret = get_secret()

    print(f"Triggering deploy at {DEPLOY_URL}...")
    resp = requests.post(DEPLOY_URL, headers={"X-Deploy-Secret": secret}, timeout=90)

    try:
        body = resp.json()
    except ValueError:
        print(f"FAILURE: deploy endpoint did not return JSON (status {resp.status_code}).")
        print(resp.text[:500])
        sys.exit(1)

    if resp.status_code != 200 or not body.get("ok"):
        print(f"FAILURE: deploy failed (status {resp.status_code}, step={body.get('step')}).")
        print("---- output ----")
        print(body.get("output", body))
        print("-----------------")
        sys.exit(1)

    print("SUCCESS: git pull + webapp reload completed.")
    print("---- git pull output ----")
    print(body.get("output", ""))
    print("--------------------------")


if __name__ == "__main__":
    main()
