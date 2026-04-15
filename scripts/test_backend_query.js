const sqlite3 = require('better-sqlite3');
const path = require('path');
const dbPath = path.join(process.env.APPDATA || (process.env.USERPROFILE + '\\AppData\\Roaming'), 'kiwoom-trader', 'db', 'kiwoom.db');
const db = new sqlite3(dbPath, { readonly: true });

const query = `
WITH combined AS (
    SELECT * FROM track_a_buy_picks
    UNION ALL
    SELECT * FROM track_b_buy_picks
    UNION ALL
    SELECT * FROM track_c_buy_picks
    UNION ALL
    SELECT * FROM track_d_buy_picks
    UNION ALL
    SELECT * FROM track_e_buy_picks
),
ranked AS (
    SELECT *,
        ROW_NUMBER() OVER (
            PARTITION BY stock_code, pick_date
            ORDER BY
                CASE category
                    WHEN 'TRUE_LEADER'              THEN 1
                    WHEN 'INTRADAY_SURGE'           THEN 2
                    WHEN 'SHORT_TERM_CONSOLIDATION' THEN 3
                    WHEN 'EMERGING_STAR'            THEN 4
                    WHEN 'PULLBACK_REBOUND'         THEN 5
                    WHEN 'PULLBACK_DIP'             THEN 6
                    ELSE 7
                END ASC,
                id ASC
        ) AS rn
    FROM combined
)
SELECT id, pick_date, stock_code, stock_name, category
FROM ranked
WHERE rn = 1
ORDER BY pick_date DESC, category ASC
LIMIT 40
`;

try {
    const rows = db.prepare(query).all();
    console.log('Returned rows:', rows.length);
    const catCount = {};
    rows.forEach(r => { catCount[r.category] = (catCount[r.category]||0) + 1; });
    console.log('By category:', catCount);
} catch (e) {
    console.error('Err:', e.message);
}
db.close();
