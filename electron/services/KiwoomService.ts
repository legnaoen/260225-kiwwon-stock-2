import axios from 'axios'
import { KiwoomTokenManager } from '../kiwoomApi'
import { KiwoomWebSocketManager } from '../websocket'
import { KiwoomConditionWebSocketManager } from '../conditionWebSocket'
import { BrowserWindow } from 'electron'
import { eventBus, SystemEvent } from '../utils/EventBus'
// import { getKstDate } from '../utils/DateUtils'
import { DatabaseService } from './DatabaseService'

const BASE_URL = 'https://api.kiwoom.com'

export class KiwoomService {
    private static instance: KiwoomService;
    private tokenManager = KiwoomTokenManager.getInstance();
    private wsManager: KiwoomWebSocketManager | null = null;
    private conditionWsManager: KiwoomConditionWebSocketManager | null = null;
    private apiLogs: any[] = [];
    private requestQueue: Promise<any> = Promise.resolve();
    private readonly MIN_REQUEST_INTERVAL = 150; // 150ms gap as per Kiwoom recommendations
    private pendingRequestsCount = 0;
    private readonly MAX_PENDING_REQUESTS = 50; // 큐 최대 대기 수 (회로 차단 용)
    
    // 절대 원칙(SKILL.md 9장) 준수를 위한 캐시 및 회로 차단 변수
    private cacheStore: Map<string, { data: any, timestamp: number, ttl: number }> = new Map();
    private isCircuitHalted: boolean = false;
    private lastHaltTime: number = 0;
    private readonly HALT_DURATION = 60 * 1000; // 1분 (기존 5분에서 단축)
    private overheatedStocks: Set<string> = new Set();


    private kiwoomAxios = axios.create({
        baseURL: BASE_URL,
        timeout: 12000, // 12초 타임아웃 (서버 응답 지연 대비)
    });

    private constructor() {
        this.setupInterceptors();
    }

