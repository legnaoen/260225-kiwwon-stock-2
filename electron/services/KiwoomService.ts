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

    private constructor() { }

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
        return response.data;
    }

    public wsRegister(symbols: string[]) {
        if (this.wsManager) {
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
    public async getUnexecutedOrders(accountNo: string): Promise<any> {
        return this.makeApiRequestWithRetry(async (token) => {
            // TODO: 실제 키움증권의 국내주식 미체결조회 TR 주소 및 ID (예: vt00021 또는 별도 api-id) 적용 필요.
            // 일단 임시로 에러를 방지하기 위해 빈 배열의 골격만 리턴합니다.
            console.warn("[KiwoomService] getUnexecutedOrders is barely implemented. TR details needed.");
            return {
                output: []
            }
        })
    }
}
