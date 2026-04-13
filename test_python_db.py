import sqlite3
import json
import os

db_path = os.path.expandvars(r"%APPDATA%\kiwoom-trader\db\kiwoom.db")
print("Trying to open:", db_path)

if not os.path.exists(db_path):
    print("File does not exist")
else:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    cursor.execute("SELECT date, name, reason FROM theme_intelligence LIMIT 5")
    rows = [dict(r) for r in cursor.fetchall()]
    print("All Top 5:", json.dumps(rows, ensure_ascii=False, indent=2))

    cursor.execute("SELECT date, name, reason FROM theme_intelligence WHERE name LIKE '%광통신%' LIMIT 5")
    rows_specific = [dict(r) for r in cursor.fetchall()]
    print("Specific 광통신:", json.dumps(rows_specific, ensure_ascii=False, indent=2))

    conn.close()
