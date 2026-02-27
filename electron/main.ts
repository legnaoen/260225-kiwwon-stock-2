import { app, BrowserWindow, ipcMain } from 'electron'
import path from 'node:path'
import Store from 'electron-store'
import axios from 'axios'
import { KiwoomTokenManager } from './kiwoomApi'
import { KiwoomWebSocketManager } from './websocket'

const store = new Store()
const tokenManager = KiwoomTokenManager.getInstance()
const BASE_URL = 'https://api.kiwoom.com'

process.env.DIST = path.join(__dirname, '../dist')
process.env.VITE_PUBLIC = app.isPackaged ? process.env.DIST : path.join(process.env.DIST, '../public')

let win: BrowserWindow | null
let wsManager: KiwoomWebSocketManager | null = null

function createWindow() {
    win = new BrowserWindow({
        width: 1200,
        height: 800,
        frame: false, // Custom title bar usage
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
        },
    })

    wsManager = new KiwoomWebSocketManager(win)

    win.webContents.on('did-finish-load', () => {
        win?.webContents.send('main-process-message', (new Date).toLocaleString())
    })

    if (process.env.VITE_DEV_SERVER_URL) {
        win.loadURL(process.env.VITE_DEV_SERVER_URL)
    } else {
        win.loadFile(path.join(process.env.DIST as string, 'index.html'))
    }
}

app.on('window-all-closed', () => {
    if (wsManager) {
        wsManager.disconnect()
    }
    if (process.platform !== 'darwin') {
        app.quit()
        win = null
    }
})

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow()
    }
})

app.whenReady().then(createWindow)

// IPC Handlers
ipcMain.on('window-controls:minimize', () => {
    win?.minimize()
})

ipcMain.on('window-controls:maximize', () => {
    if (win?.isMaximized()) {
        win.unmaximize()
    } else {
        win?.maximize()
    }
})

ipcMain.on('window-controls:close', () => {
    win?.close()
})

// Kiwoom API Key Management
ipcMain.handle('kiwoom:save-keys', async (_event, keys: { appkey: string, secretkey: string }) => {
    try {
        // 1. 먼저 키를 저장합니다.
        store.set('kiwoom_keys', keys)
        tokenManager.clearTokens()

        // 2. 즉시 토큰 발급을 시도하여 키의 유효성을 검증합니다.
        await tokenManager.getAccessToken(true)

        return {
            success: true,
            message: '키움증권 서버 연결에 성공했습니다!'
        }
    } catch (error: any) {
        // 검증 실패 시 키는 저장되어 있지만 에러 정보를 반환합니다.
        return {
            success: false,
            error: error.message || '인증에 실패했습니다. 키를 다시 확인해주세요.'
        }
    }
})

ipcMain.handle('kiwoom:get-keys', () => {
    return store.get('kiwoom_keys') || null
})

// Kiwoom Data Fetching (REAL ONLY)
ipcMain.handle('kiwoom:get-accounts', async () => {
    try {
        const token = await tokenManager.getAccessToken()
        const url = `${BASE_URL}/api/dostk/acnt`

        const response = await axios.post(url, {}, {
            headers: {
                'Content-Type': 'application/json;charset=UTF-8',
                'authorization': `Bearer ${token}`,
                'api-id': 'ka00001'
            }
        })
        console.log('IPC get-accounts: Success', response.data ? 'Data length: ' + JSON.stringify(response.data).length : 'No data');
        return { success: true, data: response.data }
    } catch (error: any) {
        console.error('IPC get-accounts error:', error?.response?.data || error.message)
        return {
            success: false,
            error: error?.response?.data || { message: error.message }
        }
    }
})

ipcMain.handle('kiwoom:get-holdings', async (_event, { accountNo, nextKey = "" }: { accountNo: string, nextKey?: string }) => {
    try {
        let token = await tokenManager.getAccessToken()
        const url = `${BASE_URL}/api/dostk/acnt`

        const makeRequest = (t: string) => axios.post(url, {
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
        })

        let response: any
        try {
            response = await makeRequest(token)
        } catch (err: any) {
            // If unauthorized, attempt one force refresh
            if (err.response?.status === 401 || JSON.stringify(err.response?.data).includes('Token')) {
                token = await tokenManager.getAccessToken(true)
                response = await makeRequest(token)
            } else {
                throw err
            }
        }

        // WebSocket 연결 시도
        if (wsManager) wsManager.connect(token)

        console.log(`IPC get-holdings: Success for ${accountNo}`);
        return {
            success: true,
            data: response.data,
            headers: response.headers
        }
    } catch (error: any) {
        console.error(`IPC get-holdings error for ${accountNo}:`, error?.response?.data || error.message)
        return {
            success: false,
            error: error?.response?.data || { message: error.message }
        }
    }
})

