const Database = require('better-sqlite3');
const path = require('path');
const dbPath = path.join(process.env.APPDATA, 'kiwoom-trader', 'data', 'kiwoom_trader.db');
const db = new Database(dbPath);

const info = db.prepare("PRAGMA table_info(market_news_consensus)").all();
console.log(JSON.stringify(info, null, 2));
db.close();
