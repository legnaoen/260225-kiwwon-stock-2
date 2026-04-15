import sqlite3
import os

db_path = r'C:\Users\legna\AppData\Roaming\kiwoom-trader\db\kiwoom.db'
if not os.path.exists(db_path):
    print("DB not found at", db_path)
    # Check electron project name
    db_path = r'C:\Users\legna\AppData\Roaming\electron\db\kiwoom.db' # sometimes default
    if not os.path.exists(db_path):
        print("DB not found at", db_path)
        exit(1)

print("Reading DB at:", db_path)
db = sqlite3.connect(db_path)
cur = db.cursor()

# Get track tables
cur.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
tables = [r[0] for r in cur.fetchall()]
# print('ALL TABLES:', tables)

buy_tables = [t for t in tables if 'buy_picks' in t]
print('Buy pick tables:', buy_tables)

if buy_tables:
    union_parts = [f"SELECT stock_code, stock_name, pick_date, category FROM {t}" for t in buy_tables]
    union_sql = " UNION ALL ".join(union_parts)
    
    cur.execute(f"""
        SELECT stock_code, stock_name, pick_date, COUNT(*) as cnt, GROUP_CONCAT(category) as cats
        FROM ({union_sql})
        WHERE pick_date >= date('now', '-3 days')
        GROUP BY stock_code, pick_date
        HAVING COUNT(*) > 1
        ORDER BY pick_date DESC, cnt DESC
        LIMIT 15
    """)
    rows = cur.fetchall()
    print('\n=== DUPLICATED STOCKS ===')
    if not rows:
        print('  None - data is clean!')
    else:
        for r in rows:
            print(f'  {r[1]}({r[0]}) @ {r[2]}: {r[3]}x | cats: {r[4]}')

    cur.execute(f"""
        SELECT pick_date, COUNT(*) as total
        FROM ({union_sql})
        WHERE pick_date >= date('now', '-3 days')
        GROUP BY pick_date ORDER BY pick_date DESC
    """)
    print('\n=== RAW totals per date (with duplicates) ===')
    for r in cur.fetchall():
        print(f'  {r[0]}: {r[1]} rows')
        
    cur.execute(f"""
        SELECT pick_date, COUNT(DISTINCT stock_code) as unique_stocks
        FROM ({union_sql})
        WHERE pick_date >= date('now', '-3 days')
        GROUP BY pick_date ORDER BY pick_date DESC
    """)
    print('\n=== UNIQUE stocks per date (after DB dedup logic) ===')
    for r in cur.fetchall():
        print(f'  {r[0]}: {r[1]} rows')

db.close()
