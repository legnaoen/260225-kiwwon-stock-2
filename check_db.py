import sqlite3

conn = sqlite3.connect(r"C:\Users\legna\AppData\Roaming\kiwoom-trader\db\kiwoom.db")
c = conn.cursor()
c.execute("SELECT strategy_category, is_active FROM live_trade_strategies")
for row in c.fetchall():
    print(row)
conn.close()
