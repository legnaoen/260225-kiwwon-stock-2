const { app } = require('electron');
app.whenReady().then(() => {
    const db = require('better-sqlite3')('C:/Users/legna/AppData/Roaming/kiwoom-trader/db/kiwoom.db');
    console.log("HELD_COUNT_RESULT: " + JSON.stringify(db.prepare('SELECT status, COUNT(*) as cnt FROM maiis_portfolio GROUP BY status').all()));
    
    // Check recently dropped
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
    console.log("DROPPED_TODAY: " + JSON.stringify(db.prepare("SELECT stock_code, stock_name, status, updated_at FROM maiis_portfolio WHERE status = 'DROPPED' AND updated_at LIKE ?").all(today + '%')));
    
    // Check current HELD
    console.log("CURRENT_HELD: " + JSON.stringify(db.prepare("SELECT stock_code, stock_name, status, entry_date FROM maiis_portfolio WHERE status IN ('HELD', 'IMMEDIATE_BUY')").all()));

    process.exit(0);
});
