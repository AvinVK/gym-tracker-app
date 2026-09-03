#!/usr/bin/env python3
"""Admin cleanup for a wrongly-approved exercise (clicked Approve instead of
Reject on a proposal). The in-app "Pending Exercises" card can only
reject/redirect a *pending* row - once it's approved it's a live catalog
entry indistinguishable from the original ~900 seeded ones, except that it
has proposed_by/proposed_at set. This finds and removes exactly those.

Usage (from the project root, correct branch checked out so config.py picks
the right DB - see config.py):

    # 1. List candidates - only exercises that went through the propose ->
    #    approve flow, newest first. The seeded catalog never has proposed_by set.
    python3 scripts/remove_approved_exercise.py --list

    # 2. Check one before touching it - shows whether anyone has already
    #    logged a set under it.
    python3 scripts/remove_approved_exercise.py --check 137

    # 3. Dry run (default) - prints what would happen, changes nothing.
    python3 scripts/remove_approved_exercise.py --remove 137

    # 4. Actually remove it, once the dry run looks right.
    python3 scripts/remove_approved_exercise.py --remove 137 --yes

    # If sets were already logged under it, either relabel them to an
    # existing catalog exercise first...
    python3 scripts/remove_approved_exercise.py --remove 137 --yes \\
        --relabel-muscle Back --relabel-exercise "Seated Cable Row"
    # ...or pass --force to delete the catalog row anyway and leave those
    # sets under a name nothing in the picker resolves to anymore (not
    # recommended - prefer --relabel).
"""
import argparse
import sqlite3

import db


def list_candidates(conn):
    rows = conn.execute(
        "SELECT id, target_muscle, exercise, proposed_at FROM exercise_plan "
        "WHERE status = 'approved' AND proposed_by IS NOT NULL ORDER BY proposed_at DESC"
    ).fetchall()
    if not rows:
        print("No user-submitted (propose -> approve) exercises found.")
        return
    for r in rows:
        print(f"id={r['id']:<6} [{r['target_muscle']}] {r['exercise']!r}  (approved {r['proposed_at']})")


def _logged_count(conn, muscle, exercise):
    return conn.execute(
        "SELECT COUNT(*) FROM exercise_log WHERE muscle_group = ? AND exercise = ?",
        (muscle, exercise),
    ).fetchone()[0]


def check_one(conn, plan_id):
    row = conn.execute("SELECT * FROM exercise_plan WHERE id = ?", (plan_id,)).fetchone()
    if not row:
        print(f"No exercise_plan row with id={plan_id}.")
        return
    print(f"id={row['id']} [{row['target_muscle']}] {row['exercise']!r} status={row['status']} "
          f"proposed_by={row['proposed_by']} proposed_at={row['proposed_at']}")
    n = _logged_count(conn, row["target_muscle"], row["exercise"])
    print(f"{n} logged set(s) reference this exercise.")
    if n:
        print("Use --remove with --relabel-muscle/--relabel-exercise to move those sets "
              "to a real catalog exercise before deleting, or --force to delete anyway.")


def remove_one(conn, plan_id, relabel_muscle, relabel_exercise, force, do_it):
    row = conn.execute("SELECT * FROM exercise_plan WHERE id = ?", (plan_id,)).fetchone()
    if not row:
        print(f"No exercise_plan row with id={plan_id}. Nothing to do.")
        return

    n = _logged_count(conn, row["target_muscle"], row["exercise"])
    print(f"Target: id={row['id']} [{row['target_muscle']}] {row['exercise']!r}, {n} logged set(s).")

    if n and not relabel_exercise and not force:
        print(f"Refusing: {n} set(s) are logged under this exercise. Re-run with "
              "--relabel-muscle/--relabel-exercise to move them to a real catalog "
              "exercise first, or --force to delete anyway and leave them orphaned.")
        return

    if relabel_exercise:
        target = conn.execute(
            "SELECT 1 FROM exercise_plan WHERE target_muscle = ? AND exercise = ? AND status = 'approved'",
            (relabel_muscle, relabel_exercise),
        ).fetchone()
        if not target:
            print(f"Refusing: no approved catalog exercise matches "
                  f"[{relabel_muscle}] {relabel_exercise!r} - check spelling/casing.")
            return
        print(f"Would relabel {n} set(s) to [{relabel_muscle}] {relabel_exercise!r}.")

    print(f"Would delete exercise_plan id={plan_id}.")

    if not do_it:
        print("\nDry run only - nothing changed. Re-run with --yes to apply.")
        return

    if relabel_exercise:
        conn.execute(
            "UPDATE exercise_log SET exercise = ?, muscle_group = ? WHERE muscle_group = ? AND exercise = ?",
            (relabel_exercise, relabel_muscle, row["target_muscle"], row["exercise"]),
        )
    conn.execute("DELETE FROM exercise_plan WHERE id = ?", (plan_id,))
    conn.commit()
    print("Done.")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--list", action="store_true", help="List user-submitted, now-approved exercises")
    group.add_argument("--check", type=int, metavar="ID", help="Show details + logged-set count for one id")
    group.add_argument("--remove", type=int, metavar="ID", help="Remove one exercise_plan row by id")
    parser.add_argument("--relabel-muscle", help="With --remove: target_muscle of the existing exercise to move logged sets to")
    parser.add_argument("--relabel-exercise", help="With --remove: exercise name of the existing exercise to move logged sets to")
    parser.add_argument("--force", action="store_true", help="With --remove: delete even if sets are logged under it (they'll be orphaned)")
    parser.add_argument("--yes", action="store_true", help="With --remove: actually apply the change (default is dry run)")
    args = parser.parse_args()

    if bool(args.relabel_muscle) != bool(args.relabel_exercise):
        parser.error("--relabel-muscle and --relabel-exercise must be given together")

    conn = sqlite3.connect(db.DB_PATH)
    conn.row_factory = sqlite3.Row

    if args.list:
        list_candidates(conn)
    elif args.check is not None:
        check_one(conn, args.check)
    elif args.remove is not None:
        remove_one(conn, args.remove, args.relabel_muscle, args.relabel_exercise, args.force, args.yes)

    conn.close()


if __name__ == "__main__":
    main()
