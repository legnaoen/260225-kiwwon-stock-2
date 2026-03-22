const Database = require('better-sqlite3');
const db = new Database('./data/kiwoom.db', {readonly: true});
console.log('=== daily_rising_stocks dates ===');
console.log(JSON.stringify(db.prepare('SELECT date, timing, COUNT(*) as cnt FROM daily_rising_stocks GROUP BY date, timing ORDER BY date DESC LIMIT 10').all()));
console.log('=== sample rows ===');
console.log(JSON.stringify(db.prepare('SELECT date, timing, stock_name, ai_score, change_rate FROM daily_rising_stocks ORDER BY date DESC LIMIT 5').all()));
db.close();
