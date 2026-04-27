import sqlite3
import json

db_paths = [
    r"C:\Users\legna\AppData\Roaming\kiwoom-trader\kiwoom.db",
    r"C:\Users\legna\AppData\Roaming\kiwoom-trader\data\ai_mkt_logs.db",
    r"C:\Users\legna\AppData\Roaming\kiwoom-trader\db\kiwoom.db"
]

found = False
for db_path in db_paths:
    try:
        conn = sqlite3.connect(db_path)
        c = conn.cursor()
        c.execute("SELECT result FROM ai_execution_log WHERE agent_id = 'PORTFOLIO_MANAGER' ORDER BY queued_at DESC LIMIT 1")
        row = c.fetchone()
        if row and row[0]:
            try:
                data = json.loads(row[0])
                print(f"--- SUCCESS in {db_path} ---")
                print(json.dumps(data, indent=2, ensure_ascii=False))
                found = True
                break
            except:
                print(f"--- SUCCESS in {db_path} ---")
                print(row[0])
                found = True
                break
        conn.close()
    except Exception as e:
        pass

if not found:
    print("No result found in any DB.")
