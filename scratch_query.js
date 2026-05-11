const Database = require('better-sqlite3');
const db = new Database('maiis.db');

try {
  console.log("maiis_stock_info:");
  console.log(db.prepare(`SELECT * FROM maiis_stock_info WHERE item_name LIKE '%아이비전웍스%' LIMIT 5;`).all());
  
  console.log("\nmaiis_report_trading_picks:");
  console.log(db.prepare(`SELECT * FROM maiis_report_trading_picks WHERE item_name LIKE '%아이비전웍스%' ORDER BY created_at DESC LIMIT 5;`).all());
  
  console.log("\nmaiis_report_trading_ledger:");
  console.log(db.prepare(`SELECT * FROM maiis_report_trading_ledger WHERE item_name LIKE '%아이비전웍스%' ORDER BY entry_date DESC LIMIT 5;`).all());
  
  console.log("\nmaiis_portfolio:");
  console.log(db.prepare(`SELECT * FROM maiis_portfolio WHERE item_name LIKE '%아이비전웍스%' LIMIT 5;`).all());
  
} catch (e) {
  console.error("Query Error:", e.message);
} finally {
  db.close();
}
