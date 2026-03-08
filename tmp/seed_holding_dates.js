const Database = require('better-sqlite3');
const path = require('path');
const os = require('os');

const dbPath = path.join(os.homedir(), 'AppData', 'Roaming', 'kiwoom-trader', 'db', 'kiwoom.db');
const db = new Database(dbPath);

const seedData = [
    { code: '002140', date: '2026-03-04' }, // 고려산업
    { code: '465770', date: '2026-03-04' }, // STX그린로지스
    { code: '010170', date: '2026-03-03' }, // 대한광통신
    { code: '307750', date: '2026-03-03' }, // 국전약품
    { code: '002680', date: '2026-03-05' }, // 한탑 (오늘이 맞음)
];

const stmt = db.prepare('INSERT OR REPLACE INTO holding_history (stock_code, first_seen_date) VALUES (?, ?)');
const run = db.transaction(function () {
    for (var i = 0; i < seedData.length; i++) {
        stmt.run(seedData[i].code, seedData[i].date);
        console.log('OK: ' + seedData[i].code + ' => ' + seedData[i].date);
    }
});

run();

const rows = db.prepare('SELECT * FROM holding_history').all();
console.log('\n=== 현재 DB 내용 ===');
rows.forEach(function (r) { console.log(r.stock_code + ' => ' + r.first_seen_date); });

db.close();
console.log('\n완료!');
