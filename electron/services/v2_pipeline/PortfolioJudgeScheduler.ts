import { DatabaseService } from '../DatabaseService';
import { KiwoomService } from '../KiwoomService';

export class PortfolioJudgeScheduler {
    private static instance: PortfolioJudgeScheduler;
    private db: DatabaseService;
    private kiwoom: KiwoomService;

    private constructor() {
        this.db = DatabaseService.getInstance();
        this.kiwoom = KiwoomService.getInstance();
    }

    public static getInstance(): PortfolioJudgeScheduler {
        if (!PortfolioJudgeScheduler.instance) {
            PortfolioJudgeScheduler.instance = new PortfolioJudgeScheduler();
        }
        return PortfolioJudgeScheduler.instance;
    }

    /**
     * 장 마감 후 매일 실행 (15:40)
     * 활성 포트폴리오의 생존 여부와 수익률 달성을 확인합니다.
     */
    public async runDailyJudgement() {
        const dateStr = this.db.getKstDate();
        console.log(`[PortfolioJudge] ⚖️ ${dateStr} 종목 관리 AI 수익률 결산 및 수명 체크 시작...`);

        try {
            const rawDb = (this.db as any).db;
            const startTime = Date.now();

            // ── A. 매수 포지션(HELD)만 채점 대상
            const buyPositions = (this.db as any).getBuyPositionPortfolio() as any[];
            // ── B. 관심종목(WATCHING)은 현재가 업데이트만
            const watchlistStocks = rawDb.prepare(
                "SELECT * FROM maiis_portfolio WHERE status = 'WATCHING'"
            ).all() as any[];

            const totalEvaluated = buyPositions.length;

            if (totalEvaluated === 0 && watchlistStocks.length === 0) {
                console.log(`[PortfolioJudge] ℹ️ 현재 활성화된 포트폴리오 종목이 없어 심사를 종료합니다.`);
                this.db.saveAiExecutionLog({
                    id: `LOG-JUDGE-${Date.now()}`,
                    agentId: 'PORTFOLIO_JUDGE',
                    agentName: '장마감 채점 엔진',
                    triggerType: 'SYSTEM',
                    targetType: 'PORTFOLIO',
                    status: 'SUCCESS',
                    queuedAt: new Date(startTime).toISOString(),
                    startedAt: new Date(startTime).toISOString(),
                    finishedAt: new Date().toISOString(),
                    durationMs: 0,
                    error: null,
                    prompt: '당일 포트폴리오 수익률 및 수명 심사',
                    systemInstruction: '수명 경과 및 손실/수익률 초과 시 자동 강등/이관 처리',
                    result: '활성화된 포트폴리오 종목이 없음 (심사 생략)'
                });
                return;
            }

            // ── A루프: 관심종목 — current_price / days_held만 업데이트, profit_rate·상태 변경 금지
            console.log(`[PortfolioJudge] 👀 관심종목 ${watchlistStocks.length}개 현재가 갱신 (수익률 채점 제외)`);
            for (const stock of watchlistStocks) {
                let todayPrice = stock.current_price;
                try {
                    const priceInfo = await this.kiwoom.getStockBasicInfo(stock.stock_code);
                    const body = priceInfo?.Body || priceInfo?.out1 || priceInfo || {};
                    const prcStr = String(body.stk_prc || body.currentPrice || body.cur_prc || body.stck_prpr || 0).replace(/[^0-9-]/g, '');
                    if (prcStr) todayPrice = Math.abs(parseFloat(prcStr));
                } catch (e) { /* 조회 실패 시 기존 가격 유지 */ }

                // 관심종목은 current_price만 갱신 — days_held는 HELD 전환 시점부터만 카운트
                rawDb.prepare(`
                    UPDATE maiis_portfolio
                    SET current_price = ?, updated_at = ?
                    WHERE stock_code = ?
                `).run(todayPrice, this.db.getKstTimestamp(), stock.stock_code);
            }

            // ── B루프: 매수 포지션(HELD) — 전략별 채점 + HIT/DROPPED 전환
            let demotedCount = 0;
            console.log(`[PortfolioJudge] 💰 매수 포지션 ${totalEvaluated}개 수익률 채점 시작`);

            for (const stock of buyPositions) {
                // 1. 현재가 조회 (키움 API)
                let todayClosePrice = stock.current_price;
                let todayHighPrice = stock.current_price;

                try {
                    const priceInfo = await this.kiwoom.getStockBasicInfo(stock.stock_code);
                    const body = priceInfo?.Body || priceInfo?.out1 || priceInfo || {};
                    const currentPrcStr = String(body.stk_prc || body.currentPrice || body.cur_prc || body.stck_prpr || stock.current_price).replace(/[^0-9-]/g, '');
                    const highPrcStr = String(body.stck_hgpr || body.highPrice || body.hgpr || stock.current_price).replace(/[^0-9-]/g, '');

                    if (currentPrcStr) todayClosePrice = Math.abs(parseFloat(currentPrcStr));
                    if (highPrcStr) todayHighPrice = Math.abs(parseFloat(highPrcStr));
                } catch (e) {
                    console.warn(`[PortfolioJudge] ${stock.stock_name} 현재가 조회 실패. 기존 가격을 사용합니다.`);
                }

                // entry_price가 없으면 오늘 현재가로 설정하고 채점 스킵 (다음 사이클에 정상 채점)
                if (!stock.entry_price || stock.entry_price <= 0) {
                    if (todayClosePrice > 0) {
                        rawDb.prepare('UPDATE maiis_portfolio SET entry_price = ?, current_price = ? WHERE stock_code = ?')
                             .run(todayClosePrice, todayClosePrice, stock.stock_code);
                    }
                    continue;
                }

                const entryPrice = stock.entry_price;
                const highProfitPct = ((todayHighPrice - entryPrice) / entryPrice) * 100;
                const closeProfitPct = ((todayClosePrice - entryPrice) / entryPrice) * 100;
                const daysHeld = stock.days_held + 1;

                // 2. 종목 상태 변경 기능 제거 (15시 41분에는 상태 변경을 하지 않음)
                // - 실제 물리적인 매매가 가능한 09:45, 14:05 크론에서 포트폴리오 매니저가 담당함.
                const newStatus = stock.status;

                // 3. DB 갱신 (종가 기록, 일수 +1 증가)
                rawDb.prepare(`
                    UPDATE maiis_portfolio
                    SET current_price = ?, target_price = ?, profit_rate = ?, days_held = ?, status = ?, updated_at = ?
                    WHERE stock_code = ?
                `).run(
                    todayClosePrice,
                    todayHighPrice,
                    closeProfitPct,
                    daysHeld,
                    newStatus,
                    this.db.getKstTimestamp(),
                    stock.stock_code
                );
                
                // (제거됨) DROPPED 시 인큐베이터 자동 이관 로직은 매매 관리 크론으로 이전/위임됨.
            }

            const endTime = Date.now();
            console.log(`[PortfolioJudge] ✅ 일간 포트폴리오 심사 완료.`);

            this.db.saveAiExecutionLog({
                id: `LOG-JUDGE-${Date.now()}`,
                agentId: 'PORTFOLIO_JUDGE',
                agentName: '장마감 채점 엔진',
                triggerType: 'SYSTEM',
                targetType: 'PORTFOLIO',
                status: 'SUCCESS',
                queuedAt: new Date(startTime).toISOString(),
                startedAt: new Date(startTime).toISOString(),
                finishedAt: new Date(endTime).toISOString(),
                durationMs: endTime - startTime,
                error: null,
                prompt: `당일 포트폴리오 수익률 및 수명 심사 (${totalEvaluated}종목)`,
                systemInstruction: '수익/손절 기준, 시간 만료 기준 평가 및 인큐베이터(Pool B) 생존 이관',
                result: `총 ${totalEvaluated}개 종목 심사 완료. ${demotedCount}개 인큐베이터로 강등/이관됨.`
            });

            // ─── 1B: LeaderRegime 스냅샷 저장 ───────────────────────────
            // conviction_score 이력 저장 (A트랙 — 동기 실행)
            this.savePortfolioScoreHistory();
            // Alpha 일일 스냅샷 저장 (B트랙 — 비동기, 오류 무시)
            this.saveLeaderSnapshot().catch(e =>
                console.warn('[PortfolioJudge] 스냅샷 저장 백그라운드 오류 (무시):', e?.message)
            );

        } catch (e: any) {
            console.error(`[PortfolioJudge] 포트폴리오 채점 중 오류:`, e);
            this.db.saveAiExecutionLog({
                id: `LOG-JUDGE-${Date.now()}-ERR`,
                agentId: 'PORTFOLIO_JUDGE',
                agentName: '장마감 채점 엔진',
                triggerType: 'SYSTEM',
                targetType: 'PORTFOLIO',
                status: 'FAILED',
                queuedAt: new Date().toISOString(),
                startedAt: new Date().toISOString(),
                finishedAt: new Date().toISOString(),
                durationMs: 0,
                error: String(e.message || e),
                prompt: '당일 포트폴리오 수익률 및 수명 심사',
                systemInstruction: '-',
                result: '시스템 또는 데이터 연산 오류'
            });
        }
    }

