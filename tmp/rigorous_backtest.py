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
all_picks = []
for t in tracks:
    cur.execute(f"SELECT stock_code, stock_name, entry_date, entry_price, '{t}' as track FROM {t} WHERE entry_price > 0 AND entry_date IS NOT NULL")
    for r in cur.fetchall():
        all_picks.append(dict(r))

def run_rigorous_conservative_test(picks, tp_pct, sl_pct, max_hold_days=10, cost_pct=0.4):
    """
    CONSERVATIVE RULES:
    1. If BOTH TP and SL can hit on the same day:
       - Assume WORST CASE: Stop Loss hit first!
    2. Slippage & Cost: 0.4% round-trip.
    3. If Gap down open < SL: exit at OPEN (full gap loss).
    4. If Gap up open > TP: exit at TP (do not assume lucky gap execution).
    """
    results = []
    both_hit_count = 0
    
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
        exit_date = None
        exit_reason = None
        days_held = 0
        
        for day_offset, i in enumerate(range(entry_idx + 1, min(entry_idx + 1 + max_hold_days, len(bars))), 1):
            days_held = day_offset
            b = bars[i]
            
            sl_target = actual_entry * (1 - abs(sl_pct) / 100.0)
            tp_target = actual_entry * (1 + abs(tp_pct) / 100.0)
            
            can_sl = b['low'] <= sl_target
            can_tp = b['high'] >= tp_target
            
            if can_sl and can_tp:
                both_hit_count += 1
                # CONSERVATIVE: Assume SL hits first!
                exit_price = min(b['open'], sl_target)
                exit_date = b['date']
                exit_reason = 'STOP_LOSS_WORST_CASE'
                break
            elif can_sl:
                exit_price = min(b['open'], sl_target)
                exit_date = b['date']
                exit_reason = 'STOP_LOSS'
                break
            elif can_tp:
                # If opened above TP target, exit at open, else at TP target
                exit_price = tp_target
                exit_date = b['date']
                exit_reason = 'TAKE_PROFIT'
                break
                
            if day_offset == max_hold_days:
                exit_price = b['close']
                exit_date = b['date']
                exit_reason = 'TIME_LIMIT'
                break
                
        if exit_price is None:
            last_bar = bars[min(entry_idx + max_hold_days, len(bars) - 1)]
            exit_price = last_bar['close']
            exit_date = last_bar['date']
            exit_reason = 'DATA_END'
            
        raw_return = (exit_price - actual_entry) / actual_entry * 100
        net_return = raw_return - cost_pct
        
        results.append({
            'code': code,
            'name': pick['stock_name'],
            'track': pick['track'],
            'days_held': days_held,
            'net_return': net_return,
            'exit_reason': exit_reason,
            'is_win': net_return > 0
        })
        
    total = len(results)
    wins = sum(1 for r in results if r['is_win'])
    losses = total - wins
    win_rate = (wins / total) * 100 if total > 0 else 0
    avg_return = sum(r['net_return'] for r in results) / total if total > 0 else 0
    total_return = sum(r['net_return'] for r in results)
    
    gains = sum(r['net_return'] for r in results if r['is_win'])
    losses_sum = abs(sum(r['net_return'] for r in results if not r['is_win']))
    pf = (gains / losses_sum) if losses_sum > 0 else 999.0
    
    avg_win = (gains / wins) if wins > 0 else 0
    avg_loss = (losses_sum / losses) if losses > 0 else 0
    avg_hold = sum(r['days_held'] for r in results) / total if total > 0 else 0
    
    tp_hits = sum(1 for r in results if r['exit_reason'] == 'TAKE_PROFIT')
    sl_hits = sum(1 for r in results if 'STOP_LOSS' in r['exit_reason'])
    time_exits = sum(1 for r in results if r['exit_reason'] == 'TIME_LIMIT')
    
    return {
        'tp_pct': tp_pct,
        'sl_pct': sl_pct,
        'max_hold': max_hold_days,
        'total': total,
        'win_rate': round(win_rate, 2),
        'avg_return': round(avg_return, 2),
        'total_return': round(total_return, 1),
        'profit_factor': round(pf, 2),
        'avg_win': round(avg_win, 2),
        'avg_loss': round(avg_loss, 2),
        'avg_hold': round(avg_hold, 1),
        'tp_hits': tp_hits,
        'sl_hits': sl_hits,
        'time_exits': time_exits,
        'both_hit_count': both_hit_count
    }

print("\n=== RIGOROUS CONSERVATIVE BACKTEST (WORST-CASE ON SAME DAY, 0.4% FEES) ===")
settings = [
    (3.0, 3.0, 5),
    (5.0, 3.0, 5),
    (5.0, 3.0, 10),
    (7.0, 3.0, 5),
    (7.0, 3.0, 10),
    (7.0, 4.0, 10),
    (10.0, 4.0, 10),
    (10.0, 5.0, 15),
    (12.0, 5.0, 15),
    (15.0, 5.0, 20),
    (20.0, 7.0, 20)
]

print(f"{'TP / SL / Hold':<20} | {'Win%':<6} | {'Avg%':<6} | {'PF':<5} | {'Tot%':<8} | {'AvgWin':<6} | {'AvgLoss':<7} | {'TP_Hits':<7} | {'SL_Hits':<7} | {'HoldD'}")
print("-" * 110)
rigorous_results = []
for tp, sl, hold in settings:
    r = run_rigorous_conservative_test(all_picks, tp, sl, hold)
    rigorous_results.append(r)
    label = f"+{tp}% / -{sl}% ({hold}d)"
    print(f"{label:<20} | {r['win_rate']:<6.1f} | {r['avg_return']:<6.2f} | {r['profit_factor']:<5.2f} | {r['total_return']:<8.1f} | {r['avg_win']:<6.2f} | {r['avg_loss']:<7.2f} | {r['tp_hits']:<7} | {r['sl_hits']:<7} | {r['avg_hold']}")

with open('tmp/rigorous_sim_results.json', 'w', encoding='utf-8') as f:
    json.dump(rigorous_results, f, ensure_ascii=False, indent=2)
