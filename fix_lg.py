import sqlite3

def fix_lg():
    conn = sqlite3.connect(r'C:\Users\legna\AppData\Roaming\kiwoom-trader\db\kiwoom.db')
    c = conn.cursor()
    
    # Insert closed trade for LG
    c.execute("""
        INSERT INTO maiis_trade_history (stock_code, stock_name, entry_date, entry_price, entry_reason, entry_at, strategy, status, exit_date, exit_price, exit_reason, profit_rate, created_at, updated_at)
        VALUES ('066570', 'LG전자', '2026-04-28', 141679, '이전 매수', '2026-04-28 09:45:00', 'MOMENTUM', 'CLOSED', '2026-05-08', 147800.0, '매수 포지션 이탈 (WATCHING 강등)', 4.32, datetime('now', 'localtime'), datetime('now', 'localtime'))
    """)
    
    # Reset entry fields in portfolio
    c.execute("""
        UPDATE maiis_portfolio 
        SET entry_price = 0, entry_price_at = NULL, profit_rate = 0, entry_date = NULL, days_held = 0
        WHERE stock_name = 'LG전자' AND status = 'WATCHING'
    """)
    
    conn.commit()
    print("LG전자 데이터 보정 완료!")

if __name__ == '__main__':
    fix_lg()
