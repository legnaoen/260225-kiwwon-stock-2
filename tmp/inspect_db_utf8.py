import sqlite3
import os
import json

db_path = os.path.expandvars(r'%APPDATA%\kiwoom-trader\db\kiwoom.db')
conn = sqlite3.connect(db_path)
conn.row_factory = sqlite3.Row
cur = conn.cursor()

cur.execute("SELECT name FROM sqlite_master WHERE type='table'")
tables = [r[0] for r in cur.fetchall()]

result = {"tables": tables, "data": {}}

for tbl in tables:
    try:
        cur.execute(f"SELECT COUNT(*) FROM {tbl}")
        cnt = cur.fetchone()[0]
        cur.execute(f"SELECT * FROM {tbl} ORDER BY rowid DESC LIMIT 20")
        rows = [dict(r) for r in cur.fetchall()]
        result["data"][tbl] = {"count": cnt, "samples": rows}
    except Exception as e:
        result["data"][tbl] = {"error": str(e)}

with open('tmp/db_full_summary.json', 'w', encoding='utf-8') as f:
    json.dump(result, f, ensure_ascii=False, indent=2)

print("Saved to tmp/db_full_summary.json successfully.")
