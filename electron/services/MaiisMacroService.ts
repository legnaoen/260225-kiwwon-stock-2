import { YahooFinanceService } from './YahooFinanceService';
import { DatabaseService } from './DatabaseService';

export interface MacroSnapshot {
    symbol: string;
    name: string;
    current_value: number;
    previous_value: number;
    dod_change_pct: number;
    trend_summary: string;
}

export class MaiisMacroService {
    private static instance: MaiisMacroService;
    private db = DatabaseService.getInstance();
    private yahooDb = YahooFinanceService.getInstance();

    private readonly WATCHLIST = [
        { symbol: '^IXIC', name: 'NASDAQ' },
        { symbol: 'KRW=X', name: 'USDKRW' },
        { symbol: '^TNX', name: 'US_10Y_YIELD' },
        { symbol: 'CL=F', name: 'WTI_CRUDE_OIL' },
        { symbol: '^VIX', name: 'VIX' },
        { symbol: '^GSPC', name: 'S&P_500' }
    ];

    private constructor() {}

    public static getInstance() {
        if (!MaiisMacroService.instance) {
            MaiisMacroService.instance = new MaiisMacroService();
        }
        return MaiisMacroService.instance;
    }

    /**
     * 지정된 날짜 전후로 가장 최근의 매크로 지표 스냅샷을 야후 API로부터 가져와 포맷팅합니다.
     */
    public async getDailyMacroSnapshot(): Promise<MacroSnapshot[]> {
        const snapshots: MacroSnapshot[] = [];

        for (const item of this.WATCHLIST) {
            try {
                const data = await this.yahooDb.getMacroIndicator(item.symbol);
                if (!data || !data.quotes || data.quotes.length < 2) {
                    continue;
                }

                const quotes = data.quotes;
                if (quotes.length < 60) {
                    continue; // 60일선 이상 계산 불가능 시 스킵
                }

                const latest = quotes[quotes.length - 1];
                const previous = quotes[quotes.length - 2];

                // 1. 전일 대비 단기 모멘텀 계산
                const dod_change = ((latest.close - previous.close) / previous.close) * 100;

                // 2. 52주 고점/저점 이격도 계산
                const prices = quotes.map((q: any) => q.close);
                const week52High = Math.max(...prices);
                const week52Low = Math.min(...prices);
                const distFrom52WHighPct = ((latest.close - week52High) / week52High) * 100;

                // 3. 이동평균선(20MA, 60MA) 계산
                const calcMA = (period: number) => {
                    const slice = prices.slice(-period);
                    return slice.reduce((acc: number, val: number) => acc + val, 0) / period;
                };
                
                const ma20 = calcMA(20);
                const ma60 = calcMA(60);

                const above20MA = latest.close > ma20;
                const above60MA = latest.close > ma60;

                // 4. 주간(5일), 월간(20일) 모멘텀
                const getPctChange = (days: number) => {
                    if (quotes.length < days + 1) return 0;
                    const past = quotes[quotes.length - 1 - days].close;
                    return ((latest.close - past) / past) * 100;
                };
                const weekChange = getPctChange(5);
                const monthChange = getPctChange(20);

                // 5. RSI 14 계산
                const calcRSI = (period: number) => {
                    let gains = 0, losses = 0;
                    for (let i = quotes.length - period; i < quotes.length; i++) {
                        const diff = quotes[i].close - quotes[i - 1].close;
                        if (diff >= 0) gains += diff;
                        else losses -= diff;
                    }
                    if (losses === 0) return 100;
                    const rs = (gains / period) / (losses / period);
                    return 100 - (100 / (1 + rs));
                };
                const rsi14 = calcRSI(14);
                let rsiText = '중립 구간';
                if (rsi14 >= 70) rsiText = '단기 과열 (Overbought)';
                else if (rsi14 <= 30) rsiText = '극단적 과매도/투매 (Oversold)';

                // 6. 연속 등락 카운터 (연승/연패)
                let consecutiveDays = 0;
                let isUp = dod_change > 0;
                for (let i = quotes.length - 1; i > 0; i--) {
                    const diff = quotes[i].close - quotes[i - 1].close;
                    if ((diff > 0 && isUp) || (diff < 0 && !isUp)) {
                        consecutiveDays++;
                    } else break;
                }
                const streakText = consecutiveDays > 1 ? `${consecutiveDays}거래일 연속 ${isUp ? '상승' : '하락'}` : (isUp ? '반등' : '조정');

                // 7. 인간/AI 친화적인 축약 텍스트 조립 (Pre-digested String)
                let trendDesc = '';
                if (above20MA && above60MA) trendDesc = '단기 및 중기 상승장 확립 (강세)';
                else if (!above20MA && above60MA) trendDesc = '중기 상승 속 단기 조정 중 (박스권)';
                else if (above20MA && !above60MA) trendDesc = '중기 하락 속 단기 반등 (기술적 반등)';
                else trendDesc = '단기 및 중기 하락 추세 지속 (약세)';

                let highDistText = '';
                if (distFrom52WHighPct >= -3) highDistText = '52주 역사적 신고가 근접(돌파 시도)';
                else if (distFrom52WHighPct <= -20) highDistText = '52주 최고가 대비 심한 낙폭(베어마켓 궤도)';
                else highDistText = `52주 최고점 대비 ${distFrom52WHighPct.toFixed(1)}% 하락 위치`;

                const pre_digested_string = `${item.name}: ${Number(latest.close.toFixed(2))} (전일대비 ${dod_change > 0 ? '+' : ''}${dod_change.toFixed(2)}%). 상태: ${trendDesc}. 위치: ${highDistText}. 모멘텀: 1W(${weekChange > 0 ? '+' : ''}${weekChange.toFixed(1)}%), 1M(${monthChange > 0 ? '+' : ''}${monthChange.toFixed(1)}%)로 ${streakText} 중. RSI: ${rsi14.toFixed(1)} (${rsiText})!`;

                snapshots.push({
                    symbol: item.symbol,
                    name: item.name,
                    current_value: Number(latest.close.toFixed(2)),
                    previous_value: Number(previous.close.toFixed(2)),
                    dod_change_pct: Number(dod_change.toFixed(2)),
                    trend_summary: pre_digested_string
                } as any); // any as we expanded the interface below

            } catch (err) {
                console.error(`[MaiisMacroService] 지표 수집 실패 (${item.symbol}):`, err);
            }
        }

        return snapshots;
    }
}
