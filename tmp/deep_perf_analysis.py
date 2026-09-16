import sqlite3
import os
import json

db_path = os.path.expandvars(r'%APPDATA%\kiwoom-trader\db\kiwoom.db')
conn = sqlite3.connect(db_path)
conn.row_factory = sqlite3.Row
cur = conn.cursor()

def dump_table_summary(table_name, limit=10):
    print(f"\n=================== TABLE: {table_name} ===================")
    cur.execute(f"PRAGMA table_info({table_name})")
    cols = [r['name'] for r in cur.fetchall()]
    print("Columns:", cols)
    cur.execute(f"SELECT COUNT(*) FROM {table_name}")
    count = cur.fetchone()[0]
    print(f"Total Rows: {count}")
    cur.execute(f"SELECT * FROM {table_name} ORDER BY rowid DESC LIMIT {limit}")
    rows = [dict(r) for r in cur.fetchall()]
    return rows

output = {}

tables_to_check = [
    'persona_performance',
    'ai_analyst_picks',
    'track_a_buy_picks',
    'track_b_buy_picks',
    'track_c_buy_picks',
    'track_d_buy_picks',
    'track_e_buy_picks',
    'maiis_trade_history',
    'live_trade_tickets',
    'live_trade_strategies',
    'moonshot_eval_history',
    'agent_retrospectives',
    'portfolio_retrospective_reports',
    'track_self_learning_history'
]

for tbl in tables_to_check:
    rows = dump_table_summary(tbl, 5)
    output[tbl] = rows

with open('tmp/perf_analysis_samples.json', 'w', encoding='utf-8') as f:
    json.dump(output, f, ensure_ascii=False, indent=2)

print("\nDone writing samples to tmp/perf_analysis_samples.json")
