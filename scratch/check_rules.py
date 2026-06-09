import sqlite3
import os

user_profile = os.environ.get('USERPROFILE', r'C:\Users\legna')
possible_paths = [
    os.path.join(user_profile, 'AppData', 'Roaming', 'kiwoom-trader', 'db', 'kiwoom.db'),
    os.path.join(user_profile, 'AppData', 'Roaming', 'Electron', 'db', 'kiwoom.db'),
]

found = False
for path in possible_paths:
    if os.path.exists(path):
        print(f"Found DB at: {path}")
        conn = sqlite3.connect(path)
        cursor = conn.cursor()
        
        # Check if table agent_rules exists
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='agent_rules'")
        if cursor.fetchone():
            print("Table 'agent_rules' exists.")
            cursor.execute("SELECT COUNT(*) FROM agent_rules")
            count = cursor.fetchone()[0]
            print(f"Total rules: {count}")
            
            cursor.execute("SELECT id, agent_type, rule_text, source_prediction_id, is_active, created_at FROM agent_rules ORDER BY id DESC LIMIT 10")
            rows = cursor.fetchall()
            for r in rows:
                print(f"ID: {r[0]} | Type: {r[1]} | Source: {r[3]} | Created: {r[5]}")
                print(f"Rule: {r[2]}")
                print("-" * 50)
        else:
            print("Table 'agent_rules' does not exist in this database.")
        
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='agent_retrospectives'")
        if cursor.fetchone():
            print("Table 'agent_retrospectives' exists.")
            cursor.execute("SELECT type, COUNT(*) FROM agent_retrospectives GROUP BY type")
            print(cursor.fetchall())
            
        conn.close()
        found = True
        break

if not found:
    print("Database file kiwoom.db not found in standard paths.")
