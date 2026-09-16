import sqlite3
import os
from collections import defaultdict

db_path = os.path.expandvars(r'%APPDATA%\kiwoom-trader\db\kiwoom.db')
conn = sqlite3.connect(db_path)
conn.row_factory = sqlite3.Row
cur = conn.cursor()

cur.execute("SELECT stock_code, date, open, high, low, close FROM market_ohlcv_history ORDER BY stock_code, date ASC")
ohlcv_by_code = defaultdict(list)
for r in cur.fetchall():
    ohlcv_by_code[r['stock_code']].append({
        'date': r['date'],
        'open': float(r['open']),
        'high': float(r['high']),
        'low': float(r['low']),
        'close': float(r['close'])
    })

cur.execute("SELECT stock_code, entry_date, entry_price FROM track_a_buy_picks WHERE entry_price > 0 AND entry_date IS NOT NULL")
picks = [dict(r) for r in cur.fetchall()]

day1_returns = []
day1_lows = []

for pick in picks:
    code = pick['stock_code']
    bars = ohlcv_by_code.get(code, [])
    entry_idx = -1
    for i, b in enumerate(bars):
        if b['date'] == pick['entry_date']:
            entry_idx = i
            break
    if entry_idx != -1 and entry_idx + 1 < len(bars):
        b0 = bars[entry_idx]
        b1 = bars[entry_idx + 1]
        c0 = pick['entry_price'] if pick['entry_price'] > 0 else b0['close']
        day1_ret = (b1['close'] - c0) / c0 * 100
        day1_low = (b1['low'] - c0) / c0 * 100
        day1_returns.append(day1_ret)
        day1_lows.append(day1_low)

print(f"Total valid picks checked: {len(day1_returns)}")
drops = sum(1 for r in day1_returns if r < 0)
low_drops_3pct = sum(1 for l in day1_lows if l <= -3.0)
print(f"Day +1 Close was NEGATIVE: {drops} / {len(day1_returns)} ({drops/len(day1_returns)*100:.1f}%)")
print(f"Day +1 Low dropped <= -3.0%: {low_drops_3pct} / {len(day1_lows)} ({low_drops_3pct/len(day1_lows)*100:.1f}%)")
print(f"Average Day +1 return: {sum(day1_returns)/len(day1_returns):.2f}%")
