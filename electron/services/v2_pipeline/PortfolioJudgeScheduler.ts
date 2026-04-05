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
            const activePortfolio = this.db.getActivePortfolio() as any[];
            const startTime = Date.now();

            if (!activePortfolio || activePortfolio.length === 0) {
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

            let demotedCount = 0;
            let totalEvaluated = activePortfolio.length;

            for (const stock of activePortfolio) {
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

                // 2. 판정 로직
                let newStatus = stock.status;

                if (newStatus !== 'DROPPED') {
                    if (highProfitPct >= 15.0 || closeProfitPct >= 10.0) {
                        newStatus = 'HIT';
                        console.log(`[PortfolioJudge] 🎉 ${stock.stock_name} 목표 수익률 달성! (고가: ${highProfitPct.toFixed(2)}% / 종가: ${closeProfitPct.toFixed(2)}%) -> HIT`);
                    } else if (daysHeld >= (stock.lifespan_days || 20)) {
                        newStatus = 'DROPPED';
                        console.log(`[PortfolioJudge] ⏳ ${stock.stock_name} 수명 종료(${daysHeld}일 소진). 수익률: ${closeProfitPct.toFixed(2)}% -> DROPPED`);
                    }
                }

                // 3. DB 갱신
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

                // ─── P3-6: DROPPED 시 인큐베이터 자동 이관 로직 ───
                if (newStatus === 'DROPPED') {
                    try {
                        const shouldDemote = this.checkThemeOrAlphaSurvival(rawDb, stock.stock_code, stock.stock_name);
                        if (shouldDemote) {
                            this.db.demoteToIncubator({
                                stock_code: stock.stock_code,
                                stock_name: stock.stock_name,
                                current_price: todayClosePrice,
                                last_signal_reason: stock.last_signal_reason,
                                id: stock.id
                            });
                            console.log(`[PortfolioJudge] 🔀 ${stock.stock_name} → 🧪 인큐베이터 이관 (테마/Alpha 생존)`);
                            demotedCount++;
                        } else {
                            console.log(`[PortfolioJudge] ❌ ${stock.stock_name} 완전 탈락 (테마/Alpha 소멸)`);
                        }
                    } catch (e) {
                        console.warn(`[PortfolioJudge] ${stock.stock_name} 인큐베이터 이관 실패:`, e);
                    }
                }
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
     * - market_leader_alpha에서 최근 Alpha Top 50 내 존재 여부
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

            // Alpha 랭킹 확인
            try {
                const alphaCheck = rawDb.prepare(`
                    SELECT COUNT(*) as cnt FROM market_leader_alpha
                    WHERE stock_code = ? AND rank_num <= 50
                    ORDER BY date DESC LIMIT 1
                `).get(stockCode) as any;
                if (alphaCheck?.cnt > 0) return true;
            } catch { /* 테이블 없으면 무시 */ }

            return false;
        } catch (e) {
            // 체크 실패 시 보수적으로 인큐베이터로 이관
            console.warn(`[PortfolioJudge] ${stockName} 테마 생존 체크 실패, 보수적 이관:`, e);
            return true;
        }
    }
}
