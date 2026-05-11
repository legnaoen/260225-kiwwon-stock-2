import sqlite3
import os

db_path = os.path.join(os.environ.get('APPDATA'), 'kiwoom-trader', 'db', 'kiwoom.db')
conn = sqlite3.connect(db_path)
print(conn.cursor().execute("SELECT time_slot, high_pct FROM live_trade_portfolio_timeseries WHERE entry_date='2026-05-08' ORDER BY time_slot").fetchall())
