import sqlite3
import os
db_path = os.path.join(os.environ['APPDATA'], 'kiwoom-trader', 'db', 'kiwoom.db')
conn = sqlite3.connect(db_path)
cur = conn.cursor()
cur.execute("SELECT * FROM market_ohlcv_history WHERE stock_code='143240' ORDER BY date DESC LIMIT 5")
print("143240:", cur.fetchall())
conn.close()
