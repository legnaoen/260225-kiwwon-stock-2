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
import { SchedulerService } from './services/SchedulerService'
import { StockMasterService } from './services/StockMasterService'
import { IngestionManager } from './services/IngestionManager'
import { eventBus, SystemEvent } from './utils/EventBus'

const store = new Store()
const kiwoomService = KiwoomService.getInstance()
const autoTradeService = AutoTradeService.getInstance()
const telegramService = TelegramService.getInstance()
const marketScannerService = MarketScannerService.getInstance()
const aiDecisionService = AiDecisionService.getInstance()
const schedulerService = SchedulerService.getInstance()
const ingestionManager = IngestionManager.getInstance()
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

// 앱 시작 시 스킬스 파일 초기 스냅샷 DB 기록
import('./services/SkillsService').then(({ SkillsService }) => {
    SkillsService.getInstance().initSnapshots()
}).catch(console.error)

// Global Error Handling
process.on('uncaughtException', (error) => {
    console.error('CRITICAL: Uncaught Exception:', error);
    if (win && !win.isDestroyed()) {
        win.webContents.send('system:error', { message: error.message, stack: error.stack });
    }
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('CRITICAL: Unhandled Rejection at:', promise, 'reason:', reason);
});

function createWindow() {
    win = new BrowserWindow({
        width: 1400,
        height: 1000,
        minWidth: 1400,
        minHeight: 1000,
        center: true,
        frame: false,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
        },
    })

    if (win) {
        console.log('[Main] Window created with size: 1400x1000')
        const size = win.getSize()
        console.log(`[Main] Actual window size: ${size[0]}x${size[1]}`)
        kiwoomService.initWebSocket(win)
    }

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

    // Forward Batch Progress
    eventBus.on(SystemEvent.BATCH_PROGRESS, (data) => {
        if (win && !win.isDestroyed()) {
            win.webContents.send('analysis:batch-progress', data)
        }
    })

    // Forward YouTube Progress
    eventBus.on(SystemEvent.YOUTUBE_PROGRESS, (data) => {
        if (win && !win.isDestroyed()) {
            win.webContents.send('youtube:progress', data)
        }
    })

    // Forward System Error
    eventBus.on(SystemEvent.SYSTEM_ERROR, (errorInfo) => {
        if (win && !win.isDestroyed()) {
            win.webContents.send('system:error', errorInfo)
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
            console.log('[Main] Starting startup Stock Master & DART sync...')
            // 종목 마스터 동기화 (내부에서 오늘 날짜 체크함)
            await StockMasterService.getInstance().checkAndUpdate()
            
            await DartApiService.getInstance().syncWatchlistSchedules()
            console.log('[Main] Startup sync completed.')
        } catch (err) {
            console.error('[Main] Startup sync failed:', err)
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

ipcMain.handle('yahoo:get-macros', async (_event, symbols: string[]) => {
    try {
        const { YahooFinanceService } = await import('./services/YahooFinanceService')
        const results = await Promise.all(symbols.map(s => YahooFinanceService.getInstance().getMacroIndicator(s)))
        return { success: true, data: results }
    } catch (err: any) {
        return { success: false, error: err.message }
    }
})

ipcMain.on('kiwoom:notify-disparity-slump', (_event, data: { code: string, name: string, disparity: number, changeRate: number }) => {
    eventBus.emit(SystemEvent.DISPARITY_SLUMP_DETECTED, data)
})

// ─── Critical Infrastructure IPC Handlers ───────────────────────────

ipcMain.handle('kiwoom:get-connection-status', () => {
    try {
        return kiwoomService.getConnectionStatus()
    } catch (error) {
        return { connected: false, realConnected: false }
    }
})

ipcMain.handle('kiwoom:reset-circuit', () => {
    kiwoomService.resetCircuitBreaker()
    return { success: true }
})

ipcMain.handle('kiwoom:get-api-logs', () => {
    return kiwoomService.getApiLogs()
})

ipcMain.handle('maiis:get-inventory', () => {
    try {
        return IngestionManager.getInstance().getInventory()
    } catch (e) {
        console.error('[Main] Failed to get MAIIS inventory:', e)
        return []
    }
})

ipcMain.handle('maiis:get-stats', (_event, limit) => {
    try {
        return IngestionManager.getInstance().getRecentStats(limit)
    } catch (e) {
        console.error('[Main] Failed to get MAIIS stats:', e)
        return []
    }
})

ipcMain.handle('maiis:trigger-sync', async (_event, { providerId, options }) => {
    try {
        return await IngestionManager.getInstance().triggerSync(providerId, options)
    } catch (err: any) {
        return { success: false, error: err.message }
    }
})

ipcMain.handle('maiis:analyze-domain', async (_event, { domain, date }) => {
    try {
        const { MaiisDomainService } = await import('./services/MaiisDomainService')
        return domain === 'YOUTUBE' 
            ? await MaiisDomainService.getInstance().analyzeYoutubeDomain(date)
            : await MaiisDomainService.getInstance().analyzeNewsDomain(date)
    } catch (err: any) {
        return { success: false, error: err.message }
    }
})

ipcMain.handle('maiis:get-domain-insights', async (_event, date) => {
    const { DatabaseService } = await import('./services/DatabaseService');
    const db = DatabaseService.getInstance();
    const targetDate = date || db.getKstDate()
    return db.getMaiisDomainInsights(targetDate)
})

ipcMain.handle('maiis:get-world-state', async (_event, date) => {
    const { DatabaseService } = await import('./services/DatabaseService');
    const db = DatabaseService.getInstance();
    const targetDate = date || db.getKstDate()
    return db.getMaiisWorldState(targetDate)
})

ipcMain.handle('maiis:get-macro-snapshot', async () => {
    try {
        const { MaiisMacroService } = await import('./services/MaiisMacroService');
        const snapshots = await MaiisMacroService.getInstance().getDailyMacroSnapshot();
        return { success: true, data: snapshots };
    } catch (err: any) {
        return { success: false, error: err.message };
    }
})

ipcMain.on('chart-render-complete', (_event, code) => {
    eventBus.emit(SystemEvent.CHART_RENDER_COMPLETE, code)
})

// ─── Existing IPC Handlers ─────────────────────────────────────────

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

        return { success: true, data: tradingDays };
    } catch (err: any) {
        console.error('[Main] get-trading-days Error:', err.message);
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

ipcMain.handle('kiwoom:test-market-scanner', async () => {
    try {
        const data = await kiwoomService.getVolumeSpikeStocks()
        return { success: true, data }
    } catch (error: any) {
        return { success: false, error: error?.response?.data || { message: error.message } }
    }
})

ipcMain.handle('kiwoom:get-top-trading-value-stocks', async () => {
    try {
        const data = await kiwoomService.getTopTradingValueStocks()
        return { success: true, data }
    } catch (error: any) {
        return { success: false, error: error?.response?.data || { message: error.message } }
    }
})

ipcMain.handle('kiwoom:get-top-rising-stocks', async () => {
    try {
        const data = await kiwoomService.getTopRisingStocks()
        return { success: true, data }
    } catch (error: any) {
        return { success: false, error: error?.response?.data || { message: error.message } }
    }
})

ipcMain.handle('kiwoom:get-combined-top-stocks', async (_event, { risingLimit, tradingValueLimit }) => {
    try {
        const data = await kiwoomService.getCombinedTopStocks(risingLimit, tradingValueLimit)
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

// === Naver API Handlers ===
ipcMain.handle('naver:save-keys', (_event, keys: { clientId: string, clientSecret: string }) => {
    store.set('naver_api_keys', keys)
    return { success: true }
})

ipcMain.handle('naver:get-keys', () => {
    return store.get('naver_api_keys') || null
})

ipcMain.handle('naver:test-api', async (_event, { clientId, clientSecret }) => {
    try {
        const axios = (await import('axios')).default
        const response = await axios.get('https://openapi.naver.com/v1/search/news.json', {
            params: { query: '삼성전자', display: 1 },
            headers: {
                'X-Naver-Client-Id': clientId,
                'X-Naver-Client-Secret': clientSecret
            }
        })
        if (response.data && response.data.items && response.data.items.length > 0) {
            // HTML 태그 제거
            const cleanTitle = response.data.items[0].title.replace(/<[^>]*>?/gm, '')
            return { success: true, title: cleanTitle }
        }
        return { success: false, error: '검색 결과가 없습니다.' }
    } catch (err: any) {
        return { success: false, error: err.response?.data?.errorMessage || err.message }
    }
})

// === Market News Briefing Handlers ===
ipcMain.handle('market-news:get-settings', () => {
    return store.get('market_briefing_settings') || {
        keywords: ['코스피 코스닥 시황', '뉴욕증시 마감', '미국 금리 환율'],
        enabled: true,
        reportTime: '08:20',
        telegramTime: '08:30',
        max_total_keywords: 5,
        ai_keywords_pool: []
    }
})

ipcMain.handle('market-news:save-settings', (_event, settings: any) => {
    store.set('market_briefing_settings', settings)
    return { success: true }
})

ipcMain.handle('market-news:get-latest-briefings', async (_event, limit) => {
    try {
        const { MarketNewsService } = await import('./services/MarketNewsService')
        return await MarketNewsService.getInstance().getLatestBriefings(limit)
    } catch (err: any) {
        console.error('[Main] get-latest-briefings Error:', err.message)
        return []
    }
})

ipcMain.handle('market-news:generate-now', async () => {
    try {
        const { MarketNewsService } = await import('./services/MarketNewsService')
        return await MarketNewsService.getInstance().generateMarketBriefing()
    } catch (err: any) {
        console.error('[Main] generate-now Error:', err.message)
        return { success: false, error: err.message }
    }
})

ipcMain.handle('market-news:get-trends', async (_event, limit: number = 30) => {
    try {
        const { DatabaseService } = await import('./services/DatabaseService');
        const trends = DatabaseService.getInstance().getLatestMarketNewsTrends(limit);
        return { success: true, data: trends };
    } catch (err: any) {
        return { success: false, error: err.message };
    }
})

// === YouTube API Handlers ===
ipcMain.handle('youtube:save-key', (_event, key: string) => {
    store.set('youtube_api_key', key)
    return { success: true }
})

ipcMain.handle('youtube:get-key', () => {
    return store.get('youtube_api_key') || ''
})

ipcMain.handle('youtube:get-channels', async () => {
    try {
        const { YoutubeService } = await import('./services/YoutubeService')
        return await YoutubeService.getInstance().getChannels()
    } catch (err: any) {
        console.error('[Main] get-youtube-channels Error:', err.message)
        return []
    }
})

ipcMain.handle('youtube:get-latest-insights', async (_event, limit) => {
    try {
        const { YoutubeService } = await import('./services/YoutubeService')
        return await YoutubeService.getInstance().getLatestInsights(limit)
    } catch (err: any) {
        console.error('[Main] get-latest-youtube-insights Error:', err.message)
        return []
    }
})

ipcMain.handle('youtube:test-api', async (_event, key: string) => {
    try {
        const axios = (await import('axios')).default
        // Test with a simple search for the keyword 'KOSPI'
        const response = await axios.get('https://www.googleapis.com/youtube/v3/search', {
            params: {
                part: 'snippet',
                q: 'KOSPI',
                maxResults: 1,
                key: key.trim()
            }
        })
        if (response.data && response.data.items) {
            return { success: true, message: 'YouTube API 연결 성공!' }
        }
        return { success: false, error: '검색 결과가 없습니다.' }
    } catch (err: any) {
        console.error('[Main] YouTube API Test Error:', err.response?.data || err.message)
        const errorMsg = err.response?.data?.error?.message || err.message
        return { success: false, error: errorMsg }
    }
})

ipcMain.handle('youtube:add-channel', async (_event, { id, name }) => {
    try {
        const { YoutubeService } = await import('./services/YoutubeService')
        await YoutubeService.getInstance().addChannel(id, name)
        return { success: true }
    } catch (err: any) {
        return { success: false, error: err.message }
    }
})

ipcMain.handle('youtube:update-trust', async (_event, { id, score }) => {
    try {
        const { YoutubeService } = await import('./services/YoutubeService')
        await YoutubeService.getInstance().updateChannelTrust(id, score)
        return { success: true }
    } catch (err: any) {
        return { success: false, error: err.message }
    }
})

ipcMain.handle('youtube:remove-channel', async (_event, channelId: string) => {
    try {
        const { YoutubeService } = await import('./services/YoutubeService')
        await YoutubeService.getInstance().removeChannel(channelId)
        return { success: true }
    } catch (err: any) {
        return { success: false, error: err.message }
    }
})

ipcMain.handle('youtube:sync-videos', async () => {
    try {
        const apiKey = store.get('youtube_api_key') as string;
        if (!apiKey) return { success: false, error: '유튜브 API 키가 설정되지 않았습니다.' };
        const { YoutubeService } = await import('./services/YoutubeService');
        return await YoutubeService.getInstance().collectLatestVideos(apiKey, undefined, { skipAnalysis: true });
    } catch (err: any) {
        return { success: false, error: err.message };
    }
});

ipcMain.handle('youtube:collect-now', async (_event, channelId?: string) => {
    try {
        const apiKey = store.get('youtube_api_key') as string
        if (!apiKey) return { success: false, error: '유튜브 API 키가 설정되지 않았습니다.' }

        const { YoutubeService } = await import('./services/YoutubeService')
        return await YoutubeService.getInstance().collectLatestVideos(apiKey, channelId)
    } catch (err: any) {
        return { success: false, error: err.message }
    }
})

ipcMain.handle('youtube:reanalyze-video', async (_event, videoId: string) => {
    try {
        const { YoutubeService } = await import('./services/YoutubeService')
        return await YoutubeService.getInstance().reanalyzeVideo(videoId)
    } catch (err: any) {
        return { success: false, error: err.message }
    }
})

ipcMain.handle('youtube:get-trends', async (_event, limit: number = 30) => {
    try {
        const trends = DatabaseService.getInstance().getLatestYoutubeNarrativeTrends(limit);
        return { success: true, data: trends };
    } catch (err: any) {
        return { success: false, error: err.message };
    }
})

ipcMain.handle('youtube:get-consensus', async (_event, limit: number = 20) => {
    try {
        const consensus = DatabaseService.getInstance().getLatestYoutubeDailyConsensus(limit);
        return { success: true, data: consensus };
    } catch (err: any) {
        return { success: false, error: err.message };
    }
})

ipcMain.handle('youtube:get-settings', () => {
    return store.get('youtube_settings') || {
        enabled: true,
        collectTime: '08:30'
    };
});

ipcMain.handle('youtube:save-settings', async (_event, settings: any) => {
    store.set('youtube_settings', settings);
    const { SchedulerService } = await import('./services/SchedulerService');
    SchedulerService.getInstance().initSchedules();
    return { success: true };
});

// === Rising Stocks Analysis DB Handlers ===
ipcMain.handle('analysis:save-market-report', async (_event, report) => {
    try {
        DatabaseService.getInstance().saveMarketDailyReport(report)
        return { success: true }
    } catch (err: any) {
        return { success: false, error: err.message }
    }
})

ipcMain.handle('analysis:get-market-report', async (_event, { date, timing }) => {
    try {
        const report = DatabaseService.getInstance().getMarketDailyReport(date, timing)
        return { success: true, data: report }
    } catch (err: any) {
        return { success: false, error: err.message }
    }
})

ipcMain.handle('analysis:save-stock-analysis', async (_event, analysis) => {
    try {
        DatabaseService.getInstance().saveRisingStockAnalysis(analysis)
        return { success: true }
    } catch (err: any) {
        return { success: false, error: err.message }
    }
})

ipcMain.handle('analysis:get-stocks-by-date', async (_event, { date, timing }) => {
    try {
        const stocks = DatabaseService.getInstance().getRisingStocksByDate(date, timing)
        return { success: true, data: stocks }
    } catch (err: any) {
        return { success: false, error: err.message }
    }
})

ipcMain.handle('analysis:get-stock-analysis', async (_event, stockCode) => {
    try {
        const history = DatabaseService.getInstance().getStockAnalysis(stockCode)
        return { success: true, data: history }
    } catch (err: any) {
        return { success: false, error: err.message }
    }
})

ipcMain.handle('analysis:run-stock-analysis', async (_event, options) => {
    try {
        const service = (await import('./services/RisingStockAnalysisService')).RisingStockAnalysisService.getInstance()
        const result = await service.runAnalysis(options)
        return result
    } catch (err: any) {
        return { success: false, error: err.message }
    }
})

ipcMain.handle('analysis:run-market-report', async (_event, { date, timing }) => {
    try {
        const result = await (await import('./services/RisingStockAnalysisService')).RisingStockAnalysisService.getInstance().generateMarketDailyReport(date, timing)
        return result
    } catch (err: any) {
        return { success: false, error: err.message }
    }
})

ipcMain.handle('analysis:run-batch-report', async (_event, { timing, date }) => {
    try {
        const { SchedulerService } = await import('./services/SchedulerService')
        const result = await SchedulerService.getInstance().runManualBatchAnalysis(timing || 'MANUAL', date)
        return result
    } catch (err: any) {
        return { success: false, error: err.message }
    }
})

ipcMain.handle('analysis:save-ai-schedule-settings', async (_event, settings) => {
    try {
        store.set('ai_schedule_settings', settings)
        // 스케줄러 즉시 반영
        const { SchedulerService } = await import('./services/SchedulerService')
        SchedulerService.getInstance().initSchedules()
        return { success: true }
    } catch (err: any) {
        return { success: false, error: err.message }
    }
})

ipcMain.handle('analysis:get-ai-schedule-settings', async () => {
    try {
        const settings = store.get('ai_schedule_settings')
        return { success: true, data: settings }
    } catch (err: any) {
        return { success: false, error: err.message }
    }
})

ipcMain.handle('analysis:get-report-history', async () => {
    try {
        const history = DatabaseService.getInstance().getDailyReportHistory()
        return { success: true, data: history }
    } catch (err: any) {
        return { success: false, error: err.message }
    }
})

ipcMain.handle('analysis:get-raw-data', async (_event, { date, stockCode }) => {
    try {
        const raw = DatabaseService.getInstance().getRawData(date, stockCode)
        if (!raw) return { success: false, error: '저장된 원본 데이터가 없습니다.' }
        return {
            success: true,
            data: {
                news: JSON.parse(raw.news_json || '[]'),
                disclosures: JSON.parse(raw.disclosures_json || '[]'),
                collectedAt: (raw as any).collected_at
            }
        }
    } catch (err: any) {
        return { success: false, error: err.message }
    }
})

ipcMain.handle('naver:collect-news', async (_event, { date, stockCode, stockName }) => {
    try {
        const { NaverNewsService } = await import('./services/NaverNewsService')
        const news = await NaverNewsService.getInstance().searchNews(stockName, 10)
        
        // DB 저장
        DatabaseService.getInstance().saveNewsRawData(date, stockCode, stockName, news)
        
        return { success: true, data: news }
    } catch (err: any) {
        return { success: false, error: err.message }
    }
})

ipcMain.handle('dart:collect-disclosures', async (_event, { date, stockCode, stockName }) => {
    try {
        const { DartApiService } = await import('./services/DartApiService')
        const result = await DartApiService.getInstance().getDisclosuresSummaryForAiWithRaw(stockCode)
        
        // DB 저장
        DatabaseService.getInstance().saveDisclosuresRawData(date, stockCode, stockName, result.items)
        
        return { success: true, data: result.items }
    } catch (err: any) {
        return { success: false, error: err.message }
    }
})

// ─── Skills File IPC ─────────────────────────────────────────────────────────

ipcMain.handle('skills:get-all', async () => {
    try {
        const { SkillsService } = await import('./services/SkillsService')
        const list = SkillsService.getInstance().getAllSkillsInfo()
        return { success: true, data: list }
    } catch (err: any) {
        return { success: false, error: err.message }
    }
})

ipcMain.handle('skills:get-history', async (_event, fileName: string) => {
    try {
        const { SkillsService } = await import('./services/SkillsService')
        const history = SkillsService.getInstance().getHistory(fileName)
        return { success: true, data: history }
    } catch (err: any) {
        return { success: false, error: err.message }
    }
})

ipcMain.handle('skills:get-version', async (_event, { fileName, version }: { fileName: string, version: number }) => {
    try {
        const { SkillsService } = await import('./services/SkillsService')
        const content = SkillsService.getInstance().getVersionContent(fileName, version)
        return { success: true, data: content }
    } catch (err: any) {
        return { success: false, error: err.message }
    }
})

ipcMain.handle('skills:save', async (_event, { fileName, content, diffSummary }: { fileName: string, content: string, diffSummary: string }) => {
    try {
        const { SkillsService } = await import('./services/SkillsService')
        SkillsService.getInstance().saveAndSnapshot(fileName, content, diffSummary, 'MANUAL')
        return { success: true }
    } catch (err: any) {
        return { success: false, error: err.message }
    }
})

// End of Handlers
