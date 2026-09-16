import sqlite3
import os
import json

db_path = os.path.expandvars(r'%APPDATA%\kiwoom-trader\db\kiwoom.db')
conn = sqlite3.connect(db_path)
conn.row_factory = sqlite3.Row
cur = conn.cursor()

report = {}

# 1. Live trade tickets performance
cur.execute("""
    SELECT 
        strategy_category,
        count(*) as total,
        sum(case when realized_profit_pct > 0 then 1 else 0 end) as wins,
        sum(case when realized_profit_pct <= 0 then 1 else 0 end) as losses,
        avg(realized_profit_pct) as avg_return,
        min(realized_profit_pct) as max_loss,
        max(realized_profit_pct) as max_gain,
        sum(realized_profit_pct) as total_return
    FROM live_trade_tickets
    WHERE realized_profit_pct IS NOT NULL
    GROUP BY strategy_category
""")
report['live_trades_by_category'] = [dict(r) for r in cur.fetchall()]

cur.execute("""
    SELECT 
        count(*) as total,
        sum(case when realized_profit_pct > 0 then 1 else 0 end) as wins,
        sum(case when realized_profit_pct <= 0 then 1 else 0 end) as losses,
        avg(realized_profit_pct) as avg_return,
        min(realized_profit_pct) as max_loss,
        max(realized_profit_pct) as max_gain,
        sum(realized_profit_pct) as total_return
    FROM live_trade_tickets
    WHERE realized_profit_pct IS NOT NULL
""")
report['live_trades_overall'] = dict(cur.fetchone())

# 2. MAIIS trade history
cur.execute("""
    SELECT 
        count(*) as total,
        sum(case when profit_rate > 0 then 1 else 0 end) as wins,
        sum(case when profit_rate <= 0 then 1 else 0 end) as losses,
        avg(profit_rate) as avg_return,
        min(profit_rate) as max_loss,
        max(profit_rate) as max_gain
    FROM maiis_trade_history
    WHERE profit_rate IS NOT NULL
""")
report['maiis_trades_overall'] = dict(cur.fetchone())

cur.execute("""
    SELECT 
        strategy,
        count(*) as total,
        sum(case when profit_rate > 0 then 1 else 0 end) as wins,
        avg(profit_rate) as avg_return
    FROM maiis_trade_history
    WHERE profit_rate IS NOT NULL
    GROUP BY strategy
""")
report['maiis_trades_by_strategy'] = [dict(r) for r in cur.fetchall()]

# 3. Track A ~ E performance
tracks = ['track_a_buy_picks', 'track_b_buy_picks', 'track_c_buy_picks', 'track_d_buy_picks', 'track_e_buy_picks']
report['tracks'] = {}
for t in tracks:
    cur.execute(f"""
        SELECT 
            count(*) as total,
            sum(case when status='CLOSED' then 1 else 0 end) as closed,
            sum(case when final_return > 0 then 1 else 0 end) as wins,
            sum(case when final_return <= 0 then 1 else 0 end) as losses,
            avg(final_return) as avg_return,
            avg(peak_return) as avg_peak,
            min(final_return) as max_loss,
            max(final_return) as max_gain
        FROM {t}
        WHERE final_return IS NOT NULL
    """)
    report['tracks'][t] = dict(cur.fetchone())

# 4. Persona performance
cur.execute("""
    SELECT 
        persona_id,
        count(*) as total,
        sum(case when is_hit = 1 then 1 else 0 end) as hits,
        avg(is_hit) * 100 as hit_rate
    FROM persona_performance
    GROUP BY persona_id
""")
report['persona_performance'] = [dict(r) for r in cur.fetchall()]

# 5. Latest Portfolio Retrospective Reports
cur.execute("""
    SELECT id, created_date, total_trades, win_rate, avg_return, diagnoses_json, failure_patterns_json, success_patterns_json, pm1_improvements_json
    FROM portfolio_retrospective_reports
    ORDER BY id DESC
    LIMIT 3
""")
report['latest_retrospectives'] = [dict(r) for r in cur.fetchall()]

# 6. Exit reasons breakdown
cur.execute("""
    SELECT exit_reason, count(*), avg(profit_rate)
    FROM maiis_trade_history
    WHERE exit_reason IS NOT NULL
    GROUP BY exit_reason
""")
report['maiis_exit_reasons'] = [dict(r) for r in cur.fetchall()]

with open('tmp/compiled_statistics.json', 'w', encoding='utf-8') as f:
    json.dump(report, f, ensure_ascii=False, indent=2)

print("Saved compiled statistics to tmp/compiled_statistics.json")
