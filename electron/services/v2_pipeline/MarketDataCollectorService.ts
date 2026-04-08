import { KiwoomService } from '../KiwoomService';
import { DatabaseService } from '../DatabaseService';
import { eventBus, SystemEvent } from '../../utils/EventBus';
import { getKstDate } from '../../utils/DateUtils';

export class MarketDataCollectorService {
    private static instance: MarketDataCollectorService;
    private kiwoomService: KiwoomService;
    private dbService: DatabaseService;
    private isCollecting: boolean = false;

    private constructor() {
        this.kiwoomService = KiwoomService.getInstance();
        this.dbService = DatabaseService.getInstance();
    }

    public static getInstance(): MarketDataCollectorService {
        if (!MarketDataCollectorService.instance) {
            MarketDataCollectorService.instance = new MarketDataCollectorService();
        }
        return MarketDataCollectorService.instance;
    }

    public getIsCollecting(): boolean {
        return this.isCollecting;
    }

    /**
     * 전 종목 코스피/코스닥 60일치 일봉 데이터를 수집합니다.
     */
    public async runDailyCollection(days: number = 60): Promise<void> {
        if (this.isCollecting) {
            console.log('[MarketDataCollector] 이미 전 종목 수집이 진행 중입니다.');
            return;
        }

        this.isCollecting = true;
        eventBus.emit(SystemEvent.LOG_INFO, '[Data Pump] 전 종목 차트(OHLCV) 수집 엔진 가동 시작');

        try {
            // 1. 코스피('0')와 코스닥('10') 종목 리스트 징수
            const kospi = await this.kiwoomService.getAllStocks('0');
            const kosdaq = await this.kiwoomService.getAllStocks('10');
            
            // 일반 상장 주식(보통주) 여부 검증 함수
            const isValidOrdinaryStock = (name: string): boolean => {
                if (!name) return false;
                
                // 1. 스팩 (SPAC)
                if (name.includes('스팩')) return false;
                
                // 2. ETF / ETN 펀드 및 파생상품 브랜드
                const etfBrands = ['KODEX', 'TIGER', 'KBSTAR', 'KINDEX', 'ARIRANG', 'KOSEF', 'HANARO', 'ACE', 'SOL', 'TIMEFOLIO', '히어로즈', '마이티', 'TREX', 'FOCUS', 'HK', '파워'];
                for (const brand of etfBrands) {
                    if (name.startsWith(brand)) return false;
                }
                if (name.includes('ETN') || name.includes('선물') || name.includes('인버스') || name.includes('레버리지')) return false;
                
                // 3. 리츠 및 인프라 (부동산)
                if (name.includes('리츠') || name.includes('맥쿼리인프라') || name.includes('맵스')) return false;
                
                // 4. 우선주 (우, 우B, 우C 등)
                if (/우[A-Z]?$|우\(기\)$|우\(전환\)$/.test(name)) return false;
                
                return true;
            };

            // 중복 제거 및 특수 종목 제외 후 리스트 합치기
            const allStocksMap = new Map<string, any>();
            [...kospi, ...kosdaq].forEach(s => {
                if (s && s.stock_code && isValidOrdinaryStock(s.stock_name)) {
                    allStocksMap.set(s.stock_code, s);
                }
            });
            const allStocks = Array.from(allStocksMap.values());

            console.log(`[MarketDataCollector] 수집 대상 종목 수: ${allStocks.length}개`);
            eventBus.emit(SystemEvent.LOG_INFO, `[Data Pump] 수집 대상 종목 수: ${allStocks.length}개 (KOSPI/KOSDAQ)`);

            const db = (this.dbService as any).db;
            let successCount = 0;
            let failCount = 0;

            const insertStmt = db.prepare(`
                INSERT OR REPLACE INTO market_ohlcv_history 
                (stock_code, date, open, high, low, close, volume, trading_value)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `);

            // DB 트랜잭션 수동 커밋을 위해 배열에 담아 일괄 처리 방식을 사용할 수도 있으나, 
            // 징수가 오래 걸리므로 종목별 혹은 N개 단위 트랜잭션으로 처리
            const batchSize = 100;
            let currentBatch: any[] = [];

            const flushBatch = () => {
                if (currentBatch.length === 0) return;
                db.transaction(() => {
                    for (const row of currentBatch) {
                        insertStmt.run(row.stockCode, row.date, row.open, row.high, row.low, row.close, row.volume, row.tradingValue);
                    }
                })();
                currentBatch = [];
            };

            for (let i = 0; i < allStocks.length; i++) {
                const stock = allStocks[i];

                try {
                    // API Call: getDailyChartData 호출 (기본 80개, 우리는 days만큼 사용)
                    const rawData = await this.kiwoomService.getDailyChartData(stock.stock_code, days + 5);

                    if (Array.isArray(rawData) && rawData.length > 0) {
                        for (const row of rawData.slice(0, days)) {
                            // 날짜 파싱
                            const dateStr = String(row.dt || row.stnd_dt || row.stck_bsop_date || row.date || '').replace(/[-]/g, '');
                            if (dateStr.length !== 8) continue;
                            const formattedDate = `${dateStr.substring(0,4)}-${dateStr.substring(4,6)}-${dateStr.substring(6,8)}`;

                            const v = Object.keys(row).reduce((acc: any, k) => { acc[k] = row[k]; return acc; }, {});
                            const getVal = (keys: string[]) => {
                                for(const k of keys) {
                                    if (v[k] !== undefined && String(v[k]).trim() !== '') return String(v[k]).replace(/[,]/g, '').replace(/[-]/g, '');
                                }
                                return '0';
                            };

                            const open = parseInt(getVal(["open", "open_pric", "opn_prc", "stck_oprc", "oprc"]));
                            const high = parseInt(getVal(["high", "high_pric", "hg_prc", "stck_hgpr", "hgpr"]));
                            const low = parseInt(getVal(["low", "low_pric", "lw_prc", "stck_lwpr", "lwpr"]));
                            const close = parseInt(getVal(["close", "cur_prc", "stck_clpr", "clprc", "prpr"]));
                            const volume = parseInt(getVal(["volume", "trde_qty", "vol", "acml_vol"]));
                            
                            // 거래대금 파싱 (없으면 close * volume 평균치로 대체)
                            let tradingValue = parseInt(getVal(["trading_value", "trde_daeg", "acml_tr_pbmn"]));
                            if (tradingValue === 0 && volume > 0) {
                                tradingValue = Math.floor((open + close) / 2 * volume); // 보정
                            }

                            currentBatch.push({
                                stockCode: stock.stock_code,
                                date: formattedDate,
                                open, high, low, close, volume, tradingValue
                            });
                        }
                        successCount++;
                    } else {
                        failCount++;
                    }

                    // Flush batch
                    if (currentBatch.length >= batchSize) {
                        flushBatch();
                    }

                    // 진행상황 로깅
                    if ((i + 1) % 100 === 0) {
                        console.log(`[MarketDataCollector] 진행율: ${i + 1} / ${allStocks.length} ... (성공: ${successCount}, 실패: ${failCount})`);
                    }

                } catch (err: any) {
                    console.error(`[MarketDataCollector] 종목 수집 실패 (${stock.stock_code}):`, err.message);
                    failCount++;
                    
                    if (err.message && err.message.toLowerCase().includes('circuit')) {
                        console.error('[MarketDataCollector] 수집량을 초과하여 수집을 중단합니다.');
                        break;
                    }
                }
            }

            // 남은 데이터 저장
            flushBatch();

            const finishMsg = `[Data Pump] 수집 완료. 징수 종목: ${successCount}개 / 실패: ${failCount}개.`;
            console.log(finishMsg);
            eventBus.emit(SystemEvent.LOG_SUCCESS, finishMsg);

        } catch (error: any) {
            console.error('[MarketDataCollector] 수집 엔진 에러:', error);
            eventBus.emit(SystemEvent.LOG_ERROR, `[Data Pump] 수집 엔진 에러: ${error.message}`);
        } finally {
            this.isCollecting = false;
        }
    }
}
