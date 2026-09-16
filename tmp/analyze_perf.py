import json

with open('tmp/db_full_summary.json', 'r', encoding='utf-8') as f:
    d = json.load(f)

print("=== TABLE LIST & COUNTS ===")
for k, v in d['data'].items():
    cnt = v.get('count', 'error')
    print(f"{k}: {cnt}")

print("\n=== AI STRATEGIES ===")
if 'ai_strategies' in d['data']:
    for row in d['data']['ai_strategies']['samples']:
        print(row)

print("\n=== AI STRATEGY HISTORY ===")
if 'ai_strategy_history' in d['data']:
    for row in d['data']['ai_strategy_history']['samples'][:5]:
        print(row)

print("\n=== TRADES SAMPLE ===")
if 'trades' in d['data']:
    for row in d['data']['trades']['samples'][:10]:
        print(row)
