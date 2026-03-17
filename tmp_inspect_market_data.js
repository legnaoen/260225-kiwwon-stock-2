
const Database = require('better-sqlite3');
const path = require('path');
const os = require('os');
const fs = require('fs');

const paths = [
    path.join(os.homedir(), 'AppData', 'Roaming', 'kiwoom-trader', 'db', 'kiwoom.db'),
    path.join(os.homedir(), 'AppData', 'Roaming', 'Kiwoom Trader', 'db', 'kiwoom.db')
];

let dbPath = null;
for (const p of paths) {
    if (fs.existsSync(p)) {
        dbPath = p;
        break;
    }
}

if (!dbPath) {
    console.error('Database not found in paths:', paths);
    process.exit(1);
}

console.log('Using database:', dbPath);
const db = new Database(dbPath);

try {
    console.log('--- market_daily_reports ---');
    const reports = db.prepare('SELECT id, date, timing, created_at FROM market_daily_reports ORDER BY date DESC, created_at DESC LIMIT 10').all();
    console.log(JSON.stringify(reports, null, 2));

    console.log('\n--- daily_rising_stocks summary ---');
    const stocks = db.prepare('SELECT date, timing, COUNT(*) as count FROM daily_rising_stocks GROUP BY date, timing ORDER BY date DESC LIMIT 10').all();
    console.log(JSON.stringify(stocks, null, 2));
} catch (e) {
    console.error('Query error:', e);
} finally {
    db.close();
}
