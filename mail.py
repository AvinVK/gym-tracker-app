"""Sends verification emails via Gmail SMTP.

Requires GMAIL_ADDRESS and GMAIL_APP_PASSWORD env vars (an App Password,
not the account's real password - Gmail only accepts those for SMTP
login). Same "set it on the host, don't commit it" pattern as SECRET_KEY
in app.py.
"""
import os
import smtplib
from email.message import EmailMessage

import config

GMAIL_ADDRESS = os.environ.get("GMAIL_ADDRESS")
GMAIL_APP_PASSWORD = os.environ.get("GMAIL_APP_PASSWORD")


def _send_email(to_email, subject, body, code_for_dev_log):
    if not GMAIL_ADDRESS or not GMAIL_APP_PASSWORD:
        if config.is_dev():
            # No Gmail account wired up yet for local testing - print the
            # code instead of blocking the whole flow on it.
            print(f"[mail] GMAIL_ADDRESS/GMAIL_APP_PASSWORD not set - code for {to_email} is {code_for_dev_log}", flush=True)
            return
        raise RuntimeError("GMAIL_ADDRESS / GMAIL_APP_PASSWORD are not configured")

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = GMAIL_ADDRESS
    msg["To"] = to_email
    msg.set_content(body)

    with smtplib.SMTP_SSL("smtp.gmail.com", 465) as smtp:
        smtp.login(GMAIL_ADDRESS, GMAIL_APP_PASSWORD)
        smtp.send_message(msg)


def send_otp_email(to_email, code):
    _send_email(
        to_email,
        f"Your Clock It verification code: {code}",
        f"Your Clock It verification code is {code}.\n\n"
        "It expires in 10 minutes. If you didn't request this, just ignore this email.",
        code,
    )


def send_pin_reset_email(to_email, code):
    _send_email(
        to_email,
        f"Your Clock It PIN reset code: {code}",
        f"Your Clock It PIN reset code is {code}.\n\n"
        "It expires in 10 minutes. If you didn't request this, just ignore this email - your PIN won't change.",
        code,
    )
