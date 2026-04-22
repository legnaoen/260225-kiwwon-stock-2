const path = require('path');
const DB = require('better-sqlite3');
const appDataDir = process.env.APPDATA || (process.platform === 'darwin' ? process.env.HOME + '/Library/Application Support' : process.env.HOME + '/.config');
const dbPath = path.join(appDataDir, 'kiwoom-rest-api', 'db', 'kiwoom.db');

console.log('Connecting to', dbPath);
try {
    const db = new DB(dbPath);
    let before = db.prepare('SELECT trade_id, stock_name, entry_price, exit_price, profit_rate FROM maiis_trade_history WHERE status = ? AND exit_price > 0 AND entry_price > 0').all('CLOSED');
    console.log('Before update:');
    console.table(before);

    const info = db.prepare(`
        UPDATE maiis_trade_history 
        SET profit_rate = ROUND(((exit_price - entry_price) / entry_price) * 100, 2)
        WHERE status = 'CLOSED' 
        AND exit_price > 0 
        AND entry_price > 0
    `).run();

    console.log('Update info:', info);

    let after = db.prepare('SELECT trade_id, stock_name, entry_price, exit_price, profit_rate FROM maiis_trade_history WHERE status = ? AND exit_price > 0 AND entry_price > 0').all('CLOSED');
    console.log('After update:');
    console.table(after);

    db.close();
} catch (err) {
    console.error('Error:', err);
}
