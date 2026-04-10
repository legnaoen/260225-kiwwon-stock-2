import Database from 'better-sqlite3'
import path from 'path'
import { app } from 'electron'
import fs from 'fs'
import Store from 'electron-store'

const store = new Store()

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
        const createPortfolioEventLogsTable = `
            CREATE TABLE IF NOT EXISTS portfolio_event_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                stock_code TEXT NOT NULL,
                stock_name TEXT,
                event_type TEXT NOT NULL,
                old_status TEXT,
                new_status TEXT,
                reason TEXT,
                price INTEGER,
                created_at TEXT NOT NULL
            );
        `

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
                reasonToPropose TEXT
            );
        `

        const createAiSettingsTable = `
            CREATE TABLE IF NOT EXISTS ai_settings (
                strategy_id TEXT PRIMARY KEY,
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

        const createPortfolioEventsTable = `
            CREATE TABLE IF NOT EXISTS maiis_portfolio_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                stock_code TEXT NOT NULL,
                stock_name TEXT,
                event_type TEXT NOT NULL,
                old_status TEXT,
                new_status TEXT,
                price REAL DEFAULT 0,
                profit_rate REAL DEFAULT 0,
                reason TEXT,
                created_at TEXT NOT NULL
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

        const createMarketOhlcvHistoryTable = `
            CREATE TABLE IF NOT EXISTS market_ohlcv_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                stock_code TEXT NOT NULL,
                date TEXT NOT NULL,
                open INTEGER,
                high INTEGER,
                low INTEGER,
                close INTEGER,
                volume INTEGER,
                trading_value INTEGER,
                UNIQUE(stock_code, date)
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

        const createAiExecutionLogTable = `
            CREATE TABLE IF NOT EXISTS ai_execution_log (
                id TEXT PRIMARY KEY,
                agent_id TEXT,
                agent_name TEXT,
                trigger_type TEXT,
                target_type TEXT,
                status TEXT,
                queued_at TEXT,
                started_at TEXT,
                finished_at TEXT,
                duration_ms INTEGER,
                error TEXT,
                prompt TEXT,
                system_instruction TEXT,
                result TEXT
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

        // Phase 3 Master AI 전용: 시간대별 분기 및 지식망(Reflection) 지원 테이블
        const createMaiisWorldStateV2Table = `
            CREATE TABLE IF NOT EXISTS maiis_world_state_v2 (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                date TEXT NOT NULL,
                timing TEXT NOT NULL,
                market_thesis TEXT,
                sentiment_score REAL,
                top_themes_json TEXT, -- v3부터는 Legacy 호환용
                alpha_picks_json TEXT, -- v3부터는 Legacy 호환용
                score_adjustments_json TEXT, -- v3 추가: AI의 강제 조정치 (Delta)
                new_alpha_picks_json TEXT,   -- v3 추가: 신규 편입 종목
                drop_alpha_picks_json TEXT,  -- v3 추가: 편출(손절/익절) 종목
                self_reflection TEXT,
                raw_json TEXT,
                created_at TEXT NOT NULL,
                UNIQUE(date, timing)
            );
        `

        // Phase 3 기계적 랭킹 추적 (Stateful DB)
        const createMaiisThemeRankingsTable = `
            CREATE TABLE IF NOT EXISTS maiis_theme_rankings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                date TEXT NOT NULL,
                theme_name TEXT NOT NULL,
                base_score REAL DEFAULT 0,
                ai_adjustment REAL DEFAULT 0,
                final_score REAL DEFAULT 0,
                ai_reason TEXT,
                rank INTEGER DEFAULT 0,
                UNIQUE(date, theme_name)
            );
        `

        // Phase 3 키워드 랭킹 추적
        const createMaiisKeywordRankingsTable = `
            CREATE TABLE IF NOT EXISTS maiis_keyword_rankings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                date TEXT NOT NULL,
                keyword TEXT NOT NULL,
                frequency INTEGER DEFAULT 0,
                score REAL DEFAULT 0,
                UNIQUE(date, keyword)
            );
        `

        // Phase 3 능동적 알파 픽 포트폴리오 (Stateful DB)
        const createMaiisActivePicksTable = `
            CREATE TABLE IF NOT EXISTS maiis_active_picks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                stock_code TEXT NOT NULL,
                stock_name TEXT NOT NULL,
                recommend_date TEXT NOT NULL,
                reco_price REAL DEFAULT 0,
                current_price REAL DEFAULT 0,
                profit_rate REAL DEFAULT 0,
                status TEXT DEFAULT 'ACTIVE', -- ACTIVE, DROPPED
                ai_reason TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE(stock_code)
            );
        `

        // PL-NaverFlow: 업종 및 테마별 상승률 트렌드 테이블
        const createNaverMarketFlowTable = `
            CREATE TABLE IF NOT EXISTS naver_market_flow (
                date TEXT NOT NULL,
                type TEXT NOT NULL,
                rank_num INTEGER NOT NULL,
                name TEXT NOT NULL,
                change_rate REAL NOT NULL,
                PRIMARY KEY(date, type, name)
            );
        `

        // PL-NaverFlow: 마켓 주도주 자동 태깅 테이블
        const createStockThemeTagsTable = `
            CREATE TABLE IF NOT EXISTS stock_theme_tags (
                stock_code TEXT NOT NULL,
                stock_name TEXT NOT NULL,
                tag_name TEXT NOT NULL,
                is_auto_tagged INTEGER DEFAULT 0,
                change_rate REAL DEFAULT 0,
                added_date TEXT NOT NULL,
                PRIMARY KEY(stock_code, tag_name)
            );
        `

        // PL-NaverFlow: 마켓 테마 AI 분석 리포트 (Gemini 연동)
        const createThemeIntelligenceTable = `
            CREATE TABLE IF NOT EXISTS theme_intelligence (
                date TEXT NOT NULL,
                type TEXT NOT NULL,
                name TEXT NOT NULL,
                reason TEXT,
                lifespan_type TEXT,
                lifespan_reasoning TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY(date, type, name)
            );
        `

        // 누적 어휘 사전: 한번 등장한 네이버 업종/테마 이름을 영구 보존 (이슈 AI 정합 기준)
        const createNaverVocabularyTable = `
            CREATE TABLE IF NOT EXISTS naver_vocabulary (
                name TEXT NOT NULL,
                type TEXT NOT NULL,            -- 'SECTOR' | 'THEME'
                first_seen TEXT NOT NULL,      -- 최초 등장일 (YYYY-MM-DD)
                last_seen TEXT NOT NULL,       -- 최근 등장일 (갱신)
                times_appeared INTEGER DEFAULT 1,
                PRIMARY KEY(name, type)
            );
        `

        // PL-NaverFlow: 마켓 주도주 하이브리드 인덱스 추적용 테이블
        const createThemePriceIndexTable = `
            CREATE TABLE IF NOT EXISTS theme_price_index (
                date TEXT NOT NULL,
                type TEXT NOT NULL,
                name TEXT NOT NULL,
                price_index REAL NOT NULL,
                daily_return REAL NOT NULL,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY(date, type, name)
            );
        `


        // PL-NewsFlow: 네이버 증권 뉴스 수집 테이블
        const createNaverNewsFlowTable = `
            CREATE TABLE IF NOT EXISTS naver_news_flow (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                date TEXT NOT NULL,
                category TEXT NOT NULL,
                title TEXT NOT NULL,
                body_snippet TEXT,
                source TEXT,
                article_id TEXT,
                url TEXT,
                collected_at TEXT NOT NULL,
                UNIQUE(date, category, title)
            );
        `

        // PL-Research: 네이버 리서치 집중 산업 수집 테이블
        const createNaverResearchFlowTable = `
            CREATE TABLE IF NOT EXISTS naver_research_flow (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                date TEXT NOT NULL,
                rank INTEGER NOT NULL,
                industry_name TEXT NOT NULL,
                report_title TEXT,
                analyst TEXT,
                broker TEXT,
                content_snippet TEXT,
                url TEXT,
                collected_at TEXT NOT NULL,
                UNIQUE(date, industry_name, report_title)
            );
        `

        this.db.exec(createNaverMarketFlowTable)
        this.db.exec(createStockThemeTagsTable)
        try {
            this.db.exec('ALTER TABLE stock_theme_tags ADD COLUMN change_rate REAL DEFAULT 0;');
        } catch (e: any) {
            // Ignore error if column already exists
        }
        this.db.exec(createThemeIntelligenceTable)
        this.db.exec(createThemePriceIndexTable)
        this.db.exec(createNaverNewsFlowTable)
        try {
            this.db.exec('ALTER TABLE naver_news_flow ADD COLUMN body_snippet TEXT;');
        } catch (e: any) {
            // Ignore error if column already exists
        }
        this.db.exec(createNaverVocabularyTable)
        this.db.exec(createNaverResearchFlowTable)

        this.db.exec(createDartCorpTable)
        this.db.exec(createPortfolioEventLogsTable)
        this.db.exec(createSchedulesTable)
        this.db.exec(createFinancialDataTable)
        this.db.exec(createAnalysisCacheTable)
        this.db.exec(createYahooFinanceCacheTable)
        this.db.exec(createYahooMacroCacheTable)
        this.db.exec(createAiStrategiesTable)
        this.db.exec(createAiStrategyHistoryTable)
        this.db.exec(createHoldingHistoryTable)
        this.db.exec(createMarketDailyReportsTable)
        this.db.exec(createMarketOhlcvHistoryTable)
        this.db.exec(createDailyRisingStocksTable)
        this.db.exec(createAiLearningLogTable)
        this.db.exec(createStockRawDataTable)
        this.db.exec(createSkillsFileHistoryTable)
        this.db.exec(createAiExecutionLogTable)
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
        this.db.exec(createMaiisWorldStateV2Table)
        this.db.exec(createMaiisThemeRankingsTable)
        this.db.exec(createMaiisKeywordRankingsTable)
        this.db.exec(createMaiisActivePicksTable)

        // ── Track A 전용 테이블: LeaderRegime 스냅샷 ————————————————————
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS leader_regime_snapshot (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                snapshot_date TEXT NOT NULL,
                type TEXT NOT NULL,
                name TEXT NOT NULL,
                leader_status TEXT NOT NULL,
                appearances_10d INTEGER DEFAULT 0,
                avg_rank_5d REAL,
                avg_rank_prev5d REAL,
                rank_today INTEGER,
                change_rate_today REAL,
                lifespan_type TEXT,
                confirmed_since TEXT,
                heat_score_60d REAL,
                heat_score_120d REAL,
                stock_avg_heat_60 REAL,
                vol_ratio_5d_20d REAL,
                entry_zone TEXT NOT NULL DEFAULT 'WATCH',
                combined_signal TEXT NOT NULL DEFAULT 'WATCH',
                leading_stocks TEXT,
                ai_summary TEXT,
                created_at TEXT DEFAULT (datetime('now', 'localtime')),
                UNIQUE(snapshot_date, type, name)
            );
        `);
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS portfolio_score_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                snapshot_date TEXT NOT NULL,
                stock_code TEXT NOT NULL,
                stock_name TEXT NOT NULL,
                conviction_score INTEGER,
                last_signal TEXT,
                strategy TEXT,
                analysts_json TEXT,
                theme_sector TEXT,
                theme_regime TEXT,
                sector_regime TEXT,
                market_alpha REAL,
                created_at TEXT DEFAULT (datetime('now', 'localtime')),
                UNIQUE(snapshot_date, stock_code)
            );
        `);
        // ──────────────────────────────────────────────────────────────────
        
        // Portfolio Events Table (Added for Event Logs)
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS maiis_portfolio_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                stock_code TEXT NOT NULL,
                stock_name TEXT,
                event_type TEXT NOT NULL,
                old_status TEXT,
                new_status TEXT,
                price REAL DEFAULT 0,
                profit_rate REAL DEFAULT 0,
                reason TEXT,
                created_at TEXT NOT NULL
            );
        `);

        // Theme Ontology
        const createThemeOntologyTable = `
            CREATE TABLE IF NOT EXISTS theme_ontology (
                raw_tag TEXT PRIMARY KEY,
                macro_category TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
        `
        this.db.exec(createThemeOntologyTable)

        // ═══ V2 Agent Swarm: Market Condition Agent ═══
        const createAgentPredictionsTable = `
            CREATE TABLE IF NOT EXISTS agent_predictions (
                id TEXT PRIMARY KEY,
                date TEXT NOT NULL,
                cycle TEXT NOT NULL,
                predict TEXT NOT NULL,
                position TEXT NOT NULL,
                confidence REAL,
                rationale TEXT,
                sources_json TEXT,
                indicators_json TEXT,
                t1_target_return REAL,
                t5_predict TEXT,
                t5_target_return REAL,
                t20_predict TEXT,
                t20_target_return REAL,
                entry_price REAL,
                t1_peak REAL,
                t1_final REAL,
                t5_peak REAL,
                t5_final REAL,
                t20_peak REAL,
                t20_final REAL,
                feedback TEXT,
                pipelines_used TEXT,
                execution_time_ms INTEGER,
                created_at TEXT NOT NULL,
                raw_context TEXT,
                UNIQUE(date, cycle)
            );
        `

        const createAgentRulesTable = `
            CREATE TABLE IF NOT EXISTS agent_rules (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                agent_type TEXT NOT NULL DEFAULT 'market_condition',
                rule_text TEXT NOT NULL,
                source_prediction_id TEXT,
                is_active INTEGER DEFAULT 1,
                created_at TEXT NOT NULL,
                deactivated_at TEXT
            );
        `

        const createAgentRetrospectivesTable = `
            CREATE TABLE IF NOT EXISTS agent_retrospectives (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                type TEXT NOT NULL, -- 'WEEKLY' | 'MONTHLY'
                target_period TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at TEXT NOT NULL,
                UNIQUE(type, target_period)
            );
        `

        this.db.exec(createAgentPredictionsTable)
        try { this.db.exec("ALTER TABLE agent_predictions ADD COLUMN raw_context TEXT;"); } catch { }
        try { this.db.exec("ALTER TABLE agent_predictions ADD COLUMN t1_target_return REAL;"); } catch { }
        try { this.db.exec("ALTER TABLE agent_predictions ADD COLUMN t5_predict TEXT;"); } catch { }
        try { this.db.exec("ALTER TABLE agent_predictions ADD COLUMN t5_target_return REAL;"); } catch { }
        try { this.db.exec("ALTER TABLE agent_predictions ADD COLUMN t20_predict TEXT;"); } catch { }
        try { this.db.exec("ALTER TABLE agent_predictions ADD COLUMN t20_target_return REAL;"); } catch { }
        try { this.db.exec("ALTER TABLE agent_predictions ADD COLUMN comments_json TEXT;"); } catch { }
        try { this.db.exec("ALTER TABLE agent_predictions ADD COLUMN swarm_sentiment TEXT;"); } catch { }

        this.db.exec(createAgentRulesTable)
        this.db.exec(createAgentRetrospectivesTable)

        // V2 MCA: 장중 인트라데이 예측 테이블
        const createIntradayPredictionsTable = `
            CREATE TABLE IF NOT EXISTS intraday_predictions (
                id TEXT PRIMARY KEY,
                date TEXT NOT NULL,
                time_slot TEXT NOT NULL,
                predict TEXT NOT NULL,
                confidence INTEGER,
                rationale TEXT,
                entry_kospi REAL,
                close_kospi REAL,
                result TEXT,
                position TEXT,
                entry_price REAL,
                close_price REAL,
                return_pct REAL,
                max_price REAL,
                max_return_pct REAL,
                sources_json TEXT,
                created_at TEXT DEFAULT (datetime('now', 'localtime')),
                UNIQUE(date, time_slot)
            );
        `
        this.db.exec(createIntradayPredictionsTable)
        try { this.db.exec("ALTER TABLE intraday_predictions ADD COLUMN max_price REAL;"); } catch { }
        try { this.db.exec("ALTER TABLE intraday_predictions ADD COLUMN max_return_pct REAL;"); } catch { }
        try { this.db.exec("ALTER TABLE intraday_predictions ADD COLUMN image_base64 TEXT;"); } catch { }

        // Phase 2: Persona Performance (AI 댓글 적중률 채점용)
        try {
            const check = this.db.prepare("PRAGMA table_info(persona_performance)").all() as any[];
            if (check.length > 0 && !check.find(c => c.name === 'time_slot')) {
                console.log('[DatabaseService] Migrating persona_performance to add time_slot...');
                this.db.exec("DROP TABLE persona_performance");
            }
        } catch (e) {}

        const createPersonaPerformanceTable = `
            CREATE TABLE IF NOT EXISTS persona_performance (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                date TEXT NOT NULL,
                time_slot TEXT NOT NULL,
                persona_id TEXT NOT NULL,
                predict TEXT NOT NULL,
                actual_result TEXT NOT NULL,
                is_hit INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                UNIQUE(date, time_slot, persona_id)
            );
        `
        this.db.exec(createPersonaPerformanceTable)

        const createAiRunLogsTable = `
            CREATE TABLE IF NOT EXISTS ai_run_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                date TEXT NOT NULL,
                message TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
        `
        this.db.exec(createAiRunLogsTable)

        const createTelegramLogsTable = `
            CREATE TABLE IF NOT EXISTS telegram_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                sender_type TEXT NOT NULL,
                message TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
        `
        this.db.exec(createTelegramLogsTable)

        // 기존 테이블에 새 컬럼 추가 (ALTER TABLE은 이미 존재하면 무시)
        const intradayAlterColumns = ['position', 'entry_price', 'close_price', 'return_pct', 'sources_json', 'comments_json', 'swarm_sentiment']
        for (const col of intradayAlterColumns) {
            try { this.db.exec(`ALTER TABLE intraday_predictions ADD COLUMN ${col} ${['sources_json', 'position', 'comments_json', 'swarm_sentiment'].includes(col) ? 'TEXT' : 'REAL'}`) } catch {}
        }

        // Phase 2.5: AI Analysts Sourcing Pool
        const createAiAnalystPicksTable = `
            CREATE TABLE IF NOT EXISTS ai_analyst_picks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                date TEXT NOT NULL,
                agent_type TEXT NOT NULL,
                stock_code TEXT NOT NULL,
                stock_name TEXT NOT NULL,
                reason TEXT NOT NULL,
                confidence INTEGER DEFAULT 50,
                lifespan_days INTEGER DEFAULT 5,
                created_at TEXT NOT NULL,
                UNIQUE(date, agent_type, stock_code)
            );
        `
        this.db.exec(createAiAnalystPicksTable)

        const createAiDailyRawLogsTable = `
            CREATE TABLE IF NOT EXISTS ai_daily_raw_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                date TEXT NOT NULL,
                agent_type TEXT NOT NULL,
                raw_text TEXT NOT NULL,
                created_at TEXT NOT NULL,
                UNIQUE(date, agent_type)
            );
        `
        this.db.exec(createAiDailyRawLogsTable)

        // Phase 2: Portfolio State Machine
        const createMaiisPortfolioTable = `
            CREATE TABLE IF NOT EXISTS maiis_portfolio (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                stock_code TEXT NOT NULL,
                stock_name TEXT NOT NULL,
                status TEXT DEFAULT 'WATCHLIST',
                strategy TEXT DEFAULT 'SWING',
                conviction_score INTEGER DEFAULT 50,
                theme TEXT,
                entry_price REAL DEFAULT 0,
                current_price REAL DEFAULT 0,
                target_price REAL DEFAULT 0,
                stop_loss_price REAL DEFAULT 0,
                profit_rate REAL DEFAULT 0,
                position_size REAL DEFAULT 0,
                weight_pct REAL DEFAULT 0,
                max_weight_pct REAL DEFAULT 10,
                entry_date TEXT,
                last_signal TEXT,
                last_signal_reason TEXT,
                last_reviewed_at TEXT,
                days_held INTEGER DEFAULT 0,
                source TEXT DEFAULT 'PM_AI',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE(stock_code)
            );
        `
        this.db.exec(createMaiisPortfolioTable)

        // Phase 2.5 Tracker: maiis_portfolio columns for Manager AI
        try { this.db.exec("ALTER TABLE maiis_portfolio ADD COLUMN analysts_json TEXT") } catch (e) { }
        try { this.db.exec("ALTER TABLE maiis_portfolio ADD COLUMN lifespan_days INTEGER DEFAULT 20") } catch (e) { }

        // Phase 2 Tracker: maiis_portfolio columns for NAV engine
        try { this.db.exec("ALTER TABLE maiis_portfolio ADD COLUMN closed_date TEXT") } catch (e) { }
        try { this.db.exec("ALTER TABLE maiis_portfolio ADD COLUMN closed_price REAL DEFAULT 0") } catch (e) { }
        try { this.db.exec("ALTER TABLE maiis_portfolio ADD COLUMN closed_profit_rate REAL DEFAULT 0") } catch (e) { }
        try { this.db.exec("ALTER TABLE maiis_portfolio ADD COLUMN actual_entry_price REAL DEFAULT 0") } catch (e) { }
        try { this.db.exec("ALTER TABLE maiis_portfolio ADD COLUMN entry_shares INTEGER DEFAULT 0") } catch (e) { }
        try { this.db.exec("ALTER TABLE maiis_portfolio ADD COLUMN raw_context TEXT") } catch (e) { }
        try { this.db.exec("ALTER TABLE maiis_portfolio ADD COLUMN invested_amount REAL DEFAULT 0") } catch (e) { }
        try { this.db.exec("ALTER TABLE maiis_portfolio ADD COLUMN entry_pending INTEGER DEFAULT 0") } catch (e) { }

        // Phase 2 Tracker: Daily NAV snapshot table
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS maiis_portfolio_daily (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                date TEXT NOT NULL,
                nav REAL DEFAULT 10000000,
                cash REAL DEFAULT 10000000,
                invested REAL DEFAULT 0,
                portfolio_return REAL DEFAULT 0,
                daily_return REAL DEFAULT 0,
                kospi_close REAL DEFAULT 0,
                kospi_base REAL DEFAULT 0,
                kospi_return REAL DEFAULT 0,
                alpha REAL DEFAULT 0,
                active_count INTEGER DEFAULT 0,
                total_trades INTEGER DEFAULT 0,
                win_count INTEGER DEFAULT 0,
                lose_count INTEGER DEFAULT 0,
                snapshot_json TEXT,
                created_at TEXT NOT NULL,
                UNIQUE(date)
            );
        `)

        // Phase 2 Tracker: Strategy rule columns
        try { this.db.exec("ALTER TABLE maiis_portfolio ADD COLUMN high_price REAL DEFAULT 0") } catch (e) { }
        try { this.db.exec("ALTER TABLE maiis_portfolio ADD COLUMN extension_used INTEGER DEFAULT 0") } catch (e) { }
        try { this.db.exec("ALTER TABLE maiis_portfolio ADD COLUMN deadline_date TEXT") } catch (e) { }

        // Phase 2.5 Tracker: AI Analyst recommendations
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS ai_analyst_picks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                date TEXT NOT NULL,
                agent_type TEXT NOT NULL,
                stock_code TEXT NOT NULL,
                stock_name TEXT NOT NULL,
                reason TEXT,
                confidence INTEGER DEFAULT 50,
                lifespan_days INTEGER DEFAULT 5,
                created_at TEXT NOT NULL,
                UNIQUE(date, agent_type, stock_code)
            );
        `)
        this.db.exec("CREATE INDEX IF NOT EXISTS idx_ai_analyst_picks_date ON ai_analyst_picks(date)")
        
        // Phase 4: Retrospective & Performance Tracking for Analyst Picks
        try { this.db.exec("ALTER TABLE ai_analyst_picks ADD COLUMN entry_price REAL DEFAULT 0") } catch (e) { }
        try { this.db.exec("ALTER TABLE ai_analyst_picks ADD COLUMN target_profit_rate REAL DEFAULT 5.0") } catch (e) { }
        try { this.db.exec("ALTER TABLE ai_analyst_picks ADD COLUMN max_profit_rate REAL") } catch (e) { }
        try { this.db.exec("ALTER TABLE ai_analyst_picks ADD COLUMN evaluation_status TEXT DEFAULT 'PENDING'") } catch (e) { }
        // entry_price 확정 시각 (PM AI 실행 완료 시점의 실시간 현재가 스탬프)
        try { this.db.exec("ALTER TABLE maiis_portfolio ADD COLUMN entry_price_at TEXT") } catch (e) { }
        // was_held: 실제 매수 포지션(HELD)에 진입한 적 있는 종목 마킹 → 성적표 필터 기준
        try { this.db.exec("ALTER TABLE maiis_portfolio ADD COLUMN was_held INTEGER DEFAULT 0") } catch (e) { }

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

        // Migration for maiis_world_state_v2 Phase 3 v3 columns (Delta 구조)
        try { this.db.exec("ALTER TABLE maiis_world_state_v2 ADD COLUMN score_adjustments_json TEXT") } catch (e) { }
        try { this.db.exec("ALTER TABLE maiis_world_state_v2 ADD COLUMN new_alpha_picks_json TEXT") } catch (e) { }
        try { this.db.exec("ALTER TABLE maiis_world_state_v2 ADD COLUMN drop_alpha_picks_json TEXT") } catch (e) { }

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

        // Migration for maiis_keyword_rankings reason column
        try { this.db.exec("ALTER TABLE maiis_keyword_rankings ADD COLUMN reason TEXT") } catch (e) { }

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

        const createAiExecutionLogsTable = `
            CREATE TABLE IF NOT EXISTS ai_execution_logs (
                id TEXT PRIMARY KEY,
                agentId TEXT NOT NULL,
                agentName TEXT NOT NULL,
                triggerType TEXT NOT NULL,
                targetType TEXT NOT NULL,
                status TEXT NOT NULL,
                queuedAt TEXT NOT NULL,
                startedAt TEXT,
                finishedAt TEXT,
                durationMs INTEGER,
                error TEXT,
                prompt TEXT,
                systemInstruction TEXT,
                result TEXT
            );
        `
        this.db.exec(createAiExecutionLogsTable)
        
        try { this.db.exec("ALTER TABLE ai_execution_logs ADD COLUMN prompt TEXT;"); } catch { }
        try { this.db.exec("ALTER TABLE ai_execution_logs ADD COLUMN systemInstruction TEXT;"); } catch { }
        try { this.db.exec("ALTER TABLE ai_execution_logs ADD COLUMN result TEXT;"); } catch { }

        // [HOTFIX] SQLite의 문자열 정렬(DESC) 시 '오전/오후' 한글 문자열로 인해 정렬 오작동이 발생했음.
        // 이를 수정하기 위해 이전 포맷을 사용한 로그들을 삭제하여 테이블 포맷을 초기화합니다.
        try { this.db.exec("DELETE FROM ai_execution_logs WHERE queuedAt LIKE '% %';"); } catch { }

        // ═══ P3-1: Incubator (Pool B) ═══
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS maiis_incubator (
                id TEXT PRIMARY KEY,                     -- 'INC-{stock_code}'
                stock_code TEXT NOT NULL UNIQUE,
                stock_name TEXT NOT NULL,
                source TEXT NOT NULL,                   -- 'THEME_AI'|'MARKET_LEADER'|'FUNDAMENTAL'|'PORTFOLIO_DEMOTED'|'MANUAL'
                source_context TEXT,                    -- 입수 당시 사유 (AI 분석 근거)
                entry_date TEXT NOT NULL,               -- 인큐베이터 편입일
                entry_price REAL DEFAULT 0,             -- 편입 시점 가격
                current_price REAL DEFAULT 0,
                neglect_score INTEGER DEFAULT 0,        -- 소외 지수 0~100 (높을수록 과열 대기)
                volume_ratio REAL DEFAULT 1.0,          -- 최근 거래량 / 20일 평균 거래량
                ma60_disparity REAL DEFAULT 0,          -- MA60 대비 이격도 (%)
                investor_flow TEXT,                     -- 외인/기관 순매수 동향 텍스트
                last_catalyst TEXT,                     -- 마지막 뉴스 촉매
                catalyst_date TEXT,
                status TEXT DEFAULT 'WATCHING',         -- WATCHING|READY_TO_IGNITE|GRADUATED|DROPPED
                ai_evaluation TEXT,                     -- AI 판단 근거
                days_watched INTEGER DEFAULT 0,
                demotion_count INTEGER DEFAULT 0,       -- Pool A에서 강등된 횟수
                original_portfolio_id INTEGER,          -- 강등 시 원본 maiis_portfolio id
                updated_at TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
        `);
        this.db.exec("CREATE INDEX IF NOT EXISTS idx_incubator_status ON maiis_incubator(status);");
        this.db.exec("CREATE INDEX IF NOT EXISTS idx_incubator_score  ON maiis_incubator(neglect_score DESC);");

        // ═══ Track B: 모의매매 (AI 매수 후보 성과 추적) ═══
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS track_b_buy_picks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                pick_date TEXT NOT NULL,
                pick_rank INTEGER NOT NULL,
                stock_code TEXT NOT NULL,
                stock_name TEXT NOT NULL,
                category TEXT NOT NULL,
                signals_json TEXT,
                buy_score INTEGER DEFAULT 0,
                reason TEXT,
                risk TEXT,
                related_themes_json TEXT,
                theme_lifespan TEXT,
                entry_price REAL DEFAULT 0,
                exit_price REAL DEFAULT 0,
                current_price REAL DEFAULT 0,
                holding_days INTEGER DEFAULT 0,
                target_days INTEGER DEFAULT 5,
                target_return_pct REAL DEFAULT 15.0,
                peak_return REAL,
                peak_date TEXT,
                final_return REAL,
                status TEXT DEFAULT 'PENDING',
                result TEXT,
                entry_date TEXT,
                exit_date TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE(pick_date, stock_code)
            );
        `);
        this.db.exec("CREATE INDEX IF NOT EXISTS idx_track_b_picks_date ON track_b_buy_picks(pick_date DESC);");
        this.db.exec("CREATE INDEX IF NOT EXISTS idx_track_b_picks_status ON track_b_buy_picks(status);");
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

    // ═══════════════════════════════════════════════════
    // P3-1: maiis_incubator CRUD
    // ═══════════════════════════════════════════════════

    /** 인큐베이터에 종목 추가 또는 갱신. stock_code가 unique key. */
    public upsertIncubator(item: {
        stock_code: string;
        stock_name: string;
        source: string;
        source_context?: string;
        entry_price?: number;
        original_portfolio_id?: number;
    }): void {
        const now = this.getKstTimestamp();
        const today = this.getKstDate();
        const id = `INC-${item.stock_code}`;
        const existing = this.db.prepare('SELECT id, demotion_count FROM maiis_incubator WHERE stock_code = ?').get(item.stock_code) as any;

        if (existing) {
            // 이미 존재하면 source_context와 demotion_count만 갱신
            const demotionCount = (item.source === 'PORTFOLIO_DEMOTED') ? (existing.demotion_count + 1) : existing.demotion_count;
            this.db.prepare(`
                UPDATE maiis_incubator
                SET source = @source, source_context = @source_context,
                    status = 'WATCHING', neglect_score = 0,
                    demotion_count = @demotion_count,
                    original_portfolio_id = COALESCE(@original_portfolio_id, original_portfolio_id),
                    updated_at = @updated_at
                WHERE stock_code = @stock_code
            `).run({
                source: item.source,
                source_context: item.source_context || null,
                demotion_count: demotionCount,
                original_portfolio_id: item.original_portfolio_id || null,
                updated_at: now,
                stock_code: item.stock_code
            });
            console.log(`[Incubator] ♻️  기존 인큐베이터 종목 재편입: ${item.stock_name} (강등 누적: ${demotionCount}회)`);
        } else {
            this.db.prepare(`
                INSERT INTO maiis_incubator
                (id, stock_code, stock_name, source, source_context, entry_date, entry_price,
                 status, days_watched, demotion_count, original_portfolio_id, updated_at, created_at)
                VALUES
                (@id, @stock_code, @stock_name, @source, @source_context, @entry_date, @entry_price,
                 'WATCHING', 0, @demotion_count, @original_portfolio_id, @updated_at, @created_at)
            `).run({
                id,
                stock_code: item.stock_code,
                stock_name: item.stock_name,
                source: item.source,
                source_context: item.source_context || null,
                entry_date: today,
                entry_price: item.entry_price || 0,
                demotion_count: item.source === 'PORTFOLIO_DEMOTED' ? 1 : 0,
                original_portfolio_id: item.original_portfolio_id || null,
                updated_at: now,
                created_at: now
            });
            console.log(`[Incubator] 🧪 신규 인큐베이터 편입: ${item.stock_name} (출처: ${item.source})`);
        }
    }

    /** 인큐베이터 전체 목록 조회 */
    public getIncubatorList(status?: string): any[] {
        if (status) {
            return this.db.prepare('SELECT * FROM maiis_incubator WHERE status = ? ORDER BY neglect_score DESC').all(status) as any[];
        }
        return this.db.prepare(`
            SELECT * FROM maiis_incubator
            WHERE status NOT IN ('GRADUATED', 'DROPPED')
            ORDER BY neglect_score DESC, days_watched DESC
        `).all() as any[];
    }

    /** 개별 종목 조회 */
    public getIncubatorByCode(stock_code: string): any | null {
        return this.db.prepare('SELECT * FROM maiis_incubator WHERE stock_code = ?').get(stock_code) as any;
    }

    /** neglect_score 및 기술적 지표 일괄 갱신 (P3-3 스캔 엔진에서 호출) */
    public updateIncubatorScore(stock_code: string, data: {
        current_price: number;
        neglect_score: number;
        volume_ratio: number;
        ma60_disparity: number;
        investor_flow?: string;
        last_catalyst?: string;
        catalyst_date?: string;
    }): void {
        const now = this.getKstTimestamp();
        this.db.prepare(`
            UPDATE maiis_incubator
            SET current_price    = @current_price,
                neglect_score    = @neglect_score,
                volume_ratio     = @volume_ratio,
                ma60_disparity   = @ma60_disparity,
                investor_flow    = COALESCE(@investor_flow, investor_flow),
                last_catalyst    = COALESCE(@last_catalyst, last_catalyst),
                catalyst_date    = COALESCE(@catalyst_date, catalyst_date),
                days_watched     = days_watched + 1,
                updated_at       = @updated_at
            WHERE stock_code = @stock_code
        `).run({ ...data, investor_flow: data.investor_flow || null, last_catalyst: data.last_catalyst || null, catalyst_date: data.catalyst_date || null, updated_at: now, stock_code });
    }

    /** 상태 변경 (WATCHING → READY_TO_IGNITE → GRADUATED / DROPPED) */
    public updateIncubatorStatus(stock_code: string, status: string, ai_evaluation?: string): void {
        const now = this.getKstTimestamp();
        this.db.prepare(`
            UPDATE maiis_incubator
            SET status = @status,
                ai_evaluation = COALESCE(@ai_evaluation, ai_evaluation),
                updated_at = @updated_at
            WHERE stock_code = @stock_code
        `).run({ status, ai_evaluation: ai_evaluation || null, updated_at: now, stock_code });
    }

    /** IGNITE 완료 처리 (Pool A로 졸업) */
    public graduateIncubator(stock_code: string): void {
        this.updateIncubatorStatus(stock_code, 'GRADUATED', '✅ IGNITE → Pool A 승격');
    }

    /** Pool A DROP 시 인큐베이터로 자동 이관 (P3-6에서 호출) */
    public demoteToIncubator(portfolioItem: {
        stock_code: string;
        stock_name: string;
        current_price: number;
        last_signal_reason?: string;
        id?: number;
    }): void {
        this.upsertIncubator({
            stock_code: portfolioItem.stock_code,
            stock_name: portfolioItem.stock_name,
            source: 'PORTFOLIO_DEMOTED',
            source_context: portfolioItem.last_signal_reason || 'PM DROP 후 테마 생존 감지',
            entry_price: portfolioItem.current_price,
            original_portfolio_id: portfolioItem.id
        });
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
        const risingStocks = this.db.prepare(`
            SELECT 
                date, 
                '수급 급등주 AI' as agent_type, 
                ai_score as score, 
                reason, 
                chart_insight, 
                past_reference,
                date || ' ' || timing as sort_time
            FROM daily_rising_stocks 
            WHERE stock_code = ?
        `).all(stockCode) as any[];

        const analystPicks = this.db.prepare(`
            SELECT 
                date, 
                agent_type, 
                confidence as score, 
                reason, 
                null as chart_insight, 
                null as past_reference,
                created_at as sort_time
            FROM ai_analyst_picks 
            WHERE stock_code = ?
        `).all(stockCode) as any[];

        const combined = [...risingStocks, ...analystPicks.map(p => ({
            ...p,
            agent_type: p.agent_type === 'THEME' ? '테마 AI' : 
                        p.agent_type === 'REPORT' ? '리포트 AI' : 
                        p.agent_type === 'MOMENTUM' ? '수급 AI (모멘텀)' : p.agent_type
        }))];

        // 최신순 정렬
        combined.sort((a, b) => b.sort_time.localeCompare(a.sort_time));

        return combined;
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

    public upsertNaverResearchFlow(data: any[]): number {
        try {
            const stmt = this.db.prepare(`
                INSERT OR REPLACE INTO naver_research_flow (
                    date, rank, industry_name, report_title, analyst, broker, content_snippet, url, collected_at
                ) VALUES (@date, @rank, @industry_name, @report_title, @analyst, @broker, @content_snippet, @url, @collected_at)
            `);
            const insertMany = this.db.transaction((items: any[]) => {
                for (const item of items) stmt.run(item);
            });
            insertMany(data);
            return data.length;
        } catch (e) {
            console.error('[DatabaseService] upsertNaverResearchFlow Error:', e);
            throw e;
        }
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

    // === Phase 2.5: Portfolio Manager & Analysts Methods ===
    public saveAiAnalystPicks(picks: any[]) {
        try {
            const stmt = this.db.prepare(`
                INSERT INTO ai_analyst_picks (
                    date, agent_type, stock_code, stock_name, reason, confidence, lifespan_days, created_at, entry_price, target_profit_rate, evaluation_status
                ) VALUES (
                    @date, @agent_type, @stock_code, @stock_name, @reason, @confidence, @lifespan_days, @created_at, @entry_price, @target_profit_rate, @evaluation_status
                )
                ON CONFLICT(date, agent_type, stock_code) DO UPDATE SET
                    reason = excluded.reason,
                    confidence = excluded.confidence,
                    lifespan_days = excluded.lifespan_days,
                    entry_price = COALESCE(NULLIF(excluded.entry_price, 0), ai_analyst_picks.entry_price),
                    created_at = excluded.created_at
            `);
            const insertMany = this.db.transaction((items: any[]) => {
                for (const item of items) {
                    stmt.run({
                        ...item,
                        entry_price: item.entry_price || 0,
                        target_profit_rate: item.target_profit_rate || 5.0,
                        evaluation_status: item.evaluation_status || 'PENDING'
                    });
                }
            });
            insertMany(picks);
            return picks.length;
        } catch (e) {
            console.error('[DatabaseService] saveAiAnalystPicks Error:', e);
            throw e;
        }
    }

    public getAiAnalystPicksByDate(date: string) {
        return this.db.prepare('SELECT * FROM ai_analyst_picks WHERE date = ?').all(date);
    }

    public getLatestAiAnalystPicks() {
        const row = this.db.prepare('SELECT MAX(date) as max_date FROM ai_analyst_picks').get() as any;
        if (!row || !row.max_date) return [];
        return this.getAiAnalystPicksByDate(row.max_date);
    }

    public saveAiDailyRawLog(date: string, agent_type: string, raw_text: string) {
        try {
            const stmt = this.db.prepare(`
                INSERT OR REPLACE INTO ai_daily_raw_logs (date, agent_type, raw_text, created_at)
                VALUES (@date, @agent_type, @raw_text, @created_at)
            `);
            stmt.run({ date, agent_type, raw_text, created_at: this.getKstTimestamp() });
        } catch (e) {
            console.error('[DatabaseService] saveAiDailyRawLog Error:', e);
        }
    }

    public getAiDailyRawLog(date: string, agent_type: string) {
        return this.db.prepare('SELECT raw_text FROM ai_daily_raw_logs WHERE date = ? AND agent_type = ?').get(date, agent_type) as { raw_text: string } | undefined;
    }

    public upsertPortfolioWatchlist(item: any) {
        // 시그널 타입이 아닌 실제 포지션(팩트) 기반 분류
        const isWatchStatus = item.status === 'WATCHING';
        const isHeldStatus = item.status === 'HELD';

        // 관심종목은 진입가 세팅 안 함
        const safeEntryPrice = isWatchStatus ? 0 : (item.entry_price || 0);

        // 관심종목은 수명 없음(NULL) / 매수 포지션 전환 시에만 전략별 수명 확정
        const safeLifespanDays = isWatchStatus ? null : (item.lifespan_days || null);

        const stmt = this.db.prepare(`
            INSERT INTO maiis_portfolio (
                stock_code, stock_name, status, strategy, conviction_score, theme, 
                entry_date, last_signal, last_signal_reason, analysts_json, lifespan_days,
                last_reviewed_at, created_at, updated_at, raw_context, current_price, entry_price, entry_price_at, was_held
            ) VALUES (
                @stock_code, @stock_name, @status, @strategy, @conviction_score, @theme,
                @entry_date, @last_signal, @last_signal_reason, @analysts_json, @lifespan_days,
                @last_reviewed_at, @created_at, @updated_at, @raw_context, @current_price, @entry_price, @entry_price_at, @was_held
            )
            ON CONFLICT(stock_code) DO UPDATE SET
                status = excluded.status,
                conviction_score = excluded.conviction_score,
                theme = excluded.theme,
                last_signal = excluded.last_signal,
                last_signal_reason = excluded.last_signal_reason,
                analysts_json = excluded.analysts_json,
                last_reviewed_at = excluded.last_reviewed_at,
                updated_at = excluded.updated_at,
                raw_context = excluded.raw_context,
                current_price = excluded.current_price,
                lifespan_days = CASE
                    WHEN excluded.status = 'HELD'
                    THEN excluded.lifespan_days
                    ELSE NULL
                END,
                days_held = CASE
                    WHEN excluded.status = 'HELD' AND maiis_portfolio.status != 'HELD'
                    THEN 0
                    WHEN excluded.status != 'HELD'
                    THEN 0
                    ELSE maiis_portfolio.days_held
                END,
                entry_price = CASE
                    WHEN excluded.status = 'HELD' AND maiis_portfolio.status != 'HELD'
                    THEN excluded.entry_price
                    ELSE maiis_portfolio.entry_price  -- WATCHING 등 비매수 상태에서는 절대 덮어쓰지 않음
                END,
                entry_date = CASE
                    WHEN excluded.status = 'HELD' AND maiis_portfolio.status != 'HELD'
                    THEN excluded.entry_date
                    ELSE maiis_portfolio.entry_date
                END,
                entry_price_at = CASE
                    WHEN excluded.entry_price > 0 AND maiis_portfolio.entry_price = 0
                    THEN excluded.entry_price_at
                    ELSE maiis_portfolio.entry_price_at
                END,
                was_held = CASE
                    WHEN excluded.status = 'HELD' THEN 1  -- HELD 전환 시 영구 마킹
                    ELSE maiis_portfolio.was_held           -- 기존 값 보존 (한 번 매수한 종목은 영원히 was_held = 1)
                END
        `);
        stmt.run({
            ...item,
            analysts_json: typeof item.analysts_json === 'string' ? item.analysts_json : JSON.stringify(item.analysts_json || []),
            created_at: item.created_at || this.getKstTimestamp(),
            updated_at: this.getKstTimestamp(),
            last_reviewed_at: this.getKstTimestamp(),
            raw_context: item.raw_context || null,
            current_price: item.current_price || 0,
            lifespan_days: safeLifespanDays,
            entry_price: safeEntryPrice,
            entry_price_at: safeEntryPrice > 0 ? (item.entry_price_at || this.getKstTimestamp()) : null,
            was_held: isHeldStatus ? 1 : 0  // INSERT 신규 등록 시 초기값
        });

        // [추가] 관심종목 및 매수포지션 캡(Quota) 적용
        this.enforcePortfolioCaps();
    }

    private enforcePortfolioCaps() {
        try {
            const aiSettings: any = store.get('ai_settings') || {};
            const limits = aiSettings.portfolioLimits || {
                buy: { MOMENTUM: 2, PULLBACK: 2, SWING: 4, VALUE: 2 },
                watchlist: { MOMENTUM: 3, PULLBACK: 3, SWING: 6, VALUE: 3 }
            };

            const strategies = ['MOMENTUM', 'PULLBACK', 'SWING', 'VALUE'];
            const types = ['HELD', 'WATCHING'];

            for (const type of types) {
                const signalCondition = type === 'HELD' ? "status = 'HELD'" : "status = 'WATCHING'";
                // status 자체가 조건이므로 중복되지만, 캡슐화 논리를 위해 남김
                const statusCondition = "status NOT IN ('CLEARED', 'DROPPED', 'HIT')"; 

                for (const strategy of strategies) {
                    const maxCount = type === 'HELD' ? (limits.buy[strategy] || 0) : (limits.watchlist[strategy] || 0);

                    const countRow = this.db.prepare(`
                        SELECT COUNT(*) as cnt 
                        FROM maiis_portfolio 
                        WHERE ${statusCondition} AND ${signalCondition} AND 
                        CASE WHEN UPPER(strategy) IN ('MOMENTUM', 'PULLBACK', 'VALUE') THEN UPPER(strategy) ELSE 'SWING' END = ?
                    `).get(strategy) as any;

                    if (countRow && countRow.cnt > maxCount) {
                        const excess = countRow.cnt - maxCount;
                        const excessItems = this.db.prepare(`
                            SELECT stock_code, stock_name FROM maiis_portfolio 
                            WHERE ${statusCondition} AND ${signalCondition} AND 
                            CASE WHEN UPPER(strategy) IN ('MOMENTUM', 'PULLBACK', 'VALUE') THEN UPPER(strategy) ELSE 'SWING' END = ?
                            ORDER BY conviction_score ASC, updated_at ASC
                            LIMIT ?
                        `).all(strategy, excess) as any[];

                        if (excessItems.length > 0) {
                            const codes = excessItems.map((r: any) => `'${r.stock_code.replace(/'/g, "''")}'`).join(',');
                            const info = this.db.prepare(`
                                UPDATE maiis_portfolio 
                                SET status = 'DROPPED', updated_at = ?
                                WHERE stock_code IN (${codes})
                            `).run(this.getKstTimestamp());
                            
                            // [수정] DROP된 종목을 인큐베이터로 강등 처리
                            excessItems.forEach((r: any) => {
                                this.demoteToIncubator({
                                    stock_code: r.stock_code,
                                    stock_name: r.stock_name || '알수없음',  // join 안했으므로 db조회 필요
                                    current_price: 0,
                                    last_signal_reason: '관심종목 캡 한도 초과 자동 탈락'
                                });
                            });

                            console.log(`[DatabaseService] ✂️ 용량 설정 (Cap ${maxCount}) 초과로 ${info.changes}개 자동 DROPPED 및 인큐베이터 이관. (${type} - ${strategy})`);
                        }
                    }
                }
            }
        } catch (e) {
            console.error(`[DatabaseService] 포트폴리오 전략별 Cap 검사 중 오류:`, e);
        }
    }

    public getActivePortfolio() {
        return this.db.prepare("SELECT * FROM maiis_portfolio WHERE status NOT IN ('DROPPED', 'HIT') ORDER BY conviction_score DESC").all();
    }

    /**
     * 장마감 채점(Judge)용 — 매수 포지션(HELD)만 반환
     * WATCHING(관심종목)은 profit_rate 계산/갱신 대상이 아님
     */
    public getBuyPositionPortfolio() {
        return this.db.prepare(
            "SELECT * FROM maiis_portfolio WHERE status = 'HELD' ORDER BY conviction_score DESC"
        ).all();
    }

    public getPortfolioHistory() {
        // was_held = 1 인 종목만 반환 — 관심종목(WATCHING)에서 탈락한 종목은 성적표 제외
        return this.db.prepare("SELECT * FROM maiis_portfolio WHERE status IN ('DROPPED', 'HIT') AND was_held = 1 ORDER BY updated_at DESC LIMIT 100").all();
    }

    /**
     * 관심종목 중 진입가/수익률이 잘못 기록된 레코드를 일괄 초기화
     * → entry_price, profit_rate, days_held를 0으로 리셋하고 상태를 WATCHING으로 복구
     * @returns { fixed: number } 수정된 레코드 수
     */
    public cleanupWatchlistEntryPrices(): { fixed: number } {
        const info = this.db.prepare(`
            UPDATE maiis_portfolio
            SET
                entry_price    = 0,
                entry_price_at = NULL,
                profit_rate    = 0,
                days_held      = 0,
                status         = 'WATCHING',
                updated_at     = ?
            WHERE
                status = 'WATCHING'
                AND (entry_price > 0 OR profit_rate != 0)
        `).run(this.getKstTimestamp());

        console.log(`[DB] cleanupWatchlistEntryPrices: ${info.changes}건 초기화 완료`);
        return { fixed: info.changes };
    }

    public getPortfolioStocksCount() {
        const row = this.db.prepare("SELECT COUNT(*) as cnt FROM maiis_portfolio WHERE status NOT IN ('DROPPED', 'HIT')").get() as any;
        return row ? row.cnt : 0;
    }

    // ── 개별 항목 삭제 ──────────────────────────────────────────────────────

    /** 포트폴리오 (매수 포지션 / 관심종목 / 성적표) 단건 삭제 */
    public deletePortfolioItem(id: number): { deleted: boolean } {
        const info = this.db.prepare('DELETE FROM maiis_portfolio WHERE id = ?').run(id);
        console.log(`[DB] deletePortfolioItem: id=${id}, changes=${info.changes}`);
        return { deleted: info.changes > 0 };
    }

    /** 포트폴리오 이벤트 로그(타임라인) 단건 수동 삭제 */
    public deletePortfolioEventLog(id: number): { deleted: boolean } {
        const info = this.db.prepare('DELETE FROM maiis_portfolio_events WHERE id = ?').run(id);
        console.log(`[DB] deletePortfolioEventLog: id=${id}, changes=${info.changes}`);
        return { deleted: info.changes > 0 };
    }

    /** 추천종목(ai_analyst_picks) 단건 삭제 */
    public deleteAnalystPick(id: number): { deleted: boolean } {
        const info = this.db.prepare('DELETE FROM ai_analyst_picks WHERE id = ?').run(id);
        console.log(`[DB] deleteAnalystPick: id=${id}, changes=${info.changes}`);
        return { deleted: info.changes > 0 };
    }

    /** 인큐베이터(incubator_pool) 단건 삭제 */
    public deleteIncubatorItem(stock_code: string): { deleted: boolean } {
        const info = this.db.prepare('DELETE FROM incubator_pool WHERE stock_code = ?').run(stock_code);
        console.log(`[DB] deleteIncubatorItem: code=${stock_code}, changes=${info.changes}`);
        return { deleted: info.changes > 0 };
    }


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

    public deleteIncubatorItemByCode(stockCode: string) {
        const stmt = this.db.prepare('DELETE FROM maiis_incubator WHERE stock_code = ?')
        const info = stmt.run(stockCode)
        return { deleted: info.changes > 0 }
    }

    public syncPortfolioEntryPrice(stockCode: string, price: number, entryDate: string): { success: boolean; error?: string } {
        try {
            const stmt = this.db.prepare(`
                UPDATE maiis_portfolio 
                SET entry_price = ?, current_price = ?, entry_date = ?
                WHERE stock_code = ?
            `)
            stmt.run(price, price, entryDate, stockCode)
            return { success: true }
        } catch (e: any) {
            return { success: false, error: e.message }
        }
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
    public saveAiRunLog(message: string) {
        try {
            this.db.prepare("INSERT INTO ai_run_logs (date, message, created_at) VALUES (date('now', 'localtime'), ?, DATETIME('now', 'localtime'))").run(message);
        } catch (e) {
            console.error('[DB] Failed to save ai_run_log:', e);
        }
    }

    public getAiRunLogs(): string[] {
        try {
            const rows = this.db.prepare("SELECT message FROM ai_run_logs WHERE date >= date('now', 'localtime', '-1 days') ORDER BY id ASC").all() as any[];
            return rows.map(r => r.message);
        } catch (e) {
            console.error('[DB] Failed to get ai_run_logs:', e);
            return [];
        }
    }

    public clearAiRunLogs() {
        try {
            this.db.prepare('DELETE FROM ai_run_logs').run();
        } catch (e) {}
    }

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

    /** [MAIIS 통합] 최근 N일간 도메인 인사이트 히스토리 (차트/트렌드용) */
    public getMaiisDomainInsightsHistory(domainType: string, days: number = 14) {
        return this.db.prepare(`
            SELECT * FROM maiis_domain_insights 
            WHERE domain_type = ? 
            ORDER BY date DESC, created_at DESC 
            LIMIT ?
        `).all(domainType, days);
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

    // ==========================================
    // Master AI (Phase 3) 전용 DB 메서드
    // ==========================================

    public saveMasterWorldState(date: string, timing: string, data: any) {
        const stmt = this.db.prepare(`
            INSERT OR REPLACE INTO maiis_world_state_v2 
            (date, timing, market_thesis, sentiment_score, 
             score_adjustments_json, new_alpha_picks_json, drop_alpha_picks_json, 
             self_reflection, raw_json, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        stmt.run(
            date, 
            timing, 
            data.market_thesis || null, 
            data.sentiment_score || null,
            JSON.stringify(data.score_adjustments || []),
            JSON.stringify(data.new_alpha_picks || []),
            JSON.stringify(data.drop_alpha_picks || []),
            data.self_reflection || null,
            JSON.stringify(data),
            new Date().toISOString()
        );
    }

    public getMasterWorldState(date: string, timing: string) {
        return this.db.prepare(`SELECT * FROM maiis_world_state_v2 WHERE date = ? AND timing = ?`).get(date, timing) as any;
    }

    public getActiveThemeRankings(date: string) {
        return this.db.prepare(`SELECT * FROM maiis_theme_rankings WHERE date = ? ORDER BY final_score DESC LIMIT 10`).all(date) as any[];
    }

    public getActivePicks() {
        return this.db.prepare(`SELECT * FROM maiis_active_picks WHERE status = 'ACTIVE'`).all() as any[];
    }

    /**
     * 어제(혹은 가장 최근 영업일)의 장마감(1530) 오답 노트(Reflection)를 반환합니다.
     */
    public getRecentReflection(date: string) {
        return this.db.prepare(`
            SELECT * FROM maiis_world_state_v2 
            WHERE date < ? AND timing = '1530' 
            ORDER BY date DESC LIMIT 1
        `).get(date) as any || null;
    }

    // ──────────────────────────────────────────────
    // Phase 2: Portfolio State Machine CRUD
    // ──────────────────────────────────────────────

    public getPortfolio() {
        return this.db.prepare('SELECT * FROM maiis_portfolio ORDER BY conviction_score DESC').all() as any[];
    }

    public getPortfolioByStatus(status: string) {
        return this.db.prepare('SELECT * FROM maiis_portfolio WHERE status = ? ORDER BY conviction_score DESC').all(status) as any[];
    }

    public getPortfolioItem(stockCode: string) {
        return this.db.prepare('SELECT * FROM maiis_portfolio WHERE stock_code = ?').get(stockCode) as any | undefined;
    }

    public upsertPortfolioItem(item: any) {
        const now = new Date().toISOString();
        return this.db.prepare(`
            INSERT INTO maiis_portfolio (
                stock_code, stock_name, status, strategy, conviction_score, theme,
                entry_price, current_price, target_price, stop_loss_price,
                profit_rate, position_size, weight_pct, max_weight_pct,
                entry_date, last_signal, last_signal_reason, last_reviewed_at,
                days_held, source, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(stock_code) DO UPDATE SET
                status = excluded.status,
                strategy = excluded.strategy,
                conviction_score = excluded.conviction_score,
                theme = excluded.theme,
                current_price = excluded.current_price,
                target_price = excluded.target_price,
                stop_loss_price = excluded.stop_loss_price,
                profit_rate = excluded.profit_rate,
                last_signal = excluded.last_signal,
                last_signal_reason = excluded.last_signal_reason,
                last_reviewed_at = excluded.last_reviewed_at,
                days_held = excluded.days_held,
                updated_at = excluded.updated_at
        `).run(
            item.stock_code, item.stock_name, item.status || 'WATCHLIST',
            item.strategy || 'SWING', item.conviction_score || 50, item.theme || '',
            item.entry_price || 0, item.current_price || 0,
            item.target_price || 0, item.stop_loss_price || 0,
            item.profit_rate || 0, item.position_size || 0,
            item.weight_pct || 0, item.max_weight_pct || 10,
            item.entry_date || '', item.last_signal || '',
            item.last_signal_reason || '', now,
            item.days_held || 0, item.source || 'PM_AI',
            now, now
        );
    }

    public updatePortfolioStatus(stockCode: string, status: string, reason?: string) {
        const now = new Date().toISOString();
        // HELD 상태로 전환될 때 was_held = 1 마킹 (한 번 매수 포지션이었던 종목임을 영구 기록)
        if (status === 'HELD') {
            this.db.prepare(`
                UPDATE maiis_portfolio
                SET status = ?, last_signal = ?, last_signal_reason = ?, updated_at = ?, was_held = 1
                WHERE stock_code = ?
            `).run(status, status, reason || '', now, stockCode);
        } else {
            // DROPPED/HIT 등 다른 상태 전환 시에는 was_held를 건드리지 않음
            this.db.prepare(`
                UPDATE maiis_portfolio
                SET status = ?, last_signal = ?, last_signal_reason = ?, updated_at = ?
                WHERE stock_code = ?
            `).run(status, status, reason || '', now, stockCode);
        }
    }

    public logPortfolioEvent(stockCode: string, stockName: string, eventType: string, oldStatus: string | null, newStatus: string, reason: string, price: number) {
        try {
            const pf = this.getPortfolioItem(stockCode);
            const profitRate = pf ? pf.profit_rate : 0;
            this.db.prepare(`
                INSERT INTO maiis_portfolio_events (stock_code, stock_name, event_type, old_status, new_status, price, profit_rate, reason, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(stockCode, stockName, eventType, oldStatus, newStatus, price, profitRate, reason, this.getKstTimestamp());
        } catch (e) {
            console.error('[DB] Failed to log portfolio event:', e);
        }
    }

    public getPortfolioEventLogs(stockCode: string) {
        try {
            return this.db.prepare('SELECT * FROM maiis_portfolio_events WHERE stock_code = ? ORDER BY created_at DESC').all(stockCode) as any[];
        } catch (e) {
            console.error('[DB] Failed to fetch portfolio event logs:', e);
            return [];
        }
    }

    // ──────────────────────────────────────────────
    // Phase 2.5: AI Analyst Picks CRUD
    // ──────────────────────────────────────────────



    // ──────────────────────────────────────────────
    // Phase 2 Tracker: NAV & Daily Snapshot CRUD
    // ──────────────────────────────────────────────



    public getClosedPortfolio() {
        return this.db.prepare(
            "SELECT * FROM maiis_portfolio WHERE status = 'CLOSED' ORDER BY closed_date DESC"
        ).all() as any[];
    }

    public closePortfolioItem(stockCode: string, closedPrice: number, closedDate: string) {
        const now = new Date().toISOString();
        const item = this.getPortfolioItem(stockCode);
        if (!item) return;
        const entryPrice = item.actual_entry_price || item.entry_price || 0;
        const closedProfitRate = entryPrice > 0 ? ((closedPrice / entryPrice) - 1) * 100 : 0;
        return this.db.prepare(`
            UPDATE maiis_portfolio SET
                status = 'CLOSED', closed_date = ?, closed_price = ?,
                closed_profit_rate = ?, current_price = ?, profit_rate = ?,
                last_signal = 'SELL', updated_at = ?
            WHERE stock_code = ?
        `).run(closedDate, closedPrice, closedProfitRate, closedPrice, closedProfitRate, now, stockCode);
    }

    public upsertDailySnapshot(snap: any) {
        const now = new Date().toISOString();
        return this.db.prepare(`
            INSERT INTO maiis_portfolio_daily (
                date, nav, cash, invested, portfolio_return, daily_return,
                kospi_close, kospi_base, kospi_return, alpha,
                active_count, total_trades, win_count, lose_count,
                snapshot_json, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(date) DO UPDATE SET
                nav = excluded.nav, cash = excluded.cash, invested = excluded.invested,
                portfolio_return = excluded.portfolio_return, daily_return = excluded.daily_return,
                kospi_close = excluded.kospi_close, kospi_return = excluded.kospi_return,
                alpha = excluded.alpha, active_count = excluded.active_count,
                total_trades = excluded.total_trades, win_count = excluded.win_count,
                lose_count = excluded.lose_count, snapshot_json = excluded.snapshot_json
        `).run(
            snap.date, snap.nav, snap.cash, snap.invested,
            snap.portfolio_return, snap.daily_return,
            snap.kospi_close, snap.kospi_base, snap.kospi_return, snap.alpha,
            snap.active_count, snap.total_trades, snap.win_count, snap.lose_count,
            snap.snapshot_json || null, now
        );
    }

    public getDailySnapshots(limit = 90) {
        return this.db.prepare(
            'SELECT * FROM maiis_portfolio_daily ORDER BY date ASC LIMIT ?'
        ).all(limit) as any[];
    }

    public getLatestDailySnapshot() {
        return this.db.prepare(
            'SELECT * FROM maiis_portfolio_daily ORDER BY date DESC LIMIT 1'
        ).get() as any | undefined;
    }

    public getPortfolioStats() {
        const closed = this.getClosedPortfolio();
        const active = this.getActivePortfolio();
        const latestSnap = this.getLatestDailySnapshot();
        const wins = closed.filter(c => (c.closed_profit_rate || 0) > 0).length;
        const losses = closed.filter(c => (c.closed_profit_rate || 0) <= 0).length;
        const avgHoldDays = closed.length > 0
            ? closed.reduce((sum: number, c: any) => sum + (c.days_held || 0), 0) / closed.length
            : 0;
        const bestTrade = closed.reduce((best: any, c: any) => 
            (!best || (c.closed_profit_rate || 0) > (best.closed_profit_rate || 0)) ? c : best, null);
        const worstTrade = closed.reduce((worst: any, c: any) => 
            (!worst || (c.closed_profit_rate || 0) < (worst.closed_profit_rate || 0)) ? c : worst, null);

        return {
            totalReturn: latestSnap?.portfolio_return || 0,
            currentNAV: latestSnap?.nav || 10_000_000,
            alpha: latestSnap?.alpha || 0,
            winRate: (wins + losses) > 0 ? (wins / (wins + losses)) * 100 : 0,
            wins,
            losses,
            avgHoldDays: Math.round(avgHoldDays * 10) / 10,
            activeCount: active.length,
            totalTrades: closed.length,
            bestTrade: bestTrade ? { name: bestTrade.stock_name, profit: bestTrade.closed_profit_rate } : null,
            worstTrade: worstTrade ? { name: worstTrade.stock_name, profit: worstTrade.closed_profit_rate } : null,
        };
    }

    public upsertNaverMarketFlow(flows: { date: string, type: string, rank_num: number, name: string, change_rate: number }[]) {
        if (flows.length === 0) return;

        const deleteStmt = this.db.prepare(`DELETE FROM naver_market_flow WHERE date = ? AND type = ?`);
        const insertStmt = this.db.prepare(`
            INSERT OR REPLACE INTO naver_market_flow (date, type, rank_num, name, change_rate)
            VALUES (@date, @type, @rank_num, @name, @change_rate)
        `);

        // Get unique date/type combinations
        const groups = [...new Set(flows.map(f => `${f.date}|${f.type}`))];

        const replaceMany = this.db.transaction((items) => {
            // 날짜당 가장 최신 정보만 남기기 위해 기존 데이터 삭제
            for (const g of groups) {
                const [date, type] = g.split('|');
                deleteStmt.run(date, type);
            }
            // 최신 데이터 삽입
            for (const item of items) {
                insertStmt.run(item);
            }
        });
        
        replaceMany(flows);
    }

    /** 네이버 어휘 사전: 파이프라인에서 수집한 업종/테마 이름을 누적 저장 (삭제 없음) */
    public upsertNaverVocabulary(items: { name: string, type: string, date: string }[]) {
        if (items.length === 0) return;
        const stmt = this.db.prepare(`
            INSERT INTO naver_vocabulary (name, type, first_seen, last_seen, times_appeared)
            VALUES (@name, @type, @date, @date, 1)
            ON CONFLICT(name, type) DO UPDATE SET
                last_seen = @date,
                times_appeared = times_appeared + 1
        `);
        const tx = this.db.transaction((rows: any[]) => { for (const r of rows) stmt.run(r); });
        tx(items);
    }

    /** 이슈 AI 프롬프트 주입용: 전체 어휘 목록 반환 (type별 필터 가능) */
    public getNaverVocabulary(type?: 'SECTOR' | 'THEME'): { name: string, type: string, last_seen: string }[] {
        if (type) {
            return this.db.prepare(`SELECT name, type, last_seen FROM naver_vocabulary WHERE type = ? ORDER BY times_appeared DESC`).all(type) as any[];
        }
        return this.db.prepare(`SELECT name, type, last_seen FROM naver_vocabulary ORDER BY type, times_appeared DESC`).all() as any[];
    }

    public getRecentNaverMarketFlows(type: string, limitDays: number = 5) {
        return this.db.prepare(`
            SELECT * FROM naver_market_flow 
            WHERE type = ? 
            ORDER BY date DESC, rank_num ASC
        `).all(type) as any[]
    }

    public getThemeTrackerData(type: string, targetDate: string, limitDays: number = 14, topN: number = 5) {
        // 1) Get recent distinct trading dates
        const dates = this.db.prepare(`
            SELECT DISTINCT date FROM naver_market_flow
            WHERE type = ? AND date <= ?
            ORDER BY date DESC LIMIT ?
        `).all(type, targetDate, limitDays + 1) as {date: string}[];
        
        if (dates.length === 0) return { current: [], topNames: [], trendData: [], date: targetDate };

        const latestDate = dates[0].date;
        const prevDate = dates.length > 1 ? dates[1].date : null;
        
        // 2) Load history data
        const historyData = this.db.prepare(`
            SELECT * FROM naver_market_flow 
            WHERE type = ? AND date IN (${dates.map(()=>'?').join(',')})
            ORDER BY date DESC, rank_num ASC
        `).all(type, ...dates.map(d => d.date)) as any[];

        // 3) Calculate current vs prev
        const latestItems = historyData.filter(d => d.date === latestDate);
        const prevItems = prevDate ? historyData.filter(d => d.date === prevDate) : [];

        // Load theme intelligence for the latest date
        const intelligences = this.db.prepare(`
            SELECT * FROM theme_intelligence WHERE date = ? AND type = ?
        `).all(latestDate, type) as any[];

        // Prepare statement for fetching top stocks
        const getAlphaStocks = this.db.prepare(`
            SELECT stock_name, stock_code, change_rate FROM stock_theme_tags 
            WHERE tag_name = ? AND added_date = ?
            ORDER BY change_rate DESC
        `);

        const currentWithChange = latestItems.map(item => {
            const prevItem = prevItems.find(p => p.name === item.name);
            let change = 'NEW';
            let changeNum = 0;
            if (prevItem) {
                changeNum = prevItem.rank_num - item.rank_num; // positive means went up
                change = changeNum > 0 ? `▲${changeNum}` : changeNum < 0 ? `▼${Math.abs(changeNum)}` : '-';
            }
            
            const aiData = intelligences.find(ai => ai.name === item.name);
            
            // Fetch leading stocks from DB
            const alphaStocks = getAlphaStocks.all(item.name, latestDate) as {stock_name: string, stock_code: string}[];

            // Fetch price index history
            const priceIndexHistory = this.db.prepare(`
                SELECT date, price_index, daily_return FROM theme_price_index
                WHERE type = ? AND name = ?
                ORDER BY date ASC LIMIT ?
            `).all(type, item.name, limitDays) as { date: string, price_index: number, daily_return: number }[];

            return {
                ...item,
                changeStr: change,
                changeNum,
                reason: aiData ? aiData.reason : null,
                lifespan_type: aiData ? aiData.lifespan_type : null,
                lifespan_reasoning: aiData ? aiData.lifespan_reasoning : null,
                top_stocks: alphaStocks,
                price_index_history: priceIndexHistory
            };
        });

        // 4) Get top N names for trend
        const topNames = latestItems.slice(0, topN).map(item => item.name);

        // 5) Build trend series (chronological order)
        const chartDates = dates.slice(0, limitDays).map(d => d.date).reverse();
        const trendData = chartDates.map(date => {
            const dayData: any = { date };
            const dayItems = historyData.filter(d => d.date === date);
            topNames.forEach(name => {
                const found = dayItems.find(d => d.name === name);
                dayData[name] = found ? found.rank_num : null;
            });
            return dayData;
        });

        return {
            date: latestDate,
            current: currentWithChange,
            topNames,
            trendData,
            historyData // pass raw history just in case detail view needs it
        };
    }

    public upsertThemePriceIndex(items: { date: string, type: string, name: string, price_index: number, daily_return: number }[]) {
        const stmt = this.db.prepare(`
            INSERT OR REPLACE INTO theme_price_index (date, type, name, price_index, daily_return)
            VALUES (@date, @type, @name, @price_index, @daily_return)
        `);
        const transaction = this.db.transaction((data) => {
            for (const item of data) {
                stmt.run(item);
            }
        });
        transaction(items);
    }

    public upsertThemeIntelligence(data: { date: string, type: string, name: string, reason: string, lifespan_type: string, lifespan_reasoning: string }[]) {
        const stmt = this.db.prepare(`
            INSERT OR REPLACE INTO theme_intelligence (date, type, name, reason, lifespan_type, lifespan_reasoning)
            VALUES (@date, @type, @name, @reason, @lifespan_type, @lifespan_reasoning)
        `)
        const replaceMany = this.db.transaction((items) => {
            for (const item of items) {
                stmt.run(item)
            }
        })
        replaceMany(data)
    }

    public getThemeIntelligence(date: string) {
        return this.db.prepare('SELECT * FROM theme_intelligence WHERE date = ?').all(date) as any[]
    }

    public upsertStockThemeTags(tags: { stock_code: string, stock_name: string, tag_name: string, is_auto_tagged: number, change_rate?: number, added_date: string }[]) {
        const stmt = this.db.prepare(`
            INSERT OR REPLACE INTO stock_theme_tags (stock_code, stock_name, tag_name, is_auto_tagged, change_rate, added_date)
            VALUES (@stock_code, @stock_name, @tag_name, @is_auto_tagged, @change_rate, @added_date)
        `)
        const insertMany = this.db.transaction((items) => {
            for (const item of items) {
                stmt.run(item)
            }
        })
        insertMany(tags)
    }

    public getStockThemeTags(stockCode: string) {
        return this.db.prepare('SELECT * FROM stock_theme_tags WHERE stock_code = ?').all(stockCode) as any[]
    }

    // PL-NewsFlow: 뉴스 저장
    public upsertNaverNewsFlow(news: { date: string, category: string, title: string, body_snippet: string, source: string, article_id: string, url: string, collected_at: string }[]) {
        const stmt = this.db.prepare(`
            INSERT OR IGNORE INTO naver_news_flow (date, category, title, body_snippet, source, article_id, url, collected_at)
            VALUES (@date, @category, @title, @body_snippet, @source, @article_id, @url, @collected_at)
        `)
        const insertMany = this.db.transaction((items) => {
            for (const item of items) {
                stmt.run(item)
            }
        })
        insertMany(news)
    }

    // PL-NewsFlow: 뉴스 조회 (AI 연동용)
    public getRecentNaverNews(category?: string, date?: string) {
        const targetDate = date || this.getKstDate()
        if (category) {
            return this.db.prepare(
                'SELECT * FROM naver_news_flow WHERE category = ? AND date = ? ORDER BY collected_at DESC'
            ).all(category, targetDate) as any[]
        }
        return this.db.prepare(
            'SELECT * FROM naver_news_flow WHERE date = ? ORDER BY category, collected_at DESC'
        ).all(targetDate) as any[]
    }

    public insertTelegramLog(senderType: string, message: string) {
        // Skip specific startup message
        if (message.includes('정상적으로 시작되었습니다')) {
            return;
        }
        
        try {
            const stmt = this.db.prepare(`
                INSERT INTO telegram_logs (sender_type, message, created_at)
                VALUES (@sender_type, @message, @created_at)
            `);
            stmt.run({
                sender_type: senderType,
                message: message,
                created_at: this.getKstTimestamp()
            });

            // Cleanup older than 3 days
            const threeDaysAgo = new Date();
            threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
            const limitDate = this.getKstTimestamp(threeDaysAgo);
            
            this.db.prepare('DELETE FROM telegram_logs WHERE created_at < ?').run(limitDate);
        } catch (error) {
            console.error('[DatabaseService] failed to save telegram log', error);
        }
    }

    public getTelegramLogs() {
        return this.db.prepare('SELECT * FROM telegram_logs ORDER BY created_at DESC LIMIT 1000').all() as any[];
    }

    // ═══ AI Execution Log ═══
    public saveAiExecutionLog(log: any) {
        const stmt = this.db.prepare(`
            INSERT OR REPLACE INTO ai_execution_log (
                id, agent_id, agent_name, trigger_type, target_type, status,
                queued_at, started_at, finished_at, duration_ms, error,
                prompt, system_instruction, result
            ) VALUES (
                @id, @agentId, @agentName, @triggerType, @targetType, @status,
                @queuedAt, @startedAt, @finishedAt, @durationMs, @error,
                @prompt, @systemInstruction, @result
            )
        `)
        stmt.run({
            id: log.id,
            agentId: log.agentId,
            agentName: log.agentName,
            triggerType: log.triggerType,
            targetType: log.targetType,
            status: log.status,
            queuedAt: log.queuedAt,
            startedAt: log.startedAt || null,
            finishedAt: log.finishedAt || null,
            durationMs: log.durationMs || null,
            error: log.error || null,
            prompt: log.prompt || null,
            systemInstruction: log.systemInstruction || null,
            result: log.result || null
        })
    }

    public getAiExecutionLogs(limit: number = 200) {
        return this.db.prepare('SELECT * FROM ai_execution_log ORDER BY queued_at DESC LIMIT ?').all(limit).map((r: any) => ({
            id: r.id,
            agentId: r.agent_id,
            agentName: r.agent_name,
            triggerType: r.trigger_type,
            targetType: r.target_type,
            status: r.status,
            queuedAt: r.queued_at,
            startedAt: r.started_at,
            finishedAt: r.finished_at,
            durationMs: r.duration_ms,
            error: r.error,
            prompt: r.prompt,
            systemInstruction: r.system_instruction,
            result: r.result
        }));
    }

    // ────────────────────────────────────────────────────────────────
    // Track A: LeaderRegime 스냅샷 저장 / 조회
    // ────────────────────────────────────────────────────────────────

    /**
     * [Track A - Layer 1]
     * 특정 테마/섹터의 최근 N일치 naver_market_flow 랭킹 이력 조회
     */
    public getNaverFlowHistory(type: string, days: number = 20): any[] {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - days);
        const cutoffStr = cutoff.toISOString().slice(0, 10);
        return (this.db.prepare(`
            SELECT date, type, name, rank_num, change_rate
            FROM naver_market_flow
            WHERE type = ? AND date >= ?
            ORDER BY date ASC, rank_num ASC
        `).all(type, cutoffStr) as any[]);
    }

    /**
     * [Track A - Layer 1]
     * 오늘 naver_market_flow Top20 전체 (테마 + 섹터)
     */
    public getTodayMarketFlow(today: string): any[] {
        return (this.db.prepare(`
            SELECT type, name, rank_num, change_rate
            FROM naver_market_flow
            WHERE date = ?
            ORDER BY type, rank_num ASC
        `).all(today) as any[]);
    }

    /**
     * [Track A - Layer 1]
     * 특정 테마/섹터의 lifespan_type (이전 AI 분석 결과)
     */
    public getThemeLifespan(type: string, name: string): string | null {
        const row = this.db.prepare(`
            SELECT lifespan_type FROM theme_intelligence
            WHERE type = ? AND name = ?
            ORDER BY date DESC LIMIT 1
        `).get(type, name) as any;
        return row?.lifespan_type ?? null;
    }

    /**
     * [Track A - Layer 1]
     * 특정 테마의 CONFIRMED 상태 구존 여부 (과거 스냅샷 DB 조회)
     */
    public hasPastConfirmedRegime(name: string): boolean {
        const row = this.db.prepare(`
            SELECT COUNT(*) as cnt FROM leader_regime_snapshot
            WHERE name = ? AND leader_status = 'CONFIRMED'
        `).get(name) as any;
        return (row?.cnt ?? 0) > 0;
    }

    /**
     * [Track A - Layer 2]
     * 테마/섹터별 Heat Score 계산
     * theme_price_index의 누적 인덱스에서 60봉/120봉 저점 대비 상승률
     */
    public getThemeHeatScores(today: string): Record<string, { heat_60d: number; heat_120d: number; current_index: number }> {
        const rows = (this.db.prepare(`
            SELECT
                curr.type,
                curr.name,
                curr.price_index                                                      AS current_index,
                MIN(h60.price_index)                                                  AS min_60d,
                MIN(h120.price_index)                                                 AS min_120d,
                ROUND((curr.price_index - MIN(h60.price_index))
                      / NULLIF(MIN(h60.price_index), 0) * 100, 1)                     AS heat_60d,
                ROUND((curr.price_index - MIN(h120.price_index))
                      / NULLIF(MIN(h120.price_index), 0) * 100, 1)                    AS heat_120d
            FROM theme_price_index curr
            JOIN theme_price_index h60
                ON h60.type = curr.type AND h60.name = curr.name
                AND h60.date >= date(curr.date, '-60 days')
                AND h60.date <= curr.date
            JOIN theme_price_index h120
                ON h120.type = curr.type AND h120.name = curr.name
                AND h120.date >= date(curr.date, '-120 days')
                AND h120.date <= curr.date
            WHERE curr.date = ?
            GROUP BY curr.type, curr.name
        `).all(today) as any[]);

        const result: Record<string, { heat_60d: number; heat_120d: number; current_index: number }> = {};
        for (const row of rows) {
            result[row.name] = {
                heat_60d:      row.heat_60d      ?? 0,
                heat_120d:     row.heat_120d     ?? 0,
                current_index: row.current_index ?? 100,
            };
        }
        return result;
    }

    /**
     * [Track A - Layer 2]
     * 테마별 구성종목들의 평균 Heat Score + 거래량 비율
     * stock_theme_tags → market_ohlcv_history 윌도우 함수 활용
     */
    public getStockHeatByTheme(today: string): Record<string, { avg_heat_60: number; avg_heat_120: number; vol_ratio: number; stock_count: number; theme_abs_vol: number }> {
        const cutoff120 = new Date(today); cutoff120.setDate(cutoff120.getDate() - 120);
        const cutoff60  = new Date(today); cutoff60.setDate(cutoff60.getDate() - 60);
        const cutoff20  = new Date(today); cutoff20.setDate(cutoff20.getDate() - 20);
        const cutoff5   = new Date(today); cutoff5.setDate(cutoff5.getDate() - 5);
        const d120 = cutoff120.toISOString().slice(0, 10);
        const d60  = cutoff60.toISOString().slice(0, 10);
        const d20  = cutoff20.toISOString().slice(0, 10);
        const d5   = cutoff5.toISOString().slice(0, 10);

        const rows = (this.db.prepare(`
            WITH BaseStockStats AS (
                SELECT
                    stt.tag_name AS theme_name,
                    stt.stock_code,
                    CASE WHEN ohlcv.close > 0 AND ohlcv.min_60 > 0
                         THEN ROUND((ohlcv.close - ohlcv.min_60) * 1.0 / ohlcv.min_60 * 100, 1)
                         ELSE NULL END AS heat_60,
                    CASE WHEN ohlcv.close > 0 AND ohlcv.min_120 > 0
                         THEN ROUND((ohlcv.close - ohlcv.min_120) * 1.0 / ohlcv.min_120 * 100, 1)
                         ELSE NULL END AS heat_120,
                    CASE WHEN ohlcv.avg_vol_20d > 0
                         THEN ROUND(ohlcv.avg_vol_5d * 1.0 / ohlcv.avg_vol_20d, 2)
                         ELSE NULL END AS vol_ratio,
                    ohlcv.avg_vol_5d
                FROM stock_theme_tags stt
                JOIN (
                    SELECT
                        stock_code,
                        MAX(CASE WHEN date = ? THEN close END)          AS close,
                        MIN(CASE WHEN date >= ? THEN close END)         AS min_60,
                        MIN(CASE WHEN date >= ? THEN close END)         AS min_120,
                        AVG(CASE WHEN date >= ? THEN trading_value END) AS avg_vol_5d,
                        AVG(CASE WHEN date >= ? THEN trading_value END) AS avg_vol_20d
                    FROM market_ohlcv_history
                    WHERE date >= ?
                    GROUP BY stock_code
                ) ohlcv ON ohlcv.stock_code = stt.stock_code
                WHERE stt.stock_name NOT LIKE '%ETN%'
                  AND stt.stock_name NOT LIKE '%ETF%'
                  AND stt.stock_name NOT LIKE '%스팩%'
                  AND stt.stock_name NOT LIKE '%리츠%'
            ), ThemeAvgStats AS (
                SELECT 
                    theme_name,
                    AVG(heat_60) AS avg_60,
                    AVG(heat_120) AS avg_120,
                    AVG(vol_ratio) AS avg_vol,
                    AVG(avg_vol_5d) AS avg_vol_abs_5d,
                    COUNT(DISTINCT stock_code) AS stock_count
                FROM BaseStockStats
                GROUP BY theme_name
            )
            SELECT 
                b.theme_name,
                t.stock_count,
                AVG(CASE WHEN b.heat_60 >= t.avg_60 THEN b.heat_60 ELSE NULL END) AS avg_heat_60,
                AVG(CASE WHEN b.heat_120 >= t.avg_120 THEN b.heat_120 ELSE NULL END) AS avg_heat_120,
                MAX(t.avg_vol) AS vol_ratio,
                MAX(t.avg_vol_abs_5d) AS theme_abs_vol
            FROM BaseStockStats b
            JOIN ThemeAvgStats t ON b.theme_name = t.theme_name
            GROUP BY b.theme_name
        `).all(today, d60, d120, d5, d20, d120) as any[]);

        const result: Record<string, { avg_heat_60: number; avg_heat_120: number; vol_ratio: number; stock_count: number; theme_abs_vol: number }> = {};
        for (const row of rows) {
            result[row.theme_name] = {
                avg_heat_60:  row.avg_heat_60  ?? 999,
                avg_heat_120: row.avg_heat_120 ?? 999,
                vol_ratio:   row.vol_ratio   ?? 1.0,
                stock_count: row.stock_count ?? 0,
                theme_abs_vol: row.theme_abs_vol ?? 0,
            };
        }
        return result;
    }

    /**
     * [Track A - 개별종목]
     * 5대 DB(급등, 테마대장, 수급, 등) 교차 검증(Multi-hit) 타겟팅 후보 추출
     * - daily_rising_stocks (최근 3일 내 급등 여부)
     * - leader_regime_snapshot (오늘 CONFIRMED/EMERGING/STRENGTHENING 인 테마 소속)
     * - maiis_incubator (관심종목/수급기록 존재 여부)
     */
    public getTrackAStockCandidates(today: string): any[] {
        const d3 = new Date(today); d3.setDate(d3.getDate() - 3);
        const cutoff3Str = d3.toISOString().slice(0, 10);
        const d60 = new Date(today); d60.setDate(d60.getDate() - 60);
        const cutoff60Str = d60.toISOString().slice(0, 10);
        const d20 = new Date(today); d20.setDate(d20.getDate() - 20);
        const cutoff20Str = d20.toISOString().slice(0, 10);
        const d5 = new Date(today); d5.setDate(d5.getDate() - 5);
        const cutoff5Str = d5.toISOString().slice(0, 10);

        return this.db.prepare(`
            WITH RisingStocks AS (
                SELECT DISTINCT stock_code, stock_name
                FROM daily_rising_stocks
                WHERE date >= ? AND date <= ?
            ),
            LeaderThemes AS (
                SELECT name
                FROM leader_regime_snapshot
                WHERE snapshot_date = ?
                  AND leader_status IN ('CONFIRMED', 'EMERGING', 'STRENGTHENING')
            ),
            ThemeStocks AS (
                SELECT DISTINCT stt.stock_code, stt.stock_name
                FROM stock_theme_tags stt
                JOIN LeaderThemes lt ON stt.tag_name = lt.name
            ),
            IncubatorStocks AS (
                SELECT DISTINCT stock_code, stock_name
                FROM maiis_incubator
            ),
            AllCandidates AS (
                SELECT stock_code, stock_name FROM RisingStocks
                UNION
                SELECT stock_code, stock_name FROM ThemeStocks
            ),
            StockScores AS (
                SELECT
                    ac.stock_code,
                    ac.stock_name,
                    CASE WHEN rs.stock_code IS NOT NULL THEN 1 ELSE 0 END AS is_rising,
                    CASE WHEN ts.stock_code IS NOT NULL THEN 1 ELSE 0 END AS is_theme_leader,
                    CASE WHEN inc.stock_code IS NOT NULL THEN 1 ELSE 0 END AS is_incubator,
                    (CASE WHEN rs.stock_code IS NOT NULL THEN 1 ELSE 0 END +
                     CASE WHEN ts.stock_code IS NOT NULL THEN 1 ELSE 0 END +
                     CASE WHEN inc.stock_code IS NOT NULL THEN 1 ELSE 0 END) AS total_hits
                FROM AllCandidates ac
                LEFT JOIN RisingStocks rs ON ac.stock_code = rs.stock_code
                LEFT JOIN ThemeStocks ts ON ac.stock_code = ts.stock_code
                LEFT JOIN IncubatorStocks inc ON ac.stock_code = inc.stock_code
            ),
            OhlcvData AS (
                SELECT
                    stock_code,
                    MAX(CASE WHEN date = ? THEN close END) AS close,
                    MIN(CASE WHEN date >= ? THEN close END) AS min_60,
                    AVG(CASE WHEN date >= ? THEN trading_value END) AS avg_vol_5d,
                    AVG(CASE WHEN date >= ? THEN trading_value END) AS avg_vol_20d
                FROM market_ohlcv_history
                WHERE date >= ? AND stock_code IN (SELECT stock_code FROM AllCandidates)
                GROUP BY stock_code
            )
            SELECT
                ss.stock_code,
                ss.stock_name,
                ss.is_rising,
                ss.is_theme_leader,
                ss.is_incubator,
                ss.total_hits,
                CASE WHEN o.close > 0 AND o.min_60 > 0
                     THEN ROUND((o.close - o.min_60) / o.min_60 * 100, 1)
                     ELSE 999 END AS heat_60,
                CASE WHEN o.avg_vol_20d > 0
                     THEN ROUND(o.avg_vol_5d / o.avg_vol_20d, 2)
                     ELSE 1.0 END AS vol_ratio
            FROM StockScores ss
            LEFT JOIN OhlcvData o ON ss.stock_code = o.stock_code
            WHERE ss.total_hits >= 1
            ORDER BY ss.total_hits DESC, heat_60 ASC
        `).all(cutoff3Str, today, today, today, cutoff60Str, cutoff5Str, cutoff20Str, cutoff60Str) as any[];
    }

    /**
     * [Track A - 테마 상세조회]
     * 특정 테마에 속한 종목들의 상세 스펙 (Heat 60, Drawdown 60) 조회
     */
    public getThemeConstituentStocks(themeName: string, today: string): any[] {
        const d60 = new Date(today); d60.setDate(d60.getDate() - 60);
        const cutoff60Str = d60.toISOString().slice(0, 10);
        const d20 = new Date(today); d20.setDate(d20.getDate() - 20);
        const cutoff20Str = d20.toISOString().slice(0, 10);
        const d5 = new Date(today); d5.setDate(d5.getDate() - 5);
        const cutoff5Str = d5.toISOString().slice(0, 10);

        return this.db.prepare(`
            WITH TargetStocks AS (
                SELECT stock_code, stock_name
                FROM stock_theme_tags
                WHERE tag_name = ?
                  AND stock_name NOT LIKE '%ETN%'
                  AND stock_name NOT LIKE '%ETF%'
                  AND stock_name NOT LIKE '%스팩%'
                  AND stock_name NOT LIKE '%리츠%'
            ), OhlcvData AS (
                SELECT
                    ts.stock_code,
                    (SELECT close FROM market_ohlcv_history WHERE stock_code = ts.stock_code ORDER BY date DESC LIMIT 1) AS close,
                    MIN(CASE WHEN h.date >= ? THEN (CASE WHEN h.low > 0 THEN h.low ELSE h.close END) END) AS min_60,
                    MAX(CASE WHEN h.date >= ? THEN (CASE WHEN h.high > 0 THEN h.high ELSE h.close END) END) AS max_60,
                    AVG(CASE WHEN h.date >= ? THEN h.trading_value END) AS avg_vol_5d,
                    AVG(CASE WHEN h.date >= ? THEN h.trading_value END) AS avg_vol_20d
                FROM TargetStocks ts
                LEFT JOIN market_ohlcv_history h ON ts.stock_code = h.stock_code AND h.date >= ?
                GROUP BY ts.stock_code
            )
            SELECT
                t.stock_code,
                t.stock_name,
                CASE WHEN o.close > 0 AND o.min_60 > 0 THEN ROUND((o.close - o.min_60) * 100.0 / o.min_60, 1) ELSE 0 END AS heat_60,
                CASE WHEN o.close > 0 AND o.max_60 > 0 THEN ROUND((o.close - o.max_60) * 100.0 / o.max_60, 1) ELSE 0 END AS drawdown_60,
                CASE WHEN o.avg_vol_20d > 0 THEN ROUND(o.avg_vol_5d * 1.0 / o.avg_vol_20d, 2) ELSE 1.0 END AS vol_ratio,
                o.close
            FROM TargetStocks t
            LEFT JOIN OhlcvData o ON t.stock_code = o.stock_code
            ORDER BY heat_60 DESC, vol_ratio DESC
        `).all(themeName, cutoff60Str, cutoff60Str, cutoff5Str, cutoff20Str, cutoff60Str) as any[];
    }

    /**
     * [Track A]
     * LeaderRegime 스냅샷 일괄 UPSERT
     */
    public saveLeaderRegimeSnapshots(snapshots: {
        snapshot_date: string; type: string; name: string;
        leader_status: string; appearances_10d: number;
        avg_rank_5d: number; avg_rank_prev5d: number;
        rank_today: number | null; change_rate_today: number;
        lifespan_type: string | null; confirmed_since: string | null;
        heat_score_60d: number; heat_score_120d: number;
        stock_avg_heat_60: number; vol_ratio_5d_20d: number;
        entry_zone: string; combined_signal: string;
        leading_stocks: string | null; ai_summary: string | null;
        theme_abs_vol?: number;
    }[]): void {
        const stmt = this.db.prepare(`
            INSERT OR REPLACE INTO leader_regime_snapshot
            (snapshot_date, type, name, leader_status, appearances_10d,
             avg_rank_5d, avg_rank_prev5d, rank_today, change_rate_today,
             lifespan_type, confirmed_since,
             heat_score_60d, heat_score_120d, stock_avg_heat_60, vol_ratio_5d_20d,
             entry_zone, combined_signal, leading_stocks, ai_summary, theme_abs_vol)
            VALUES
            (@snapshot_date, @type, @name, @leader_status, @appearances_10d,
             @avg_rank_5d, @avg_rank_prev5d, @rank_today, @change_rate_today,
             @lifespan_type, @confirmed_since,
             @heat_score_60d, @heat_score_120d, @stock_avg_heat_60, @vol_ratio_5d_20d,
             @entry_zone, @combined_signal, @leading_stocks, @ai_summary, @theme_abs_vol)
        `);
        const insert = this.db.transaction((items: typeof snapshots) => {
            for (const item of items) {
                if (item.theme_abs_vol === undefined) item.theme_abs_vol = 0;
                stmt.run(item);
            }
        });
        insert(snapshots);
    }

    /**
     * [Track A]
     * 특정 날짜의 LeaderRegime 스냅샷 전체 조회
     * combined_signal 지정 시 필터링 가능
     */
    public getLeaderRegimeSnapshot(date: string, filter?: {
        type?: 'THEME' | 'SECTOR';
        signals?: string[];  // ['BEST_BUY', 'BUY', ...]
    }): { data: any[], date: string } {
        
        let actualDate = date;
        const latestRow = this.db.prepare(`SELECT MAX(snapshot_date) as max_date FROM leader_regime_snapshot WHERE snapshot_date <= ?`).get(date) as any;
        if (latestRow && latestRow.max_date) {
            actualDate = latestRow.max_date;
        }

        let query = `
            SELECT * FROM leader_regime_snapshot
            WHERE snapshot_date = ? AND name NOT LIKE '%기타%'
        `;
        const params: any[] = [actualDate];
        if (filter?.type) {
            query += ` AND type = ?`;
            params.push(filter.type);
        }
        if (filter?.signals && filter.signals.length > 0) {
            query += ` AND combined_signal IN (${filter.signals.map(() => '?').join(',')})`;
            params.push(...filter.signals);
        }
        query += ` ORDER BY
            heat_score_60d DESC NULLS LAST,
            rank_today ASC NULLS LAST,
            CASE combined_signal
                WHEN 'BEST_BUY'    THEN 1
                WHEN 'BUY'         THEN 2
                WHEN 'REVIVAL_BUY' THEN 3
                WHEN 'HOLD_ONLY'   THEN 4
                WHEN 'WATCH'       THEN 5
                WHEN 'SELL_ALERT'  THEN 6
                WHEN 'PREPARE_EXIT'THEN 7
                WHEN 'EXIT'        THEN 8
                ELSE 9
            END`;
            
        const data = this.db.prepare(query).all(...params) as any[];
        return { data, date: actualDate };
    }

    /**
     * [Track A]
     * 특정 테마/섹터의 Regime 타임라인 (N일 chi)
     */
    public getRegimeTimeline(type: string, name: string, days: number = 30): any[] {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - days);
        return this.db.prepare(`
            SELECT snapshot_date, leader_status, entry_zone, combined_signal,
                   rank_today, heat_score_60d, vol_ratio_5d_20d, change_rate_today
            FROM leader_regime_snapshot
            WHERE type = ? AND name = ? AND snapshot_date >= ?
            ORDER BY snapshot_date ASC
        `).all(type, name, cutoff.toISOString().slice(0, 10)) as any[];
    }

    /**
     * [Track A - Phase 2]
     * 고열주 연속 등장 히트맵 (10일중 N일 이상 등장한 종목)
     */
    public getHotStocksTimeline(days: number = 10, minAppearances: number = 3): any[] {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - days);
        return this.db.prepare(`
            SELECT
                stock_code, stock_name, theme_sector,
                COUNT(*)                    AS appearance_days,
                AVG(change_rate)            AS avg_daily_change,
                AVG(trading_value)          AS avg_trading_value,
                MIN(date)                   AS first_seen,
                MAX(date)                   AS last_seen
            FROM daily_rising_stocks
            WHERE date >= ? AND timing = 'EVENING'
            GROUP BY stock_code
            HAVING COUNT(*) >= ?
            ORDER BY appearance_days DESC, avg_daily_change DESC
        `).all(cutoff.toISOString().slice(0, 10), minAppearances) as any[];
    }
}
