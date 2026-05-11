const path = require('path');
const os = require('os');
const db = require('better-sqlite3')('c:/Users/legna/AppData/Roaming/kiwoom-trader/db/kiwoom.db'); 
try {
    const info = db.prepare("DELETE FROM market_ohlcv_history WHERE date >= '2026-05-10'").run(); 
    console.log('Rows deleted:', info.changes); 
} catch(e) {
    console.error(e);
}
process.exit(0);
