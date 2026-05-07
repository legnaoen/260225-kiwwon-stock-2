import { DatabaseService } from '../DatabaseService';

export class ThemeMockTradingJudgeAgent {
    private static instance: ThemeMockTradingJudgeAgent;
    private db: DatabaseService;

    private constructor() {
        this.db = DatabaseService.getInstance();
    }

    public static getInstance(): ThemeMockTradingJudgeAgent {
        if (!ThemeMockTradingJudgeAgent.instance) {
            ThemeMockTradingJudgeAgent.instance = new ThemeMockTradingJudgeAgent();
        }
        return ThemeMockTradingJudgeAgent.instance;
    }

    private getBusinessDaysDiff(startDateStr: string, endDateStr: string): number {
        const start = new Date(startDateStr);
        const end = new Date(endDateStr);
        let count = 0;
        const cur = new Date(start);
        while (cur < end) {
            cur.setDate(cur.getDate() + 1);
            const day = cur.getDay();
            if (day !== 0 && day !== 6) { // 일(0), 토(6) 아님
                count++;
            }
        }
        return count;
    }

    /**
     * 모의매매 명부에 있는 최근 15일 이내의 추천 종목들을 추적하고
     * 상태(진입가, 현재가, 수익률, D-DAY, HIT 여부 등)를 업데이트합니다.
     */
    public async evaluatePicks() {
        console.log(`[ThemeMockTradingJudge] ⚖️ 테마 모의매매 성과 판독(Judge) 시작...`);
        try {
            const rawDb = (this.db as any).db;

            // 1. 평가 대상 긁어오기 (15일치 - 10영업일 커버 목적)
            const records = rawDb.prepare(`
                SELECT date, type, name, top_picks_json 
                FROM theme_intelligence 
                WHERE top_picks_json IS NOT NULL AND top_picks_json != '[]'
                ORDER BY date DESC
                LIMIT 50
            `).all() as any[];

            const stmtGetOhlcv = rawDb.prepare(`
                SELECT date, open, high, low, close 
                FROM market_ohlcv_history 
                WHERE stock_code = ? AND date >= ? 
                ORDER BY date ASC
            `);

            const stmtGetFallbackOhlcv = rawDb.prepare(`
                SELECT close FROM market_ohlcv_history
                WHERE stock_code = ? AND date <= ?
                ORDER BY date DESC LIMIT 1
            `);
            
            const stmtGetFallbackRate = rawDb.prepare(`
                SELECT change_rate FROM stock_theme_tags
                WHERE stock_code = ? AND tag_name = ?
            `);

            const stmtGetTradingDays = rawDb.prepare(`
                SELECT COUNT(DISTINCT date) as days
                FROM market_ohlcv_history
                WHERE date > ? AND date <= ?
            `);

            const stmtUpdateJson = rawDb.prepare(`
                UPDATE theme_intelligence 
                SET top_picks_json = ? 
                WHERE date = ? AND type = ? AND name = ?
            `);

            let updatedCount = 0;

            for (const row of records) {
                let picks = [];
                try { picks = JSON.parse(row.top_picks_json); } catch (e) { continue; }
                if (!Array.isArray(picks) || picks.length === 0) continue;

                let isModified = false;

                for (let pick of picks) {
                    // 이미 청산되었거나 HIT 달성으로 종료된 경우 업데이트 생략 (선택적)
                    if (pick.status && (pick.status.includes('청산') || pick.status.includes('HIT'))) {
                        continue;
                    }

                    const ohlcvList = stmtGetOhlcv.all(pick.stock_code, row.date) as any[];
                    const todayStr = this.db.getKstDate();
                    const tradingDaysObj = stmtGetTradingDays.get(row.date, todayStr) as any;
                    const actualTradingDays = tradingDaysObj ? tradingDaysObj.days : 0;
                    
                    let entryPrice = pick.entryPrice || 0; // JSON에 기록된 실시간 진입가가 있다면 우선 사용
                    let currentPrice = 0;
                    let maxHigh = 0;
                    let elapsedDays = actualTradingDays;

                    if (!ohlcvList || ohlcvList.length === 0) {
                        // Fallback: 오늘 OHLCV가 없다면 어제 종가 + 오늘 테마 등락률로 진입가 추정
                        const fallbackOhlcv = stmtGetFallbackOhlcv.get(pick.stock_code, row.date) as any;
                        const fallbackRate = stmtGetFallbackRate.get(pick.stock_code, row.name) as any;
                        
                        if (fallbackOhlcv) {
                            let estPrice = fallbackOhlcv.close;
                            if (fallbackRate && fallbackRate.change_rate != null) {
                                estPrice = Math.round(fallbackOhlcv.close * (1 + fallbackRate.change_rate / 100));
                            }
                            if (!entryPrice) entryPrice = estPrice; // 값이 없을 때만 추정
                            currentPrice = entryPrice;
                            maxHigh = entryPrice;
                        } else {
                            if (!entryPrice) continue; // OHLCV 히스토리가 아예 없고 entryPrice도 없으면 스킵 (신규상장 등)
                            currentPrice = entryPrice;
                            maxHigh = entryPrice;
                        }
                    } else {
                        // 진입가: 추천일(D-0)의 종가 기준 (단, 사전에 기록된 실시간 진입가가 없다면 덮어쓰기)
                        if (!entryPrice) entryPrice = ohlcvList[0].close;
                        
                        // 현재가: 배열의 가장 마지막(최신) 종가
                        currentPrice = ohlcvList[ohlcvList.length - 1].close;

                        // 피크: 추천일 다음 날부터 가장 높았던 고가 (종가 베팅이므로 당일 고가는 제외)
                        maxHigh = entryPrice;
                        for (const candle of ohlcvList) {
                            if (candle.date <= row.date) continue; // 매수 당일 고가는 오반영되므로 스킵
                            if (candle.high > maxHigh) maxHigh = candle.high;
                        }
                    }
                    
                    const returnVal = ((currentPrice - entryPrice) / entryPrice) * 100;
                    const peakVal = ((maxHigh - entryPrice) / entryPrice) * 100;
                    
                    const dDay = Math.max(0, 10 - elapsedDays);

                    // 상태 판정
                    let status = '가설 검증중';
                    if (peakVal >= 20.0) {
                        status = '목표달성 (HIT)';
                    } else if (elapsedDays >= 10) {
                        status = '기간만료 (청산)';
                    }

                    pick.entryPrice = entryPrice;
                    pick.currentPrice = currentPrice;
                    pick.return = Number(returnVal.toFixed(2));
                    pick.peak = Number(peakVal.toFixed(2));
                    pick.dDay = dDay;
                    pick.status = status;
                    
                    isModified = true;
                }

                if (isModified) {
                    stmtUpdateJson.run(JSON.stringify(picks), row.date, row.type, row.name);
                    updatedCount++;
                }
            }

            console.log(`[ThemeMockTradingJudge] ✅ 판독 완료. 업데이트된 테마 그룹 수: ${updatedCount}`);
            return { success: true, updatedCount };

        } catch (error: any) {
            console.error(`[ThemeMockTradingJudge] 💥 판독 중 오류 발생:`, error);
            return { success: false, error: error.message };
        }
    }
}
