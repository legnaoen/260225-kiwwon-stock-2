const Database = require('better-sqlite3');
const db = new Database('./data/trading.db');
try {
  console.log('B:', db.prepare("SELECT id, pick_date, status, entry_date, entry_price, holding_days, category FROM track_b_buy_picks WHERE stock_code='006490'").all());
} catch(e) { console.log(e.message); }
try {
  console.log('C:', db.prepare("SELECT id, pick_date, status, entry_date, entry_price, holding_days, category FROM track_c_buy_picks WHERE stock_code='006490'").all());
} catch(e) { console.log(e.message); }
