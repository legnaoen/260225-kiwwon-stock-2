import { app, BrowserWindow, ipcMain } from 'electron'
import path from 'node:path'
import Store from 'electron-store'
import { KiwoomService } from './services/KiwoomService'
import { AutoTradeService } from './services/AutoTradeService'
import { TelegramService } from './services/TelegramService'
import { DatabaseService } from './services/DatabaseService'
import { DartApiService } from './services/DartApiService'
import { eventBus, SystemEvent } from './utils/EventBus'

const store = new Store()
const kiwoomService = KiwoomService.getInstance()
const autoTradeService = AutoTradeService.getInstance()
const telegramService = TelegramService.getInstance()

// Load initial settings to the service
const initialSettings = store.get('autotrade_settings')
if (initialSettings) {
    autoTradeService.updateConfig(initialSettings)
}
const initialStatus = store.get('autotrade_status') || false
if (initialStatus) {
    autoTradeService.setRunning(initialStatus as boolean)
}

process.env.DIST = path.join(__dirname, '../dist')
process.env.VITE_PUBLIC = app.isPackaged ? process.env.DIST : path.join(process.env.DIST, '../public')

let win: BrowserWindow | null

function createWindow() {
    win = new BrowserWindow({
        width: 1200,
        height: 800,
        frame: false,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
        },
    })

    kiwoomService.initWebSocket(win)

    // Forward AutoTrade logs to renderer
    eventBus.on(SystemEvent.AUTO_TRADE_LOG, (logInfo) => {
        if (win && !win.isDestroyed()) {
            win.webContents.send('kiwoom:auto-trade-log', logInfo)
        }
    })

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
    kiwoomService.disconnectWebSocket()
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

app.whenReady().then(() => {
    createWindow()

    // Startup DART Sync after 5 seconds
    setTimeout(async () => {
        try {
            console.log('[Main] Starting startup DART sync...')
            await DartApiService.getInstance().syncWatchlistSchedules()
            console.log('[Main] Startup DART sync completed.')
        } catch (err) {
            console.error('[Main] Startup DART sync failed:', err)
        }
    }, 5000)
})

// IPC Handlers: Window Controls
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

// IPC Handlers: Features mapped to KiwoomService
ipcMain.handle('kiwoom:save-keys', async (_event, keys: { appkey: string, secretkey: string }) => {
    try {
        store.set('kiwoom_keys', keys)
        await kiwoomService.saveKeys(keys)

        return {
            success: true,
            message: '키움증권 서버 연결에 성공했습니다!'
        }
    } catch (error: any) {
        return {
            success: false,
            error: error.message || '인증에 실패했습니다. 키를 다시 확인해주세요.'
        }
    }
})

ipcMain.handle('kiwoom:get-keys', () => {
    return store.get('kiwoom_keys') || null
})

ipcMain.handle('kiwoom:get-connection-status', async () => {
    try {
        return await kiwoomService.getConnectionStatus()
    } catch (error) {
        return { connected: false, mode: 'none' }
    }
})

ipcMain.handle('kiwoom:get-accounts', async () => {
    try {
        const data = await kiwoomService.getAccounts()
        return { success: true, data }
    } catch (error: any) {
        return { success: false, error: error?.response?.data || { message: error.message } }
    }
})

ipcMain.handle('kiwoom:get-holdings', async (_event, { accountNo, nextKey = "" }) => {
    try {
        const result = await kiwoomService.getHoldings(accountNo, nextKey)
        return { success: true, ...result }
    } catch (error: any) {
        return { success: false, error: error?.response?.data || { message: error.message } }
    }
})

ipcMain.handle('kiwoom:get-deposit', async (_event, { accountNo }) => {
    try {
        const data = await kiwoomService.getDeposit(accountNo)
        return { success: true, data }
    } catch (error: any) {
        return { success: false, error: error?.response?.data || { message: error.message } }
    }
})

ipcMain.handle('kiwoom:get-all-stocks', async (_event, { marketType }) => {
    try {
        const data = await kiwoomService.getAllStocks(marketType)
        return { success: true, data }
    } catch (error: any) {
        return { success: false, error: error?.response?.data || { message: error.message } }
    }
})

ipcMain.handle('kiwoom:save-watchlist-symbols', async (_event, symbols: string[]) => {
    store.set('watchlist_symbols', symbols)
    return { success: true }
})

ipcMain.handle('kiwoom:get-watchlist-symbols', () => {
    return store.get('watchlist_symbols') || []
})

ipcMain.handle('kiwoom:get-watchlist', async (_event, { symbols }) => {
    try {
        const data = await kiwoomService.getWatchlist(symbols)
        return { success: true, data }
    } catch (error: any) {
        return { success: false, error: error?.response?.data || { message: error.message } }
    }
})

ipcMain.handle('kiwoom:get-chart-data', async (_event, { stk_cd, base_dt }) => {
    try {
        const data = await kiwoomService.getChartData(stk_cd, base_dt)
        return { success: true, data }
    } catch (error: any) {
        return { success: false, error: error?.response?.data || { message: error.message } }
    }
})

