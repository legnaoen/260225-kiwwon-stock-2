import axios from 'axios'
import { KiwoomTokenManager } from '../kiwoomApi'
import { KiwoomWebSocketManager } from '../websocket'
import { KiwoomConditionWebSocketManager } from '../conditionWebSocket'
import { BrowserWindow } from 'electron'
import { eventBus, SystemEvent } from '../utils/EventBus'

const BASE_URL = 'https://api.kiwoom.com'

export class KiwoomService {
    private static instance: KiwoomService;
    private tokenManager = KiwoomTokenManager.getInstance();
    private wsManager: KiwoomWebSocketManager | null = null;
    private conditionWsManager: KiwoomConditionWebSocketManager | null = null;
    private apiLogs: any[] = [];

    private constructor() {
        // Setup axios interceptors for diagnostic logging
        axios.interceptors.request.use((config) => {
            (config as any).metadata = { startTime: new Date() };
            return config;
        });

        axios.interceptors.response.use(
            (response) => {
                if (response.config.url?.includes('api.kiwoom.com')) {
                    const config = response.config;
                    const apiId = config.headers?.['api-id'] || 'Unknown API';
                    const duration = new Date().getTime() - (config as any).metadata.startTime.getTime();

                    const logEntry = {
                        id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
                        time: new Date().toLocaleTimeString('en-US', { hour12: false }),
                        apiId: apiId,
                        url: config.url,
                        requestData: config.data ? (typeof config.data === 'string' ? JSON.parse(config.data) : config.data) : null,
                        responseData: response.data,
                        success: true,
                        duration: duration
                    };

                    this.apiLogs.unshift(logEntry);
                    if (this.apiLogs.length > 50) this.apiLogs.pop();
                }
                return response;
            },
            (error) => {
                if (error.config?.url?.includes('api.kiwoom.com')) {
                    const config = error.config;
                    const apiId = config?.headers?.['api-id'] || 'Unknown API';
                    const duration = config ? (new Date().getTime() - (config as any).metadata.startTime.getTime()) : 0;

                    const logEntry = {
                        id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
                        time: new Date().toLocaleTimeString('en-US', { hour12: false }),
                        apiId: apiId,
                        url: config?.url || 'Unknown URL',
                        requestData: config?.data ? (typeof config.data === 'string' ? JSON.parse(config.data) : config.data) : null,
                        responseData: error.response?.data || error.message,
                        success: false,
                        duration: duration
                    };

                    this.apiLogs.unshift(logEntry);
                    if (this.apiLogs.length > 50) this.apiLogs.pop();
                }
                throw error;
            }
        );
    }

    public getApiLogs() {
        return this.apiLogs;
    }

