import sqlite3
import os
import sys

# 강제로 stdout 인코딩을 UTF-8로 설정하여 cp949 인코딩 에러 방지
sys.stdout.reconfigure(encoding='utf-8')

appdata = os.getenv('APPDATA')
db_path = os.path.join(appdata, 'kiwoom-trader', 'db', 'kiwoom.db')

try:
    if not os.path.exists(db_path):
        print(f"[{db_path}] DB file not found.")
        exit(1)

    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    print('\n[DB Migration Start]')
    print(f'DB Path: {db_path}')
    
    cursor.execute("UPDATE maiis_portfolio SET status = 'HELD', last_signal = 'BUY' WHERE status = 'IMMEDIATE_BUY'")
    changes1 = cursor.rowcount
    
    cursor.execute("UPDATE maiis_portfolio SET status = 'WATCHING' WHERE status = 'WATCHLIST'")
    changes2 = cursor.rowcount
    
    conn.commit()
    
    print(f'- [IMMEDIATE_BUY -> HELD] Updated: {changes1}')
    print(f'- [WATCHLIST -> WATCHING] Updated: {changes2}\n')
    print('Migration Complete. Safe to restart the electron app.')
    
except Exception as e:
    print('Migration Error:', e)
finally:
    if 'conn' in locals():
        conn.close()
