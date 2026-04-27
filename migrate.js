const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.resolve('c:/Users/legna/Projects/260224 kiwoom rest api/data/database.sqlite');
console.log('DB Path:', dbPath);
const db = new Database(dbPath);

const records = db.prepare(`SELECT date, name, momentum_status, top_picks_json FROM theme_intelligence WHERE top_picks_json IS NOT NULL AND top_picks_json != '[]'`).all();

let insertCount = 0;
const stmt = db.prepare(`
    INSERT OR REPLACE INTO stock_research_reports (
        date, stock_code, stock_name, agent_source, market_theme_link,
        theme_durability, catalyst_summary, risk_factors, upside_probability,
        buy_score, preliminary_decision, reasoning, injected_context_json,
        system_prompt, raw_ai_response, created_at
    ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime')
    )
`);

db.transaction(() => {
    for (const row of records) {
        let picks = [];
        try {
            picks = JSON.parse(row.top_picks_json);
        } catch(e) {}
        
        for (const pick of picks) {
            if (!pick.stock_code) continue;
            const reasoningStr = `[${row.name} 대장주/주도주 편입] ${pick.reason || ''}`;
            const injectedCtx = JSON.stringify({ themeReason: pick.reason || '' });
            
            stmt.run(
                row.date,
                pick.stock_code,
                pick.stock_name || '',
                'THEME_INTELLIGENCE',
                row.name,
                row.momentum_status || 'UPTREND',
                pick.reason || '',
                '', // risk_factors
                'HIGH', // upside
                80, // buy_score
                'BUY',
                reasoningStr,
                injectedCtx,
                '테마 수명 분석기 (자동 편입)',
                ''
            );
            insertCount++;
        }
    }
})();

console.log(`Migration Complete. Inserted ${insertCount} reports.`);
