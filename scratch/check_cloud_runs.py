import os
import sqlite3

appdata = os.environ.get('APPDATA')
dbp = os.path.join(appdata, 'kiwoom-trader', 'db', 'kiwoom.db')
print('Opening DB:', dbp)

try:
    conn = sqlite3.connect(dbp)
    cursor = conn.cursor()
    
    # ITA, COPILOT, SWARM_MONITOR, INTRADAY_MONITOR 등의 로그 통계 조회
    cursor.execute("""
        SELECT agent_id, target_type, status, COUNT(*) as count 
        FROM ai_execution_log 
        WHERE agent_id IN ('ITA', 'COPILOT', 'SWARM_MONITOR', 'INTRADAY_MONITOR')
        GROUP BY agent_id, target_type, status
    """)
    rows = cursor.fetchall()
    print("=== 특정 에이전트들의 큐 실행 통계 ===")
    print("agent_id | target_type | status | count")
    print("-" * 60)
    for row in rows:
        print(" | ".join(str(val) for val in row))
        
    print("\n" + "="*80 + "\n")
    
    # 최근 10개의 ITA 실행 로그 조회
    cursor.execute("""
        SELECT id, agent_id, target_type, status, queued_at, model_name, error 
        FROM ai_execution_log 
        WHERE agent_id = 'ITA'
        ORDER BY queued_at DESC 
        LIMIT 10
    """)
    rows = cursor.fetchall()
    if rows:
        print("=== 최근 10개 ITA 실행 로그 ===")
        col_names = [d[0] for d in cursor.description]
        print(" | ".join(col_names))
        print("-" * 100)
        for row in rows:
            print(" | ".join(str(val) for val in row))
            
    print("\n" + "="*80 + "\n")
    
    # 최근 10개의 INTRADAY_MONITOR, SWARM_MONITOR 실행 로그 조회
    cursor.execute("""
        SELECT id, agent_id, target_type, status, queued_at, model_name, error 
        FROM ai_execution_log 
        WHERE agent_id IN ('INTRADAY_MONITOR', 'SWARM_MONITOR')
        ORDER BY queued_at DESC 
        LIMIT 10
    """)
    rows = cursor.fetchall()
    if rows:
        print("=== 최근 10개 장중 스웜 실행 로그 ===")
        col_names = [d[0] for d in cursor.description]
        print(" | ".join(col_names))
        print("-" * 100)
        for row in rows:
            print(" | ".join(str(val) for val in row))
            
    conn.close()
except Exception as e:
    print('Error:', e)
