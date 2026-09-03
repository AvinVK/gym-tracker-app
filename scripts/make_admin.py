#!/usr/bin/env python3
"""One-off: promote a user to admin by email (see db.set_admin / users.is_admin).

Usage (from the project root, correct branch checked out):

    python3 scripts/make_admin.py --email demo@example.com
"""
import argparse
import sqlite3

import db


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--email", required=True)
    args = parser.parse_args()

    conn = sqlite3.connect(db.DB_PATH)
    row = conn.execute("SELECT id FROM users WHERE email = ?", (args.email,)).fetchone()
    conn.close()
    if not row:
        raise SystemExit(f"No user with email {args.email}")

    db.set_admin(row[0])


if __name__ == "__main__":
    main()
