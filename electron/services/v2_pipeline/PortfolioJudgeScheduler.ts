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

            if (!activePortfolio || activePortfolio.length === 0) {
                console.log(`[PortfolioJudge] ℹ️ 현재 활성화된 포트폴리오 종목이 없어 심사를 종료합니다.`);
                return;
            }

            for (const stock of activePortfolio) {
                // 1. 현재가 조회 (키움 API) 
                // Note: 실제 운영에서는 키움 API가 15:30 이후에 종가를 제공하므로 이를 활용합니다.
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

                // 만약 가격이 아직 0이라면 패스 (최초 진입 후 데이터 누락 등)
                if (!stock.entry_price || stock.entry_price <= 0) {
                    if (todayClosePrice > 0) {
                        // 초기 진입가 설정
                        rawDb.prepare('UPDATE maiis_portfolio SET entry_price = ?, current_price = ? WHERE stock_code = ?')
                             .run(todayClosePrice, todayClosePrice, stock.stock_code);
                    }
                    continue;
                }

                const entryPrice = stock.entry_price;
                const highProfitPct = ((todayHighPrice - entryPrice) / entryPrice) * 100;
                const closeProfitPct = ((todayClosePrice - entryPrice) / entryPrice) * 100;
                const daysHeld = stock.days_held + 1; // 하루 지남

                // 2. 판정 로직 적용 (최고가 15% 이상 OR 종가 10% 이상 -> HIT)
                let newStatus = stock.status;
                let finalScore = stock.conviction_score;

                if (newStatus !== 'DROPPED') {
                    if (highProfitPct >= 15.0 || closeProfitPct >= 10.0) {
                        newStatus = 'HIT';
                        console.log(`[PortfolioJudge] 🎉 ${stock.stock_name} 목표 수익률 달성! (고가기준: ${highProfitPct.toFixed(2)}% / 종가기준: ${closeProfitPct.toFixed(2)}%) -> HIT 처리 완료`);
                    } 
                    // 3. 타임아웃 룰 적용 (수명 종료 시 잔여 수익률 확인 후 DROP 처리 - 1개월 기준 우선 20일로 처리)
                    else if (daysHeld >= (stock.lifespan_days || 20)) {
                        newStatus = 'DROPPED';
                        console.log(`[PortfolioJudge] ⏳ ${stock.stock_name} 수명 종료(${daysHeld}일 소진). 현재 수익률: ${closeProfitPct.toFixed(2)}% -> DROPPED 처리`);
                    }
                }

                // 4. DB 갱신
                rawDb.prepare(`
                    UPDATE maiis_portfolio 
                    SET current_price = ?, target_price = ?, profit_rate = ?, days_held = ?, status = ?, updated_at = ?
                    WHERE stock_code = ?
                `).run(
                    todayClosePrice,
                    todayHighPrice, // target_price 대신 오늘 최고가 기록
                    closeProfitPct,
                    daysHeld,
                    newStatus,
                    this.db.getKstTimestamp(),
                    stock.stock_code
                );
            }

            console.log(`[PortfolioJudge] ✅ 일간 포트폴리오 심사 완료.`);

        } catch (e) {
            console.error(`[PortfolioJudge] 포트폴리오 채점 중 오류:`, e);
        }
    }
}
