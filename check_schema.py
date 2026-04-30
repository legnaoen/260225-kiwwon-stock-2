import sqlite3
conn = sqlite3.connect(r'C:\Users\legna\AppData\Roaming\kiwoom-trader\db\kiwoom.db')
c = conn.cursor()
c.execute("PRAGMA table_info(theme_intelligence);")
for row in c.fetchall():
    print(row)
