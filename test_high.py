import sqlite3

conn=sqlite3.connect(r'C:\Users\legna\AppData\Roaming\kiwoom-trader\db\kiwoom.db')
c=conn.cursor()
c.execute("SELECT stock_name, current_price, entry_price, high_price FROM maiis_portfolio WHERE status='HELD'")
for r in c.fetchall():
    print(r)
