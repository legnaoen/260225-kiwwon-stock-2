import sqlite3
import os
db_path = os.path.join(os.environ['APPDATA'], 'kiwoom-trader', 'db', 'kiwoom.db')
conn = sqlite3.connect(db_path)
cur = conn.cursor()
cur.execute("SELECT stock_code, current_price, entry_price FROM moonshot_active_tracking WHERE is_invalidated=0")
print("active_tracking current prices:", cur.fetchall())
conn.close()