    public static getInstance(): KiwoomService {
        if (!KiwoomService.instance) {
            KiwoomService.instance = new KiwoomService();
        }
        return KiwoomService.instance;
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
    private async makeApiRequestWithRetry(apiCallFunc: (token: string) => Promise<any>): Promise<any> {
        try {
            let token = await this.tokenManager.getAccessToken()
            let response = await apiCallFunc(token)

            // Check for Kiwoom specific token errors in HTTP 200 responses
            if (response.data && response.data.return_code === 3 &&
                (JSON.stringify(response.data).includes('8005') || JSON.stringify(response.data).includes('Token'))) {
                throw new Error('TOKEN_EXPIRED')
            }
            return response
        } catch (err: any) {
            if (err.message === 'TOKEN_EXPIRED' || err.response?.status === 401 || JSON.stringify(err.response?.data || '').includes('Token') || JSON.stringify(err.response?.data || '').includes('8005')) {
                console.log('Token invalid or expired (8005). Forcing refresh and retrying once...')
                this.tokenManager.clearTokens()
                let newToken = await this.tokenManager.getAccessToken(true)
                eventBus.emit(SystemEvent.TOKEN_REFRESHED, null)

                let retryResponse = await apiCallFunc(newToken)

                if (retryResponse.data && retryResponse.data.return_code === 3 &&
                    (JSON.stringify(retryResponse.data).includes('8005') || JSON.stringify(retryResponse.data).includes('Token'))) {
                    throw new Error('토큰 재발급 후에도 인증에 실패했습니다. 설정 탭에서 API 키(appkey/secretkey)를 다시 확인하고 등록해주세요.')
                }
                return retryResponse
            }
            throw err
        }
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

    public async getAccounts() {
        const url = `${BASE_URL}/api/dostk/acnt`
        const response = await this.makeApiRequestWithRetry((t) => axios.post(url, {}, {
            headers: {
                'Content-Type': 'application/json;charset=UTF-8',
                'authorization': `Bearer ${t}`,
                'api-id': 'ka00001'
            }
        }))
        return response.data;
    }

    public async getHoldings(accountNo: string, nextKey: string = "") {
        const url = `${BASE_URL}/api/dostk/acnt`
        const response = await this.makeApiRequestWithRetry((t) => axios.post(url, {
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

        // Ensure WebSocket is connected after getting holdings logic
        let token = await this.tokenManager.getAccessToken()
        if (this.wsManager) this.wsManager.connect(token)

        return { data: response.data, headers: response.headers };
    }

    public async getDeposit(accountNo: string) {
        const url = `${BASE_URL}/api/dostk/acnt`
        const todayDate = new Date()
        const today = todayDate.toISOString().split('T')[0].replace(/-/g, '')
        const sevenDaysAgoDate = new Date()
        sevenDaysAgoDate.setDate(todayDate.getDate() - 7)
        const sevenDaysAgo = sevenDaysAgoDate.toISOString().split('T')[0].replace(/-/g, '')

        const response = await this.makeApiRequestWithRetry((t) => axios.post(url, {
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
        const url = `${BASE_URL}/api/dostk/stkinfo`
        let allStocks: any[] = []
        let hasMore = true
        let nextKey = ''

        while (hasMore) {
            const response = await this.makeApiRequestWithRetry((t) => axios.post(url, {
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

            if (hasMore) await new Promise(resolve => setTimeout(resolve, 100))
        }
        return allStocks;
    }

    public async getWatchlist(symbols: string[]) {
        const url = `${BASE_URL}/api/dostk/stkinfo`
        const response = await this.makeApiRequestWithRetry((t) => axios.post(url, {
            stk_cd: symbols.join('|')
        }, {
            headers: {
                'Content-Type': 'application/json;charset=UTF-8',
                'authorization': `Bearer ${t}`,
                'api-id': 'ka10095'
            }
        }))
        return response.data;
    }

    public async getChartData(stk_cd: string, base_dt?: string) {
        const url = `${BASE_URL}/api/dostk/chart`
        const today = new Date().toISOString().split('T')[0].replace(/-/g, '')
        const response = await this.makeApiRequestWithRetry((t) => axios.post(url, {
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
        console.log('[KiwoomService] getChartData response keys:', Object.keys(response.data || {}), response.data?.Body ? Object.keys(response.data.Body) : 'No Body');
        return response.data;
    }

    public async getStockBasicInfo(stk_cd: string) {
        const url = `${BASE_URL}/api/dostk/stkinfo`
        const response = await this.makeApiRequestWithRetry((t) => axios.post(url, {
            stk_cd
        }, {
            headers: {
                'Content-Type': 'application/json;charset=UTF-8',
                'authorization': `Bearer ${t}`,
                'cont-yn': 'N',
                'api-id': 'ka10001'
            }
        }))
        return response.data;
    }

    public async getCurrentPrice(stk_cd: string) {
        const url = `${BASE_URL}/api/dostk/stkrtprc`
        const response = await this.makeApiRequestWithRetry((t) => axios.post(url, {
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

    public startConditionSearch(seq: string) {
        if (!this.conditionWsManager) throw new Error("Condition WebSocket Manager is not initialized");
        this.conditionWsManager.requestConditionSearch(seq);
    }

    /**
     * 국내주식 매수 주문
     */
    public async sendBuyOrder(accountNo: string, stk_cd: string, qty: number, price: number): Promise<any> {
        return this.makeApiRequestWithRetry(async (token) => {
            const url = `${BASE_URL}/api/dostk/ordr`
            const headers = {
                'Content-Type': 'application/json;charset=UTF-8',
                'authorization': `Bearer ${token}`,
                'api-id': 'kt10000', // 매수
            }
            const body = {
                acnt_no: accountNo,
                dmst_stex_tp: 'KRX',
                stk_cd: stk_cd,
                ord_qty: String(qty),
                ord_uv: String(price),
                trde_tp: '00', // 지정가 (보통)
                cond_uv: ''
            }
            const response = await axios.post(url, body, { headers })
            return response.data
        })
    }

    /**
     * 국내주식 매도 주문
     */
    public async sendSellOrder(accountNo: string, stk_cd: string, qty: number, price: number): Promise<any> {
        return this.makeApiRequestWithRetry(async (token) => {
            const url = `${BASE_URL}/api/dostk/ordr`
            const headers = {
                'Content-Type': 'application/json;charset=UTF-8',
                'authorization': `Bearer ${token}`,
                'api-id': 'kt10001', // 매도
            }
            const body = {
                acnt_no: accountNo,
                dmst_stex_tp: 'KRX',
                stk_cd: stk_cd,
                ord_qty: String(qty),
                ord_uv: String(price),
                trde_tp: '00', // 지정가 (보통)
                cond_uv: ''
            }
            const response = await axios.post(url, body, { headers })
            return response.data
        })
    }

    /**
     * 국내주식 정정 주문
     */
    public async modifyOrder(accountNo: string, orig_ord_no: string, stk_cd: string, mdfy_qty: number, mdfy_uv: number): Promise<any> {
        return this.makeApiRequestWithRetry(async (token) => {
            const url = `${BASE_URL}/api/dostk/ordr`
            const headers = {
                'Content-Type': 'application/json;charset=UTF-8',
                'authorization': `Bearer ${token}`,
                'api-id': 'kt10002', // 정정
            }
            const body = {
                acnt_no: accountNo,
                dmst_stex_tp: 'KRX',
                stk_cd: stk_cd,
                orig_ord_no: orig_ord_no,
                mdfy_qty: String(mdfy_qty),
                mdfy_uv: String(mdfy_uv),
                trde_tp: '00', // 지정가 (보통)
                cond_uv: ''
            }
            const response = await axios.post(url, body, { headers })
            return response.data
        })
    }

    /**
     * 미체결 주문 내역 조회 (TODO: 정확한 TR명 반영 필요)
     */
    public async getUnexecutedOrders(
        accountNo: string,
        options: {
            all_stk_tp?: string;
            trde_tp?: string;
            stk_cd?: string;
            stex_tp?: string;
            cont_yn?: string;
            next_key?: string;
        } = {}
    ): Promise<any> {
        const {
            all_stk_tp = '1', // 전체 종목 조회
            trde_tp = '0', // 전체 매매구분
            stk_cd = '', // 특정 종목코드 없으면 전체
            stex_tp = '0', // 통합 거래소
            cont_yn = 'N',
            next_key = ''
        } = options;

        return this.makeApiRequestWithRetry(async (token) => {
            const url = `${BASE_URL}/api/dostk/acnt`;
            const headers: any = {
                'Content-Type': 'application/json;charset=UTF-8',
                authorization: `Bearer ${token}`,
                'api-id': 'ka10075',
                'cont-yn': cont_yn,
                'next-key': next_key,
            };
            const body = {
                acnt_no: accountNo,
                all_stk_tp,
                trde_tp,
                stk_cd,
                stex_tp,
            };
            try {
                const response = await axios.post(url, body, { headers });
                console.log('[KiwoomService] getUnexecutedOrders Response Data:', JSON.stringify(response.data));
                return response.data;
            } catch (err: any) {
                console.error('[KiwoomService] getUnexecutedOrders Error:', err?.response?.data || err.message);
                throw err;
            }
        });
    }

    /**
     * 예상체결등락률상위 조회 (ka10029) - 장전 갭상승 종목 포착용
     */
    public async getGapUpStocks() {
        return this.makeApiRequestWithRetry(async (token) => {
            const url = `${BASE_URL}/api/dostk/stkinfo`
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
            const response = await axios.post(url, body, { headers })
            return response.data
        })
    }

    /**
     * 거래량급증 조회 (ka10023) - 장중 수급 종목 포착용
     */
    public async getVolumeSpikeStocks() {
        return this.makeApiRequestWithRetry(async (token) => {
            const url = `${BASE_URL}/api/dostk/rkinfo`
            const headers = {
                'Content-Type': 'application/json;charset=UTF-8',
                'authorization': `Bearer ${token}`,
                'api-id': 'ka10023'
            }
            const body = {
                mrkt_tp: "000",      // 시장구분: 000(전체)
                sort_tp: "1",        // 정렬구분: 1(급증량)
                tm_tp: "1",          // 시간구분: 1(분)
                trde_qty_tp: "5",    // 거래량구분: 5(5천주이상)
                tm: "1",             // 시간(분)
                stk_cnd: "0",        // 종목조건: 0(전체조회)
                pric_tp: "0",        // 가격구분: 0(전체조회)
                stex_tp: "3"         // 거래소구분: 3(통합)
            }
            const response = await axios.post(url, body, { headers })
            return response.data
        })
    }

    /**
     * 거래대금 상위 조회 (ka10030) - 당일 주도 테마 파악용
     */
    public async getTopTradingValueStocks() {
        return this.makeApiRequestWithRetry(async (token) => {
            const url = `${BASE_URL}/api/dostk/rkinfo`
            const headers = {
                'Content-Type': 'application/json;charset=UTF-8',
                'authorization': `Bearer ${token}`,
                'api-id': 'ka10030'
            }
            const body = {
                mrkt_tp: '000',        // 시장구분: 000(전체)
                sort_tp: '3',          // 정렬구분: 3(거래대금)
                mang_stk_incls: '1',   // 관리종목 포함 여부: 1(미포함)
                crd_tp: '0',           // 신용구분: 0(전체조회)
                trde_qty_tp: '0',      // 거래량구분: 0(전체조회)
                pric_tp: '8',          // 가격구분: 8(1천원이상) -> 동전주 제외
                trde_prica_tp: '0',    // 거래대금구분: 0(전체조회)
                mrkt_open_tp: '0',     // 장운영구분: 0(전체조회)
                stex_tp: '3'           // 거래소구분: 3(통합)
            }
            const response = await axios.post(url, body, { headers })
            return response.data
        })
    }

    /**
     * 주식 분봉 차트 조회 (ka10070)
     * @param code 종목코드
     * @param targetTime 조회 기준시각 (HHMMSS 형식) - 0이면 현재시간
     */
    public async getMinuteChartData(code: string, targetTime: string = "0") {
        return this.makeApiRequestWithRetry(async (token) => {
            const url = `${BASE_URL}/api/dostk/minutChart`
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
            const response = await axios.post(url, body, { headers })
            return response.data;
        });
    }
}
