const Database = require('better-sqlite3');
const path = require('path');
const dbPath = process.env.APPDATA + '/kiwoom-trader/db/kiwoom.db';

const db = new Database(dbPath);
const info = db.prepare("DELETE FROM maiis_portfolio WHERE length(stock_code) != 6 OR stock_code GLOB '*[^0-9]*'").run();
console.log('Cleaned ' + info.changes + ' invalid stock codes.');
