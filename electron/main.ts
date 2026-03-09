import { app, BrowserWindow, ipcMain, shell } from 'electron'
import path from 'node:path'
import Store from 'electron-store'
import { KiwoomService } from './services/KiwoomService'
import { AutoTradeService } from './services/AutoTradeService'
import { TelegramService } from './services/TelegramService'
import { DatabaseService } from './services/DatabaseService'
import { DartApiService } from './services/DartApiService'
import { CompanyAnalysisService } from './services/CompanyAnalysisService'
import { MarketScannerService } from './services/MarketScannerService'
import { AiDecisionService } from './services/AiDecisionService'
import { DataLoggingService } from './services/DataLoggingService'
import { DailyRetrospectiveService } from './services/DailyRetrospectiveService'
import { AiService } from './services/AiService'
import { VirtualAccountService } from './services/VirtualAccountService'
import { eventBus, SystemEvent } from './utils/EventBus'

const store = new Store()
const kiwoomService = KiwoomService.getInstance()
const autoTradeService = AutoTradeService.getInstance()
const telegramService = TelegramService.getInstance()
const marketScannerService = MarketScannerService.getInstance()
const aiDecisionService = AiDecisionService.getInstance()
// DataLoggingService is now lazily instantiated.

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
process.env.VITE_PUBLIC = (app && app.isPackaged) ? process.env.DIST : path.join(process.env.DIST, '../public')

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

    eventBus.on(SystemEvent.AUTO_TRADE_STATUS_CHANGED, (running) => {
        if (win && !win.isDestroyed()) {
            win.webContents.send('kiwoom:auto-trade-status-changed', running)
        }
    })

    // Forward AI Trade Stream to renderer
    eventBus.on(SystemEvent.AI_TRADE_STREAM, (data) => {
        if (win && !win.isDestroyed()) {
            win.webContents.send('ai-trade:stream', data)
        }
    })

    // Forward AI Evaluation update
    eventBus.on(SystemEvent.AI_EVALUATION_UPDATE, (data) => {
        if (win && !win.isDestroyed()) {
            win.webContents.send('ai-trade:evaluation-update', data)
        }
    })

    // Forward Market Opened Detection (Trading Days Sync)
    eventBus.on(SystemEvent.MARKET_OPENED_DETECTED, (data) => {
        if (win && !win.isDestroyed()) {
            win.webContents.send('kiwoom:market-opened-detected', data)
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

        // Start Market Scanner
        marketScannerService.start()
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

ipcMain.handle('yahoo:test-connection', async () => {
    try {
        const { YahooFinanceService } = await import('./services/YahooFinanceService')
        // Test with Samsung Electronics (005930.KS)
        const result = await YahooFinanceService.getInstance().getHistoricalRates('005930', 'KOSPI')
        if (result && result.quotes) {
            return { success: true, count: result.quotes.length }
        }
        return { success: false, error: '데이터를 가져오지 못했습니다.' }
    } catch (err: any) {
        return { success: false, error: err.message }
    }
})

ipcMain.on('kiwoom:notify-disparity-slump', (_event, data: { code: string, name: string, disparity: number, changeRate: number }) => {
    eventBus.emit(SystemEvent.DISPARITY_SLUMP_DETECTED, data)
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

        // Sync holding history with DB automatically
        try {
            const hBody = result?.data?.Body || result?.data;
            const listData = hBody?.acnt_evlt_remn_indv_tot || hBody?.output1 || hBody?.list || hBody?.grid || [];
            const list = Array.isArray(listData) ? listData : [listData].filter(Boolean);

            if (list.length > 0) {
                const currentCodes = list.map((item: any) =>
                    String(item.stk_cd || item.pdno || item.code || '').replace(/^A/i, '').trim()
                ).filter(Boolean);
                DatabaseService.getInstance().syncHoldingHistory(currentCodes);
            }
        } catch (syncErr) {
            console.error('[Main] Failed to sync holding history:', syncErr);
        }

        // Return consistent structure
        return { success: true, data: result.data, headers: result.headers }
    } catch (error: any) {
        return { success: false, error: error?.response?.data || { message: error.message } }
    }
})


ipcMain.handle('holding:get-history', () => {
    return DatabaseService.getInstance().getHoldingHistory();
})

ipcMain.handle('kiwoom:get-trading-days', async () => {
    try {
        const chartRes = await kiwoomService.getChartData('005930');
        const rawData = chartRes?.stk_dt_pole_chart_qry || chartRes?.output2 || chartRes?.Body || chartRes?.list || [];

        const tradingDays = rawData.map((d: any) => {
            const dateStr = String(d.dt || d.stck_bsop_date || d.date || d.trd_dt || '');
            return dateStr.length === 8 ? `${dateStr.substring(0, 4)}-${dateStr.substring(4, 6)}-${dateStr.substring(6, 8)}` : dateStr;
        }).filter((d: string) => d.length === 10).sort();

        const today = new Date().toISOString().split('T')[0];
        if (!tradingDays.includes(today)) tradingDays.push(today);
        tradingDays.sort();

        return { success: true, data: tradingDays };
    } catch (err: any) {
        return { success: false, error: err.message };
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

ipcMain.handle('kiwoom:get-unexecuted-orders', async (_event, { accountNo }) => {
    try {
        const data = await kiwoomService.getUnexecutedOrders(accountNo)
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

ipcMain.handle('kiwoom:get-api-logs', () => {
    return kiwoomService.getApiLogs()
})

ipcMain.handle('kiwoom:test-market-scanner', async () => {
    try {
        const data = await kiwoomService.getVolumeSpikeStocks()
        return { success: true, data }
    } catch (error: any) {
        return { success: false, error: error?.response?.data || { message: error.message } }
    }
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
    const success = await kiwoomService.wsRegister(symbols)
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

ipcMain.handle('kiwoom:execute-manual-buy', async () => {
    try {
        await autoTradeService.executeManualBuy();
        return { success: true };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
})

ipcMain.handle('kiwoom:execute-d3-auto-sell', async () => {
    try {
        await autoTradeService.executeD3AutoSell();
        return { success: true };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
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
ipcMain.handle('telegram:save-settings', (_event, settings: any) => {
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
        await telegramService.sendAutoTradeStatusMessage(true);
        return { success: true };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
})

ipcMain.handle('telegram:test-top-rising', async () => {
    try {
        await telegramService.sendDailyTopRisingMessage('단일 테스트');
        return { success: true };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
})

ipcMain.handle('telegram:test-period-rising', async (_event, { label, days }) => {
    try {
        await telegramService.sendPeriodTopRisingMessage(label, days);
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

ipcMain.handle('dart:get-financial-data', async (_event, stockCode: string) => {
    try {
        const data = DatabaseService.getInstance().getFinancialData(stockCode)
        return { success: true, data }
    } catch (err: any) {
        return { success: false, error: err.message }
    }
})

ipcMain.handle('dart:sync-batch-financials', async (_event, stockCodes: string[]) => {
    try {
        await DartApiService.getInstance().syncBatchFinancials(stockCodes)
        return { success: true }
    } catch (err: any) {
        return { success: false, error: err.message }
    }
})

ipcMain.handle('kiwoom:analyze-stock', async (_event, stockCode: string) => {
    try {
        const result = await CompanyAnalysisService.getInstance().analyzeStock(stockCode)
        return { success: true, data: result }
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
ipcMain.handle('open-external', async (_event, url: string) => {
    try {
        await shell.openExternal(url)
        return { success: true }
    } catch (err: any) {
        return { success: false, error: err.message }
    }
})

ipcMain.handle('ai-trade:set-autopilot', (_event, active: boolean) => {
    AiDecisionService.getInstance().setAutoPilot(active)
    return { success: true }
})

ipcMain.handle('ai-trade:get-autopilot', () => {
    return AiDecisionService.getInstance().getIsAutoPilot()
})

ipcMain.handle('ai-trade:get-logs', () => {
    return MarketScannerService.getInstance().getLogHistory()
})
ipcMain.handle('ai-trade:get-strategies', () => {
    return DatabaseService.getInstance().getAiStrategies()
})

ipcMain.handle('ai-trade:set-active-strategy', (_event, id: string) => {
    DatabaseService.getInstance().setAiStrategyActive(id)
    return { success: true }
})

ipcMain.handle('ai-trade:delete-strategy', (_event, id: string) => {
    DatabaseService.getInstance().deleteAiStrategy(id)
    return { success: true }
})

ipcMain.handle('ai-trade:run-retrospective', async () => {
    const result = await DailyRetrospectiveService.getInstance().runRetrospective()
    return { success: true, strategy: result }
})

ipcMain.handle('ai-trade:reset-account', () => {
    return VirtualAccountService.getInstance().resetAccount()
})

ipcMain.handle('ai-trade:get-account-state', () => {
    return VirtualAccountService.getInstance().getAccountState()
})
ipcMain.handle('ai-trade:get-runtime-config', () => {
    return AiDecisionService.getInstance().getActiveConfig()
})
ipcMain.handle('ai-trade:save-runtime-config', (_event, config: any) => {
    store.set('ai_runtime_config', config)
    return { success: true }
})
ipcMain.handle('ai-trade:sync-strategy-config', () => {
    AiDecisionService.getInstance().syncRuntimeConfigWithActiveStrategy()
    return { success: true }
})
ipcMain.handle('ai:save-settings', (_event, settings: any) => {
    store.set('ai_settings', settings)
    return { success: true }
})
ipcMain.handle('ai:get-settings', () => {
    return store.get('ai_settings') || null
})

ipcMain.handle('ai:test-connection', async (_event, { geminiKey, modelName }: { geminiKey: string, modelName: string }) => {
    try {
        const response = await AiService.getInstance().askGemini(
            'Hello, this is a connection test. Please respond with "Connected".',
            undefined,
            geminiKey,
            modelName
        )
        return { success: true, response }
    } catch (err: any) {
        return { success: false, error: err.message }
    }
})