    /**
     * P3-6: 종목의 테마 또는 Alpha 랭킹이 아직 살아있는지 확인
     * - theme_intelligence에서 최근 3일 이내 등장 + 피크아웃/설거지가 아닌 경우
     * - market_leader_daily에서 최근 Alpha Top 50 내 존재 여부
     */
    private checkThemeOrAlphaSurvival(rawDb: any, stockCode: string, stockName: string): boolean {
        try {
            const tags = rawDb.prepare('SELECT tag_name FROM stock_theme_tags WHERE stock_code = ?').all(stockCode) as any[];
            if (tags.length > 0) {
                const tagNames = tags.map((t: any) => t.tag_name);
                const placeholders = tagNames.map(() => '?').join(',');
                const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

                const activeTheme = rawDb.prepare(`
                    SELECT COUNT(*) as cnt FROM theme_intelligence
                    WHERE name IN (${placeholders})
                    AND lifespan_type NOT LIKE '%설거지%'
                    AND lifespan_type NOT LIKE '%피크아웃%'
                    AND created_at >= ?
                `).get(...tagNames, threeDaysAgo) as any;

                if (activeTheme?.cnt > 0) return true;
            }

            // Alpha 랭킹 확인 (market_leader_daily 우선, 없으면 market_leader_alpha 폴백)
            try {
                const alphaCheck = rawDb.prepare(`
                    SELECT COUNT(*) as cnt FROM market_leader_daily
                    WHERE stock_code = ? AND rank <= 50
                    ORDER BY snapshot_date DESC LIMIT 1
                `).get(stockCode) as any;
                if (alphaCheck?.cnt > 0) return true;
            } catch {
                try {
                    const alphaFallback = rawDb.prepare(`
                        SELECT COUNT(*) as cnt FROM market_leader_alpha
                        WHERE stock_code = ? AND rank_num <= 50
                        ORDER BY date DESC LIMIT 1
                    `).get(stockCode) as any;
                    if (alphaFallback?.cnt > 0) return true;
                } catch { /* 테이블 없으면 무시 */ }
            }

            return false;
        } catch (e) {
            // 체크 실패 시 보수적으로 인큐베이터로 이관
            console.warn(`[PortfolioJudge] ${stockName} 테마 생존 체크 실패, 보수적 이관:`, e);
            return true;
        }
    }

