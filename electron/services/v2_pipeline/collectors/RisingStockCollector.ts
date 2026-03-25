import { IBaseCollector } from '../types/PipelineTypes';
import { KiwoomService } from '../../KiwoomService';
import { DatabaseService } from '../../DatabaseService';

/**
 * MarketScannerService와 동일한 ETF/ETN/SPAC 필터 로직.
 */
function isJunkStock(name: string): boolean {
    if (!name) return true;
    const upper = name.toUpperCase();
    if (upper.includes('KODEX') || upper.includes('TIGER') || upper.includes('KBSTAR') ||
        upper.includes('KOSEF') || upper.includes('ARIRANG') || upper.includes('HANARO') ||
        upper.includes('RISE') || upper.includes('ACE') || upper.includes('SOL')) return true;
    if (upper.includes('ETN') || upper.includes('스팩') || upper.includes('인버스') || upper.includes('레버리지')) return true;
    return false;
}

export class RisingStockCollector implements IBaseCollector {
    private kiwoom = KiwoomService.getInstance();
    private dbService = DatabaseService.getInstance();

    public async collect(options?: { forceFetch?: boolean }): Promise<any> {
        try {
            let topGainers: any[] = [];
            let topVolumes: any[] = [];
            let isFallback = false;

            // 1. Raw API 직접 호출 (MarketScannerService가 쓰는 동일한 메서드)
            const [risingResult, tradingResult] = await Promise.allSettled([
                this.kiwoom.getTopRisingStocks(),            // ka10027: 등락률 상위
                this.kiwoom.getTopTradingValueStocks()        // ka10030: 거래대금 상위
            ]);

            // ka10027 Raw 응답 디버그
            const risingRaw = risingResult.status === 'fulfilled' ? risingResult.value : null;
            if (risingRaw) {
                // ka10027 응답 키: pred_pre_flu_rt_upper (디버그로 확인됨)
                const risingList: any[] = risingRaw?.pred_pre_flu_rt_upper ?? risingRaw?.bid_req_upper ?? risingRaw?.rkinfo ?? risingRaw?.Body ?? risingRaw?.list ?? risingRaw?.output ?? [];
                if (risingList.length === 0) {
                    // 알려지지 않은 키에 배열이 있는지 확인
                    for (const key of Object.keys(risingRaw)) {
                        if (Array.isArray(risingRaw[key]) && risingRaw[key].length > 0) {
                            console.log(`[RisingStockCollector] ka10027 발견된 배열 키: '${key}' (${risingRaw[key].length}건)`);
                            console.log('[RisingStockCollector] ka10027 첫 항목 키:', Object.keys(risingRaw[key][0]));
                            // 이 배열을 사용
                            const list = risingRaw[key];
                            let rankG = 1;
                            for (const s of list) {
                                if (rankG > 15) break;
                                const name = s.stk_nm || s.name || '';
                                if (!name || isJunkStock(name)) continue;
                                const rate = parseFloat(s.flu_rt || s.flrt || s.prdy_ctrt || s.change_rate || '0');
                                topGainers.push({
                                    rank: rankG++,
                                    name: name,
                                    change: rate > 0 ? `+${rate.toFixed(2)}%` : `${rate.toFixed(2)}%`,
                                    reason_keyword: '실시간 포착'
                                });
                            }
                            break;
                        }
                    }
                } else {
                    let rankG = 1;
                    for (const s of risingList) {
                        if (rankG > 15) break;
                        const name = s.stk_nm || s.name || '';
                        if (!name || isJunkStock(name)) continue;
                        const rate = parseFloat(s.flu_rt || s.flrt || s.prdy_ctrt || '0');
                        topGainers.push({
                            rank: rankG++,
                            name: name,
                            change: rate > 0 ? `+${rate.toFixed(2)}%` : `${rate.toFixed(2)}%`,
                            reason_keyword: '실시간 포착'
                        });
                    }
                }
            }

            // ka10030 Raw 응답 디버그
            const tradingRaw = tradingResult.status === 'fulfilled' ? tradingResult.value : null;
            if (tradingRaw) {
                console.log('[RisingStockCollector] ka10030 응답 키:', Object.keys(tradingRaw));
                let tradingList: any[] = tradingRaw?.tdy_trde_qty_upper ?? [];
                if (tradingList.length === 0) {
                    for (const key of Object.keys(tradingRaw)) {
                        if (Array.isArray(tradingRaw[key]) && tradingRaw[key].length > 0) {
                            console.log(`[RisingStockCollector] ka10030 발견된 배열 키: '${key}' (${tradingRaw[key].length}건)`);
                            console.log('[RisingStockCollector] ka10030 첫 항목 키:', Object.keys(tradingRaw[key][0]));
                            tradingList = tradingRaw[key];
                            break;
                        }
                    }
                }
                if (tradingList.length > 0) {
                    // 첫 항목의 전체 필드를 찍어서 거래대금 필드명 확인
                    console.log('[RisingStockCollector] ka10030 첫 항목 전체:', JSON.stringify(tradingList[0]));
                    
                    let rankV = 1;
                    for (const s of tradingList) {
                        if (rankV > 15) break;
                        const name = s.stk_nm || s.name || '';
                        if (!name || isJunkStock(name)) continue;
                        const rate = parseFloat(s.flu_rt || s.flrt || s.prdy_ctrt || '0');
                        
                        // 거래대금 필드: trde_amt (디버그 확인: 백만원 단위, 삼성전자=3929080 → 39,290억)
                        const rawAmt = s.trde_amt || s.trde_prica || s.acml_tr_pbmn || '0';
                        const amtNum = parseInt(String(rawAmt).replace(/[^0-9]/g, ''), 10) || 0;
                        // trde_amt는 백만원 단위이므로 /100 → 억원
                        const volInBillion = amtNum > 0 
                            ? Math.round(amtNum / 100).toLocaleString() + '억'
                            : '-';

                        topVolumes.push({
                            rank: rankV++,
                            name: name,
                            volume: volInBillion,
                            change: rate > 0 ? `+${rate.toFixed(2)}%` : `${rate.toFixed(2)}%`,
                            reason_keyword: '실시간 포착'
                        });
                    }
                }
            }

            // 2. 장 마감 / 주말 / API 에러 시 → 레거시 DB Fallback
            if (topGainers.length === 0 && topVolumes.length === 0) {
                isFallback = true;
                const db = this.dbService.getDb();
                const latest = db.prepare('SELECT date, timing FROM daily_rising_stocks ORDER BY date DESC, timing DESC LIMIT 1').get() as any;
                if (latest) {
                    const stocks = db.prepare('SELECT * FROM daily_rising_stocks WHERE date = ? AND timing = ?').all(latest.date, latest.timing) as any[];
                    
                    const sortedByChange = [...stocks].sort((a,b) => (b.change_rate || 0) - (a.change_rate || 0)).slice(0, 15);
                    topGainers = sortedByChange.map((s, idx) => ({
                        rank: idx + 1, name: s.stock_name,
                        change: s.change_rate > 0 ? `+${s.change_rate.toFixed(1)}%` : `${s.change_rate.toFixed(1)}%`,
                        reason_keyword: s.theme_sector || '개별이슈'
                    }));

                    const sortedByVol = [...stocks].sort((a,b) => (b.trading_value || 0) - (a.trading_value || 0)).slice(0, 15);
                    topVolumes = sortedByVol.map((s, idx) => ({
                        rank: idx + 1, name: s.stock_name,
                        volume: s.trading_value ? `${Math.round(s.trading_value)}억` : '확인불가',
                        change: s.change_rate > 0 ? `+${s.change_rate.toFixed(1)}%` : `${s.change_rate.toFixed(1)}%`,
                        reason_keyword: s.theme_sector || '개별이슈'
                    }));
                }
            }

            return { 
                timestamp: new Date().toISOString(),
                targetDateStr: isFallback ? '마지막 개장일 (DB Fallback)' : new Date().toLocaleDateString('ko-KR') + ' (Kiwoom Live)',
                topGainers,
                topVolumes,
                thematicInsights: [
                    { theme: 'Sub-AI 대기', stocks: '데이터 정리 완료', reason: '추후 Sub-AI 테마 그룹핑 처리 예정' }
                ]
            };

        } catch (error: any) {
            console.error('[RisingStockCollector] Pipeline Error:', error);
            return { timestamp: new Date().toISOString(), error: '키움 파이프라인 에러: ' + error.message };
        }
    }
}
