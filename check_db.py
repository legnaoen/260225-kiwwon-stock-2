import sqlite3
import os

db_path = os.path.join(os.environ['APPDATA'], 'kiwoom-trader', 'db', 'kiwoom.db')
print(f"DB Path: {db_path}")

try:
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()
    cur.execute("SELECT * FROM market_ohlcv_history WHERE stock_code='015230' ORDER BY date DESC LIMIT 5")
    print("015230:", cur.fetchall())
    
    cur.execute("SELECT * FROM market_ohlcv_history WHERE stock_code='A015230' ORDER BY date DESC LIMIT 5")
    print("A015230:", cur.fetchall())

    cur.execute("SELECT * FROM market_ohlcv_history ORDER BY date DESC LIMIT 5")
    print("Any 5 rows:", cur.fetchall())
    conn.close()
except Exception as e:
    print(e)
