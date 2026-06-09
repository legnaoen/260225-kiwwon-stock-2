import os
import sqlite3

appdata = os.environ.get('APPDATA')
dbp = os.path.join(appdata, 'kiwoom-trader', 'db', 'kiwoom.db')
print('Opening DB:', dbp)

try:
    conn = sqlite3.connect(dbp)
    cursor = conn.cursor()
    cursor.execute("SELECT COUNT(*) FROM ai_execution_log")
    count = cursor.fetchone()[0]
    print(f"Total logs in ai_execution_log: {count}")
    
    if count > 0:
        cursor.execute("""
            SELECT id, agent_id, agent_name, trigger_type, target_type, status, queued_at, model_name, error 
            FROM ai_execution_log 
            ORDER BY queued_at DESC 
            LIMIT 30
        """)
        rows = cursor.fetchall()
        col_names = [d[0] for d in cursor.description]
        print(" | ".join(col_names))
        print("-" * 140)
        for row in rows:
            print(" | ".join(str(val) for val in row))
    else:
        print('No entries found.')
    conn.close()
except Exception as e:
    print('Error:', e)
