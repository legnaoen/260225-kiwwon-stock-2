import sqlite3
import os

db_path = os.path.join(os.path.expanduser('~'), 'AppData', 'Roaming', 'kiwoom-trader', 'db', 'kiwoom.db')
print("DB path:", db_path)

conn = sqlite3.connect(db_path)
c = conn.cursor()

c.execute("UPDATE intraday_predictions SET position = 'KODEX 200' WHERE position LIKE '%HOLD(KODEX 200 기준)%' AND time_slot IN ('09:45', '10:15')")
c.execute("UPDATE intraday_predictions SET position = 'HOLD' WHERE position LIKE '%HOLD(KODEX 200 기준)%' OR position = '- HOLD' OR position = 'HOLD(관망)'")

conn.commit()

c.execute("SELECT time_slot, position FROM intraday_predictions WHERE date = date('now', 'localtime')")
print("Today's fixed positions:")
for row in c.fetchall():
    print(row)

conn.close()
print("Done fixing database!")
