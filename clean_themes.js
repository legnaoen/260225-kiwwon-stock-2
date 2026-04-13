const Database = require('better-sqlite3');
const db = new Database('./data/db/kiwoom.db');

try {
    // 백업 남기기
    db.prepare(`CREATE TABLE IF NOT EXISTS mega_theme_ledger_bak AS SELECT * FROM mega_theme_ledger`).run();
    
    // 테이블 초토화 (깨끗한 테스트를 위해)
    db.prepare(`DELETE FROM mega_theme_ledger`).run();
    console.log("[CLEANUP] 과거 중복 종목 및 테마 오염 리셋이 완료되었습니다.");
} catch (e) {
    console.error(e);
}
