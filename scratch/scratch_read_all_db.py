import os
import json
import sqlite3

appdata = os.environ.get('APPDATA')

paths_to_check = [
    os.path.join(appdata, 'kiwoom-trader'),
    os.path.join(appdata, 'ai-trader')
]

for p in paths_to_check:
    print(f"\n======================================")
    print(f"Checking Path: {p}")
    print(f"======================================")
    if not os.path.exists(p):
        print("Path does not exist.")
        continue
        
    config_path = os.path.join(p, 'config.json')
    if os.path.exists(config_path):
        print(f"--- config.json found ---")
        try:
            with open(config_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
                ai_set = data.get('ai_settings', {})
                print(f"Model Name: {ai_set.get('modelName')}")
                print(f"Deep Model Name: {ai_set.get('deepModelName')}")
                print(f"Deep Model Agents: {ai_set.get('deepModelAgents')}")
                print(f"Lightweight Cloud Model: {ai_set.get('lightweightCloudModel')}")
                print(f"Lightweight Cloud Agents: {ai_set.get('lightweightCloudAgents')}")
        except Exception as e:
            print("Error:", e)
            
    # DB 파일들 체크
    db_candidates = [
        os.path.join(p, 'kiwoom.db'),
        os.path.join(p, 'db', 'kiwoom.db')
    ]
    for dbp in db_candidates:
        if os.path.exists(dbp):
            print(f"\n--- Database: {dbp} ---")
            try:
                conn = sqlite3.connect(dbp)
                cursor = conn.cursor()
                cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
                tables = [t[0] for t in cursor.fetchall()]
                print("Tables present:", ", ".join(tables))
                
                if 'ai_execution_logs' in tables:
                    cursor.execute("SELECT COUNT(*) FROM ai_execution_logs")
                    count = cursor.fetchone()[0]
                    print(f"Total logs in ai_execution_logs: {count}")
                    if count > 0:
                        cursor.execute("""
                            SELECT id, agentId, agentName, triggerType, targetType, status, queuedAt, modelName, error 
                            FROM ai_execution_logs 
                            ORDER BY queuedAt DESC 
                            LIMIT 10
                        """)
                        rows = cursor.fetchall()
                        col_names = [d[0] for d in cursor.description]
                        print(" | ".join(col_names))
                        print("-" * 120)
                        for row in rows:
                            print(" | ".join(str(val) for val in row))
                conn.close()
            except Exception as e:
                print("DB Error:", e)
