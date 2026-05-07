const Database = require('better-sqlite3');
const db = new Database('C:\\Users\\legna\\kiwoom-trader\\kiwoom-trader.db');
const rows = db.prepare('SELECT strategy_category, is_active FROM live_trade_strategies').all();
console.log(rows);