    // ─────────────────────────────────────────────────────────────────
    // 1A: 전략별(Strategy-Aware) 판정 엔진
    // ─────────────────────────────────────────────────────────────────

    /**
     * 전략(strategy)에 따라 HIT / DROPPED 여부를 판정하고 새 상태 문자열 또는 null을 반환합니다.
     * null 반환 = 현재 상태 유지
     *
     * 전략별 기준:
     *   MOMENTUM : 5일 기준  /  고가+13% or 종가+10% → HIT  /  종가-8% 즉시 손절
     *   PULLBACK : 10일 기준 /  고가+18% or 종가+15% → HIT  /  종가-10% 즉시 손절
     *   SWING    : 20일 기준 /  고가+25% or 종가+20% → HIT  /  종가-12% + 수명 초과 시 손절
     *   VALUE    : 60일 기준 /  고가+35% or 종가+30% → HIT  /  종가-15% 손절 (가장 관대)
     */
    private judgeByStrategy(
        strategy: string,
        ctx: { highProfitPct: number; closeProfitPct: number; daysHeld: number; lifespanDays: number; stockName: string }
    ): 'HIT' | 'DROPPED' | null {
        const { highProfitPct, closeProfitPct, daysHeld, lifespanDays, stockName } = ctx;

        interface StrategyRule {
            hitHighPct: number;   // 고가 기준 목표 수익률
            hitClosePct: number;  // 종가 기준 목표 수익률
            stopLossPct: number;  // 손절선 (음수)
            lifespan: number;     // 기본 수명 (lifespan_days 없을 시 fallback)
        }

        const rules: Record<string, StrategyRule> = {
            MOMENTUM: { hitHighPct: 13, hitClosePct: 10, stopLossPct: -8,  lifespan: 5  },
            PULLBACK: { hitHighPct: 18, hitClosePct: 15, stopLossPct: -10, lifespan: 10 },
            SWING:    { hitHighPct: 25, hitClosePct: 20, stopLossPct: -12, lifespan: 20 },
            VALUE:    { hitHighPct: 35, hitClosePct: 30, stopLossPct: -15, lifespan: 60 },
        };

        const rule = rules[strategy] ?? rules['SWING'];
        const effectiveLifespan = lifespanDays || rule.lifespan;

        // ① 목표 수익률 달성 → HIT (자동 익절 방식을 제거하고 AI 자율 판단(Max-profit pursuit)에 맡김)
        // 사용자가 "AI가 포트폴리오를 전담하며 가능한 최대 수익을 추구하라"고 지시.
        // if (highProfitPct >= rule.hitHighPct || closeProfitPct >= rule.hitClosePct) {
        //     console.log(
        //         `[PortfolioJudge] 🎉 [${strategy}] ${stockName} HIT (Disabled for Max Profit) ` +
        //         `고가 ${highProfitPct.toFixed(1)}% / 종가 ${closeProfitPct.toFixed(1)}%`
        //     );
        //     // return 'HIT'; // 더이상 강제 HIT 시키지 않고 진행
        // }

        // ② 손절선 이탈 → 즉시 DROPPED
        if (closeProfitPct <= rule.stopLossPct) {
            console.log(
                `[PortfolioJudge] 🛑 [${strategy}] ${stockName} 손절 실행! ` +
                `종가 ${closeProfitPct.toFixed(1)}% ≤ 손절선 ${rule.stopLossPct}%`
            );
            return 'DROPPED';
        }

        // ③ 수명 초과 → DROPPED
        if (daysHeld >= effectiveLifespan) {
            console.log(
                `[PortfolioJudge] ⏳ [${strategy}] ${stockName} 수명 종료 ` +
                `(${daysHeld}/${effectiveLifespan}일). 수익률: ${closeProfitPct.toFixed(1)}%`
            );
            return 'DROPPED';
        }

        return null; // 현재 상태 유지
    }

