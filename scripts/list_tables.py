import sqlite3
db = sqlite3.connect('database.sqlite')
cur = db.cursor()
cur.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
tables = [r[0] for r in cur.fetchall()]
print('ALL TABLES:')
for t in tables:
    print(' ', t)
db.close()
