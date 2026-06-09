const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '../kiwoom.db');
console.log('Opening DB:', dbPath);

try {
    const db = new Database(dbPath, { readonly: true });
    
    // 테이블 목록 확인
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    console.log('Tables in DB:', tables.map(t => t.name).join(', '));
    
    if (tables.some(t => t.name === 'ai_execution_logs')) {
        console.log('\n--- Recent 20 AI Execution Logs ---');
        const logs = db.prepare(`
            SELECT id, agentId, agentName, triggerType, targetType, status, queuedAt, modelName, error
            FROM ai_execution_logs 
            ORDER BY queuedAt DESC 
            LIMIT 20
        `).all();
        console.table(logs);
    } else {
        console.log('Table ai_execution_logs does not exist.');
    }
} catch (err) {
    console.error('Error reading DB:', err.message);
}
