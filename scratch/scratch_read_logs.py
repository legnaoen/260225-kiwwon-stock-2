import sqlite3
import os

db_path = os.path.join(os.path.dirname(__file__), '../kiwoom.db')
print('Opening DB:', db_path)

try:
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    # 테이블 목록 확인
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
    tables = [t[0] for t in cursor.fetchall()]
    print('Tables in DB:', ', '.join(tables))
    
    if 'ai_execution_logs' in tables:
        print('\n--- Recent 20 AI Execution Logs ---')
        cursor.execute("""
            SELECT id, agentId, agentName, triggerType, targetType, status, queuedAt, modelName, error 
            FROM ai_execution_logs 
            ORDER BY queuedAt DESC 
            LIMIT 20
        """)
        rows = cursor.fetchall()
        
        # 프린트 형식
        col_names = [d[0] for d in cursor.description]
        print(f"{' | '.join(col_names)}")
        print("-" * 120)
        for row in rows:
            print(" | ".join(str(val) for val in row))
    else:
        print('Table ai_execution_logs does not exist.')
        
    conn.close()
except Exception as e:
    print('Error reading DB:', str(e))
