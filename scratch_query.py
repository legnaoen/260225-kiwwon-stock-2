import sqlite3

try:
    db = sqlite3.connect(r'C:\Users\legna\AppData\Roaming\kiwoom-trader\db\kiwoom.db')
    cursor = db.cursor()
    cursor.execute("SELECT agent_name, status, started_at, error FROM ai_execution_log WHERE agent_id = 'PORTFOLIO_MANAGER' AND status = 'FAILED' ORDER BY started_at DESC LIMIT 1")
    row = cursor.fetchone()
    if row:
        print("Agent:", row[0])
        print("Status:", row[1])
        print("Time:", row[2])
        print("Error:", row[3])
    else:
        print("No error found")
except Exception as e:
    print(f"Python Error: {e}")
