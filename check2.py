import sqlite3
db = sqlite3.connect('C:/Users/legna/AppData/Roaming/kiwoom-trader/db/kiwoom.db')
name = db.execute("SELECT * FROM stocks_master WHERE stock_code LIKE '%000880%'").fetchall()
print("Stock Master:", name)
