const Database = require('better-sqlite3');
try {
  const db = new Database('kiwoom_data.db', { readonly: true });
  const rows = db.prepare("SELECT date, close FROM market_ohlcv_history WHERE stock_code = '039490' AND date >= '2026-05-01'").all();
  console.log(rows);
} catch (e) {
  console.log('Error:', e.message);
}
