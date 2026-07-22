# Gym Tracker (local app)

A small local web app: Flask backend + SQLite database + a plain HTML/JS frontend.
Replaces the spreadsheet version with a real cascading dropdown (pick a muscle group,
only see exercises for that muscle) and a proper database instead of formulas.

## Run it

```
cd gym-tracker-app
pip install -r requirements.txt --break-system-packages   # (drop the flag on Windows/Mac)
python app.py
```

Then open **http://localhost:5000** in a browser.

The database file `gym_tracker.db` is created automatically on first run, pre-seeded
with the same exercise plan (Chest / Back / Shoulders / Legs / Biceps / Triceps) you
already had. Delete `gym_tracker.db` at any time to reset to a blank database — it
will be recreated with the seed data on the next run.

## What's inside

- **Exercise Plan tab** — add/remove exercises, grouped by Target Muscle. Add a brand
  new muscle group just by typing it in the "Target Muscle" field.
- **Log Workout tab** — record a gym visit (date, muscle group, start/end time —
  duration is calculated automatically) and log the exercises done that day. The
  Exercise dropdown only shows exercises belonging to whichever muscle group you pick
  — this is real server-side filtering, not a spreadsheet formula trick.
- **History tab** — view and delete past workout visits and exercise entries.

## Notes

- Everything is stored in `gym_tracker.db` (SQLite) in this folder — back it up by
  copying that one file.
- This runs on one machine at a time (whoever has the Flask server running). It's not
  designed to be exposed to the internet as-is.
- No build step, no Node — just Python's standard library + Flask.
