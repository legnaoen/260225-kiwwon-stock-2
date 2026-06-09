import sqlite3
import os

user_profile = os.environ.get('USERPROFILE', r'C:\Users\legna')
db_path = os.path.join(user_profile, 'AppData', 'Roaming', 'kiwoom-trader', 'db', 'kiwoom.db')

if os.path.exists(db_path):
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    cursor.execute("SELECT id, agent_type, rule_text, source_prediction_id, created_at FROM agent_rules ORDER BY id DESC LIMIT 10")
    rows = cursor.fetchall()
    
    with open('scratch/rules_output.txt', 'w', encoding='utf-8') as f:
        f.write(f"DB Path: {db_path}\n")
        f.write("=" * 60 + "\n")
        for r in rows:
            f.write(f"ID: {r[0]} | Type: {r[1]} | Source: {r[3]} | Created: {r[4]}\n")
            f.write(f"Rule: {r[2]}\n")
            f.write("-" * 60 + "\n")
            
    print("Rules output written to scratch/rules_output.txt")
    conn.close()
else:
    print("Database not found.")
