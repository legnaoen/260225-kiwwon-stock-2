const sqlite3 = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(process.env.APPDATA || process.env.LOCALAPPDATA, 'kiwoom-trader', 'TradingDatabase.sqlite');
console.log('DB Path:', dbPath);

const db = new sqlite3(dbPath);

const invalidatedStocks = db.prepare(`
    SELECT mat.*, mdr.daily_narrative, mdr.verdict
    FROM moonshot_active_tracking mat
    LEFT JOIN (
        SELECT stock_code, daily_narrative, verdict
        FROM moonshot_daily_review
        WHERE stock_code = mat.stock_code
        ORDER BY reviewed_at DESC
        LIMIT 1
    ) mdr ON mat.stock_code = mdr.stock_code
    WHERE mat.is_invalidated = 1
`).all();

console.log(`Found ${invalidatedStocks.length} invalidated stocks.`);

for (const stock of invalidatedStocks) {
    const sellPrice = stock.current_price || 0;
    const returnRate = stock.entry_price > 0 ? ((sellPrice / stock.entry_price) - 1) * 100 : 0;
    const success = returnRate > 0 ? 1 : 0;
    const finalNarrative = stock.daily_narrative || '가설 훼손 컷 (AI 자동 폐기)';

    try { db.exec('ALTER TABLE moonshot_archive ADD COLUMN is_hidden INTEGER DEFAULT 0'); } catch (e) {}

    db.prepare(`
        INSERT INTO moonshot_archive 
        (stock_code, stock_name, tag, original_thesis, bull_case, bear_case, entry_price, sell_price, return_rate, buy_date, sell_date, success, final_narrative, is_hidden)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'), ?, ?, ?)
    `).run(
        stock.stock_code,
        stock.stock_name,
        stock.tag,
        stock.narrative,
        stock.bull_case,
        stock.bear_case,
        stock.entry_price,
        sellPrice,
        returnRate,
        stock.entry_date,
        success,
        finalNarrative,
        0
    );

    db.prepare('DELETE FROM moonshot_active_tracking WHERE stock_code = ?').run(stock.stock_code);
    console.log(`Migrated and deleted: ${stock.stock_name} (${stock.stock_code})`);
}

console.log('Migration completed.');
