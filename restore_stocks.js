const fs = require('fs');
const Database = require('better-sqlite3');
const path = require('path');

const paths = [
    path.join(process.env.APPDATA, 'kiwoom-trader', 'db', 'kiwoom.db'),
    path.join(process.env.APPDATA, 'electron', 'db', 'kiwoom.db'),
    path.join(process.env.APPDATA, 'Electron', 'db', 'kiwoom.db')
];

let dbPath = null;
for (const p of paths) {
    if (fs.existsSync(p)) {
        dbPath = p;
        break;
    }
}

if (dbPath) {
    const db = new Database(dbPath);
    const info = db.prepare(`UPDATE maiis_portfolio SET status = 'IMMEDIATE_BUY', last_signal = 'IMMEDIATE_BUY' WHERE stock_name IN ('삼성전기', '삼성전자') AND status = 'WATCHLIST'`).run();
    console.log('Restored: ', info.changes);
}
