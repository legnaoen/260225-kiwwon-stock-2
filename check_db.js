const Database = require('better-sqlite3');
const path = require('path');
const os = require('os');

const dbPath = path.join(os.homedir(), 'AppData', 'Roaming', 'kiwoom-trader', 'db', 'kiwoom.db');
const db = new Database(dbPath, { readonly: true });

console.log('--- TABLE SCHEMA ---');
console.log(db.prepare(`PRAGMA table_info(market_ohlcv_history)`).all());

console.log('\n--- SAMPLE DATA ---');
const sample = db.prepare(`SELECT * FROM market_ohlcv_history WHERE stock_code='065450' LIMIT 5`).all();
console.log(sample);

console.log('\n--- TARGET STOCKS ---');
const tags = db.prepare(`SELECT * FROM stock_theme_tags WHERE tag_name='우주항공과국방' LIMIT 3`).all();
console.log(tags);

console.log('\n--- RESULT OF QUERY ---');
const cutoff60Str = '2026-02-07'; // 60 days ago
const cutoff20Str = '2026-03-18';
const cutoff5Str  = '2026-04-02';

const res = db.prepare(`
    WITH TargetStocks AS (
        SELECT stock_code, stock_name
        FROM stock_theme_tags
        WHERE tag_name = ?
    ), OhlcvData AS (
        SELECT
            ts.stock_code,
            (SELECT close FROM market_ohlcv_history WHERE stock_code = ts.stock_code ORDER BY date DESC LIMIT 1) AS close,
            MIN(CASE WHEN h.date >= ? THEN (CASE WHEN h.low > 0 THEN h.low ELSE h.close END) END) AS min_60,
            MAX(CASE WHEN h.date >= ? THEN (CASE WHEN h.high > 0 THEN h.high ELSE h.close END) END) AS max_60,
            AVG(CASE WHEN h.date >= ? THEN h.trading_value END) AS avg_vol_5d,
            AVG(CASE WHEN h.date >= ? THEN h.trading_value END) AS avg_vol_20d
        FROM TargetStocks ts
        LEFT JOIN market_ohlcv_history h ON ts.stock_code = h.stock_code AND h.date >= ?
        GROUP BY ts.stock_code
    )
    SELECT
        t.stock_code,
        t.stock_name,
        o.close,
        o.min_60,
        o.max_60,
        CASE WHEN o.close > 0 AND o.min_60 > 0 THEN ROUND(CAST((o.close - o.min_60) AS REAL) / o.min_60 * 100, 1) ELSE 0 END AS heat_60,
        CASE WHEN o.close > 0 AND o.max_60 > 0 THEN ROUND(CAST((o.close - o.max_60) AS REAL) / o.max_60 * 100, 1) ELSE 0 END AS drawdown_60,
        o.avg_vol_5d,
        o.avg_vol_20d
    FROM TargetStocks t
    LEFT JOIN OhlcvData o ON t.stock_code = o.stock_code
    LIMIT 3
`).all('우주항공과국방', cutoff60Str, cutoff60Str, cutoff5Str, cutoff20Str, cutoff60Str);
console.log(res);