ipcMain.handle('kiwoom:get-deposit', async (_event, { accountNo }: { accountNo: string }) => {
    try {
        const token = await tokenManager.getAccessToken()
        const url = `${BASE_URL}/api/dostk/acnt`
        const todayDate = new Date()
        const today = todayDate.toISOString().split('T')[0].replace(/-/g, '')
        const sevenDaysAgoDate = new Date()
        sevenDaysAgoDate.setDate(todayDate.getDate() - 7)
        const sevenDaysAgo = sevenDaysAgoDate.toISOString().split('T')[0].replace(/-/g, '')

        // kt00016 (일별계좌수익률상세현황요청) 사용
        // fr_dt: 시작일자, to_dt: 종료일자
        const response = await axios.post(url, {
            account_no: accountNo,
            fr_dt: sevenDaysAgo,
            to_dt: today
        }, {
            headers: {
                'Content-Type': 'application/json;charset=UTF-8',
                'authorization': `Bearer ${token}`,
                'api-id': 'kt00016'
            }
        })
        console.log(`IPC get-deposit (kt00016): Success for ${accountNo}`);
        return { success: true, data: response.data }
    } catch (error: any) {
        console.error(`IPC get-deposit error for ${accountNo}:`, error?.response?.data || error.message)
        return {
            success: false,
            error: error?.response?.data || { message: error.message }
        }
    }
})

ipcMain.handle('kiwoom:get-connection-status', async () => {
    try {
        const status = await tokenManager.getConnectionStatus()
        return status
    } catch (error) {
        return { connected: false, mode: 'none' }
    }
})

ipcMain.handle('kiwoom:get-all-stocks', async (_event, { marketType }: { marketType: string }) => {
    try {
        const token = await tokenManager.getAccessToken()
        const url = `${BASE_URL}/api/dostk/stkinfo`
        let allStocks: any[] = []
        let hasMore = true
        let nextKey = ''

        while (hasMore) {
            const response = await axios.post(url, {
                mrkt_tp: marketType
            }, {
                headers: {
                    'Content-Type': 'application/json;charset=UTF-8',
                    'authorization': `Bearer ${token}`,
                    'api-id': 'ka10099',
                    'cont-yn': nextKey ? 'Y' : 'N',
                    'next-key': nextKey
                }
            })

            const data = response.data
            const list = data?.Body || data?.list || []
            allStocks = allStocks.concat(list)

            nextKey = response.headers['next-key'] || ''
            hasMore = (response.headers['cont-yn'] === 'Y' && !!nextKey)

            // API Rate limiting safety - small delay if paginating
            if (hasMore) await new Promise(resolve => setTimeout(resolve, 100))
        }

        return { success: true, data: allStocks }
    } catch (error: any) {
        console.error('IPC get-all-stocks error:', error?.response?.data || error.message)
        return {
            success: false,
            error: error?.response?.data || { message: error.message }
        }
    }
})

ipcMain.handle('kiwoom:save-watchlist-symbols', async (_event, symbols: string[]) => {
    store.set('watchlist_symbols', symbols)
    return { success: true }
})

ipcMain.handle('kiwoom:get-watchlist-symbols', () => {
    return store.get('watchlist_symbols') || []
})

ipcMain.handle('kiwoom:get-watchlist', async (_event, { symbols }: { symbols: string[] }) => {
    try {
        const token = await tokenManager.getAccessToken()
        const url = `${BASE_URL}/api/dostk/stkinfo`

        // ka10095: stk_cd 파라미터에 종목코드를 |로 구분하여 전달
        const response = await axios.post(url, {
            stk_cd: symbols.join('|')
        }, {
            headers: {
                'Content-Type': 'application/json;charset=UTF-8',
                'authorization': `Bearer ${token}`,
                'api-id': 'ka10095'
            }
        })
        return { success: true, data: response.data }
    } catch (error: any) {
        console.error('IPC get-watchlist error:', error?.response?.data || error.message)
        return {
            success: false,
            error: error?.response?.data || { message: error.message }
        }
    }
})

ipcMain.handle('kiwoom:get-chart-data', async (_event, { stk_cd, base_dt }: { stk_cd: string, base_dt?: string }) => {
    try {
        const token = await tokenManager.getAccessToken()
        const url = `${BASE_URL}/api/dostk/chart`

        // base_dt가 없으면 오늘 날짜로 시뮬레이션 (API 사양에 따라 다름)
        const today = new Date().toISOString().split('T')[0].replace(/-/g, '')

        const response = await axios.post(url, {
            stk_cd,
            base_dt: base_dt || today,
            upd_stkpc_tp: '1' // 수정주가 구분 (1: 수정주가)
        }, {
            headers: {
                'Content-Type': 'application/json;charset=UTF-8',
                'authorization': `Bearer ${token}`,
                'api-id': 'ka10081'
            }
        })
        return { success: true, data: response.data }
    } catch (error: any) {
        console.error('IPC get-chart-data error:', error?.response?.data || error.message)
        return {
            success: false,
            error: error?.response?.data || { message: error.message }
        }
    }
})

ipcMain.handle('kiwoom:ws-register', async (_event, symbols: string[]) => {
    if (wsManager) {
        wsManager.registerItems(symbols)
        return { success: true }
    }
    return { success: false, error: 'WebSocket not initialized' }
})
