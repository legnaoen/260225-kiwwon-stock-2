const { app } = require('electron');
app.whenReady().then(() => {
    const db = require('better-sqlite3')('C:/Users/legna/AppData/Roaming/kiwoom-trader/db/kiwoom.db');
    console.log("TRADE_HISTORY_0506: " + JSON.stringify(db.prepare("SELECT stock_code, stock_name, entry_date, exit_date, status, exit_reason FROM maiis_trade_history WHERE exit_date LIKE '2026-05-06%'").all()));
    process.exit(0);
});
