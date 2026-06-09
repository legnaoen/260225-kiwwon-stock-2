import sqlite3
import os
import glob

db_files = glob.glob(os.path.join(os.path.dirname(__file__), '../*.db'))
print('DB Files found:', db_files)

for db_path in db_files:
    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
        tables = [t[0] for t in cursor.fetchall()]
        if 'ai_execution_logs' in tables:
            print(f"Found 'ai_execution_logs' in: {os.path.basename(db_path)}")
            cursor.execute("""
                SELECT id, agentId, agentName, triggerType, targetType, status, queuedAt, modelName, error 
                FROM ai_execution_logs 
                ORDER BY queuedAt DESC 
                LIMIT 10
            """)
            rows = cursor.fetchall()
            col_names = [d[0] for d in cursor.description]
            print(f"Columns: {col_names}")
            for row in rows:
                print(" | ".join(str(val) for val in row))
            print("-" * 50)
        conn.close()
    except Exception as e:
        print(f"Error reading {db_path}: {e}")
