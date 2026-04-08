const Database = require('better-sqlite3');
const path = require('path');
const os = require('os');
const dbPath = path.join(os.homedir(), 'AppData', 'Roaming', 'kiwoom-trader', 'db', 'kiwoom.db');
try {
    const db = new Database(dbPath, { readonly: true });
    const today = '2026-04-08';
    const d60 = new Date(today); d60.setDate(d60.getDate() - 60);
    const cutoff60Str = d60.toISOString().slice(0, 10);
    const d20 = new Date(today); d20.setDate(d20.getDate() - 20);
    const cutoff20Str = d20.toISOString().slice(0, 10);
    const d5 = new Date(today); d5.setDate(d5.getDate() - 5);
    const cutoff5Str = d5.toISOString().slice(0, 10);

    const themeName = '우주항공과국방';
    
    const query = `
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
                CASE WHEN o.close > 0 AND o.min_60 > 0 THEN ROUND((o.close - o.min_60) * 100.0 / o.min_60, 1) ELSE 0 END AS heat_60,
                CASE WHEN o.close > 0 AND o.max_60 > 0 THEN ROUND((o.close - o.max_60) * 100.0 / o.max_60, 1) ELSE 0 END AS drawdown_60,
                CASE WHEN o.avg_vol_20d > 0 THEN ROUND(o.avg_vol_5d * 1.0 / o.avg_vol_20d, 2) ELSE 1.0 END AS vol_ratio,
                o.close
            FROM TargetStocks t
            LEFT JOIN OhlcvData o ON t.stock_code = o.stock_code
            ORDER BY heat_60 DESC, vol_ratio DESC
    `;
    const res = db.prepare(query).all(themeName, cutoff60Str, cutoff60Str, cutoff5Str, cutoff20Str, cutoff60Str);
    console.log("Success! ", res.length, " items");
} catch(e) {
    console.error("Error: ", e.message);
}
