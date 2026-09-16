import json
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

tracks = ['track_a_buy_picks', 'track_b_buy_picks', 'track_c_buy_picks', 'track_d_buy_picks', 'track_e_buy_picks']

def run_track_test(track_name, tp_pct=7.0, sl_pct=3.0, max_hold_days=10, cost_pct=0.4):
    cur.execute(f"SELECT stock_code, stock_name, entry_date, entry_price FROM {track_name} WHERE entry_price > 0 AND entry_date IS NOT NULL")
    picks = [dict(r) for r in cur.fetchall()]
    
    results = []
    for pick in picks:
        code = pick['stock_code']
        entry_date = pick['entry_date']
        entry_price = pick['entry_price']
        bars = ohlcv_by_code.get(code, [])
        if not bars:
            continue
        entry_idx = -1
        for i, b in enumerate(bars):
            if b['date'] == entry_date:
                entry_idx = i
                break
            elif b['date'] > entry_date and entry_idx == -1:
                entry_idx = i
                break
        if entry_idx == -1 or entry_idx >= len(bars) - 1:
            continue
            
        actual_entry = entry_price if entry_price > 0 else bars[entry_idx]['close']
        if actual_entry <= 0:
            continue
            
        exit_price = None
        for day_offset, i in enumerate(range(entry_idx + 1, min(entry_idx + 1 + max_hold_days, len(bars))), 1):
            b = bars[i]
            sl_target = actual_entry * (1 - abs(sl_pct) / 100.0)
            tp_target = actual_entry * (1 + abs(tp_pct) / 100.0)
            
            if b['low'] <= sl_target:
                exit_price = min(b['open'], sl_target)
                break
            elif b['high'] >= tp_target:
                exit_price = tp_target
                break
            if day_offset == max_hold_days:
                exit_price = b['close']
                break
                
        if exit_price is None:
            last_bar = bars[min(entry_idx + max_hold_days, len(bars) - 1)]
            exit_price = last_bar['close']
            
        net_ret = (exit_price - actual_entry) / actual_entry * 100 - cost_pct
        results.append(net_ret)
        
    total = len(results)
    if total == 0:
        return None
    wins = sum(1 for r in results if r > 0)
    gains = sum(r for r in results if r > 0)
    losses = abs(sum(r for r in results if r <= 0))
    pf = (gains / losses) if losses > 0 else 0
    return {
        'track': track_name,
        'total': total,
        'win_rate': round((wins / total) * 100, 1),
        'avg_return': round(sum(results) / total, 2),
        'profit_factor': round(pf, 2),
        'total_return': round(sum(results), 1)
    }

print("=== TRACK BY TRACK TEST (+7% TP / -3% SL) ===")
for t in tracks:
    res = run_track_test(t, 7.0, 3.0, 10)
    print(res)

print("\n=== TRACK BY TRACK TEST (+10% TP / -4% SL) ===")
for t in tracks:
    res = run_track_test(t, 10.0, 4.0, 10)
    print(res)
