#!/usr/bin/env python3
"""Deploy the gym-tracker-app to PythonAnywhere via the Consoles API.

Pulls the latest main branch into the PythonAnywhere home directory by
driving a bash console through the API (git isn't installed as a
deploy hook there), then reloads the web app.
"""

import os
import sys
import time

import requests

USERNAME = "Avin0406"
DOMAIN = "avin0406.pythonanywhere.com"
APP_PATH = "/home/Avin0406/gym-tracker-app"
API_BASE = f"https://www.pythonanywhere.com/api/v0/user/{USERNAME}"

CONSOLE_START_WAIT_SECONDS = 5
COMMAND_RUN_WAIT_SECONDS = 8


def get_token() -> str:
    token = os.environ.get("PA_API_TOKEN")
    if not token:
        print("FAILURE: PA_API_TOKEN environment variable is not set.")
        sys.exit(1)
    return token


def api_headers(token: str) -> dict:
    return {"Authorization": f"Token {token}"}


def open_console(token: str) -> int:
    print("Opening a bash console on PythonAnywhere...")
    resp = requests.post(
        f"{API_BASE}/consoles/",
        headers=api_headers(token),
        data={"executable": "bash"},
    )
    if resp.status_code not in (200, 201):
        print(f"FAILURE: could not open console (status {resp.status_code}): {resp.text}")
        sys.exit(1)

    console_id = resp.json().get("id")
    if not console_id:
        print(f"FAILURE: console response missing id: {resp.text}")
        sys.exit(1)

    print(f"Console opened (id={console_id}). Waiting for it to become ready...")
    time.sleep(CONSOLE_START_WAIT_SECONDS)
    return console_id


def send_command(token: str, console_id: int, command: str) -> None:
    print(f"Sending command: {command}")
    resp = requests.post(
        f"{API_BASE}/consoles/{console_id}/send_input/",
        headers=api_headers(token),
        json={"input": command + "\n"},
    )
    if resp.status_code != 200:
        print(f"FAILURE: could not send command (status {resp.status_code}): {resp.text}")
        sys.exit(1)

    print(f"Command sent. Waiting {COMMAND_RUN_WAIT_SECONDS}s for it to complete...")
    time.sleep(COMMAND_RUN_WAIT_SECONDS)


def read_output(token: str, console_id: int) -> str:
    resp = requests.get(
        f"{API_BASE}/consoles/{console_id}/get_latest_output/",
        headers=api_headers(token),
    )
    if resp.status_code != 200:
        print(f"FAILURE: could not read console output (status {resp.status_code}): {resp.text}")
        sys.exit(1)

    return resp.json().get("output", "")


def check_output_for_errors(output: str) -> None:
    lowered = output.lower()
    if "error" in lowered or "fatal" in lowered:
        print("FAILURE: deploy command output contained an error:")
        print("---- console output ----")
        print(output)
        print("-------------------------")
        sys.exit(1)

    print("Console output looks clean:")
    print("---- console output ----")
    print(output)
    print("-------------------------")


def reload_webapp(token: str) -> None:
    print(f"Reloading web app {DOMAIN}...")
    resp = requests.post(
        f"{API_BASE}/webapps/{DOMAIN}/reload/",
        headers=api_headers(token),
    )
    if resp.status_code != 200:
        print(f"FAILURE: could not reload web app (status {resp.status_code}): {resp.text}")
        sys.exit(1)

    print(f"SUCCESS: web app {DOMAIN} reloaded.")


def main() -> None:
    token = get_token()

    console_id = open_console(token)
    send_command(token, console_id, f"cd {APP_PATH} && git pull origin main")

    output = read_output(token, console_id)
    check_output_for_errors(output)

    reload_webapp(token)

    print("SUCCESS: deploy completed.")


if __name__ == "__main__":
    main()
