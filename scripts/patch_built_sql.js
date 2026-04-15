const fs = require('fs');

const chunkPath = 'dist-electron/main-BPN-S2ZO.js';
let content = fs.readFileSync(chunkPath, 'utf8');

// Find the IPC handler by unique string (without quotes to avoid quote type issues)
const ipcIdx = content.indexOf('get-sim-trade-picks');
if (ipcIdx === -1) { console.error('IPC handler not found'); process.exit(1); }

// Find db.prepare after IPC handler
const prepareStart = content.indexOf('db.prepare(`', ipcIdx);
if (prepareStart === -1) { console.error('db.prepare not found'); process.exit(1); }

// Find the closing template literal + .all()
const sqlEnd = content.indexOf('`).all();', prepareStart) + '`).all();'.length;
if (sqlEnd === -1) { console.error('`).all() not found'); process.exit(1); }

const oldBlock = content.substring(prepareStart, sqlEnd);
console.log('Old block length:', oldBlock.length);
console.log('Old block preview:', oldBlock.substring(0, 200));

// New SQL with ROW_NUMBER() dedup at DB level
const newBlock = "db.prepare(`\n            WITH combined AS (\n                SELECT * FROM track_a_buy_picks\n                UNION ALL\n                SELECT * FROM track_b_buy_picks\n                UNION ALL\n                SELECT * FROM track_c_buy_picks\n                UNION ALL\n                SELECT * FROM track_d_buy_picks\n                UNION ALL\n                SELECT * FROM track_e_buy_picks\n            ),\n            ranked AS (\n                SELECT *,\n                    ROW_NUMBER() OVER (\n                        PARTITION BY stock_code, pick_date\n                        ORDER BY\n                            CASE category\n                                WHEN 'TRUE_LEADER'              THEN 1\n                                WHEN 'INTRADAY_SURGE'           THEN 2\n                                WHEN 'SHORT_TERM_CONSOLIDATION' THEN 3\n                                WHEN 'EMERGING_STAR'            THEN 4\n                                WHEN 'PULLBACK_REBOUND'         THEN 5\n                                WHEN 'PULLBACK_DIP'             THEN 6\n                                ELSE 7\n                            END ASC,\n                            id ASC\n                    ) AS rn\n                FROM combined\n            )\n            SELECT\n                id, pick_date, pick_rank, stock_code, stock_name, category,\n                signals_json, buy_score, reason, risk, related_themes_json,\n                theme_lifespan, entry_price, exit_price, current_price,\n                holding_days, target_days, target_return_pct, peak_return,\n                peak_date, final_return, status, result, entry_date, exit_date\n            FROM ranked\n            WHERE rn = 1\n            ORDER BY\n                pick_date DESC,\n                CASE category\n                    WHEN 'TRUE_LEADER'              THEN 1\n                    WHEN 'INTRADAY_SURGE'           THEN 2\n                    WHEN 'SHORT_TERM_CONSOLIDATION' THEN 3\n                    WHEN 'EMERGING_STAR'            THEN 4\n                    WHEN 'PULLBACK_REBOUND'         THEN 5\n                    WHEN 'PULLBACK_DIP'             THEN 6\n                    ELSE 7\n                END ASC,\n                pick_rank ASC\n            LIMIT 500\n        `).all();";

const newContent = content.substring(0, prepareStart) + newBlock + content.substring(sqlEnd);
fs.writeFileSync(chunkPath, newContent, 'utf8');

// Verify
const verify = fs.readFileSync(chunkPath, 'utf8');
console.log('\nSUCCESS! ROW_NUMBER in file:', verify.includes('ROW_NUMBER'));
console.log('File size change:', content.length, '->', newContent.length);
