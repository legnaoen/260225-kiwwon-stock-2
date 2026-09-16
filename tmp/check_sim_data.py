import sqlite3
import os
import json
import pandas as pd

db_path = os.path.expandvars(r'%APPDATA%\kiwoom-trader\db\kiwoom.db')
conn = sqlite3.connect(db_path)
conn.row_factory = sqlite3.Row
cur = conn.cursor()

# Check what ohlcv data exists
cur.execute("SELECT count(*), min(date), max(date) FROM market_ohlcv_history")
ohlcv_info = cur.fetchone()
print(f"market_ohlcv_history count: {ohlcv_info[0]}, min_date: {ohlcv_info[1]}, max_date: {ohlcv_info[2]}")

# Check track picks
for t in ['track_a_buy_picks', 'track_b_buy_picks', 'track_c_buy_picks', 'track_d_buy_picks', 'track_e_buy_picks']:
    cur.execute(f"SELECT count(*), min(entry_date), max(entry_date) FROM {t} WHERE entry_price > 0")
    info = cur.fetchone()
    print(f"{t}: count={info[0]}, min_entry={info[1]}, max_entry={info[2]}")

# Sample track A rows to see all columns and values
cur.execute("SELECT stock_code, stock_name, entry_date, exit_date, entry_price, exit_price, peak_return, final_return, holding_days, result FROM track_a_buy_picks LIMIT 10")
samples = [dict(r) for r in cur.fetchall()]
print("\nSample Track A picks:")
for s in samples:
    print(s)
