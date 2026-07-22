import sqlite3
conn = sqlite3.connect('gym_tracker.db')
conn.execute(f'SELECT COUNT(*) FROM exercise_log')
conn.commit()
conn.close()
