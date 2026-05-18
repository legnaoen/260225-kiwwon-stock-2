import sqlite3
import os
appdata = os.getenv('APPDATA')
db_path = os.path.join(appdata, 'kiwoom-trader', 'db', 'kiwoom.db')
conn = sqlite3.connect(db_path)
c = conn.cursor()
try:
    c.execute("SELECT message FROM telegram_logs WHERE created_at = '2026-05-13T10:49:14'")
    rows = c.fetchall()
    for row in rows:
        print(row[0])
except Exception as e:
    print(e)
