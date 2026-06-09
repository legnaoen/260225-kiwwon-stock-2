import os
import json
import sqlite3

appdata_path = os.environ.get('APPDATA')
kiwoom_trader_path = os.path.join(appdata_path, 'kiwoom-trader')
print('Appdata kiwoom-trader path:', kiwoom_trader_path)

if os.path.exists(kiwoom_trader_path):
    print('Contents of kiwoom-trader path:', os.listdir(kiwoom_trader_path))
    
    config_json_path = os.path.join(kiwoom_trader_path, 'config.json')
    if os.path.exists(config_json_path):
        print('\n--- config.json (settings) ---')
        try:
            with open(config_json_path, 'r', encoding='utf-8') as f:
                config_data = json.load(f)
                ai_settings = config_data.get('ai_settings', {})
                print(json.dumps(ai_settings, indent=2, ensure_ascii=False))
        except Exception as e:
            print('Error reading config.json:', e)
            
    db_path = os.path.join(kiwoom_trader_path, 'db', 'kiwoom.db')
    if os.path.exists(db_path):
        print('\n--- kiwoom.db (Recent 20 AI Execution Logs) ---')
        try:
            conn = sqlite3.connect(db_path)
            cursor = conn.cursor()
            cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
            tables = [t[0] for t in cursor.fetchall()]
            if 'ai_execution_logs' in tables:
                cursor.execute("""
                    SELECT id, agentId, agentName, triggerType, targetType, status, queuedAt, modelName, error 
                    FROM ai_execution_logs 
                    ORDER BY queuedAt DESC 
                    LIMIT 20
                """)
                rows = cursor.fetchall()
                col_names = [d[0] for d in cursor.description]
                
                # 출력
                print(" | ".join(col_names))
                print("-" * 140)
                for row in rows:
                    print(" | ".join(str(val) for val in row))
            else:
                print('Table ai_execution_logs does not exist.')
            conn.close()
        except Exception as e:
            print('Error reading SQLite DB:', e)
else:
    print('Directory does not exist.')
