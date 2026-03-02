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
                is_market_event INTEGER DEFAULT 0
            );
        `

        this.db.exec(createDartCorpTable)
        this.db.exec(createSchedulesTable)
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
        const rows = stmt.all(stockCodes) as any[]

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
            INSERT OR REPLACE INTO schedules (id, title, description, target_date, stock_code, reminder_type, is_notified, is_market_event)
            VALUES (@id, @title, @description, @target_date, @stock_code, @reminder_type, @is_notified, @is_market_event)
        `)
        const insertMany = this.db.transaction((items) => {
            for (const item of items) {
                stmt.run(item)
            }
        })
        insertMany(schedules)
    }

    public deleteSchedule(id: string) {
        this.db.prepare('DELETE FROM schedules WHERE id = ?').run(id)
    }

    public getDb() {
        return this.db
    }

    public close() {
        this.db.close()
    }
}