    /**
     * axios 인터셉터 설정 (진단 로깅 + 에러 이벤트 발행)
     * forceReconnect() 시 재등록할 수 있도록 별도 메서드로 분리
     */
    private setupInterceptors() {
        this.kiwoomAxios.interceptors.request.use((config) => {
            (config as any).metadata = { startTime: new Date() };
            return config;
        });

        this.kiwoomAxios.interceptors.response.use(
            (response) => {
                const config = response.config;
                const apiId = config.headers?.['api-id'] || 'Unknown API';
                const startTime = (config as any).metadata?.startTime;
                const duration = startTime ? (new Date().getTime() - startTime.getTime()) : 0;

                let parsedData = config.data;
                if (typeof config.data === 'string') {
                    try {
                        parsedData = JSON.parse(config.data);
                    } catch (e) { /* ignore */ }
                }

                const logEntry = {
                    id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
                    time: new Date().toLocaleTimeString('en-US', { hour12: false }),
                    apiId: apiId,
                    url: config.url,
                    requestData: parsedData,
                    responseData: response.data,
                    success: true,
                    duration: duration
                };

                this.apiLogs.unshift(logEntry);
                if (this.apiLogs.length > 50) this.apiLogs.pop();
                return response;
            },
            (error) => {
                const config = error.config;
                if (config) {
                    const apiId = config.headers?.['api-id'] || 'Unknown API';
                    const startTime = (config as any).metadata?.startTime;
                    const duration = startTime ? (new Date().getTime() - startTime.getTime()) : 0;

                    let parsedData = config.data;
                    if (typeof config.data === 'string') {
                        try {
                            parsedData = JSON.parse(config.data);
                        } catch (e) { /* ignore */ }
                    }

                    const logEntry = {
                        id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
                        time: new Date().toLocaleTimeString('en-US', { hour12: false }),
                        apiId: apiId,
                        url: config.url || 'Unknown URL',
                        requestData: parsedData,
                        responseData: error.response?.data || error.message,
                        success: false,
                        duration: duration
                    };

                    this.apiLogs.unshift(logEntry);
                    if (this.apiLogs.length > 50) this.apiLogs.pop();

                    // Emit system error for critical server issues or timeouts
                    if (error.code === 'ETIMEDOUT' || error.code === 'ECONNABORTED' || error.response?.status === 500) {
                        const isWarning = (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') && !this.isMarketHours();
                        const level = isWarning ? 'warning' : 'error';

                        const message = error.code === 'ETIMEDOUT' ? '키움 서버 연결 타임아웃 (서버 과부하)' : 
                                      error.code === 'ECONNABORTED' ? '키움 서버 응답 지연 (타임아웃. 서버 점검 중일 수 있습니다)' :
                                      error.response?.status === 500 ? '키움 서버 내부 오류 (Internal Server Error)' : 
                                      '키움 서버 통신 오류';
                        eventBus.emit(SystemEvent.SYSTEM_ERROR, { 
                            message, 
                            code: error.code || error.response?.status.toString(),
                            time: logEntry.time,
                            level
                        });

                        // ★ 타임아웃 전용 이벤트: SchedulerService 자동 복구 트리거
                        if (error.code === 'ETIMEDOUT' || error.code === 'ECONNABORTED') {
                            eventBus.emit(SystemEvent.KIWOOM_TIMEOUT, { code: error.code });
                        }
                    }
                }
                throw error;
            }
        );
    }

    public getApiLogs() {
        return this.apiLogs;
    }

    private isMarketHours(): boolean {
        // KST 기준 장 운영 시간 (08:30 ~ 16:00, 평일)
        const now = new Date();
        const kstTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
        const day = kstTime.getDay();
        const hour = kstTime.getHours();
        const minute = kstTime.getMinutes();
        const timeVal = hour * 100 + minute;
        return day >= 1 && day <= 5 && timeVal >= 830 && timeVal <= 1600;
    }

    public static getInstance(): KiwoomService {
        if (!KiwoomService.instance) {
            KiwoomService.instance = new KiwoomService();
        }
        return KiwoomService.instance;
    }

    public isCircuitBroken(): boolean {
        if (this.isCircuitHalted && (Date.now() - this.lastHaltTime < this.HALT_DURATION)) {
            return true;
        }
        return false;
    }

    public initWebSocket(win: BrowserWindow) {
        this.wsManager = new KiwoomWebSocketManager(win);
        this.conditionWsManager = new KiwoomConditionWebSocketManager(win);
    }

    public disconnectWebSocket() {
        if (this.wsManager) {
            this.wsManager.disconnect();
            this.wsManager = null;
        }
        if (this.conditionWsManager) {
            this.conditionWsManager.disconnect();
            this.conditionWsManager = null;
        }
    }

    // Retry wrapper for API calls to handle token expiration (8005 errors)
    // 추후 이 곳에 Queue 및 Throttling 로직을 추가하여 속도 제한을 제어할 수 있습니다.
    private async makeApiRequestWithRetry(apiCallFunc: (token: string) => Promise<any>, options: { cacheKey?: string, ttl?: number } = {}): Promise<any> {
        // 1. 캐시 체크 (절대 원칙 9.2)
        if (options.cacheKey) {
            const cached = this.cacheStore.get(options.cacheKey);
            if (cached && Date.now() - cached.timestamp < cached.ttl) {
                // console.log(`[KiwoomService] Cache Hit: ${options.cacheKey}`);
                return cached.data; // 일관성을 위해 데이터만 반환
            }
        }

        // 2. 회로 차단 체크 (절대 원칙 9.4)
        if (this.isCircuitHalted) {
            if (Date.now() - this.lastHaltTime < this.HALT_DURATION) {
                const remaining = Math.ceil((this.HALT_DURATION - (Date.now() - this.lastHaltTime)) / 1000);
                throw new Error(`[Circuit Breaker] 키움 서버 과부하로 인해 통신이 일시 중단되었습니다. (${remaining}초 후 재개 또는 설정에서 초기화 가능)`);
            } else {
                console.log('[KiwoomService] Circuit Breaker: Cooling period passed. Resuming...');
                this.isCircuitHalted = false;
            }
        }

        // 3. 큐 대기 체크
        if (this.pendingRequestsCount >= this.MAX_PENDING_REQUESTS) {
            console.error(`[KiwoomService] Circuit Breaker: Too many pending requests (${this.pendingRequestsCount})`);
            throw new Error('서버 요청이 너무 많아 잠시 차단되었습니다. 잠시 후 다시 시도해주세요.');
        }

        this.pendingRequestsCount++;

        return this.requestQueue = this.requestQueue.catch(() => {}).then(async () => {
            const now = Date.now();
            await new Promise(resolve => setTimeout(resolve, this.MIN_REQUEST_INTERVAL));

            try {
                let token = await this.tokenManager.getAccessToken();
                let response = await apiCallFunc(token);

                // Kiwoom return_code 체크 (0: 성공, 그 외: 오류)
                const apiData = response; 
                if (apiData && apiData.return_code === 3 &&
                    (JSON.stringify(apiData).includes('8005') || JSON.stringify(apiData).includes('Token'))) {
                    throw new Error('TOKEN_EXPIRED');
                }

                // 성공 시에만 캐시 저장 (return_code가 0이거나 없을 때)
                const isSuccess = !apiData.return_code || apiData.return_code === 0 || apiData.return_code === '0';
                if (options.cacheKey && apiData && isSuccess) {
                    this.cacheStore.set(options.cacheKey, {
                        data: apiData,
                        timestamp: Date.now(),
                        ttl: options.ttl || (5 * 60 * 1000)
                    });
                }

                return apiData;
            } catch (err: any) {
                // 특정 에러 발생 시 회로 차단 발동 (절대 원칙 9.4)
                if (err.code === 'ETIMEDOUT' || err.code === 'ECONNABORTED' || err.code === 'ECONNREFUSED' || err.response?.status === 429) {
                    console.error(`[KiwoomService] Critical Error Detected (${err.code}). Activating Circuit Breaker for ${Math.round(this.HALT_DURATION / 60000)} mins.`);
                    this.isCircuitHalted = true;
                    this.lastHaltTime = Date.now();
                }

                if (err.message === 'TOKEN_EXPIRED' || err.response?.status === 401 || JSON.stringify(err.response?.data || '').includes('Token') || JSON.stringify(err.response?.data || '').includes('8005')) {
                    console.log('Token invalid or expired (8005). Forcing refresh and retrying once...');
                    this.tokenManager.clearTokens();
                    let newToken = await this.tokenManager.getAccessToken(true);
                    eventBus.emit(SystemEvent.TOKEN_REFRESHED, null);

                    let retryResponse = await apiCallFunc(newToken);

                    if (retryResponse && retryResponse.return_code === 3 &&
                        (JSON.stringify(retryResponse).includes('8005') || JSON.stringify(retryResponse).includes('Token'))) {
                        throw new Error('토큰 재발급 후에도 인증에 실패했습니다. 설정 탭에서 API 키를 다시 확인해주세요.');
                    }
                    
                    const isRetrySuccess = !retryResponse.return_code || retryResponse.return_code === 0 || retryResponse.return_code === '0';
                    if (options.cacheKey && retryResponse && isRetrySuccess) {
                        this.cacheStore.set(options.cacheKey, {
                            data: retryResponse,
                            timestamp: Date.now(),
                            ttl: options.ttl || (5 * 60 * 1000)
                        });
                    }
                    return retryResponse;
                }
                throw err;
            }
        }).finally(() => {
            this.pendingRequestsCount = Math.max(0, this.pendingRequestsCount - 1);
        }).catch(err => {
            console.error('[KiwoomService] Request Queue Error:', err.message);
            throw err;
        });
    }

    public async saveKeys(keys: { appkey: string, secretkey: string }) {
        // 이미 main.ts에서 store.set은 처리하므로 검증만 수행해도 됩니다.
        // 또는 여기서 store처리를 다 받아와도 됩니다. (현재는 main.ts가 store에 직접 접근)
        this.tokenManager.clearTokens()
        await this.tokenManager.getAccessToken(true)
    }

    public async getConnectionStatus() {
        return await this.tokenManager.getConnectionStatus()
    }

    public resetCircuitBreaker() {
        console.log('[KiwoomService] Manual Circuit Breaker Reset requested.');
        this.isCircuitHalted = false;
        this.lastHaltTime = 0;
        this.pendingRequestsCount = 0;
    }

    /**
     * 강제 재연결 (타임아웃 자동 복구용)
     * 프로그램 재시작과 동일한 효과: requestQueue + 토큰 + axios 인스턴스 리셋
     */
    public async forceReconnect(): Promise<boolean> {
        console.log('[KiwoomService] 🔄 강제 재연결 시작 (requestQueue + 토큰 + 연결 풀 리셋)...');
        try {
            // 1. requestQueue 리셋 — Promise 체인 오염 해소
            this.requestQueue = Promise.resolve();
            this.pendingRequestsCount = 0;

            // 2. Circuit Breaker 해제
            this.isCircuitHalted = false;
            this.lastHaltTime = 0;

            // 3. 토큰 강제 재발급 — 서버와 세션 재동기화
            this.tokenManager.clearTokens();
            await this.tokenManager.getAccessToken(true);

            // 4. axios 인스턴스 재생성 — TCP 연결 풀(Keep-Alive) 초기화
            this.kiwoomAxios = axios.create({
                baseURL: BASE_URL,
                timeout: 12000,
            });
            this.setupInterceptors();

            console.log('[KiwoomService] ✅ 강제 재연결 성공');
            return true;
        } catch (e: any) {
            console.error('[KiwoomService] ❌ 강제 재연결 실패:', e.message);
            return false;
        }
    }

    // [LEGACY] 키움 계좌 목록 조회 (V2 전환으로 비활성화 -> 복구)
    public async getAccounts() {
        const url = `/api/dostk/acnt`
        const response = await this.makeApiRequestWithRetry((t) => this.kiwoomAxios.post(url, {}, {
            headers: {
                'Content-Type': 'application/json;charset=UTF-8',
                'authorization': `Bearer ${t}`,
                'api-id': 'ka00001'
            }
        }))
        return response.data;
    }

    public async getHoldings(accountNo: string, nextKey: string = "") {
        const url = `/api/dostk/acnt`
        const response = await this.makeApiRequestWithRetry((t) => this.kiwoomAxios.post(url, {
            account_no: accountNo,
            qry_tp: "1",
            dmst_stex_tp: "KRX",
        }, {
            headers: {
                'Content-Type': 'application/json;charset=UTF-8',
                'authorization': `Bearer ${t}`,
                'api-id': 'kt00018',
                'cont-yn': nextKey ? 'Y' : 'N',
                'next-key': nextKey || ""
            }
        }))

        return { data: response.data, headers: response.headers };
    }

    // 예수금 내역 조회 (kt00016) — 복원됨
    public async getDeposit(accountNo: string) {
        const url = `/api/dostk/acnt`
        const today = DatabaseService.getInstance().getKstDate().replace(/-/g, '')
        const sevenDaysAgoDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
        const formatter = new Intl.DateTimeFormat('sv-SE', {
            timeZone: 'Asia/Seoul',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        });
        const sevenDaysAgo = formatter.format(sevenDaysAgoDate).replace(/-/g, '');

        const response = await this.makeApiRequestWithRetry((t) => this.kiwoomAxios.post(url, {
            account_no: accountNo,
            fr_dt: sevenDaysAgo,
            to_dt: today
        }, {
            headers: {
                'Content-Type': 'application/json;charset=UTF-8',
                'authorization': `Bearer ${t}`,
                'api-id': 'kt00016'
            }
        }))
        return response.data;
    }

    public async getAllStocks(marketType: string) {
        const cacheKey = `ALL_STOCKS_${marketType}`;
        const cached = this.cacheStore.get(cacheKey);
        const dayInMs = 24 * 60 * 60 * 1000;
        
        if (cached && Date.now() - cached.timestamp < dayInMs) {
            console.log(`[KiwoomService] Using cached stock list for ${marketType}`);
            return cached.data;
        }

        console.log(`[KiwoomService] Fetching all stocks from Kiwoom API for market ${marketType}...`);
        const url = `${BASE_URL}/api/dostk/stkinfo`
        let allStocks: any[] = []
        let hasMore = true
        let nextKey = ''

        while (hasMore) {
            try {
                const response = await this.makeApiRequestWithRetry((t) => this.kiwoomAxios.post(url, {
                    mrkt_tp: marketType
                }, {
                    headers: {
                        'Content-Type': 'application/json;charset=UTF-8',
                        'authorization': `Bearer ${t}`,
                        'api-id': 'ka10099',
                        'cont-yn': nextKey ? 'Y' : 'N',
                        'next-key': nextKey
                    }
                }))

                const data = response.data
                const list = data?.Body || data?.list || []
                allStocks = allStocks.concat(list)

                nextKey = response.headers['next-key'] || ''
                hasMore = (response.headers['cont-yn'] === 'Y' && !!nextKey)

                if (hasMore) await new Promise(resolve => setTimeout(resolve, 150))
            } catch (err) {
                console.error(`[KiwoomService] Failed to fetch stock list chunk:`, err);
                hasMore = false; 
            }
        }

        // 단기과열 종목 추출 및 저장
        this.overheatedStocks.clear();
        for (const s of allStocks) {
            const code = (s.stck_shrn_iscd || s.code || '').replace(/[^0-9A-Z]/g, '');
            if (s.auditInfo === '단기과열' || s.orderWarning === '3') {
                this.overheatedStocks.add(code);
            }
        }
        console.log(`[KiwoomService] 단기과열 종목 리스트 갱신 완료: ${this.overheatedStocks.size}개 종목`);

        const result = allStocks.map(s => ({
            stock_code: (s.stck_shrn_iscd || s.code || '').replace(/[^0-9A-Z]/g, ''),
            stock_name: s.stck_nm || s.name || ''
        }));


        if (result.length > 0) {
            this.cacheStore.set(cacheKey, {
                data: result,
                timestamp: Date.now(),
                ttl: dayInMs
            });
        }

        return result;
    }

    /**
     * 특정 종목이 단기과열(과열방지) 상태인지 확인
     */
    public isOverheatedStock(stk_cd: string): boolean {
        const cleanCode = (stk_cd || '').replace(/[^0-9]/g, '');
        return this.overheatedStocks.has(cleanCode);
    }


    // [LEGACY] 관심종목 조회 (V2 전환으로 비활성화)
    public async getWatchlist(symbols: string[]) {
        return [];
        /*
        const url = `/api/dostk/stkinfo`
        const response = await this.makeApiRequestWithRetry((t) => this.kiwoomAxios.post(url, {
            stk_cd: symbols.join('|')
        }, {
            headers: {
                'Content-Type': 'application/json;charset=UTF-8',
                'authorization': `Bearer ${t}`,
                'api-id': 'ka10095'
            }
        }))
        return response.data;
        */
    }

    public async getChartData(stk_cd: string, base_dt?: string) {
        const url = `/api/dostk/chart`
        const today = DatabaseService.getInstance().getKstDate().replace(/-/g, '')
        const response = await this.makeApiRequestWithRetry((t) => this.kiwoomAxios.post(url, {
            stk_cd,
            base_dt: base_dt || today,
            upd_stkpc_tp: '1'
        }, {
            headers: {
                'Content-Type': 'application/json;charset=UTF-8',
                'authorization': `Bearer ${t}`,
                'api-id': 'ka10081'
            }
        }))

        return response.data;
    }

    /**
     * AI 분석을 위해 설정된 거래일의 일봉 데이터를 가져옵니다. 기본 80, 최대 가용 수량까지.
     */
    public async getDailyChartData(stk_cd: string, count: number = 80): Promise<any[]> {
        const data = await this.getChartData(stk_cd);
        const list = data?.stk_dt_pole_chart_qry || data?.output2 || data?.Body || data?.list || [];
        return Array.isArray(list) ? list.slice(0, count) : [];
    }

    /**
     * 일봉 연속 데이터를 가져와서 timestamp 형태의 통일된 규격으로 반환 (AI 및 차트 렌더링용)
     */
    public async getOhlcvDaily(ticker: string, count: number = 80): Promise<any[]> {
        const data = await this.getDailyChartData(ticker, count);
        const candles: any[] = [];
        
        for (const row of Object.values(data).slice(0, count) as any[]) {
            const dateStr = String(row.dt || row.stnd_dt || row.stck_bsop_date || row.date || '').replace(/[-]/g, '');
            if (dateStr.length !== 8) continue;
            
            const year = parseInt(dateStr.substring(0, 4));
            const month = parseInt(dateStr.substring(4, 6)) - 1;
            const day = parseInt(dateStr.substring(6, 8));
            // Set to 00:00:00 UTC for EOD
            const epochSec = Date.UTC(year, month, day) / 1000;

            const v = Object.keys(row).reduce((acc: any, k) => { acc[k] = row[k]; return acc; }, {});
            const getVal = (keys: string[]) => {
                for(const k of keys) {
                    if (v[k] !== undefined && String(v[k]).trim() !== '') return String(v[k]).replace(/[,]/g, '').replace(/[-]/g, '');
                }
                return '0';
            };

            candles.push({
                time: epochSec,
                open: parseFloat(getVal(["open", "open_pric", "opn_prc"])),
                high: parseFloat(getVal(["high", "high_pric", "hgpr"])),
                low: parseFloat(getVal(["low", "low_pric", "lwpr"])),
                close: parseFloat(getVal(["close", "cur_prc", "prpr"])),
                volume: parseInt(getVal(["volume", "trde_qty", "vol"]))
            });
        }
        
        return candles.sort((a, b) => a.time - b.time);
    }

    /**
     * ETF/주식의 5분봉 연속 데이터를 가져옵니다 (기본 최근 3거래일치 수집)
     * Vwap 및 Intraday Swarm 차트 모멘텀 파싱용
     */
    public async getOhlcv5m(ticker: string, days: number = 3): Promise<any[]> {
        const url = `/api/dostk/chart`;
        let candles: any[] = [];
        let contYn = 'N';
        let nextKey = '';
        let uniqueDates = new Set<string>();
        let limitReached = false;

        while (!limitReached) {
            const headers: any = {
                'Content-Type': 'application/json;charset=UTF-8',
                'api-id': 'ka10080',
                'cont-yn': contYn,
                'next-key': nextKey
            };

            const response = await this.makeApiRequestWithRetry((t) => this.kiwoomAxios.post(url, {
                stk_cd: ticker,
                tic_scope: '5',
                upd_stkpc_tp: '1'
            }, {
                headers: { ...headers, 'authorization': `Bearer ${t}` }
            }));

            const data = response.data;
            const rows = data?.stk_min_pole_chart_qry || data?.output || data?.output1 || data?.chart || data?.data || [];
            
            if (!Array.isArray(rows) || rows.length === 0) break;

            for (const row of rows) {
                // Determine timestamp string
                let tStr = String(row.cntr_tm || row.stnd_tm || row.stck_bsop_date || row.date || row.dt || '').replace(/[-:\s]/g, '');
                if (tStr.length === 8) tStr += '000000';
                else if (tStr.length < 8) {
                    const stndDt = String(row.stnd_dt || '');
                    const stndTm = String(row.stnd_tm || '');
                    tStr = stndDt + stndTm;
                    if (tStr.length < 8) continue;
                }

                const dStr = tStr.substring(0, 8);
                uniqueDates.add(dStr);

                if (uniqueDates.size > days) {
                    limitReached = true;
                    break;
                }

                // parse values
                const v = Object.keys(row).reduce((acc: any, k) => { acc[k] = row[k]; return acc; }, {});
                
                // Helper to get first valid num from keys
                const getVal = (keys: string[]) => {
                    for(const k of keys) {
                        if (v[k] !== undefined && String(v[k]).trim() !== '') return String(v[k]).replace(/[,]/g, '').replace(/[-]/g, '');
                    }
                    return '0';
                };

                const openStr = getVal(["open", "open_pric", "opn_prc"]);
                const highStr = getVal(["high", "high_pric", "hgpr"]);
                const lowStr = getVal(["low", "low_pric", "lwpr"]);
                const closeStr = getVal(["close", "cur_prc", "prpr"]);
                const volStr = getVal(["volume", "trde_qty", "vol"]);

                // Parse KST to Epoch UTC manually for TradingView / Unix timestamp
                // Using YYYYMMDDHHMMSS format
                tStr = tStr.padEnd(14, '0').substring(0, 14);
                const year = parseInt(tStr.substring(0, 4));
                const month = parseInt(tStr.substring(4, 6)) - 1;
                const day = parseInt(tStr.substring(6, 8));
                const hour = parseInt(tStr.substring(8, 10));
                const min = parseInt(tStr.substring(10, 12));
                const sec = parseInt(tStr.substring(12, 14));
                
                // We create a UTC Date corresponding to the KST time (subtract 9 hrs)
                const epochSec = Date.UTC(year, month, day, hour - 9, min, sec) / 1000;

                candles.push({
                    time: epochSec,
                    open: parseFloat(openStr),
                    high: parseFloat(highStr),
                    low: parseFloat(lowStr),
                    close: parseFloat(closeStr),
                    volume: parseInt(volStr)
                });
            }

            const resContYn = response.headers['cont-yn'] || response.headers['Cont-Yn'];
            if (resContYn === 'Y' && !limitReached) {
                contYn = 'Y';
                nextKey = response.headers['next-key'] || response.headers['Next-Key'] || '';
            } else {
                break;
            }
        }

        // Sort ascending by time
        return candles.sort((a, b) => a.time - b.time);
    }

    /**
     * 최근 거래일(장 운영일)을 반환합니다 (YYYY-MM-DD)
     */
    public async getLatestTradingDay(): Promise<string> {
        const list = await this.getDailyChartData('005930');
        if (list.length === 0) return DatabaseService.getInstance().getKstDate();
        const last = list[0];
        const dateStr = String(last.dt || last.stck_bsop_date || last.date || last.trd_dt || '');
        if (dateStr.length === 8) {
            return `${dateStr.substring(0, 4)}-${dateStr.substring(4, 6)}-${dateStr.substring(6, 8)}`;
        }
        return dateStr;
    }

    /**
     * 주식 기본 정보 조회 (ka10001)
     */
    public async getStockBasicInfo(stk_cd: string) {
        const url = `/api/dostk/stkinfo`
        const response = await this.makeApiRequestWithRetry((t) => this.kiwoomAxios.post(url, {
            stk_cd
        }, {
            headers: {
                'Content-Type': 'application/json;charset=UTF-8',
                'authorization': `Bearer ${t}`,
                'cont-yn': 'N',
                'api-id': 'ka10001'
            }
        }), { cacheKey: `stkinfo:${stk_cd}`, ttl: 4 * 60 * 60 * 1000 })
        return response.data;
    }

    public async getCurrentPrice(stk_cd: string) {
        const url = `/api/dostk/stkrtprc`
        const response = await this.makeApiRequestWithRetry((t) => this.kiwoomAxios.post(url, {
            stk_cd
        }, {
            headers: {
                'Content-Type': 'application/json;charset=UTF-8',
                'authorization': `Bearer ${t}`,
                'cont-yn': 'N',
                'api-id': 'ka10004'
            }
        }))
        return response.data;
    }

    public async wsRegister(symbols: string[]) {
        if (this.wsManager) {
            let token = await this.tokenManager.getAccessToken()
            await this.wsManager.connect(token)
            this.wsManager.registerItems(symbols)
            return true;
        }
        return false;
    }

    /** 특정 종목의 실시간 시세 구독을 해제합니다. */
    public wsUnregister(symbols: string[]) {
        if (this.wsManager) {
            this.wsManager.unregisterItems(symbols)
            return true;
        }
        return false;
    }

    /** 현재 WS 구독 중인 종목코드 Set (6자리 숫자)을 반환합니다. */
    public wsGetRegisteredCodes(): Set<string> {
        if (this.wsManager) {
            return this.wsManager.getRegisteredCodes()
        }
        return new Set()
    }

    public getConditionList() {
        if (this.conditionWsManager) {
            return this.conditionWsManager.getConditions()
        }
        return []
    }

    public async connectConditionWs() {
        let token = await this.tokenManager.getAccessToken()
        if (this.conditionWsManager) this.conditionWsManager.connect(token)
    }

    public async startConditionSearch(seq: string) {
        if (!this.conditionWsManager) throw new Error("Condition WebSocket Manager is not initialized");

        // WS가 끊겨 있으면 재연결 후 최대 10초 대기
        const isReady = () => {
            const conditions = this.conditionWsManager!.getConditions();
            // 조건식 목록이 수신됐다면 로그인까지 완료된 상태
            return conditions.length > 0;
        };

        if (!isReady()) {
            console.log('[KiwoomService] Condition WS 미연결 감지 → 재연결 시도...');
            await this.connectConditionWs();

            // 최대 10초(500ms × 20회) 대기
            const maxRetries = 20;
            for (let i = 0; i < maxRetries; i++) {
                await new Promise(resolve => setTimeout(resolve, 500));
                if (isReady()) {
                    console.log(`[KiwoomService] Condition WS 재연결 완료 (${(i + 1) * 0.5}초 소요). 조건 검색 실행.`);
                    break;
                }
                if (i === maxRetries - 1) {
                    throw new Error('Condition WebSocket 재연결 실패: 10초 내 조건식 목록을 수신하지 못했습니다.');
                }
            }
        }

        console.log('[KiwoomService] Requesting condition search for seq:', seq);
        this.conditionWsManager.requestConditionSearch(seq);
    }

    /**
     * 국내주식 매수 주문
     */
    public async sendBuyOrder(accountNo: string, stk_cd: string, qty: number, price: number, trdeType: string = '00'): Promise<any> {
        return this.makeApiRequestWithRetry(async (token) => {
            const url = `/api/dostk/ordr`
            const headers = {
                'Content-Type': 'application/json;charset=UTF-8',
                'authorization': `Bearer ${token}`,
                'api-id': 'kt10000', // 매수
            }
            
            const normalizedTrdeType = trdeType === '5' ? '05' : trdeType;
            
            const body: any = {
                acnt_no: accountNo,
                dmst_stex_tp: 'KRX',
                stk_cd: stk_cd,
                ord_qty: String(qty),
                ord_uv: String(price),
                trde_tp: normalizedTrdeType, 
            }
            // 지정가 주문인 경우 cond_uv를 아예 포함하지 않아야 오류 방지 가능
            const response = await this.kiwoomAxios.post(url, body, { headers })
            return response.data
        })
    }

    /**
     * 국내주식 매도 주문
     * @param trdeType '00':지정가, '05':조건부지정가
     * ⚠️ 키움 REST API 매도 주문은 cond_uv(스톱가격) 파라미터를 사용하지 않음 (407022 오류 방지)
     */
    public async sendSellOrder(accountNo: string, stk_cd: string, qty: number, price: number, trdeType: string = '00', condUv: string = ''): Promise<any> {
        return this.makeApiRequestWithRetry(async (token) => {
            const url = `${BASE_URL}/api/dostk/ordr`
            const headers = {
                'Content-Type': 'application/json;charset=UTF-8',
                'authorization': `Bearer ${token}`,
                'api-id': 'kt10001', // 매도
            }

            // trdeType 표준화: '5' -> '05'
            const normalizedTrdeType = trdeType === '5' ? '05' : trdeType;

            // ⚠️ 키움 REST API 국내주식 매도 주문은 cond_uv(스톱가격)를 절대 포함하면 안됨
            // 포함 시 error 407022 발생: "해당 주문은 스톱가격을 입력하지 않습니다"
            const body: any = {
                acnt_no: accountNo,
                dmst_stex_tp: 'KRX',
                stk_cd: stk_cd,
                ord_qty: String(qty),
                ord_uv: String(price),
                trde_tp: normalizedTrdeType,
            }

            console.log(`[KiwoomService] sendSellOrder: code=${stk_cd}, qty=${qty}, price=${price}, trde_tp=${normalizedTrdeType}`);
            const response = await this.kiwoomAxios.post(url, body, { headers })
            return response.data
        })
    }

    /**
     * 국내주식 정정 주문
     */
    public async modifyOrder(accountNo: string, orig_ord_no: string, stk_cd: string, mdfy_qty: number, mdfy_uv: number, trde_tp: string = '00'): Promise<any> {
        return this.makeApiRequestWithRetry(async (token) => {
            const url = `${BASE_URL}/api/dostk/ordr`
            const headers = {
                'Content-Type': 'application/json;charset=UTF-8',
                'authorization': `Bearer ${token}`,
                'api-id': 'kt10002', // 정정
            }
            
            // 시장가 정정(trde_tp가 '03' 또는 '3')인 경우 가격은 빈 문자열("")로 전송해야 오류 방지 가능
            const isMarketOrder = trde_tp === '03' || trde_tp === '3';
            const body = {
                acnt_no: accountNo,
                dmst_stex_tp: 'KRX',
                stk_cd: stk_cd,
                orig_ord_no: orig_ord_no,
                mdfy_qty: String(mdfy_qty),
                mdfy_uv: isMarketOrder ? '' : String(mdfy_uv),
                trde_tp: trde_tp, // 지정가 '00', 시장가 '03' 등
                cond_uv: ''
            }
            const response = await this.kiwoomAxios.post(url, body, { headers })
            return response.data
        })
    }


    /**
     * 국내주식 취소 주문
     */
    public async cancelOrder(accountNo: string, orig_ord_no: string, stk_cd: string, mdfy_qty: number): Promise<any> {
        return this.makeApiRequestWithRetry(async (token) => {
            const url = `${BASE_URL}/api/dostk/ordr`
            const headers = {
                'Content-Type': 'application/json;charset=UTF-8',
                'authorization': `Bearer ${token}`,
                'api-id': 'kt10003', // 취소
            }
            const body = {
                acnt_no: accountNo,
                dmst_stex_tp: 'KRX',
                stk_cd: stk_cd,
                orig_ord_no: orig_ord_no,
                mdfy_qty: String(mdfy_qty),
                trde_tp: '00'
            }
            const response = await this.kiwoomAxios.post(url, body, { headers })
            return response.data
        })
    }

    /**
     * 미체결 주문 내역 조회 (ka10075)
     */
    public async getUnexecutedOrders(
        accountNo: string,
        options: {
            all_stk_tp?: string;
            trde_tp?: string;
            stk_cd?: string;
        } = {}
    ): Promise<any> {
        const {
            all_stk_tp = '1', // 전체 종목 조회
            trde_tp = '0', // 전체 매매구분
            stk_cd = '', // 특정 종목코드 없으면 전체
        } = options;

        return this.makeApiRequestWithRetry(async (token) => {
            try {
                const url = `/api/dostk/acnt`;
                const headers = {
                    'Content-Type': 'application/json;charset=UTF-8',
                    'authorization': `Bearer ${token}`,
                    'api-id': 'ka10075' 
                };
                const body = {
                    acnt_no: accountNo,
                    all_stk_tp: all_stk_tp,
                    trde_tp: trde_tp,
                    stk_cd: stk_cd,
                };
                const response = await this.kiwoomAxios.post(url, body, { headers });
                // Check if response has Body or similar list
                let orderList = [];
                if (response.data && response.data.Body) {
                    orderList = Array.isArray(response.data.Body) ? response.data.Body : [response.data.Body];
                } else if (response.data && response.data.list) {
                    orderList = response.data.list;
                } else if (response.data && Array.isArray(response.data)) {
                    orderList = response.data;
                }
                
                if (orderList.length > 0) console.log(`[KiwoomService] 미체결 조회 (ka10075): ${orderList.length}건`);
                
                return { oso: orderList };
            } catch (error: any) {
                console.error(`[KiwoomService] 미체결 조회 에러:`, error.response?.data || error.message);
                throw error;
            }
        });
    }

    /**
     * 계좌별주문체결내역상세요청 (kt00007) - 매도/매수 등 정밀 미체결 조회
     */
    public async getUnexecutedOrdersKt00007(
        accountNo: string,
        options: {
            sell_tp?: string; // '0': 전체, '1': 매도, '2': 매수
            stk_cd?: string;
        } = {}
    ): Promise<any> {
        const {
            sell_tp = '1', // 기본값: 매도 미체결만 조회
            stk_cd = '',
        } = options;

        return this.makeApiRequestWithRetry(async (token) => {
            try {
                const url = `/api/dostk/acnt`;
                const headers = {
                    'Content-Type': 'application/json;charset=UTF-8',
                    'authorization': `Bearer ${token}`,
                    'api-id': 'kt00007',
                    'cont-yn': 'N',
                    'next-key': ''
                };
                const body = {
                    account_no: accountNo,
                    ord_dt: '', // 오늘
                    qry_tp: '3', // 3: 미체결 내역
                    stk_bond_tp: '1', // 1: 주식
                    sell_tp: sell_tp,
                    stk_cd: stk_cd,
                    fr_ord_no: '',
                    dmst_stex_tp: '%'
                };
                const response = await this.kiwoomAxios.post(url, body, { headers });
                
                let orderList = [];
                if (response.data && response.data.acnt_ord_cntr_prps_dtl) {
                    orderList = Array.isArray(response.data.acnt_ord_cntr_prps_dtl) 
                        ? response.data.acnt_ord_cntr_prps_dtl 
                        : [response.data.acnt_ord_cntr_prps_dtl];
                } else if (response.data && response.data.Body) {
                    orderList = Array.isArray(response.data.Body) ? response.data.Body : [response.data.Body];
                } else if (response.data && response.data.list) {
                    orderList = response.data.list;
                }
                
                if (orderList.length > 0) console.log(`[KiwoomService] 미체결(매도) 조회 (kt00007): ${orderList.length}건`);
                
                return { oso: orderList };
            } catch (error: any) {
                console.error(`[KiwoomService] 미체결(kt00007) 조회 에러:`, error.response?.data || error.message);
                throw error;
            }
        });
    }

    /**
     * 당일 체결내역 조회 (kt00007, qry_tp='4')
     * - Reconciliation 시 실제 체결가(cntr_uv)와 체결수량(cntr_qty) 확인용
     * - sell_tp='0'(전체), '1'(매도), '2'(매수)
     */
    public async getDailyExecutions(
        accountNo: string,
        options: { stk_cd?: string, sell_tp?: string } = {}
    ): Promise<Array<{
        ord_no: string;     // 주문번호
        stk_cd: string;     // 종목코드
        stk_nm: string;     // 종목명
        cntr_qty: number;   // 체결수량
        cntr_uv: number;    // 체결단가
        ord_qty: number;    // 주문수량
        ord_uv: number;     // 주문단가
        sell_tp: string;    // 매도수구분 ('1':매도, '2':매수)
    }>> {
        return this.makeApiRequestWithRetry(async (token) => {
            try {
                const url = `/api/dostk/acnt`;
                const headers = {
                    'Content-Type': 'application/json;charset=UTF-8',
                    'authorization': `Bearer ${token}`,
                    'api-id': 'kt00007',
                    'cont-yn': 'N',
                    'next-key': ''
                };
                const body = {
                    account_no: accountNo,
                    ord_dt: '',          // 오늘 (공백)
                    qry_tp: '4',         // 4: 체결내역만
                    stk_bond_tp: '1',    // 1: 주식
                    sell_tp: options.sell_tp || '0', // 기본값 전체
                    stk_cd: options.stk_cd || '',
                    fr_ord_no: '',
                    dmst_stex_tp: '%'
                };

                const response = await this.kiwoomAxios.post(url, body, { headers });

                let rawList: any[] = [];
                if (response.data?.acnt_ord_cntr_prps_dtl) {
                    rawList = Array.isArray(response.data.acnt_ord_cntr_prps_dtl)
                        ? response.data.acnt_ord_cntr_prps_dtl
                        : [response.data.acnt_ord_cntr_prps_dtl];
                } else if (response.data?.Body) {
                    rawList = Array.isArray(response.data.Body) ? response.data.Body : [response.data.Body];
                } else if (response.data?.list) {
                    rawList = response.data.list;
                }

                const executions = rawList.map((item: any) => ({
                    ord_no:   String(item.ord_no   || item.order_no   || ''),
                    stk_cd:   String(item.stk_cd   || item.pdno       || '').replace(/^A/, ''),
                    stk_nm:   String(item.stk_nm   || item.prdt_name  || ''),
                    cntr_qty: parseInt(item.cntr_qty || item.tot_ccld_qty || '0', 10),
                    cntr_uv:  parseInt(item.cntr_uv  || item.avg_prvs  || '0', 10),
                    ord_qty:  parseInt(item.ord_qty  || '0', 10),
                    ord_uv:   parseInt(item.ord_uv   || '0', 10),
                    sell_tp:  String(item.sell_tp || item.sll_buy_tp || (String(item.io_tp_nm).includes('매도') ? '1' : '2')),
                }));

                console.log(`[KiwoomService] 당일 체결내역 (kt00007, qry_tp=4): ${executions.length}건`);
                return executions;
            } catch (error: any) {
                console.error(`[KiwoomService] 당일 체결내역 조회 에러:`, error.response?.data || error.message);
                throw error;
            }
        });
    }

    /**
     * 예상체결등락률상위 조회 (ka10029) - 장전 갭상승 종목 포착용
     */
    public async getGapUpStocks() {
        return this.makeApiRequestWithRetry(async (token) => {
            const url = `/api/dostk/stkinfo`
            const headers = {
                'Content-Type': 'application/json;charset=UTF-8',
                'authorization': `Bearer ${token}`,
                'api-id': 'ka10029'
            }
            const body = {
                mrkt_tp: '0', // 전체
                drt_tp: '1',  // 상승
                rank_tp: '1'  // 등락률순
            }
            const response = await this.kiwoomAxios.post(url, body, { headers })
            return response.data
        }, { cacheKey: 'GAP_UP_STOCKS', ttl: 1 * 60 * 1000 }) // 1분 캐시
    }

    /**
     * 거래량급증 조회 (ka10023) - 장중 수급 종목 포착용
     */
    public async getVolumeSpikeStocks() {
        return this.makeApiRequestWithRetry(async (token) => {
            const url = `/api/dostk/rkinfo`
            const headers = {
                'Content-Type': 'application/json;charset=UTF-8',
                'authorization': `Bearer ${token}`,
                'api-id': 'ka10023'
            }
            // 가이드와 ka10027 구성을 병합하여 최대한 보수적으로 파라미터 구성
            const body = {
                mrkt_tp: '000',        // 시장구분: 000(전체)
                sort_tp: '1',          // 정렬구분: 1(급증량)
                tm_tp: '1',            // 시간구분: 1(분)
                trde_qty_tp: '5',      // 거래량구분: 5(5천주 이상)
                tm: '01',              // 시간(분): 2자리 문자열
                stk_cnd: '0',          // 종목조건: 0(전체조회)
                pric_tp: '0',          // 가격구분: 0(전체조회)
                stex_tp: '3',          // 거래소구분: 3(통합)
                // 추가 보수적 파라미터 (ka10027 참고)
                trde_qty_cnd: '0',
                crd_cnd: '0',
                updown_incls: '1',
                trde_prica_cnd: '0'
            }
            console.log('[KiwoomService] Requesting ka10023 with body:', JSON.stringify(body));
            const response = await this.kiwoomAxios.post(url, body, { headers })
            return response.data
        }, { cacheKey: 'VOLUME_SPIKE_V3', ttl: 1 * 60 * 1000 })
    }

    /**
     * 거래대금 상위 조회 (ka10030) - 당일 주도 테마 파악용
     * 응답 키: tdy_trde_qty_upper[]
     *   - stk_cd: 종목코드
     *   - stk_nm: 종목명
     *   - cur_prc: 현재가
     *   - flu_rt: 등락률
     *   - trde_qty: 거래량
     *   - trde_amt: 거래대금 (자연수 문자열)
     */
    public async getTopTradingValueStocks() {
        return this.makeApiRequestWithRetry(async (token) => {
            const url = `/api/dostk/rkinfo`
            const headers = {
                'Content-Type': 'application/json;charset=UTF-8',
                'authorization': `Bearer ${token}`,
                'api-id': 'ka10030'
            }
            const body = {
                mrkt_tp: '000',
                sort_tp: '3',          // 3: 거래대금순
                mang_stk_incls: '1',   // 1: 관리종목 미포함
                crd_tp: '0',
                trde_qty_tp: '0',
                pric_tp: '0',          // 0: 전체 (동전주 포함)
                trde_prica_tp: '0',
                mrkt_open_tp: '0',
                stex_tp: '3',
                // 추가 보수적 파라미터
                stk_cnd: '1',
                updown_incls: '1'
            }
            console.log('[KiwoomService] Requesting ka10030 with body:', JSON.stringify(body));
            const response = await this.kiwoomAxios.post(url, body, { headers })
            return response.data
        }, { cacheKey: 'TOP_TRADING_V3', ttl: 5 * 60 * 1000 })
    }

    /**
     * 업종 리스트 반환 (KRX 표준 업종코드)
     * ka10040은 REST API에서 미지원 → 하드코딩 업종코드로 대체
     */
    public getSectorCodes() {
        return [
            { code: '001', name: '종합(KOSPI)' },
            { code: '002', name: '대형주' },
            { code: '003', name: '중형주' },
            { code: '004', name: '소형주' },
            { code: '005', name: '음식료품' },
            { code: '006', name: '섬유의복' },
            { code: '007', name: '종이목재' },
            { code: '008', name: '화학' },
            { code: '009', name: '의약품' },
            { code: '011', name: '비금속광물' },
            { code: '012', name: '철강금속' },
            { code: '013', name: '기계' },
            { code: '014', name: '전기전자' },
            { code: '015', name: '의료정밀' },
            { code: '016', name: '운수장비' },
            { code: '017', name: '유통업' },
            { code: '019', name: '전기가스업' },
            { code: '020', name: '건설업' },
            { code: '024', name: '운수창고' },
            { code: '025', name: '통신업' },
            { code: '026', name: '금융업' },
            { code: '028', name: '증권' },
            { code: '029', name: '보험' },
            { code: '030', name: '서비스업' },
        ];
    }

    /**
     * 업종별 주가 요청 (ka20002) - 단일 업종코드 조회
     * URI: /api/dostk/sect (키움 AI 확인됨)
     * ka10040, ka10021은 REST API 미지원 → 이 메서드로 대체
     */
    public async getSectorDetail(inds_cd: string, mrkt_tp: string = '0') {
        return this.makeApiRequestWithRetry(async (token) => {
            const url = `/api/dostk/sect`
            const headers = {
                'Content-Type': 'application/json;charset=UTF-8',
                'authorization': `Bearer ${token}`,
                'api-id': 'ka20002'
            }
            const body = {
                mrkt_tp: mrkt_tp,   // 0:코스피, 1:코스닥
                inds_cd: inds_cd,   // 업종코드
                stex_tp: '1'        // 1:KRX
            }
            const response = await this.kiwoomAxios.post(url, body, { headers })
            return response.data
        }, { cacheKey: `SECTOR_DETAIL_${inds_cd}_${mrkt_tp}`, ttl: 5 * 60 * 1000 })
    }


    /**
     * ka10027 응답을 정규화 형태로 반환
     */
    public async getParsedTopRisingStocks(limit = 25): Promise<{ code: string; name: string; changeRate: number; source: 'RISING' }[]> {
        try {
            const raw = await this.getTopRisingStocks()
            const list: any[] = raw?.pred_pre_flu_rt_upper ?? raw?.bid_req_upper ?? raw?.Body ?? raw?.list ?? []
            return list.slice(0, limit).map((item: any) => ({
                code: item.stk_cd || item.stck_shrn_iscd,
                name: item.stk_nm || item.stck_nm || item.name,
                changeRate: parseFloat(item.flu_rt || item.prdy_ctrt || '0'),
                source: 'RISING' as const
            })).filter(s => s.code && s.name)
        } catch (e) {
            console.error('[KiwoomService] getParsedTopRisingStocks error:', e)
            return []
        }
    }

    /**
     * ka10030 응답을 ka10027과 동일한 정규화 형태로 반환
     * { code, name, changeRate, tradingValue } 배열
     */
    public async getParsedTopTradingValueStocks(limit = 25): Promise<{ code: string; name: string; changeRate: number; tradingValue: number; source: 'TRADING_VALUE' }[]> {
        try {
            const raw = await this.getTopTradingValueStocks()
            const list: any[] = raw?.tdy_trde_qty_upper ?? []
            return list.slice(0, limit).map((item: any) => ({
                code: item.stk_cd,
                name: item.stk_nm,
                changeRate: parseFloat(item.flu_rt ?? '0'),
                tradingValue: parseInt(item.trde_amt?.replace(/[^0-9-]/g, '') ?? '0', 10),
                source: 'TRADING_VALUE' as const
            })).filter(s => s.code && s.name)
        } catch (e) {
            console.error('[KiwoomService] getParsedTopTradingValueStocks error:', e)
            return []
        }
    }

    /**
     * ka10027(등락률 상위) + ka10030(거래대금 상위) 통합 메서드
     * 중복 종목은 제거하고, source 필드로 출체 구분
     */
    public async getCombinedTopStocks(risingLimit = 25, tradingValueLimit = 25): Promise<{ code: string; name: string; changeRate: number; tradingValue?: number; source: 'RISING' | 'TRADING_VALUE' | 'BOTH' }[]> {
        const [risingRaw, tradingRaw] = await Promise.allSettled([
            this.getParsedTopRisingStocks(risingLimit),
            this.getParsedTopTradingValueStocks(tradingValueLimit)
        ])

        const risingList = risingRaw.status === 'fulfilled' ? risingRaw.value : []
        const tradingList = tradingRaw.status === 'fulfilled' ? tradingRaw.value : []

        const map = new Map<string, any>()

        for (const s of risingList) {
            map.set(s.code, { ...s, source: 'RISING' as const })
        }
        for (const s of tradingList) {
            if (map.has(s.code)) {
                // 두 소스 모두 등장 → BOTH
                map.set(s.code, { ...map.get(s.code), tradingValue: s.tradingValue, source: 'BOTH' as const })
            } else {
                map.set(s.code, s)
            }
        }
        return Array.from(map.values())
    }


    /**
     * 주식 분봉 차트 조회 (ka10070)
     * @param code 종목코드
     * @param targetTime 조회 기준시각 (HHMMSS 형식) - 0이면 현재시간
     */
    public async getMinuteChartData(code: string, targetTime: string = "0") {
        return this.makeApiRequestWithRetry(async (token) => {
            const url = `/api/dostk/minutChart`
            const headers = {
                'Content-Type': 'application/json;charset=UTF-8',
                'authorization': `Bearer ${token}`,
                'api-id': 'ka10070'
            }
            const t = targetTime === "0" ? new Date().toTimeString().split(' ')[0].replace(/:/g, '') : targetTime;

            const body = {
                stk_cd: code, // 종목코드
                tm: t, // 검색시간 (HHMMSS)
                req_cnt: "30", // 요청개수 (최대 30개)
                tm_dvs: "1" // 시간구분: 1 (1분봉)
            }
            const response = await this.kiwoomAxios.post(url, body, { headers })
            return response.data;
        });
    }

    /**
     * 전일대비 등락률 상위 조회 (ka10027) - 장 종료 후에도 데이터 조회가 가능하여 ka10020보다 안정적임
     */
    public async getTopRisingStocks() {
        return this.makeApiRequestWithRetry(async (token) => {
            const url = `${BASE_URL}/api/dostk/rkinfo`
            const headers = {
                'Content-Type': 'application/json;charset=UTF-8',
                'authorization': `Bearer ${token}`,
                'api-id': 'ka10027'
            }
            const body = {
                mrkt_tp: '000',          // 시장구분: 000(전체)
                sort_tp: '1',            // 정렬구분: 1(상승률순)
                trde_qty_cnd: '0',       // 거래량조건: 0(전체)
                stk_cnd: '1',            // 종목조건: 1(관리종목제외)
                crd_cnd: '0',            // 신용조건: 0(전체)
                updown_incls: '1',       // 상하한 포함여부: 1(포함)
                pric_cnd: '0',           // 가격조건: 0(전체)
                trde_prica_cnd: '0',     // 거래대금조건: 0(전체)
                stex_tp: '3'             // 거래소구분: 3(통합)
            }
            const response = await this.kiwoomAxios.post(url, body, { headers })
            return response.data
        }, { cacheKey: 'TOP_RISING_STOCKS', ttl: 5 * 60 * 1000 }) // 5분 캐시
    }

    /**
     * 가격급등락요청 (ka10019) - 기간(최근 n일) 내 급등 종목 조회
     * tm_tp: 1(분전), 2(일전)
     * tm: 시간/일수 (예: '5'일전)
     */
    public async getPeriodRisingStocks(days: number = 5) {
        return this.makeApiRequestWithRetry(async (token) => {
            const url = `/api/dostk/stkinfo`
            const headers = {
                'Content-Type': 'application/json;charset=UTF-8',
                'authorization': `Bearer ${token}`,
                'api-id': 'ka10019'
            }
            const body = {
                mrkt_tp: '000',          // 전체시장
                flu_tp: '1',             // 1:급등, 2:급락
                tm_tp: '2',              // 2:일전
                tm: String(days),        // n일간
                trde_qty_tp: '0000',     // 전체 거래량
                stk_cnd: '1',            // 관리종목제외
                crd_cnd: '0',            // 신용전체
                pric_cnd: '0',           // 가격전체
                updown_incls: '1',       // 상하한가포함
                stex_tp: '3'             // 통합거래소
            }
            const response = await this.kiwoomAxios.post(url, body, { headers })
            return response.data
        })
    }

    /**
     * [Moonshot] 텐베거 매집 탐지용: 기관/외국인 60일치 매매동향 연속조회 (opt10059)
     */
    public async getSmartMoneyFlow(stk_cd: string): Promise<any> {
        let allData: any[] = [];
        let contYn = 'N';
        let nextKey = '';
        
        do {
            const data: any = await this.makeApiRequestWithRetry(async (token) => {
                const url = `${BASE_URL}/api/dostk/stkinfo`;
                const headers: any = {
                    'Content-Type': 'application/json;charset=UTF-8',
                    'authorization': `Bearer ${token}`,
                    'api-id': 'ka10059',
                    'cont-yn': contYn,
                };
                if (nextKey) headers['next-key'] = nextKey;

                const todayDt = new Date().toISOString().split('T')[0].replace(/-/g, '');
                
                const body = {
                    dt: todayDt,        // 빈값 불가, YYYYMMDD 필수
                    stk_cd: stk_cd,
                    amt_qty_tp: '1',    // 1:금액
                    trde_tp: '0',       // 0:순매수
                    unit_tp: '1000'     // 1000:천주 단위
                };

                const response = await this.kiwoomAxios.post(url, body, { headers });
                
                // --- DEBUG LOG START ---
                console.log(`[Moonshot Debug] opt10059 response status:`, response.status);
                console.log(`[Moonshot Debug] opt10059 response body snippet:`, JSON.stringify(response.data).substring(0, 300));
                // --- DEBUG LOG END ---
                
                return {
                    json: response.data,
                    resContYn: response.headers['cont-yn'] || response.headers['tr-cont-yn'] || response.headers['tr_cont_yn'] || 'N', // 헤더 이름 다양성 방어
                    resNextKey: response.headers['next-key'] || ''
                };
            });

            // Parse and append current chunk safely by checking multiple possible payload locations
            const root = data.json || {};
            const chunk = root.stk_invsr_orgn 
                || root.body?.stk_invsr_orgn 
                || root.output?.stk_invsr_orgn 
                || root.body?.output?.stk_invsr_orgn 
                || [];
                
            allData = allData.concat(chunk);
            
            contYn = data.resContYn;
            nextKey = data.resNextKey;

            // 60 영업일 데이터만 필요하므로, 초과 시 루프 조기 종료
            if (allData.length >= 60) {
                console.log(`[Moonshot Debug] 60일치 조회 완료 (${allData.length}건). 연속조회 중단.`);
                contYn = 'N';
            }

            // Rate Limit Safety (1.5초 딜레이)
            if (contYn === 'Y' && chunk.length > 0) {
                await new Promise(resolve => setTimeout(resolve, 1500));
            } else if (chunk.length === 0) {
                // If chunk is empty but there's a payload, let's keep the raw data for debugging
                if (Object.keys(root).length > 0 && allData.length === 0) {
                    allData.push({ __debug_raw__: root });
                }
                // If chunk is empty, avoid infinite loops by ending iteration
                contYn = 'N';
            }
        } while (contYn === 'Y');

        // 정확히 최근 최신 60일 데이터만 사용
        const slicedData = allData.length > 60 ? allData.slice(0, 60) : allData;

        return slicedData.length > 0 && slicedData[0].__debug_raw__ 
            ? slicedData 
            : this.parseSmartMoneyFlow(slicedData);
    }

    private parseSmartMoneyFlow(dataList: any[]) {
        return dataList.map((item: any) => {
            if (item.__debug_raw__) return item;
            
            // 키움 응답 필드: 기관(orgn), 외국인(frgnr_invsr), 개인(ind_invsr)
            const orgn_amt = item.orgn || item.orgn_invsr_amt || item.orgn_nettrde_amt || '0';
            const frgnr_amt = item.frgnr_invsr || item.frgnr || item.frgnr_nettrde_amt || '0';
            const ind_amt = item.ind_invsr || '0';
            
            return {
                date: item.dt || '',
                orgn_net_buy_amt: parseInt(orgn_amt, 10) || 0,
                frgnr_net_buy_amt: parseInt(frgnr_amt, 10) || 0,
                ind_net_buy_amt: parseInt(ind_amt, 10) || 0,
                cur_prc: item.cur_prc || '', 
            };
        });
    }

    /**
     * [Moonshot] 텐베거 펀더멘털용: 주식기본정보 (opt10001) - 신용비율 및 PER 추출
     */
    public async getFundamentalInfo(stk_cd: string): Promise<any> {
        return this.makeApiRequestWithRetry(async (token) => {
            const url = `${BASE_URL}/api/dostk/stkinfo`;
            const headers = {
                'Content-Type': 'application/json;charset=UTF-8',
                'authorization': `Bearer ${token}`,
                'api-id': 'ka10001'
            };
            
            const response = await this.kiwoomAxios.post(url, { stk_cd }, { headers });
            const root = response.data || {};
            const data = root.body || root.output || root;
            
            // Safe ratio parser
            const passPercent = (val: any) => {
                if (!val) return 0.0;
                const clean = String(val).replace(/[%+,]/g, '').trim();
                const num = parseFloat(clean);
                return isNaN(num) ? 0.0 : num;
            };

            return {
                stock_code: data.stk_cd || stk_cd,
                stock_name: data.stk_nm || '',
                credit_ratio: passPercent(data.crd_rt),
                per: passPercent(data.per),
                pbr: passPercent(data.pbr),
                eps: passPercent(data.eps),
                market_cap: data.mkt_cap || '' // 시가총액
            };
        });
    }
}