ipcMain.handle('kiwoom:ws-register', async (_event, symbols: string[]) => {
    const success = kiwoomService.wsRegister(symbols)
    if (success) {
        return { success: true }
    }
    return { success: false, error: 'WebSocket not initialized' }
})

// === Condition Search IPC Handlers ===
ipcMain.handle('kiwoom:save-autotrade-settings', (_event, settings: any) => {
    store.set('autotrade_settings', settings)
    autoTradeService.updateConfig(settings) // Update service memory
    return { success: true }
})

ipcMain.handle('kiwoom:get-autotrade-settings', () => {
    return store.get('autotrade_settings') || null
})

ipcMain.handle('kiwoom:get-autotrade-status', () => {
    // Temporary status store, later integrated with AutoTradeService
    return store.get('autotrade_status') || false
})

ipcMain.handle('kiwoom:set-autotrade-status', (_event, status: boolean) => {
    store.set('autotrade_status', status)
    autoTradeService.setRunning(status) // Update service memory
    return { success: true }
})

ipcMain.handle('kiwoom:connect-condition-ws', async () => {
    try {
        await kiwoomService.connectConditionWs()
        return { success: true }
    } catch (err: any) {
        return { success: false, error: err.message }
    }
})

ipcMain.handle('kiwoom:get-condition-list', () => {
    return kiwoomService.getConditionList()
})

ipcMain.handle('kiwoom:start-condition-search', (_event, seq: string) => {
    return kiwoomService.startConditionSearch(seq)
})

// === Telegram Settings IPC Handlers ===
ipcMain.handle('telegram:save-settings', (_event, settings: { botToken: string, chatId: string, chartTheme?: string }) => {
    store.set('telegram_settings', settings)
    telegramService.reloadConfig()
    return { success: true }
})

ipcMain.handle('telegram:save-theme', (_event, theme: string) => {
    const settings: any = store.get('telegram_settings') || {}
    settings.chartTheme = theme
    store.set('telegram_settings', settings)
    return { success: true }
})

ipcMain.handle('telegram:get-settings', () => {
    return store.get('telegram_settings') || null
})

ipcMain.handle('telegram:test-message', async () => {
    try {
        await telegramService.sendMessage('✅ [테스트 메시지] 안티그래비티 PC앱과 텔레그램 연동이 정상적으로 완료되었습니다!');
        return { success: true };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
})

ipcMain.handle('telegram:send-message', async (_event, message: string) => {
    try {
        await telegramService.sendMessage(message);
        return { success: true };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
})

// === DART API Handlers ===
ipcMain.handle('dart:save-key', (_event, key: string) => {
    store.set('dart_api_key', key)
    return { success: true }
})

ipcMain.handle('dart:get-key', () => {
    return store.get('dart_api_key') || ''
})

ipcMain.handle('dart:save-settings', (_event, settings: any) => {
    store.set('dart_settings', settings)
    return { success: true }
})

ipcMain.handle('dart:get-settings', () => {
    return store.get('dart_settings') || {}
})

ipcMain.handle('dart:sync-corp-codes', async () => {
    try {
        await DartApiService.getInstance().syncCorpCodes()
        return { success: true }
    } catch (err: any) {
        return { success: false, error: err.message }
    }
})

ipcMain.handle('dart:sync-watchlist-schedules', async () => {
    try {
        await DartApiService.getInstance().syncWatchlistSchedules()
        return { success: true }
    } catch (err: any) {
        return { success: false, error: err.message }
    }
})

ipcMain.handle('dart:fetch-disclosures', async (_event, { corpCodes, bgnDe, endDe }) => {
    try {
        const disclosures = await DartApiService.getInstance().fetchDisclosures(corpCodes, bgnDe, endDe)
        return { success: true, data: disclosures }
    } catch (err: any) {
        return { success: false, error: err.message }
    }
})

ipcMain.handle('schedule:get-by-stock', async (_event, stockCode: string) => {
    try {
        const db = DatabaseService.getInstance().getDb()
        const rows = db.prepare('SELECT * FROM schedules WHERE stock_code = ? ORDER BY target_date DESC').all(stockCode)
        return { success: true, data: rows }
    } catch (err: any) {
        return { success: false, error: err.message }
    }
})

// === Schedule Settings Handlers ===
ipcMain.handle('schedule:save-settings', (_event, settings: { notificationTime: string, globalDailyNotify: boolean, sendMissedOnStartup?: boolean }) => {
    store.set('schedule_settings', settings)
    TelegramService.getInstance().reloadScheduleCron()
    return { success: true }
})

ipcMain.handle('schedule:get-settings', () => {
    return store.get('schedule_settings') || { notificationTime: '08:30', globalDailyNotify: false, sendMissedOnStartup: true }
})

ipcMain.handle('schedule:sync', (_event, schedules: any[]) => {
    DatabaseService.getInstance().upsertSchedules(schedules)
    return { success: true }
})

ipcMain.handle('schedule:delete', (_event, id: string) => {
    DatabaseService.getInstance().deleteSchedule(id)
    return { success: true }
})

ipcMain.handle('schedule:get-all', () => {
    return DatabaseService.getInstance().getAllSchedules()
})

ipcMain.handle('schedule:test-summary', async () => {
    await TelegramService.getInstance().triggerScheduleSummaryTest()
    return { success: true }
})
