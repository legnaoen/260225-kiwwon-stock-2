import sqlite3
import os
import json
from datetime import datetime

db_path = os.path.expandvars(r'%APPDATA%\kiwoom-trader\db\kiwoom.db')
conn = sqlite3.connect(db_path)
conn.row_factory = sqlite3.Row
cur = conn.cursor()

# Check market_ohlcv_history schema
cur.execute("PRAGMA table_info(market_ohlcv_history)")
cols = [r['name'] for r in cur.fetchall()]
print("market_ohlcv_history cols:", cols)

# Let's see a sample of ohlcv
cur.execute("SELECT * FROM market_ohlcv_history LIMIT 3")
print("Sample OHLCV:", [dict(r) for r in cur.fetchall()])
