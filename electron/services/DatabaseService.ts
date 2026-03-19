import Database from 'better-sqlite3'
import path from 'path'
import { app } from 'electron'
import fs from 'fs'
// Removed external DateUtils import

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

    public getKstDate(date?: Date): string {
        const now = date || new Date();
        const formatter = new Intl.DateTimeFormat('sv-SE', {
            timeZone: 'Asia/Seoul',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        });
        return formatter.format(now);
    }

    public getKstTimestamp(date?: Date): string {
        const now = date || new Date();
        return new Intl.DateTimeFormat('sv-SE', {
            timeZone: 'Asia/Seoul',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        }).format(now).replace(' ', 'T');
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

        const createStockMasterTable = `
            CREATE TABLE IF NOT EXISTS stocks_master (
                stock_code TEXT PRIMARY KEY,
                stock_name TEXT NOT NULL,
                market_type TEXT,
                corp_code TEXT,
                updated_at TEXT
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

        const createMarketDailyReportsTable = `
            CREATE TABLE IF NOT EXISTS market_daily_reports (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                date TEXT,
                timing TEXT DEFAULT 'EVENING',
                market_summary TEXT,
                report_type TEXT,
                UNIQUE(date, timing)
            );
        `

        const createDailyRisingStocksTable = `
            CREATE TABLE IF NOT EXISTS daily_rising_stocks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                date TEXT,
                timing TEXT DEFAULT 'EVENING',
                stock_code TEXT,
                stock_name TEXT,
                change_rate REAL,
                trading_value REAL,
                source TEXT,
                ai_score INTEGER,
                theme_sector TEXT,
                reason TEXT,
                chart_insight TEXT,
                past_reference TEXT,
                tags TEXT,
                UNIQUE(date, stock_code, timing)
            );
        `

        const createAiLearningLogTable = `
            CREATE TABLE IF NOT EXISTS ai_learning_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                original_report_id INTEGER,
                prediction_accuracy TEXT,
                actual_performance REAL,
                learning_point TEXT,
                sector TEXT,
                FOREIGN KEY (original_report_id) REFERENCES daily_rising_stocks(id)
            );
        `

        const createStockRawDataTable = `
            CREATE TABLE IF NOT EXISTS stock_raw_data (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                date TEXT NOT NULL,
                stock_code TEXT NOT NULL,
                stock_name TEXT NOT NULL,
                news_json TEXT,
                disclosures_json TEXT,
                collected_at TEXT,
                UNIQUE(date, stock_code)
            );
        `

        const createSkillsFileHistoryTable = `
            CREATE TABLE IF NOT EXISTS skills_file_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                file_name TEXT NOT NULL,
                version INTEGER NOT NULL,
                content TEXT NOT NULL,
                diff_summary TEXT,
                change_type TEXT NOT NULL,
                trigger_context TEXT,
                changed_at TEXT NOT NULL
            );
        `

        const createMaiisInventoryTable = `
            CREATE TABLE IF NOT EXISTS maiis_data_inventory (
                data_key TEXT PRIMARY KEY,
                source_api TEXT NOT NULL,
                category TEXT NOT NULL,
                last_freshness_at TEXT NOT NULL,
                next_check_at TEXT,
                refresh_interval_sec INTEGER,
                status TEXT DEFAULT 'IDLE',
                meta_json TEXT
            );
        `

        const createMaiisStatsTable = `
            CREATE TABLE IF NOT EXISTS maiis_ingestion_stats (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                data_key TEXT NOT NULL,
                api_name TEXT NOT NULL,
                latency_ms INTEGER,
                status_code INTEGER,
                data_size_kb REAL,
                error_msg TEXT,
                created_at TEXT NOT NULL
            );
        `

        const createSectorIndexHistoryTable = `
            CREATE TABLE IF NOT EXISTS sector_index_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                date TEXT NOT NULL,
                sector_code TEXT NOT NULL,
                sector_name TEXT NOT NULL,
                index_value REAL,
                change_rate REAL,
                trading_value REAL,
                trading_volume REAL,
                UNIQUE(date, sector_code)
            );
        `

        const createSectorInvestorFlowTable = `
            CREATE TABLE IF NOT EXISTS sector_investor_flow (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                date TEXT NOT NULL,
                sector_code TEXT NOT NULL,
                foreigner_net REAL,
                institution_net REAL,
                individual_net REAL,
                UNIQUE(date, sector_code)
            );
        `

        const createYoutubeChannelsTable = `
            CREATE TABLE IF NOT EXISTS youtube_channels (
                channel_id TEXT PRIMARY KEY,
                channel_name TEXT NOT NULL,
                description TEXT,
                trust_score REAL DEFAULT 1.0,
                last_collected_at TEXT
            );
        `

        const createYoutubeNarrativeLogsTable = `
            CREATE TABLE IF NOT EXISTS youtube_narrative_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                video_id TEXT NOT NULL,
                channel_id TEXT NOT NULL,
                published_at TEXT NOT NULL,
                title TEXT NOT NULL,
                thumbnail TEXT,
                transcript TEXT,
                summary_json TEXT, -- AI 정제 결과 (섹터, 바이어스 등)
                collected_at TEXT NOT NULL,
                UNIQUE(video_id)
            );
        `

        const createYoutubeDailyConsensusTable = `
            CREATE TABLE IF NOT EXISTS youtube_daily_consensus (
                date TEXT PRIMARY KEY,
                consensus_report TEXT, -- 전문가 통합 의견 요약
                pivot_analysis TEXT, -- 어제 대비 주요 변화
                sources_json TEXT, -- 분석에 사용된 영상 정보 (JSON)
                created_at TEXT NOT NULL
            );
        `

        const createYoutubeNarrativeTrendsTable = `
            CREATE TABLE IF NOT EXISTS youtube_narrative_trends (
                date TEXT PRIMARY KEY,
                sector_rankings_json TEXT, -- 섹터별 점수 및 요약 (JSON)
                sentiment_score REAL,      -- 통합 시장 심리 점수 (0~1)
                hot_keywords_json TEXT,    -- 주요 키워드 및 점수 (JSON)
                created_at TEXT NOT NULL
            );
        `

        const createMarketNewsConsensusTable = `
            CREATE TABLE IF NOT EXISTS market_news_consensus (
                date TEXT PRIMARY KEY,
                summary_json TEXT, -- 뉴스 통합 요약 및 시장 온도
                pivot_analysis TEXT, -- 어제 대비 주요 변화
                keywords_used TEXT, -- 분석에 사용된 키워드들
                source_news TEXT, -- 분석 소스가 된 뉴스 제목 리스트 (JSON)
                sentiment_score REAL, -- 시장 심리 점수 (-1.0 ~ 1.0)
                hot_keywords_json TEXT, -- 데일리 핵심 키워드 순위 및 점수 (JSON)
                created_at TEXT NOT NULL
            );
        `

        const createMaiisDomainInsightsTable = `
            CREATE TABLE IF NOT EXISTS maiis_domain_insights (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                date TEXT NOT NULL,
                domain_type TEXT NOT NULL,
                raw_input_text TEXT,
                used_prompt TEXT,
                generated_json TEXT,
                created_at TEXT NOT NULL
            );
        `

        const createMaiisWorldStateTable = `
            CREATE TABLE IF NOT EXISTS maiis_world_state (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                date TEXT NOT NULL,
                sentiment_score REAL,
                market_frame TEXT,
                top_keywords_json TEXT,
                expected_sectors_json TEXT,
                macro_indicators_json TEXT,
                created_at TEXT NOT NULL,
                UNIQUE(date)
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
        this.db.exec(createMarketDailyReportsTable)
        this.db.exec(createDailyRisingStocksTable)
        this.db.exec(createAiLearningLogTable)
        this.db.exec(createStockRawDataTable)
        this.db.exec(createSkillsFileHistoryTable)
        this.db.exec(createStockMasterTable)
        this.db.exec(createMaiisInventoryTable)
        this.db.exec(createMaiisStatsTable)
        this.db.exec(createSectorIndexHistoryTable)
        this.db.exec(createSectorInvestorFlowTable)
        this.db.exec(createYoutubeChannelsTable)
        this.db.exec(createYoutubeNarrativeLogsTable)
        this.db.exec(createYoutubeDailyConsensusTable)
        this.db.exec(createYoutubeNarrativeTrendsTable)
        this.db.exec(createMarketNewsConsensusTable)
        this.db.exec(createMaiisDomainInsightsTable)
        this.db.exec(createMaiisWorldStateTable)

        // Ensure macro_indicators_json exists in world state
        try {
            this.db.exec("ALTER TABLE maiis_world_state ADD COLUMN macro_indicators_json TEXT")
        } catch (e) { }
        
        // Ensure source_news column exists for migration
        try {
            this.db.exec("ALTER TABLE market_news_consensus ADD COLUMN source_news TEXT")
        } catch (e) { }
        
        // Ensure columns exist for migration
        try {
            this.db.exec("ALTER TABLE youtube_narrative_logs ADD COLUMN thumbnail TEXT")
        } catch (e) { }

        // Ensure indices for MAIIS stats
        try {
            this.db.exec("CREATE INDEX IF NOT EXISTS idx_maiis_stats_key_date ON maiis_ingestion_stats(data_key, created_at)")
        } catch (e) { }

        // Ensure columns exist for migration
        try {
            this.db.exec("ALTER TABLE schedules ADD COLUMN source TEXT DEFAULT 'MANUAL'")
        } catch (e) { }
        try {
            this.db.exec("ALTER TABLE schedules ADD COLUMN origin_id TEXT")
        } catch (e) { }
        
        // Migration for daily_rising_stocks missing columns
        try {
            this.db.exec("ALTER TABLE daily_rising_stocks ADD COLUMN trading_value REAL")
        } catch (e) { }
        try {
            this.db.exec("ALTER TABLE daily_rising_stocks ADD COLUMN source TEXT")
        } catch (e) { }
        try {
            this.db.exec("ALTER TABLE daily_rising_stocks ADD COLUMN tags TEXT")
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
        
        // --- Timing Column Migrations ---
        try {
            this.db.exec("ALTER TABLE market_daily_reports ADD COLUMN timing TEXT DEFAULT 'EVENING'")
        } catch (e) { }
        try {
            this.db.exec("ALTER TABLE daily_rising_stocks ADD COLUMN timing TEXT DEFAULT 'EVENING'")
        } catch (e) { }

        // Ensure existing NULL values are filled for backward compatibility
        try {
            this.db.exec("UPDATE market_daily_reports SET timing = 'EVENING' WHERE timing IS NULL")
            this.db.exec("UPDATE daily_rising_stocks SET timing = 'EVENING' WHERE timing IS NULL")
        } catch (e) { }

        // Migration for Market News Consensus (Schema Expansion)
        try {
            const check = this.db.prepare("PRAGMA table_info(market_news_consensus)").all() as any[];
            if (check.length > 0 && !check.find(c => c.name === 'sentiment_score')) {
                console.log('[DatabaseService] Migrating market_news_consensus to new schema...');
                this.db.exec("ALTER TABLE market_news_consensus ADD COLUMN sentiment_score REAL");
                this.db.exec("ALTER TABLE market_news_consensus ADD COLUMN hot_keywords_json TEXT");
            }
        } catch (e) {}

        // Ensure v1 Factory Strategy exists
        this.ensureV1Strategy();

        // Ensure v1 Factory Strategy exists
        this.ensureV1Strategy();

        // Migration for YouTube Narrative Tables (Schema Expansion)
        try {
            const check = this.db.prepare("PRAGMA table_info(youtube_daily_consensus)").all() as any[];
            if (check.length > 0 && !check.find(c => c.name === 'consensus_report')) {
                console.log('[DatabaseService] Migrating youtube_daily_consensus to new schema...');
                this.db.exec("DROP TABLE youtube_daily_consensus");
                // The table will be recreated on next run or I can run it here
                this.db.exec(`
                    CREATE TABLE IF NOT EXISTS youtube_daily_consensus (
                        date TEXT PRIMARY KEY,
                        consensus_report TEXT,
                        pivot_analysis TEXT,
                        sources_json TEXT,
                        created_at TEXT NOT NULL
                    )
                `);
            }
        } catch (e) {}

        try {
            const check = this.db.prepare("PRAGMA table_info(youtube_narrative_trends)").all() as any[];
            if (check.length > 0 && !check.find(c => c.name === 'sector_rankings_json')) {
                console.log('[DatabaseService] Migrating youtube_narrative_trends to new schema...');
                this.db.exec("DROP TABLE youtube_narrative_trends");
                this.db.exec(`
                    CREATE TABLE IF NOT EXISTS youtube_narrative_trends (
                        date TEXT PRIMARY KEY,
                        sector_rankings_json TEXT,
                        sentiment_score REAL,
                        hot_keywords_json TEXT,
                        created_at TEXT NOT NULL
                    )
                `);
            }
        } catch (e) {}
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

    public insertStockMaster(stocks: { stock_code: string, stock_name: string, market_type: string, corp_code?: string, updated_at: string }[]) {
        const stmt = this.db.prepare(`
            INSERT OR REPLACE INTO stocks_master (stock_code, stock_name, market_type, corp_code, updated_at)
            VALUES (@stock_code, @stock_name, @market_type, @corp_code, @updated_at)
        `)

        const insertMany = this.db.transaction((items) => {
            for (const item of items) {
                stmt.run(item)
            }
        })
        insertMany(stocks)
    }

    public searchStocks(query: string, limit: number = 20) {
        const stmt = this.db.prepare(`
            SELECT * FROM stocks_master 
            WHERE stock_name LIKE ? OR stock_code LIKE ? 
            LIMIT ?
        `)
        return stmt.all(`%${query}%`, `%${query}%`, limit) as any[]
    }

    public getStockByCode(code: string) {
        return this.db.prepare('SELECT * FROM stocks_master WHERE stock_code = ?').get(code) as any
    }

    public getAllStocks() {
        return this.db.prepare('SELECT * FROM stocks_master').all() as any[]
    }

    public getLatestStockUpdate() {
        const row = this.db.prepare('SELECT MAX(updated_at) as last_update FROM stocks_master').get() as any
        return row?.last_update || null
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

        const today = this.getKstDate();
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


    // === Rising Stocks Analysis Methods ===
    public saveMarketDailyReport(report: { date: string, timing: string, market_summary: string, report_type: string }) {
        const stmt = this.db.prepare(`
            INSERT OR REPLACE INTO market_daily_reports (date, timing, market_summary, report_type)
            VALUES (?, ?, ?, ?)
        `)
        return stmt.run(report.date, report.timing || 'EVENING', report.market_summary, report.report_type)
    }

    public getMarketDailyReport(date: string, timing: string = 'EVENING') {
        return this.db.prepare('SELECT * FROM market_daily_reports WHERE date = ? AND timing = ?').get(date, timing) as any
    }

    public saveRisingStockAnalysis(analysis: any) {
        const stmt = this.db.prepare(`
            INSERT OR REPLACE INTO daily_rising_stocks (
                date, timing, stock_code, stock_name, change_rate, trading_value, source, ai_score, 
                theme_sector, reason, chart_insight, past_reference, tags
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        return stmt.run(
            analysis.date,
            analysis.timing || 'EVENING',
            analysis.stock_code,
            analysis.stock_name,
            analysis.change_rate,
            analysis.trading_value || 0,
            analysis.source || '',
            analysis.ai_score,
            analysis.theme_sector,
            analysis.reason,
            analysis.chart_insight,
            analysis.past_reference,
            analysis.tags ? (typeof analysis.tags === 'string' ? analysis.tags : JSON.stringify(analysis.tags)) : null
        )
    }

    public getRisingStocksByDate(date: string, timing: string = 'EVENING') {
        // AI 점수 높은 순으로 정렬하여 반환 (UI 우선순위)
        return this.db.prepare('SELECT * FROM daily_rising_stocks WHERE date = ? AND timing = ? ORDER BY ai_score DESC, change_rate DESC').all(date, timing) as any[]
    }

    public getStockAnalysis(stockCode: string) {
        return this.db.prepare('SELECT * FROM daily_rising_stocks WHERE stock_code = ? ORDER BY date DESC, timing DESC').all(stockCode) as any[]
    }

    public getDailyReportHistory(limit = 100) {
        // 시장 총평이 있는 날짜 목록을 최신순으로 반환
        return this.db.prepare('SELECT DISTINCT date FROM market_daily_reports ORDER BY date DESC LIMIT ?').all(limit) as { date: string }[]
    }

    public saveAiLearningLog(log: any) {
        const stmt = this.db.prepare(`
            INSERT INTO ai_learning_log (
                original_report_id, prediction_accuracy, actual_performance, learning_point, sector
            ) VALUES (?, ?, ?, ?, ?)
        `)
        return stmt.run(
            log.original_report_id,
            log.prediction_accuracy,
            log.actual_performance,
            log.learning_point,
            log.sector
        )
    }

    // ─── Raw Data (뉴스 / 공시) ────────────────────────────────────────────
    public saveRawData(data: {
        date: string
        stock_code: string
        stock_name: string
        news_json: string          
        disclosures_json: string   
    }) {
        const stmt = this.db.prepare(`
            INSERT INTO stock_raw_data (date, stock_code, stock_name, news_json, disclosures_json, collected_at)
            VALUES (@date, @stock_code, @stock_name, @news_json, @disclosures_json, @collected_at)
            ON CONFLICT(date, stock_code) DO UPDATE SET
                news_json        = excluded.news_json,
                disclosures_json = excluded.disclosures_json,
                collected_at     = excluded.collected_at
        `)
        stmt.run({ ...data, collected_at: this.getKstTimestamp() })
    }

    public getRawData(date: string, stockCode: string): { news_json: string, disclosures_json: string, collected_at: string } | undefined {
        return this.db.prepare(
            'SELECT news_json, disclosures_json, collected_at FROM stock_raw_data WHERE date = ? AND stock_code = ?'
        ).get(date, stockCode) as any
    }

    public saveNewsRawData(date: string, stockCode: string, stockName: string, news: any[]) {
        const stmt = this.db.prepare(`
            INSERT INTO stock_raw_data (date, stock_code, stock_name, news_json, collected_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(date, stock_code) DO UPDATE SET
                news_json = excluded.news_json,
                collected_at = excluded.collected_at
        `)
        stmt.run(date, stockCode, stockName, JSON.stringify(news), this.getKstTimestamp())
    }

    public saveDisclosuresRawData(date: string, stockCode: string, stockName: string, disclosures: any[]) {
        const stmt = this.db.prepare(`
            INSERT INTO stock_raw_data (date, stock_code, stock_name, disclosures_json, collected_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(date, stock_code) DO UPDATE SET
                disclosures_json = excluded.disclosures_json,
                collected_at = excluded.collected_at
        `)
        stmt.run(date, stockCode, stockName, JSON.stringify(disclosures), this.getKstTimestamp())
    }

    // ─── Skills File History ────────────────────────────────────────────────

    /** 파일 컨텐츠가 변경됩을 때 스냅샷을 저장합니다. */
    public saveSkillsSnapshot(data: {
        file_name: string
        content: string
        diff_summary?: string
        change_type: 'MANUAL' | 'AI_LESSON' | 'AI_BATCH' | 'SYSTEM'
        trigger_context?: string
    }) {
        const lastVersion = (this.db.prepare(
            'SELECT MAX(version) as v FROM skills_file_history WHERE file_name = ?'
        ).get(data.file_name) as any)?.v ?? 0

        this.db.prepare(`
            INSERT INTO skills_file_history
                (file_name, version, content, diff_summary, change_type, trigger_context, changed_at)
            VALUES (@file_name, @version, @content, @diff_summary, @change_type, @trigger_context, @changed_at)
        `).run({
            file_name: data.file_name,
            version: lastVersion + 1,
            content: data.content,
            diff_summary: data.diff_summary ?? null,
            change_type: data.change_type,
            trigger_context: data.trigger_context ?? null,
            changed_at: new Date().toISOString()
        })
    }

    /** 특정 스킬스 파일의 변경 이력 목록 (version, summary, type, date) */
    public getSkillsHistory(fileName: string, limit = 30) {
        return this.db.prepare(`
            SELECT id, version, diff_summary, change_type, trigger_context, changed_at
            FROM skills_file_history
            WHERE file_name = ?
            ORDER BY version DESC
            LIMIT ?
        `).all(fileName, limit) as any[]
    }

    /** 특정 버전의 전체 컨텐츠 조회 */
    public getSkillsVersionContent(fileName: string, version: number): string | null {
        const row = this.db.prepare(
            'SELECT content FROM skills_file_history WHERE file_name = ? AND version = ?'
        ).get(fileName, version) as any
        return row?.content ?? null
    }

    /** 스킬스 파일 목록 (중복 없이) */
    public getSkillsFileList() {
        return this.db.prepare(`
            SELECT file_name, MAX(version) as version, MAX(changed_at) as last_updated
            FROM skills_file_history
            GROUP BY file_name
            ORDER BY file_name
        `).all() as any[]
    }
    // ─── MAIIS Ingestion Pipeline Monitoring ─────────────────────────────

    // MAIIS Inventory is handled below in the dedicated section to avoid duplicates.

    public saveSectorIndexHistory(data: any[]) {
        const stmt = this.db.prepare(`
            INSERT OR REPLACE INTO sector_index_history (
                date, sector_code, sector_name, index_value, change_rate, trading_value, trading_volume
            ) VALUES (@date, @sector_code, @sector_name, @index_value, @change_rate, @trading_value, @trading_volume)
        `)
        const insertMany = this.db.transaction((items) => {
            for (const item of items) stmt.run(item)
        })
        insertMany(data)
    }

    public saveSectorInvestorFlow(data: any[]) {
        const stmt = this.db.prepare(`
            INSERT OR REPLACE INTO sector_investor_flow (
                date, sector_code, foreigner_net, institution_net, individual_net
            ) VALUES (@date, @sector_code, @foreigner_net, @institution_net, @individual_net)
        `)
        const insertMany = this.db.transaction((items) => {
            for (const item of items) stmt.run(item)
        })
        insertMany(data)
    }

    public getLatestSectorPerformance(date: string) {
        return this.db.prepare('SELECT * FROM sector_index_history WHERE date = ?').all(date) as any[]
    }

    public recordIngestionStat(stat: {
        data_key: string
        api_name: string
        latency_ms: number
        status_code: number
        data_size_kb: number
        error_msg?: string
    }) {
        const stmt = this.db.prepare(`
            INSERT INTO maiis_ingestion_stats (
                data_key, api_name, latency_ms, status_code, data_size_kb, error_msg, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `)
        stmt.run(
            stat.data_key,
            stat.api_name,
            stat.latency_ms,
            stat.status_code,
            stat.data_size_kb,
            stat.error_msg || null,
            this.getKstTimestamp()
        )

        // Update inventory freshness concurrently
        const updateFreshness = this.db.prepare(`
            UPDATE maiis_data_inventory 
            SET last_freshness_at = ?, status = ?
            WHERE data_key = ?
        `)
        updateFreshness.run(this.getKstTimestamp(), stat.status_code === 200 ? 'SUCCESS' : 'ERROR', stat.data_key)
    }

    public getRecentMaiisStats(limit = 100) {
        return this.db.prepare(`
            SELECT * FROM maiis_ingestion_stats 
            ORDER BY created_at DESC 
            LIMIT ?
        `).all(limit) as any[]
    }

    /** 오래된 통계 데이터 정리 (30일 경과) */
    public pruneMaiisStats(days = 30) {
        const date = new Date()
        date.setDate(date.getDate() - days)
        const stmt = this.db.prepare('DELETE FROM maiis_ingestion_stats WHERE created_at < ?')
        return stmt.run(date.toISOString())
    }

    // === MAIIS Inventory Methods ===
    public getMaiisInventory() {
        try {
            const rows = this.db.prepare('SELECT * FROM maiis_data_inventory ORDER BY category, data_key').all() as any[]
            return (rows || []).map(r => ({
                ...r,
                meta_json: r.meta_json ? JSON.parse(r.meta_json) : {}
            }))
        } catch (e) {
            console.error('[DatabaseService] getMaiisInventory error:', e)
            return []
        }
    }

    public upsertMaiisInventory(item: any) {
        try {
            const stmt = this.db.prepare(`
                INSERT OR REPLACE INTO maiis_data_inventory (
                    data_key, source_api, category, last_freshness_at, next_check_at, refresh_interval_sec, status, meta_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `)
            return stmt.run(
                item.data_key,
                item.source_api,
                item.category,
                item.last_freshness_at,
                item.next_check_at,
                item.refresh_interval_sec,
                item.status,
                typeof item.meta_json === 'string' ? item.meta_json : JSON.stringify(item.meta_json || {})
            )
        } catch (e) {
            console.error('[DatabaseService] upsertMaiisInventory error:', e)
        }
    }


    public getDb() {
        return this.db
    }

    public close() {
        this.db.close()
    }

    // === Market News Consensus Methods ===
    public saveMarketNewsConsensus(data: { 
        date: string, 
        summary_json: string, 
        pivot_analysis: string, 
        keywords_used: string, 
        source_news?: string,
        sentiment_score?: number,
        hot_keywords_json?: string 
    }) {
        const sql = `
            INSERT OR REPLACE INTO market_news_consensus (
                date, summary_json, pivot_analysis, keywords_used, source_news, sentiment_score, hot_keywords_json, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, DATETIME('now', 'localtime'))
        `;
        this.db.prepare(sql).run(
            data.date, 
            data.summary_json, 
            data.pivot_analysis, 
            data.keywords_used, 
            data.source_news || null,
            data.sentiment_score ?? null,
            data.hot_keywords_json || null
        );
    }

    public getLatestMarketNewsConsensus(limit: number = 20) {
        return this.db.prepare('SELECT * FROM market_news_consensus ORDER BY date DESC LIMIT ?').all(limit);
    }

    public getLatestMarketNewsTrends(limit: number = 30) {
        // News trends are currently stored within the consensus table itself
        return this.db.prepare('SELECT date, sentiment_score, hot_keywords_json FROM market_news_consensus ORDER BY date DESC LIMIT ?').all(limit);
    }

    // === Youtube Multi-Agent Ingestion Methods ===
    public saveYoutubeNarrativeTrends(data: { date: string, sector_rankings_json: string, sentiment_score: number, hot_keywords_json: string }) {
        const sql = `
            INSERT OR REPLACE INTO youtube_narrative_trends (date, sector_rankings_json, sentiment_score, hot_keywords_json, created_at)
            VALUES (?, ?, ?, ?, DATETIME('now', 'localtime'))
        `;
        this.db.prepare(sql).run(data.date, data.sector_rankings_json, data.sentiment_score, data.hot_keywords_json);
    }

    public getLatestYoutubeNarrativeTrends(limit: number = 30) {
        return this.db.prepare('SELECT * FROM youtube_narrative_trends ORDER BY date DESC LIMIT ?').all(limit);
    }

    public saveYoutubeDailyConsensus(data: { date: string, consensus_report: string, pivot_analysis: string, sources_json: string }) {
        const sql = `
            INSERT OR REPLACE INTO youtube_daily_consensus (date, consensus_report, pivot_analysis, sources_json, created_at)
            VALUES (?, ?, ?, ?, DATETIME('now', 'localtime'))
        `;
        this.db.prepare(sql).run(data.date, data.consensus_report, data.pivot_analysis, data.sources_json);
    }

    public getLatestYoutubeDailyConsensus(limit: number = 20) {
        return this.db.prepare('SELECT * FROM youtube_daily_consensus ORDER BY date DESC LIMIT ?').all(limit);
    }

    // === MAIIS Pipeline Core Methods ===
    public saveMaiisDomainInsight(data: { date: string, domain_type: string, raw_input_text: string, used_prompt: string, generated_json: string }) {
        const sql = `
            INSERT INTO maiis_domain_insights (date, domain_type, raw_input_text, used_prompt, generated_json, created_at)
            VALUES (?, ?, ?, ?, ?, DATETIME('now', 'localtime'))
        `;
        this.db.prepare(sql).run(data.date, data.domain_type, data.raw_input_text, data.used_prompt, data.generated_json);
    }

    public getMaiisDomainInsights(date: string) {
        return this.db.prepare('SELECT * FROM maiis_domain_insights WHERE date = ? ORDER BY created_at DESC').all(date);
    }

    public saveMaiisWorldState(data: { date: string, sentiment_score: number, market_frame: string, top_keywords_json: string, expected_sectors_json: string, macro_indicators_json?: string }) {
        const sql = `
            INSERT OR REPLACE INTO maiis_world_state (date, sentiment_score, market_frame, top_keywords_json, expected_sectors_json, macro_indicators_json, created_at)
            VALUES (?, ?, ?, ?, ?, ?, DATETIME('now', 'localtime'))
        `;
        this.db.prepare(sql).run(data.date, data.sentiment_score, data.market_frame, data.top_keywords_json, data.expected_sectors_json, data.macro_indicators_json || '[]');
    }

    public getMaiisWorldState(date: string) {
        return this.db.prepare('SELECT * FROM maiis_world_state WHERE date = ?').get(date);
    }
}
