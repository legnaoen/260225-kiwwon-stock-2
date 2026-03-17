import { KiwoomService } from './KiwoomService';
import { DatabaseService } from './DatabaseService';
import { DartApiService } from './DartApiService';
import Store from 'electron-store';
import { IngestionManager } from './IngestionManager';
// import { getKstDate } from '../utils/DateUtils';

const store = new Store();

export class StockMasterService {
    private static instance: StockMasterService;
    private db = DatabaseService.getInstance();
    private isSyncing = false;

    private constructor() {}

    public static getInstance(): StockMasterService {
        if (!StockMasterService.instance) {
            StockMasterService.instance = new StockMasterService();
        }
        return StockMasterService.instance;
    }

    /**
     * 앱 기동 시 혹은 스케줄에 따라 종목 마스터 데이터를 갱신합니다.
     * 날짜 체크 및 진행 중 플래그를 통해 중복 실행을 완벽히 방지합니다.
     */
    public async checkAndUpdate(force: boolean = false) {
        if (this.isSyncing) return;
        
        const today = this.db.getKstDate();
        const lastUpdate = this.db.getLatestStockUpdate();

        // 오늘 이미 업데이트되었고 강제 업데이트가 아니면 스킵
        if (!force && lastUpdate === today) {
            console.log(`[StockMasterService] Stock master is already up to date (${today}). Skipping sync.`);
            return;
        }

        this.isSyncing = true;
        const startTime = Date.now();
        console.log(`[StockMasterService] Starting stock master synchronization... (Last: ${lastUpdate})`);

        try {
            // 0. DART 법인코드 동기화 체크 (7일에 한 번 혹은 DB가 비었을 때)
            const dartApi = DartApiService.getInstance();
            const lastDartSync = store.get('last_dart_corp_sync_date') as string;
            
            const now = new Date();
            const sevenDaysAgoDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            const sevenDaysAgo = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(sevenDaysAgoDate);
            
            const corpCount = this.db.getDb().prepare('SELECT count(*) as cnt FROM dart_corp_code').get() as any;
            if (force || !lastDartSync || lastDartSync < sevenDaysAgo || corpCount.cnt === 0) {
                console.log('[StockMasterService] DART sync required. Syncing corp codes...');
                await dartApi.syncCorpCodes();
                store.set('last_dart_corp_sync_date', today);
            }

            const kiwoom = KiwoomService.getInstance();
            
            // 1. 키움 API로부터 전체 종목 가져오기 (KOSPI=0, KOSDAQ=10)
            const kospi = await kiwoom.getAllStocks('0');
            const kosdaq = await kiwoom.getAllStocks('10');

            const allKiwoomStocks = [
                ...kospi.map(s => ({ ...s, market: 'KOSPI' })),
                ...kosdaq.map(s => ({ ...s, market: 'KOSDAQ' }))
            ];

            // 2. DART 법인코드 매핑 정보 가져오기 (이미 DB에 있는 정보 활용)
            // Tip: DART 동기화는 DartApiService에서 별도로 관리되므로 여기선 맵핑만 시도
            const stockCodes = allKiwoomStocks.map(s => s.stock_code || s.code || s.stk_code).filter(Boolean);
            const corpMap = this.db.getCorpCodesByStockCodes(stockCodes);

            // 3. 통합 데이터 구성
            const masterData = allKiwoomStocks.map(s => {
                const code = s.stock_code || s.code || s.stk_code;
                const name = s.stock_name || s.name || s.stk_nm;
                return {
                    stock_code: code,
                    stock_name: name,
                    market_type: s.market,
                    corp_code: corpMap[code] || null,
                    updated_at: this.db.getKstDate()
                };
            });

            // 4. DB 저장
            if (masterData.length > 0) {
                this.db.insertStockMaster(masterData);
                console.log(`[StockMasterService] Successfully synced ${masterData.length} stocks to master table.`);
                
                // Record success to MAIIS Ingestion Tracking
                IngestionManager.getInstance().recordIngestion(
                    'kiwoom_daily_master',
                    'Kiwoom REST API',
                    startTime,
                    200,
                    Math.round(JSON.stringify(masterData).length / 1024)
                );
                IngestionManager.getInstance().markAsSuccess('kiwoom_daily_master');
            }

        } catch (error: any) {
            console.error('[StockMasterService] Synchronization failed:', error);
            
            // Record failure
            IngestionManager.getInstance().recordIngestion(
                'kiwoom_daily_master',
                'Kiwoom REST API',
                startTime,
                500,
                0,
                error.message || 'Unknown Error'
            );
        } finally {
            this.isSyncing = false;
        }
    }

    /**
     * 종목명이나 코드로 검색을 수행합니다. (DB 검색)
     */
    public async search(query: string, limit: number = 10) {
        if (!query || query.trim().length === 0) return [];
        return this.db.searchStocks(query, limit);
    }

    /**
     * 특정 코드로 종목 정보를 신속하게 가져옵니다.
     */
    public getStock(code: string) {
        return this.db.getStockByCode(code);
    }
}
