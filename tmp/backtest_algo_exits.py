import sqlite3
import os
import json
from collections import defaultdict

db_path = os.path.expandvars(r'%APPDATA%\kiwoom-trader\db\kiwoom.db')
conn = sqlite3.connect(db_path)
conn.row_factory = sqlite3.Row
cur = conn.cursor()

# Load all daily OHLCV into an indexed dict: (stock_code, date) -> row
print("Loading OHLCV data into memory...")
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

print(f"Loaded OHLCV for {len(ohlcv_by_code)} stocks.")

# Let's get unique picks across Track A, B, C, D, E
tracks = ['track_a_buy_picks', 'track_b_buy_picks', 'track_c_buy_picks', 'track_d_buy_picks', 'track_e_buy_picks']
all_picks = []

for t in tracks:
    cur.execute(f"SELECT stock_code, stock_name, entry_date, entry_price, '{t}' as track FROM {t} WHERE entry_price > 0 AND entry_date IS NOT NULL")
    for r in cur.fetchall():
        all_picks.append(dict(r))

print(f"Total picks across all tracks: {len(all_picks)}")

def simulate_strategy(picks, tp_pct, sl_pct, trail_trigger_pct=None, trail_drop_pct=None, max_hold_days=20, cost_pct=0.35):
    """
    Simulates exits using daily OHLCV:
    - Entry at entry_date close (or entry_price recorded)
    - Each subsequent day:
      1. Check if intraday low hits stop loss (sl_pct)
      2. Check if intraday high hits take profit (tp_pct)
      3. If trailing stop active, check if low hits trailing stop price
      4. If max_hold_days reached, exit at close
    """
    results = []
    
    for pick in picks:
        code = pick['stock_code']
        entry_date = pick['entry_date']
        entry_price = pick['entry_price']
        
        bars = ohlcv_by_code.get(code, [])
        if not bars:
            continue
            
        # Find entry index
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
            
        # Actual entry price (use bar's open or close)
        actual_entry = entry_price if entry_price > 0 else bars[entry_idx]['close']
        if actual_entry <= 0:
            continue
            
        peak_price = actual_entry
        exit_price = None
        exit_date = None
        exit_reason = None
        days_held = 0
        
        # Test subsequent days
        for day_offset, i in enumerate(range(entry_idx + 1, min(entry_idx + 1 + max_hold_days, len(bars))), 1):
            days_held = day_offset
            b = bars[i]
            
            # Update peak price
            if b['high'] > peak_price:
                peak_price = b['high']
                
            peak_gain_pct = (peak_price - actual_entry) / actual_entry * 100
            
            # 1. Hard Stop Loss check (based on low)
            loss_pct = (b['low'] - actual_entry) / actual_entry * 100
            if sl_pct is not None and loss_pct <= sl_pct:
                # Stop loss triggered (exit at stop price or open if open gapped down)
                stop_target = actual_entry * (1 + sl_pct / 100)
                exit_price = min(b['open'], stop_target) if b['open'] < stop_target else stop_target
                exit_date = b['date']
                exit_reason = 'STOP_LOSS'
                break
                
            # 2. Trailing Stop check
            if trail_trigger_pct is not None and peak_gain_pct >= trail_trigger_pct:
                trail_stop_target = peak_price * (1 - trail_drop_pct / 100)
                if b['low'] <= trail_stop_target:
                    exit_price = min(b['open'], trail_stop_target) if b['open'] < trail_stop_target else trail_stop_target
                    exit_date = b['date']
                    exit_reason = 'TRAILING_STOP'
                    break
                    
            # 3. Take Profit check (based on high)
            if tp_pct is not None:
                gain_pct = (b['high'] - actual_entry) / actual_entry * 100
                if gain_pct >= tp_pct:
                    tp_target = actual_entry * (1 + tp_pct / 100)
                    exit_price = max(b['open'], tp_target) if b['open'] > tp_target else tp_target
                    exit_date = b['date']
                    exit_reason = 'TAKE_PROFIT'
                    break
                    
            # 4. Max hold days reached
            if day_offset == max_hold_days:
                exit_price = b['close']
                exit_date = b['date']
                exit_reason = 'TIME_LIMIT'
                break
                
        if exit_price is None:
            # Reached end of available data
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
            'entry_date': entry_date,
            'exit_date': exit_date,
            'days_held': days_held,
            'net_return': net_return,
            'exit_reason': exit_reason,
            'is_win': net_return > 0
        })
        
    total = len(results)
    if total == 0:
        return None
        
    wins = sum(1 for r in results if r['is_win'])
    win_rate = (wins / total) * 100
    avg_return = sum(r['net_return'] for r in results) / total
    total_return = sum(r['net_return'] for r in results)
    
    # Profit factor calculation
    gross_gains = sum(r['net_return'] for r in results if r['net_return'] > 0)
    gross_losses = abs(sum(r['net_return'] for r in results if r['net_return'] <= 0))
    profit_factor = (gross_gains / gross_losses) if gross_losses > 0 else 999.0
    
    avg_win = (gross_gains / wins) if wins > 0 else 0
    avg_loss = (gross_losses / (total - wins)) if (total - wins) > 0 else 0
    avg_hold = sum(r['days_held'] for r in results) / total
    
    return {
        'total_trades': total,
        'win_rate': round(win_rate, 2),
        'avg_return': round(avg_return, 2),
        'total_return': round(total_return, 1),
        'profit_factor': round(profit_factor, 2),
        'avg_win': round(avg_win, 2),
        'avg_loss': round(avg_loss, 2),
        'avg_hold_days': round(avg_hold, 1),
        'tp_count': sum(1 for r in results if r['exit_reason'] == 'TAKE_PROFIT'),
        'sl_count': sum(1 for r in results if r['exit_reason'] == 'STOP_LOSS'),
        'trail_count': sum(1 for r in results if r['exit_reason'] == 'TRAILING_STOP'),
        'time_count': sum(1 for r in results if r['exit_reason'] == 'TIME_LIMIT')
    }

