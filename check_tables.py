import sqlite3

db_path = r"C:\Users\legna\AppData\Roaming\kiwoom-trader\db\kiwoom.db"
conn = sqlite3.connect(db_path)
conn.row_factory = sqlite3.Row
cur = conn.cursor()

# 테이블 목록 확인
cur.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
tables = [r[0] for r in cur.fetchall()]
print("Tables:", tables)
conn.close()
