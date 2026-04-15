const Database = require('better-sqlite3');
const db = new Database('./maiis.db', { readonly: true });

const rows = db.prepare(
  "SELECT status, strategy, stock_name, stock_code, conviction_score FROM maiis_portfolio WHERE status NOT IN ('DROPPED','HIT','CLEARED') ORDER BY status, strategy, conviction_score DESC"
).all();

console.log('=== 현재 포트폴리오 현황 ===');
const statusCount = {};
rows.forEach(r => { statusCount[r.status] = (statusCount[r.status] || 0) + 1; });
console.log('상태별 카운트:', JSON.stringify(statusCount, null, 2));
console.log('--- 전체 목록 ---');
rows.forEach(r => console.log(`[${r.status}] ${r.strategy || 'N/A'} | ${r.conviction_score ?? 'N/A'}점 | ${r.stock_code} ${r.stock_name}`));

// strategy별 WATCHING 분류
const watching = rows.filter(r => r.status === 'WATCHING' || r.status === 'WATCHLIST');
console.log('\n=== WATCHING/WATCHLIST 전략별 분류 ===');
const byStrategy = {};
watching.forEach(r => {
  const s = r.strategy || 'UNKNOWN';
  if (!byStrategy[s]) byStrategy[s] = [];
  byStrategy[s].push(r);
});
Object.entries(byStrategy).forEach(([s, items]) => {
  console.log(`[${s}] ${items.length}개:`);
  items.forEach(r => console.log(`  - ${r.conviction_score}점 ${r.stock_code} ${r.stock_name}`));
});

// electron-store의 설정 파일 직접 읽기
const os = require('os');
const path = require('path');
const fs = require('fs');

const storePath = path.join(os.homedir(), 'AppData', 'Roaming', '260224 kiwoom rest api', 'config.json');
const storePath2 = path.join(os.homedir(), 'AppData', 'Roaming', 'KiwoomTrader', 'config.json');
const storePath3 = path.join(os.homedir(), 'AppData', 'Roaming', 'Electron', 'config.json');

[storePath, storePath2, storePath3].forEach(p => {
  if (fs.existsSync(p)) {
    console.log(`\n=== Store 설정 파일: ${p} ===`);
    const content = JSON.parse(fs.readFileSync(p, 'utf-8'));
    const settings = content.ai_settings || content['ai_settings'];
    if (settings) console.log('ai_settings:', JSON.stringify(settings.portfolioLimits, null, 2));
  }
});

db.close();
