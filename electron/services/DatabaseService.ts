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

        const createYahooFinanceCacheTable = `
            CREATE TABLE IF NOT EXISTS yahoo_finance_cache (
                symbol TEXT PRIMARY KEY,
                historical_data TEXT,
                updated_at TEXT
            );
        `

        const createYahooMacroCacheTable = `
            CREATE TABLE IF NOT EXISTS yahoo_macro_cache (
                symbol TEXT PRIMARY KEY,
                macro_data TEXT,
                updated_at TEXT
            );
        `

        const createAiStrategiesTable = `
            CREATE TABLE IF NOT EXISTS ai_strategies (
                id TEXT PRIMARY KEY,
                version TEXT NOT NULL,
                name TEXT NOT NULL,
                created_at TEXT NOT NULL,
                reasonToPropose TEXT,
                is_active INTEGER DEFAULT 0,
                win_rate REAL DEFAULT 0,
                avg_hold_time TEXT DEFAULT '0m',
                target_profit REAL DEFAULT 3.0,
                stop_loss REAL DEFAULT -2.0,
                min_ai_score INTEGER DEFAULT 60,
                max_positions INTEGER DEFAULT 2,
                scoring_weights TEXT,
                master_prompt TEXT
            );
        `

        const createAiStrategyHistoryTable = `
            CREATE TABLE IF NOT EXISTS ai_strategy_history (
                strategy_id TEXT,
                date TEXT,
                daily_return REAL,
                PRIMARY KEY (strategy_id, date)
            );
        `

        const createHoldingHistoryTable = `
            CREATE TABLE IF NOT EXISTS holding_history (
                stock_code TEXT PRIMARY KEY,
                first_seen_date TEXT NOT NULL
            );
        `

        this.db.exec(createDartCorpTable)
        this.db.exec(createSchedulesTable)
        this.db.exec(createFinancialDataTable)
        this.db.exec(createAnalysisCacheTable)
        this.db.exec(createYahooFinanceCacheTable)
        this.db.exec(createYahooMacroCacheTable)
        this.db.exec(createAiStrategiesTable)
        this.db.exec(createAiStrategyHistoryTable)
        this.db.exec(createHoldingHistoryTable)

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

        // Migration for new Ai Strategy columns
        try { this.db.exec("ALTER TABLE ai_strategies ADD COLUMN target_profit REAL DEFAULT 3.0") } catch (e) { }
        try { this.db.exec("ALTER TABLE ai_strategies ADD COLUMN stop_loss REAL DEFAULT -2.0") } catch (e) { }
        try { this.db.exec("ALTER TABLE ai_strategies ADD COLUMN min_ai_score INTEGER DEFAULT 60") } catch (e) { }
        try { this.db.exec("ALTER TABLE ai_strategies ADD COLUMN max_positions INTEGER DEFAULT 2") } catch (e) { }
        try { this.db.exec("ALTER TABLE ai_strategies ADD COLUMN scoring_weights TEXT") } catch (e) { }
        try { this.db.exec("ALTER TABLE ai_strategies ADD COLUMN master_prompt TEXT") } catch (e) { }

        // Ensure v1 Factory Strategy exists
        this.ensureV1Strategy();

        // Ensure v1 Factory Strategy exists
        this.ensureV1Strategy();
    }


    private ensureV1Strategy() {
        const v1 = this.db.prepare('SELECT id FROM ai_strategies WHERE version = ?').get('v1');
        if (!v1) {
            console.log('[DatabaseService] Initializing v1 Factory Strategy...');
            const v1Id = 'factory-v1-uuid';
            this.saveAiStrategy({
                id: v1Id,
                version: 'v1',
                name: 'Factory Default (v1)',
                isActive: false,
                win_rate: 0,
                avg_hold_time: '0m',
                history: [],
                targetProfit: 3.0,
                stopLoss: -2.0,
                minAiScore: 60,
                maxPositions: 2,
                scoringWeights: { vwap: 30, velocity: 25, trend: 20, gap: 10, leader: 15 },
                masterPrompt: "당신은 대한민국 코스피/코스닥 시장의 실시간 단타 및 스캘핑 전문가입니다. 아래 제공된 지표와 최근 20일 일봉 및 15분 분봉 데이터를 분석하여 '강력한 수급이 동반된 눌림목' 자리인지 판단하세요.\n\n[분석 지침]\n1. 거래대금이 상위권인 '시장 주도주' 여부와 VWAP(당일평균단가) 지지 여부를 최우선으로 분석하십시오.\n2. [최근 20일 일봉] 데이터를 통해 오늘의 위치가 주요 저항선을 돌파하는 자리인지, 혹은 매물대 상단인지 파악하십시오.\n3. 매수 승인(BUY) 시, 일봉 맥락을 고려하여 3% 이상의 높은 수익이 가능한 구간이라면 그에 맞는 target_price(익절가)를, 단기 고점이라면 타이트한 stop_price(손절가)를 반드시 구체적인 숫자로 제안하십시오.\n4. 다음 형식을 지켜 100% JSON으로 응답해야 합니다.",
                created_at: '2026-02-24T00:00:00Z'
            });
        }
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

    public saveYahooFinanceCache(symbol: string, historicalDataJson: string) {
        const stmt = this.db.prepare(`
            INSERT OR REPLACE INTO yahoo_finance_cache (symbol, historical_data, updated_at)
            VALUES (?, ?, ?)
        `)
        stmt.run(symbol, historicalDataJson, new Date().toISOString())
    }

    public getYahooFinanceCache(symbol: string) {
        return this.db.prepare('SELECT * FROM yahoo_finance_cache WHERE symbol = ?').get(symbol) as any
    }

    public saveYahooMacroCache(symbol: string, macroDataJson: string) {
        const stmt = this.db.prepare(`
            INSERT OR REPLACE INTO yahoo_macro_cache (symbol, macro_data, updated_at)
            VALUES (?, ?, ?)
        `)
        stmt.run(symbol, macroDataJson, new Date().toISOString())
    }

    public getYahooMacroCache(symbol: string) {
        return this.db.prepare('SELECT * FROM yahoo_macro_cache WHERE symbol = ?').get(symbol) as any
    }

    public getAiStrategies() {
        // Returns all strategies with their history arrays joined
        const strategies = this.db.prepare('SELECT * FROM ai_strategies ORDER BY created_at DESC').all() as any[];
        const histories = this.db.prepare('SELECT * FROM ai_strategy_history ORDER BY date DESC').all() as any[];

        for (const strategy of strategies) {
            strategy.history = histories.filter(h => h.strategy_id === strategy.id).map(h => ({
                date: h.date,
                return: h.daily_return
            }));
            strategy.isActive = strategy.is_active === 1;
            strategy.targetProfit = strategy.target_profit;
            strategy.stopLoss = strategy.stop_loss;
            strategy.minAiScore = strategy.min_ai_score;
            strategy.maxPositions = strategy.max_positions;
            strategy.scoringWeights = strategy.scoring_weights ? JSON.parse(strategy.scoring_weights) : { vwap: 40, velocity: 30, trend: 20, gap: 10 };
            strategy.masterPrompt = strategy.master_prompt || "";
        }
        return strategies;
    }

    public saveAiStrategy(strategy: any) {
        // Ensure no other is active if this one is strictly active
        if (strategy.isActive) {
            this.db.prepare('UPDATE ai_strategies SET is_active = 0').run();
        }

        const stmt = this.db.prepare(`
            INSERT OR REPLACE INTO ai_strategies (id, version, name, created_at, reasonToPropose, is_active, win_rate, avg_hold_time, target_profit, stop_loss, min_ai_score, max_positions, scoring_weights, master_prompt)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        stmt.run(
            strategy.id,
            strategy.version,
            strategy.name,
            strategy.created_at || new Date().toISOString(),
            strategy.reasonToPropose || '',
            strategy.isActive ? 1 : 0,
            strategy.win_rate || 0,
            strategy.avg_hold_time || '0m',
            strategy.targetProfit ?? 3.0,
            strategy.stopLoss ?? -2.0,
            strategy.minAiScore ?? 60,
            strategy.maxPositions ?? 2,
            strategy.scoringWeights ? JSON.stringify(strategy.scoringWeights) : JSON.stringify({ vwap: 30, velocity: 25, trend: 20, gap: 10, leader: 15 }),
            strategy.masterPrompt || ''
        );

        if (strategy.history && strategy.history.length > 0) {
            const histStmt = this.db.prepare(`
                INSERT OR REPLACE INTO ai_strategy_history (strategy_id, date, daily_return)
                VALUES (?, ?, ?)
            `);
            const insertHistory = this.db.transaction((items) => {
                for (const item of items) {
                    histStmt.run(strategy.id, item.date, item.return);
                }
            });
            insertHistory(strategy.history);
        }
    }

    public setAiStrategyActive(id: string) {
        this.db.prepare('UPDATE ai_strategies SET is_active = 0').run();
        this.db.prepare('UPDATE ai_strategies SET is_active = 1 WHERE id = ?').run(id);
    }

    public deleteAiStrategy(id: string) {
        // Prevent deletion of factory v1
        const strategy = this.db.prepare('SELECT version FROM ai_strategies WHERE id = ?').get(id) as any;
        if (strategy?.version === 'v1') {
            console.warn('[DatabaseService] Cannot delete factory strategy v1');
            return;
        }
        this.db.prepare('DELETE FROM ai_strategies WHERE id = ?').run(id);
        this.db.prepare('DELETE FROM ai_strategy_history WHERE strategy_id = ?').run(id);
    }

    public syncHoldingHistory(currentCodes: string[]) {
        if (!currentCodes || currentCodes.length === 0) {
            console.log('[DatabaseService] syncHoldingHistory: Empty codes list, skipping sync to avoid accidental deletion');
            return;
        }

        const today = new Date().toISOString().split('T')[0];
        const insertStmt = this.db.prepare('INSERT OR IGNORE INTO holding_history (stock_code, first_seen_date) VALUES (?, ?)');
        const deleteStmt = this.db.prepare('DELETE FROM holding_history WHERE stock_code = ?');
        const getAllStmt = this.db.prepare("SELECT stock_code FROM holding_history WHERE stock_code NOT LIKE 'internal-%'");

        const sync = this.db.transaction((codes: string[]) => {
            // 1. Add new stocks
            for (const code of codes) {
                insertStmt.run(code, today);
            }

            // 2. Remove stocks no longer held (skip internal markers)
            const existingEntries = getAllStmt.all() as any[];
            for (const entry of existingEntries) {
                if (!codes.includes(entry.stock_code)) {
                    console.log(`[DatabaseService] Removing ${entry.stock_code} from history because it's no longer held`);
                    deleteStmt.run(entry.stock_code);
                }
            }
        });

        sync(currentCodes);
    }

    public getHoldingHistory(): Record<string, string> {
        // Simple query without the problematic wildcard (_)
        const rows = this.db.prepare("SELECT * FROM holding_history WHERE stock_code NOT LIKE 'internal-%'").all() as any[];
        const history: Record<string, string> = {};
        rows.forEach(row => {
            history[row.stock_code] = row.first_seen_date;
        });
        return history;
    }


    public getDb() {
        return this.db
    }

    public close() {
        this.db.close()
    }
}
