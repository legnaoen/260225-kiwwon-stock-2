const Database = require('better-sqlite3');
const path = require('path');
const os = require('os');

const dbPath = path.join(os.homedir(), 'AppData', 'Roaming', 'kiwoom-trader', 'db', 'kiwoom.db');
console.log('DB Path:', dbPath);

try {
    const db = new Database(dbPath);
    const tableInfo = db.prepare('PRAGMA table_info(daily_rising_stocks)').all();
    console.log('Daily Rising Stocks Columns:', JSON.stringify(tableInfo, null, 2));
    
    const countByTiming = db.prepare('SELECT timing, count(*) as count FROM daily_rising_stocks GROUP BY timing').all();
    console.log('Count by Timing:', countByTiming);
    
    const sample = db.prepare('SELECT date, timing FROM daily_rising_stocks LIMIT 5').all();
    console.log('Sample Data:', sample);

    const reportHistory = db.prepare('SELECT DISTINCT date FROM daily_rising_stocks ORDER BY date DESC').all();
    console.log('Report History Dates:', reportHistory);

    db.close();
} catch (err) {
    console.error('Error:', err.message);
}
