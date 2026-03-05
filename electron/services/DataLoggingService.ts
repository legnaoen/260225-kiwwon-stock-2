import Database from 'better-sqlite3'
import { app } from 'electron'
import path from 'path'
import fs from 'fs'

export class DataLoggingService {
    private static instance: DataLoggingService;
    private db: Database.Database | null = null;
    private initialized = false;

    private constructor() { }

    public init() {
        if (this.initialized) return;
        const userDataPath = app.getPath('userData')
        const dbDir = path.join(userDataPath, 'data')
        if (!fs.existsSync(dbDir)) {
            fs.mkdirSync(dbDir, { recursive: true })
        }

        const dbPath = path.join(dbDir, 'ai_mkt_logs.db')
        try {
            this.db = new Database(dbPath)
            this.db.pragma('journal_mode = WAL');
            console.log('[DataLoggingService] Connected to ai_mkt_logs.db at', dbPath)
            this.initTables()
            this.purgeOldData()
            this.initialized = true;
        } catch (err) {
            console.error('[DataLoggingService] Database connection error:', err)
            throw err;
        }
    }

    public static getInstance(): DataLoggingService {
        if (!DataLoggingService.instance) {
            DataLoggingService.instance = new DataLoggingService();
        }
        return DataLoggingService.instance;
    }

    private initTables() {
        if (!this.db) return;
        // Table for tick data (1-second precision)
        this.db.prepare(`
            CREATE TABLE IF NOT EXISTS ticks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                code TEXT NOT NULL,
                price INTEGER NOT NULL,
                volume INTEGER NOT NULL,
                cum_amount REAL NOT NULL
            )
        `).run();

        // Index for faster querying
        this.db.prepare(`CREATE INDEX IF NOT EXISTS idx_ticks_code_time ON ticks(code, timestamp)`).run();

        // Table for market radar snapshots (1-minute intervals)
        this.db.prepare(`
            CREATE TABLE IF NOT EXISTS radar_snapshots (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                code TEXT NOT NULL,
                name TEXT NOT NULL,
                price INTEGER NOT NULL,
                vwap REAL NOT NULL,
                velocity INTEGER NOT NULL,
                gap REAL NOT NULL,
                ai_score INTEGER DEFAULT 0
            )
        `).run();

        this.db.prepare(`CREATE INDEX IF NOT EXISTS idx_radar_time ON radar_snapshots(timestamp)`).run();

        // Migration: Ensure ai_score column exists for legacy databases
        try {
            this.db.prepare(`ALTER TABLE radar_snapshots ADD COLUMN ai_score INTEGER DEFAULT 0`).run();
            console.log('[DataLoggingService] Migrated radar_snapshots: added ai_score column.');
        } catch (e) {
            // Column likely already exists, ignore
        }

        // Table for AI decisions (full context for backtesting/replay)
        this.db.prepare(`
            CREATE TABLE IF NOT EXISTS ai_decisions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                code TEXT NOT NULL,
                name TEXT NOT NULL,
                ai_score INTEGER NOT NULL,
                context_json TEXT NOT NULL, -- Chart data and other factors sent to AI
                prompt TEXT NOT NULL,
                response_json TEXT NOT NULL,
                action TEXT NOT NULL, -- BUY or PASS
                reason TEXT
            )
        `).run();

        this.db.prepare(`CREATE INDEX IF NOT EXISTS idx_ai_decisions_code ON ai_decisions(code)`).run();
        this.db.prepare(`CREATE INDEX IF NOT EXISTS idx_ai_decisions_time ON ai_decisions(timestamp)`).run();
    }

    /**
     * Delete data older than 30 days to free up disk space
     */
    private purgeOldData() {
        if (!this.db) return;
        try {
            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
            const cutoffDate = thirtyDaysAgo.toISOString();

            const resultTicks = this.db.prepare(`DELETE FROM ticks WHERE timestamp < ?`).run(cutoffDate);
            console.log(`[DataLoggingService] Purged old ticks: ${resultTicks.changes} rows deleted.`);

            const resultSnapshots = this.db.prepare(`DELETE FROM radar_snapshots WHERE timestamp < ?`).run(cutoffDate);
            console.log(`[DataLoggingService] Purged old snapshots: ${resultSnapshots.changes} rows deleted.`);
        } catch (e) {
            console.error(`[DataLoggingService] Error purging old data: `, e);
        }
    }

    /**
     * Log a single tick (price update)
     */
    public logTick(code: string, price: number, volume: number, cumAmount: number) {
        if (!this.db || volume === 0) return; // Only log actual trades

        try {
            const stmt = this.db.prepare(`INSERT INTO ticks (code, price, volume, cum_amount) VALUES (?, ?, ?, ?)`);
            stmt.run(code, price, volume, cumAmount);
        } catch (e) {
            console.error(`[DataLoggingService] logTick error:`, e)
        }
    }

    /**
     * Log a snapshot of the current radar (Top 20)
     */
    public logRadarSnapshot(radarList: any[]) {
        if (!this.db || !radarList || radarList.length === 0) return;

        try {
            const stmt = this.db.prepare(`
                INSERT INTO radar_snapshots (code, name, price, vwap, velocity, gap, ai_score)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `);

            const insertMany = this.db.transaction((items) => {
                for (const item of items) {
                    stmt.run(item.code, item.name, item.currentPrice, item.vwap, item.velocity, item.gap, (item.aiScore || 0));
                }
            });

            insertMany(radarList);
        } catch (e) {
            console.error(`[DataLoggingService] logRadarSnapshot error:`, e)
        }
    }

    /**
     * Log the AI decision details (for backtesting)
     */
    public logAiDecision(data: {
        code: string,
        name: string,
        aiScore: number,
        context: any,
        prompt: string,
        response: string,
        decision: any
    }) {
        if (!this.db) return;

        try {
            const stmt = this.db.prepare(`
                INSERT INTO ai_decisions (code, name, ai_score, context_json, prompt, response_json, action, reason)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `);

            stmt.run(
                data.code,
                data.name,
                data.aiScore,
                JSON.stringify(data.context),
                data.prompt,
                JSON.stringify(data.decision),
                data.decision.action,
                data.decision.reason
            );
        } catch (e) {
            console.error(`[DataLoggingService] logAiDecision error:`, e)
        }
    }

    public getTodayDecisions() {
        if (!this.db) return [];
        try {
            const today = new Date().toISOString().split('T')[0];
            const stmt = this.db.prepare(`
                SELECT * FROM ai_decisions 
                WHERE timestamp >= ? 
                ORDER BY timestamp DESC
            `);
            return stmt.all(today + ' 00:00:00') as any[];
        } catch (e) {
            console.error(`[DataLoggingService] getTodayDecisions error:`, e);
            return [];
        }
    }

    // Additional methods for backtesting queries can be added here later
}
