import { DatabaseService } from './electron/services/DatabaseService';
import { IssueLedgerDB } from './electron/services/v2_agents/IssueLedgerDB';

const db = DatabaseService.getInstance();
const dbRaw = (db as any).db;
const issueDb = IssueLedgerDB.getInstance();

const stockCode = '214370'; // 케어젠

const tags = dbRaw.prepare("SELECT tag_name FROM stock_theme_tags WHERE stock_code = ?").all(stockCode) as any[];

console.log('Tags for Caregen:', tags);

const themeIntelParams = tags.map(() => '?').join(',');
let intelSql = `SELECT * FROM theme_intelligence WHERE name IN (${themeIntelParams}) ORDER BY date DESC LIMIT 5`;

const intel = tags.length > 0 ? dbRaw.prepare(intelSql).all(...tags.map(t => t.tag_name)) : [];
console.log('Theme Intel:', intel);

const edges: any[] = [];
tags.forEach(tag => {
    // try both theme and sector
    const toTheme = issueDb.getEdgesTo('THEME', tag.tag_name);
    const toSector = issueDb.getEdgesTo('SECTOR', tag.tag_name);
    edges.push(...toTheme, ...toSector);
});

console.log('Edges:', edges);
