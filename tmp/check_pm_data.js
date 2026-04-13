const db = require('better-sqlite3')('database.sqlite');

console.log('=== ai_analyst_picks 최근 날짜별 요약 ===');
const dates = db.prepare(
    'SELECT date, agent_type, COUNT(*) as cnt FROM ai_analyst_picks GROUP BY date, agent_type ORDER BY date DESC LIMIT 20'
).all();
dates.forEach(d => console.log(JSON.stringify(d)));

console.log('\n=== maiis_portfolio 활성 종목 ===');
const portfolio = db.prepare(
    "SELECT stock_code, stock_name, status, strategy, conviction_score, substr(updated_at,1,16) as upd FROM maiis_portfolio WHERE status NOT IN ('DROPPED','HIT') ORDER BY conviction_score DESC"
).all();
portfolio.forEach(p => console.log(JSON.stringify(p)));

console.log('\n=== maiis_portfolio WATCHLIST 상태 종목 ===');
const watchlist = db.prepare(
    "SELECT stock_code, stock_name, status, last_signal_reason FROM maiis_portfolio WHERE status = 'WATCHLIST'"
).all();
watchlist.forEach(w => console.log(JSON.stringify(w)));

db.close();
