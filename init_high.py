import sqlite3

conn=sqlite3.connect(r'C:\Users\legna\AppData\Roaming\kiwoom-trader\db\kiwoom.db')
c=conn.cursor()
c.execute("UPDATE maiis_portfolio SET high_price = current_price WHERE high_price = 0 AND status = 'HELD' AND current_price > 0")
conn.commit()
print("Initialized high_price for HELD stocks.")
