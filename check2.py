import sqlite3
import json

db_path = r'C:\Users\legna\AppData\Roaming\kiwoom-trader\db\kiwoom.db'
conn = sqlite3.connect(db_path)
c = conn.cursor()

print("--- track_b_buy_picks ---")
c.execute("SELECT stock_name, related_themes_json, reason, risk FROM track_b_buy_picks WHERE stock_name='인스코비' ORDER BY pick_date DESC LIMIT 1")
pick = c.fetchone()
if pick:
    print(f"Name: {pick[0]}")
    print(f"Themes: {pick[1]}")
    print(f"Reason: {pick[2]}")
    print(f"Risk: {pick[3]}")

print("\n--- naver_news_flow (last 3 days) ---")
c.execute("SELECT title FROM naver_news_flow WHERE title LIKE '%인스코비%' OR search_keyword IN ('스마트그리드(지능형전력网)', '무선통신서비스') ORDER BY collected_at DESC LIMIT 5")
for row in c.fetchall():
    print(row[0])
