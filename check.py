import sqlite3
db = sqlite3.connect('C:/Users/legna/AppData/Roaming/kiwoom-trader/db/kiwoom.db')
rows = db.execute("SELECT DISTINCT stock_code FROM market_ohlcv_history WHERE date = '2026-05-15'").fetchall()
print("Stocks with 2026-05-15:", rows)
