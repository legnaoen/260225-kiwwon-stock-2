import axios from 'axios'
import { KiwoomTokenManager } from '../kiwoomApi'
import { KiwoomWebSocketManager } from '../websocket'
import { BrowserWindow } from 'electron'
import { eventBus, SystemEvent } from '../utils/EventBus'

const BASE_URL = 'https://api.kiwoom.com'

export class KiwoomService {
    private static instance: KiwoomService;
    private tokenManager = KiwoomTokenManager.getInstance();
    private wsManager: KiwoomWebSocketManager | null = null;

    private constructor() { }

    public static getInstance(): KiwoomService {
        if (!KiwoomService.instance) {
            KiwoomService.instance = new KiwoomService();
        }
        return KiwoomService.instance;
    }

    public initWebSocket(win: BrowserWindow) {
        this.wsManager = new KiwoomWebSocketManager(win);
    }

    public disconnectWebSocket() {
        if (this.wsManager) {
            this.wsManager.disconnect();
            this.wsManager = null;
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
}