    // ─────────────────────────────────────────────────────────────────
    // 1B: LeaderRegime 스냅샷 저장
    // ─────────────────────────────────────────────────────────────────

    /**
     * B트랙: Alpha 상위 종목 일일 스냅샷을 market_leader_daily 테이블에 저장합니다.
     * PortfolioJudgeScheduler.runDailyJudgement() 마지막에 호출합니다. (15:40)
     */
    public async saveLeaderSnapshot(): Promise<void> {
        try {
            const { MarketLeaderDiscoveryService } = await import('./MarketLeaderDiscoveryService');
            const svc = MarketLeaderDiscoveryService.getInstance();
            const rawDb = (this.db as any).db;
            const today = this.db.getKstDate();

            // 테이블 없으면 생성
            rawDb.prepare(`
                CREATE TABLE IF NOT EXISTS market_leader_daily (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    snapshot_date TEXT NOT NULL,
                    period_days INTEGER NOT NULL,
                    stock_code TEXT NOT NULL,
                    stock_name TEXT NOT NULL,
                    rank INTEGER NOT NULL,
                    market_alpha REAL,
                    total_change_rate REAL,
                    avg_trading_value REAL,
                    score REAL,
                    related_themes TEXT,
                    created_at TEXT DEFAULT (datetime('now', 'localtime'))
                )
            `).run();
            rawDb.prepare(`
                CREATE UNIQUE INDEX IF NOT EXISTS idx_leader_daily
                ON market_leader_daily(snapshot_date, period_days, stock_code)
            `).run();

            // 10일 기준 Top50 저장
            const leaders = svc.getMarketLeaders(10, 0, 50);
            const stmt = rawDb.prepare(`
                INSERT OR REPLACE INTO market_leader_daily
                (snapshot_date, period_days, stock_code, stock_name, rank,
                 market_alpha, total_change_rate, avg_trading_value, score, related_themes)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);

            const insertMany = rawDb.transaction((rows: any[]) => {
                for (const r of rows) stmt.run(...r);
            });

            insertMany(leaders.map((l, idx) => [
                today, 10, l.stockCode, l.stockName, idx + 1,
                l.marketAlpha, l.totalChangeRate, l.avgTradingValue, l.score,
                JSON.stringify(l.relatedThemes)
            ]));

            console.log(`[PortfolioJudge] 📸 ${today} Alpha 스냅샷 저장 완료 (${leaders.length}종목, 10일 기준)`);
        } catch (e: any) {
            console.warn('[PortfolioJudge] ⚠️ Alpha 스냅샷 저장 실패 (무시):', e.message);
        }
    }

    /**
     * A트랙: PM이 오늘 평가한 종목의 conviction_score 이력을 portfolio_score_history 테이블에 저장합니다.
     * PortfolioManagerAgent.runDailyReview() 완료 후 호출합니다.
     */
    public savePortfolioScoreHistory(): void {
        try {
            const rawDb = (this.db as any).db;
            const today = this.db.getKstDate();

            // 테이블 없으면 생성
            rawDb.prepare(`
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
                    market_alpha REAL,
                    created_at TEXT DEFAULT (datetime('now', 'localtime'))
                )
            `).run();
            rawDb.prepare(`
                CREATE UNIQUE INDEX IF NOT EXISTS idx_score_history
                ON portfolio_score_history(snapshot_date, stock_code)
            `).run();

            // 오늘 PM이 평가한 전체 활성 포트폴리오 스냅샷
            const activePortfolio = this.db.getActivePortfolio() as any[];
            if (!activePortfolio || activePortfolio.length === 0) return;

            const stmt = rawDb.prepare(`
                INSERT OR REPLACE INTO portfolio_score_history
                (snapshot_date, stock_code, stock_name, conviction_score,
                 last_signal, strategy, analysts_json, theme_sector, market_alpha)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);

            const insertMany = rawDb.transaction((rows: any[]) => {
                for (const r of rows) stmt.run(...r);
            });

            insertMany(activePortfolio.map(s => [
                today, s.stock_code, s.stock_name,
                s.conviction_score ?? null,
                s.last_signal ?? null,
                s.strategy ?? null,
                s.analysts_json ?? null,
                s.theme_sector ?? null,
                null  // market_alpha는 별도 Alpha 계산 후 업데이트 가능
            ]));

            console.log(`[PortfolioJudge] 📊 conviction_score 이력 저장 완료 (${activePortfolio.length}종목)`);
        } catch (e: any) {
            console.warn('[PortfolioJudge] ⚠️ conviction 이력 저장 실패 (무시):', e.message);
        }
    }

    /**
     * LeaderRegime 파생 분석 — Crown 연속일 (Alpha Top10 연속 N일 이상 유지 종목)
     */
    public getCrownLeaders(minDays: number = 3): any[] {
        try {
            const rawDb = (this.db as any).db;
            return rawDb.prepare(`
                SELECT stock_code, stock_name,
                       COUNT(*) as crown_days,
                       MIN(snapshot_date) as streak_start,
                       MIN(rank) as best_rank,
                       MAX(market_alpha) as peak_alpha
                FROM market_leader_daily
                WHERE period_days = 10 AND rank <= 10
                  AND snapshot_date >= date('now', '-30 days')
                GROUP BY stock_code
                HAVING COUNT(*) >= ?
                ORDER BY crown_days DESC
            `).all(minDays) as any[];
        } catch { return []; }
    }

    /**
     * LeaderRegime 파생 분석 — 신규 진입자 (오늘 Top30인데 어제 없던 종목)
     */
    public getNewEntrants(): any[] {
        try {
            const rawDb = (this.db as any).db;
            const today = this.db.getKstDate();
            return rawDb.prepare(`
                SELECT t.stock_code, t.stock_name, t.rank, t.market_alpha, t.related_themes
                FROM market_leader_daily t
                WHERE t.snapshot_date = ? AND t.period_days = 10
                  AND NOT EXISTS (
                      SELECT 1 FROM market_leader_daily y
                      WHERE y.stock_code = t.stock_code
                        AND y.snapshot_date = date(?, '-1 day')
                        AND y.period_days = 10
                  )
            `).all(today, today) as any[];
        } catch { return []; }
    }

    /**
     * LeaderRegime 파생 분석 — Revival 후보 (과거 Top15였다가 소강 후 재진입)
     */
    public getRevivalCandidates(pastDays: number = 20): any[] {
        try {
            const rawDb = (this.db as any).db;
            const today = this.db.getKstDate();
            return rawDb.prepare(`
                SELECT curr.stock_code, curr.stock_name, curr.rank, curr.market_alpha,
                       past.rank as past_rank, past.snapshot_date as past_date
                FROM market_leader_daily curr
                JOIN market_leader_daily past
                    ON curr.stock_code = past.stock_code
                    AND past.snapshot_date <= date(?, '-${pastDays} days')
                    AND past.rank <= 15
                WHERE curr.snapshot_date = ? AND curr.period_days = 10
            `).all(today, today) as any[];
        } catch { return []; }
    }
}

