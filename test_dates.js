const db = require('better-sqlite3')('kiwoom_data.db');
const res = db.prepare("SELECT date FROM market_ohlcv_history WHERE stock_code = '039490' AND date >= '2026-05-01'").all();
console.log(res);
