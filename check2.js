const db = require('better-sqlite3')('database.sqlite');
console.log('--- track_b_buy_picks ---');
const picks = db.prepare("SELECT stock_name, related_themes_json, reason, risk FROM track_b_buy_picks WHERE stock_name='인스코비' ORDER BY pick_date DESC LIMIT 1").get();
console.log(picks);

console.log('\n--- naver_news_flow (last 3 days) ---');
const news = db.prepare("SELECT title FROM naver_news_flow WHERE title LIKE '%인스코비%' OR search_keyword IN ('스마트그리드(지능형전력网)', '무선통신서비스') ORDER BY collected_at DESC LIMIT 5").all();
console.log(news);