# Run a suite of rule-based tests
tests = [
    {"name": "Original Benchmark (No Stop, Max 20 Days)", "tp": None, "sl": None, "trail_trig": None, "trail_drop": None, "hold": 20},
    {"name": "Tight Stop Only (SL -3%, Hold 20d)", "tp": None, "sl": -3.0, "trail_trig": None, "trail_drop": None, "hold": 20},
    {"name": "Tight Stop Only (SL -5%, Hold 20d)", "tp": None, "sl": -5.0, "trail_trig": None, "trail_drop": None, "hold": 20},
    {"name": "Fixed TP +5% / SL -3% (Hold 10d)", "tp": 5.0, "sl": -3.0, "trail_trig": None, "trail_drop": None, "hold": 10},
    {"name": "Fixed TP +7% / SL -3% (Hold 10d)", "tp": 7.0, "sl": -3.0, "trail_trig": None, "trail_drop": None, "hold": 10},
    {"name": "Fixed TP +10% / SL -4% (Hold 15d)", "tp": 10.0, "sl": -4.0, "trail_trig": None, "trail_drop": None, "hold": 15},
    {"name": "Fixed TP +15% / SL -5% (Hold 20d)", "tp": 15.0, "sl": -5.0, "trail_trig": None, "trail_drop": None, "hold": 20},
    {"name": "Trailing Stop (+5% trigger -> trail -2.5%, SL -3%, Hold 10d)", "tp": None, "sl": -3.0, "trail_trig": 5.0, "trail_drop": 2.5, "hold": 10},
    {"name": "Trailing Stop (+7% trigger -> trail -3.0%, SL -3%, Hold 15d)", "tp": None, "sl": -3.0, "trail_trig": 7.0, "trail_drop": 3.0, "hold": 15},
    {"name": "Trailing Stop (+10% trigger -> trail -4.0%, SL -4%, Hold 20d)", "tp": None, "sl": -4.0, "trail_trig": 10.0, "trail_drop": 4.0, "hold": 20},
    {"name": "Fast Scalp Exit (Hold 3d, SL -3%)", "tp": None, "sl": -3.0, "trail_trig": None, "trail_drop": None, "hold": 3},
    {"name": "Fast Scalp Exit (Hold 5d, SL -3%)", "tp": None, "sl": -3.0, "trail_trig": None, "trail_drop": None, "hold": 5}
]

summary_results = []
for t in tests:
    res = simulate_strategy(all_picks, t['tp'], t['sl'], t['trail_trig'], t['trail_drop'], t['hold'])
    if res:
        res['strategy_name'] = t['name']
        summary_results.append(res)

with open('tmp/algo_exit_sim_results.json', 'w', encoding='utf-8') as f:
    json.dump(summary_results, f, ensure_ascii=False, indent=2)

print("\n=== SIMULATION SUMMARY RESULTS ===")
print(f"{'Strategy Name':<55} | {'Win%':<6} | {'Avg%':<6} | {'PF':<5} | {'Tot%':<8} | {'AvgWin':<6} | {'AvgLoss':<7} | {'HoldD'}")
print("-" * 115)
for s in summary_results:
    print(f"{s['strategy_name']:<55} | {s['win_rate']:<6.1f} | {s['avg_return']:<6.2f} | {s['profit_factor']:<5.2f} | {s['total_return']:<8.1f} | {s['avg_win']:<6.2f} | {s['avg_loss']:<7.2f} | {s['avg_hold_days']}")
