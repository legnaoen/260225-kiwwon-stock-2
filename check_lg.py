# -*- coding: utf-8 -*-
import sqlite3
import sys

sys.stdout.reconfigure(encoding='utf-8')

def run():
    conn = sqlite3.connect(r'C:\Users\legna\AppData\Roaming\kiwoom-trader\db\kiwoom.db')
    c = conn.cursor()

    c.execute("SELECT * FROM maiis_trade_history WHERE stock_name = 'LG전자';")
    rows = c.fetchall()
    print("--- maiis_trade_history LG전자 ---")
    for r in rows:
        print(r)
        
    c.execute("SELECT id, stock_code, stock_name, status, strategy, current_price, target_price, stop_loss_price, profit_rate, created_at, updated_at FROM maiis_portfolio WHERE stock_name IN ('LG전자', '바이젠셀');")
    rows = c.fetchall()
    print("\n--- maiis_portfolio ---")
    for r in rows:
        print(f"[{r[0]}] {r[1]} {r[2]} | STATUS: {r[3]} | STRATEGY: {r[4]} | CUR: {r[5]} | PNL: {r[8]:.2f}% | CREATED: {r[9]} | UPDATED: {r[10]}")
        
    conn.close()

if __name__ == '__main__':
    run()
