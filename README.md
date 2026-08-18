# Clock It

A workout tracker built as a Flask + SQLite backend with a plain HTML/JS frontend,
wrapped with [Capacitor](https://capacitorjs.com/) so it also ships as a native
Android/iOS app. Originally replaced a workout-log spreadsheet; has since grown into
a small multi-user fitness app with streaks and menstrual-cycle-aware tracking.

## What's inside

- **Accounts** — email + 4-digit PIN login (no passwords to remember), with an
  avatar photo and a profile (name, age, optional period info).
- **Log Workout** — record a gym visit (date, energy level, pre-workout meal) and
  log the exercises done that day. The exercise picker cascades from muscle group,
  server-filtered so you only see exercises for the group you picked, from a shared
  library of curated + imported exercises with reference images.
- **History** — browse past visits, and edit or delete a day's logged sets after the
  fact. Edits, additions and deletions are tracked per set (with an "Edited"/"Added"
  badge and a snapshot of the previous value) so a day's log shows its own history,
  not just its current state. Sets that beat a previous best are tagged as PRs.
- **Streaks** — a weekly (not daily) streak: log enough visits in a week and it
  counts. Streak shields, earned as the streak grows, automatically cover a week
  that falls short instead of resetting you to zero. Weeks that overlap a logged
  period get the same free pass, no shield spent.
- **Your Cycle** — an opt-in menstrual cycle calendar: log period start dates, see
  the current/next cycle phase, a chart of the typical hormone pattern across the
  cycle, and how many gym visits landed on a period day this month.
- **Your Performance** — PR progress charts per exercise, an energy-vs-time chart,
  and a PRs-by-cycle-phase breakdown for users with cycle tracking on.
- **Diet** — placeholder tab, not built yet.

## Run it

```
cd gym-tracker-app
pip install -r requirements.txt --break-system-packages   # (drop the flag on Windows/Mac)
python app.py
```

Then open **http://localhost:5000** in a browser.

The database file `gym_tracker.db` is created automatically on first run, pre-seeded
with a starter exercise library. Delete it at any time to reset to a blank database —
it will be recreated with the seed data on the next run.

## Project layout

```
app.py          Flask app factory: config, secret key, blueprint registration
paths.py        Shared BASE_DIR/STATIC_DIR/UPLOAD_DIR constants
helpers.py      Small helpers shared across route blueprints (login/session, date checks)
config.py       Branch-aware PORT/DB_NAME defaults (so main and dev can run side by side)
db.py           SQLite schema, migrations, and connection handling
streaks.py      Weekly streak + shield calculation
cycle.py        Shared menstrual-cycle date math (used by streaks.py and the API)
routes/         One blueprint per API area (auth, workout log, exercise log, exercise
                plan, streak, deploy webhook, frontend)
static/         The frontend: index.html, app.js, exercise images, uploaded avatars
android/, ios/  Capacitor native app projects
```

## Notes

- Everything is stored in `gym_tracker.db` (SQLite) in this folder — back it up by
  copying that one file.
- This runs on one machine at a time (whoever has the Flask server running). It's not
  designed to be exposed to the internet as-is.
- No frontend build step — just Python's standard library + Flask on the backend, and
  plain HTML/JS (no framework, no bundler) on the frontend.
- The Android/iOS apps are Capacitor wrappers around the same web frontend, pointed at
  a deployed instance of this server rather than bundling their own copy.
