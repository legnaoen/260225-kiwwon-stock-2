const path = require('path');
const Database = require('better-sqlite3');
const appDataPath = process.env.APPDATA || '';
const dbPath = path.join(appDataPath, 'kiwoom-trader', 'data', 'kiwoom-trader.db');

try {
    const db = new Database(dbPath, { readonly: true });
    const latest = db.prepare('SELECT date, timing, COUNT(*) as cnt FROM daily_rising_stocks GROUP BY date, timing ORDER BY date DESC LIMIT 3').all();
    console.log('=== DB: daily_rising_stocks ===');
    console.log(JSON.stringify(latest, null, 2));
    
    if (latest.length > 0) {
        const sample = db.prepare('SELECT stock_name, stock_code, change_rate, trading_value, theme_sector, source, ai_score FROM daily_rising_stocks WHERE date = ? AND timing = ? ORDER BY change_rate DESC LIMIT 5').all(latest[0].date, latest[0].timing);
        console.log('\n=== Top 5 sample ===');
        console.log(JSON.stringify(sample, null, 2));
    }
    db.close();
} catch(e) {
    console.error('DB Error:', e.message);
}
