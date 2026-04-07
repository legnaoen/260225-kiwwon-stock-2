const { app } = require('electron');
const path = require('path');
const SQLite = require('better-sqlite3');
const fs = require('fs');

app.on('ready', () => {
    try {
        const userDataPath = app.getPath('userData');
        const dbPath = path.join(userDataPath, 'db', 'kiwoom.db');
        
        console.log('\n[DB 마이그레이션 시작]');
        console.log(`DB 경로: ${dbPath}`);
        
        if (!fs.existsSync(dbPath)) {
            console.error('kiwoom.db 파일을 찾을 수 없습니다.');
            return app.quit();
        }

        const db = new SQLite(dbPath);
        
        const changes1 = db.prepare("UPDATE maiis_portfolio SET status = 'HELD', last_signal = 'BUY' WHERE status = 'IMMEDIATE_BUY'").run();
        const changes2 = db.prepare("UPDATE maiis_portfolio SET status = 'WATCHING' WHERE status = 'WATCHLIST'").run();
        
        console.log(`✅ 매수 포지션 (IMMEDIATE_BUY -> HELD) 변경 완료: ${changes1.changes}건`);
        console.log(`✅ 관심 종목 (WATCHLIST -> WATCHING) 변경 완료: ${changes2.changes}건\n`);
        console.log('마이그레이션이 성공적으로 완료되었습니다!');
        
    } catch (e) {
        console.error('Migration Error:', e);
    } finally {
        app.quit();
    }
});
