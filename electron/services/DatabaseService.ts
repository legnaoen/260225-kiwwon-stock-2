import Database from 'better-sqlite3'
import path from 'path'
import { app } from 'electron'
import fs from 'fs'

export class DatabaseService {
    private static instance: DatabaseService
    private db: Database.Database

    private constructor() {
        const userDataPath = app.getPath('userData')
        const dbDir = path.join(userDataPath, 'db')
        if (!fs.existsSync(dbDir)) {
            fs.mkdirSync(dbDir, { recursive: true })
        }
        const dbPath = path.join(dbDir, 'kiwoom.db')

        this.db = new Database(dbPath, { verbose: process.env.NODE_ENV === 'development' ? console.log : undefined })
        this.initTables()
    }

    public static getInstance(): DatabaseService {
        if (!DatabaseService.instance) {
            DatabaseService.instance = new DatabaseService()
        }
        return DatabaseService.instance
    }

    private initTables() {
        const createDartCorpTable = `
            CREATE TABLE IF NOT EXISTS dart_corp_code (
                corp_code TEXT PRIMARY KEY,
                corp_name TEXT NOT NULL,
                stock_code TEXT,
                modify_date TEXT
            );
        `

        const createSchedulesTable = `
            CREATE TABLE IF NOT EXISTS schedules (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                description TEXT,
                target_date TEXT NOT NULL,
                stock_code TEXT,
                reminder_type TEXT,
                is_notified INTEGER DEFAULT 0,
                is_market_event INTEGER DEFAULT 0,
                source TEXT DEFAULT 'MANUAL',
                origin_id TEXT
            );
        `

        const createFinancialDataTable = `
            CREATE TABLE IF NOT EXISTS financial_data (
                stock_code TEXT,
                year TEXT,
                reprt_code TEXT,
                account_id TEXT,
                account_nm TEXT,
                fs_div TEXT,
                amount REAL,
                PRIMARY KEY (stock_code, year, reprt_code, account_id, fs_div)
            );
        `

        const createAnalysisCacheTable = `
            CREATE TABLE IF NOT EXISTS analysis_cache (
                stock_code TEXT PRIMARY KEY,
                analysis_json TEXT,
                updated_at TEXT
            );
        `

        this.db.exec(createDartCorpTable)
        this.db.exec(createSchedulesTable)
        this.db.exec(createFinancialDataTable)
        this.db.exec(createAnalysisCacheTable)

        // Ensure columns exist for migration
        try {
            this.db.exec("ALTER TABLE schedules ADD COLUMN source TEXT DEFAULT 'MANUAL'")
        } catch (e) { }
        try {
            this.db.exec("ALTER TABLE schedules ADD COLUMN origin_id TEXT")
        } catch (e) { }

        // Add index on origin_id for fast lookup
        try {
            this.db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_schedules_origin_id ON schedules(origin_id) WHERE origin_id IS NOT NULL")
        } catch (e) { }
    }

    public insertCorpCodes(codes: { corp_code: string, corp_name: string, stock_code: string, modify_date: string }[]) {
        const stmt = this.db.prepare(`
            INSERT OR REPLACE INTO dart_corp_code (corp_code, corp_name, stock_code, modify_date)
            VALUES (@corp_code, @corp_name, @stock_code, @modify_date)
        `)

        const insertMany = this.db.transaction((items) => {
            for (const item of items) {
                stmt.run(item)
            }
        })

        insertMany(codes)
    }

    public getCorpCodesByStockCodes(stockCodes: string[]): Record<string, string> {
        if (stockCodes.length === 0) return {}
        const placeholders = stockCodes.map(() => '?').join(',')
        const stmt = this.db.prepare(`SELECT stock_code, corp_code FROM dart_corp_code WHERE stock_code IN (${placeholders})`)
        const rows = stmt.all(...stockCodes) as any[]

        const map: Record<string, string> = {}
        rows.forEach(r => {
            map[r.stock_code] = r.corp_code
        })
        return map
    }

    public getAllSchedules() {
        return this.db.prepare('SELECT * FROM schedules ORDER BY target_date ASC').all()
    }

    public upsertSchedules(schedules: any[]) {
        const stmt = this.db.prepare(`
            INSERT OR REPLACE INTO schedules (id, title, description, target_date, stock_code, reminder_type, is_notified, is_market_event, source, origin_id)
            VALUES (@id, @title, @description, @target_date, @stock_code, @reminder_type, @is_notified, @is_market_event, @source, @origin_id)
        `)
        const insertMany = this.db.transaction((items) => {
            for (const item of items) {
                stmt.run({
                    id: item.id,
                    title: item.title,
                    description: item.description || '',
                    target_date: item.target_date,
                    stock_code: item.stock_code || '',
                    reminder_type: item.reminder_type || '없음',
                    is_notified: item.is_notified || 0,
                    is_market_event: item.is_market_event || 0,
                    source: item.source || 'MANUAL',
                    origin_id: item.origin_id || null
                })
            }
        })
        insertMany(schedules)
    }

    public deleteSchedule(id: string) {
        this.db.prepare('DELETE FROM schedules WHERE id = ?').run(id)
    }

    public insertFinancialData(data: any[]) {
        const stmt = this.db.prepare(`
            INSERT OR REPLACE INTO financial_data (stock_code, year, reprt_code, account_id, account_nm, fs_div, amount)
            VALUES (@stock_code, @year, @reprt_code, @account_id, @account_nm, @fs_div, @amount)
        `)

        const insertMany = this.db.transaction((items) => {
            for (const item of items) {
                stmt.run(item)
            }
        })
        insertMany(data)
    }

    public getFinancialData(stockCode: string) {
        return this.db.prepare('SELECT * FROM financial_data WHERE stock_code = ? ORDER BY year DESC, reprt_code DESC').all(stockCode)
    }

    public saveAnalysisCache(stockCode: string, analysisJson: string) {
        const stmt = this.db.prepare(`
            INSERT OR REPLACE INTO analysis_cache (stock_code, analysis_json, updated_at)
            VALUES (?, ?, ?)
        `)
        stmt.run(stockCode, analysisJson, new Date().toISOString())
    }

    public getAnalysisCache(stockCode: string) {
        return this.db.prepare('SELECT * FROM analysis_cache WHERE stock_code = ?').get(stockCode) as any
    }

    public getDb() {
        return this.db
    }

    public close() {
        this.db.close()
    }
}
