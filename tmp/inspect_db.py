import sqlite3
import os
import json

db_path = os.path.expandvars(r'%APPDATA%\kiwoom-trader\db\kiwoom.db')
print("DB Path:", db_path, "Exists:", os.path.exists(db_path))

if os.path.exists(db_path):
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    
    cur.execute("SELECT name FROM sqlite_master WHERE type='table'")
    tables = [r[0] for r in cur.fetchall()]
    print("Tables:", tables)
    
    for tbl in ['ai_strategies', 'ai_strategy_history', 'skills_file_history', 'ai_learning_log', 'trades', 'orders', 'portfolio', 'market_briefings', 'backtest_results', 'trade_logs']:
        if tbl in tables:
            print(f"\n=== Table: {tbl} ===")
            cur.execute(f"SELECT * FROM {tbl} ORDER BY rowid DESC LIMIT 10")
            rows = [dict(r) for r in cur.fetchall()]
            print(f"Count: {len(rows)}")
            for r in rows[:5]:
                print(r)
