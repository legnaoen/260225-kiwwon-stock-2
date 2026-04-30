const Database = require('better-sqlite3');
const path = require('path');

try {
    const dbPath = path.join(__dirname, 'database', 'kiwoom_auto_trader.db');
    const db = new Database(dbPath, { fileMustExist: true });

    console.log("== LS (006260) OHLCV ==");
    const rows = db.prepare(`SELECT date, close FROM market_ohlcv_history WHERE stock_code='006260' ORDER BY date DESC LIMIT 5`).all();
    console.log(rows);
    
    console.log("\n== Theme Mock Picks ==");
    const pickRows = db.prepare(`SELECT date, name, top_picks_json FROM theme_intelligence ORDER BY date DESC LIMIT 1`).all();
    for (const r of pickRows) {
        console.log(`Date: ${r.date}, Theme: ${r.name}`);
        const picks = JSON.parse(r.top_picks_json || '[]');
        for (const p of picks) {
            console.log(`  - ${p.stock_name}(${p.stock_code}): Entry=${p.entryPrice}, Current=${p.currentPrice}`);
        }
    }
} catch (err) {
    console.error(err);
}
