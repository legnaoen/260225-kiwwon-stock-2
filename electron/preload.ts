import { contextBridge, ipcRenderer } from 'electron'

// --------- Expose some API to the Renderer process ---------
contextBridge.exposeInMainWorld('electronAPI', {
    on: (channel: string, callback: (...args: any[]) => void) => {
        ipcRenderer.on(channel, (_event, ...args) => callback(...args))
    },
    send: (channel: string, ...args: any[]) => {
        ipcRenderer.send(channel, ...args)
    },
    sendChartRenderComplete: (code: string) => ipcRenderer.send('chart-render-complete', code),
    // Window controls
    minimize: () => ipcRenderer.send('window-controls:minimize'),
    maximize: () => ipcRenderer.send('window-controls:maximize'),
    close: () => ipcRenderer.send('window-controls:close'),
    // API Key Management
    saveApiKeys: (keys: { appkey: string, secretkey: string }) => ipcRenderer.invoke('kiwoom:save-keys', keys),
    getApiKeys: () => ipcRenderer.invoke('kiwoom:get-keys'),
    // Data Fetching (REAL mode is handled by backend internally)
    getAccountList: () => ipcRenderer.invoke('kiwoom:get-accounts'),
    getHoldings: (options: { accountNo: string, nextKey?: string }) => ipcRenderer.invoke('kiwoom:get-holdings', options),
    getDeposit: (options: { accountNo: string }) => ipcRenderer.invoke('kiwoom:get-deposit', options),
    getUnexecutedOrders: (options: { accountNo: string }) => ipcRenderer.invoke('kiwoom:get-unexecuted-orders', options),
    getAllStocks: (marketType: string) => ipcRenderer.invoke('kiwoom:get-all-stocks', { marketType }),
    getWatchlist: (symbols: string[]) => ipcRenderer.invoke('kiwoom:get-watchlist', { symbols }),
    getChartData: (options: { stk_cd: string, base_dt?: string }) => ipcRenderer.invoke('kiwoom:get-chart-data', options),
    wsRegister: (symbols: string[]) => ipcRenderer.invoke('kiwoom:ws-register', symbols),
    onRealTimeData: (callback: (data: any) => void) => {
        const listener = (_event: any, data: any) => callback(data)
        ipcRenderer.on('kiwoom:real-time-data', listener)
        return () => ipcRenderer.removeListener('kiwoom:real-time-data', listener)
    },
    onMarketStatus: (callback: (data: { code: string, time: string }) => void) => {
        const listener = (_event: any, data: any) => callback(data)
        ipcRenderer.on('kiwoom:market-status', listener)
        return () => ipcRenderer.removeListener('kiwoom:market-status', listener)
    },
    notifyDisparitySlump: (data: { code: string, name: string, disparity: number, changeRate: number }) => ipcRenderer.send('kiwoom:notify-disparity-slump', data),
    saveWatchlistSymbols: (symbols: string[]) => ipcRenderer.invoke('kiwoom:save-watchlist-symbols', symbols),
    getWatchlistSymbols: () => ipcRenderer.invoke('kiwoom:get-watchlist-symbols'),
    getConnectionStatus: () => ipcRenderer.invoke('kiwoom:get-connection-status'),
    analyzeStock: (stockCode: string) => ipcRenderer.invoke('kiwoom:analyze-stock', stockCode),

    // Auto Trade
    saveAutoTradeSettings: (settings: any) => ipcRenderer.invoke('kiwoom:save-autotrade-settings', settings),
    getAutoTradeSettings: () => ipcRenderer.invoke('kiwoom:get-autotrade-settings'),
    getAutoTradeStatus: () => ipcRenderer.invoke('kiwoom:get-autotrade-status'),
    setAutoTradeStatus: (status: boolean) => ipcRenderer.invoke('kiwoom:set-autotrade-status', status),
    executeManualBuy: () => ipcRenderer.invoke('kiwoom:execute-manual-buy'),
    onAutoTradeLog: (callback: (log: any) => void) => {
        const listener = (_event: any, log: any) => callback(log)
        ipcRenderer.on('kiwoom:auto-trade-log', listener)
        return () => ipcRenderer.removeListener('kiwoom:auto-trade-log', listener)
    },
    onAutoTradeStatusChanged: (callback: (running: boolean) => void) => {
        const listener = (_event: any, running: boolean) => callback(running)
        ipcRenderer.on('kiwoom:auto-trade-status-changed', listener)
        return () => ipcRenderer.removeListener('kiwoom:auto-trade-status-changed', listener)
    },
    // Real-time order updates
    onOrderRealtime: (callback: (order: any) => void) => {
        const listener = (_event: any, order: any) => callback(order);
        ipcRenderer.on('kiwoom:order-realtime', listener);
        return () => ipcRenderer.removeListener('kiwoom:order-realtime', listener);
    },

    // API Diagnostics
    getApiLogs: () => ipcRenderer.invoke('kiwoom:get-api-logs'),
    testMarketScanner: () => ipcRenderer.invoke('kiwoom:test-market-scanner'),

    // Telegram
    saveTelegramSettings: (settings: { botToken: string, chatId: string, chartTheme?: string }) => ipcRenderer.invoke('telegram:save-settings', settings),
    saveTelegramTheme: (theme: string) => ipcRenderer.invoke('telegram:save-theme', theme),
    getTelegramSettings: () => ipcRenderer.invoke('telegram:get-settings'),
    sendTelegramTestMessage: () => ipcRenderer.invoke('telegram:test-message'),
    sendTelegramMessage: (message: string) => ipcRenderer.invoke('telegram:send-message', message),

    // Condition Search
    connectConditionWs: () => ipcRenderer.invoke('kiwoom:connect-condition-ws'),
    getConditionList: () => ipcRenderer.invoke('kiwoom:get-condition-list'),
    startConditionSearch: (seq: string) => ipcRenderer.invoke('kiwoom:start-condition-search', seq),
    onConditionList: (callback: (conditions: any[]) => void) => {
        const listener = (_event: any, data: any[]) => callback(data)
        ipcRenderer.on('kiwoom:condition-list', listener)
        return () => ipcRenderer.removeListener('kiwoom:condition-list', listener)
    },

    // DART API & SQLite Scheduling
    saveDartApiKey: (key: string) => ipcRenderer.invoke('dart:save-key', key),
    getDartApiKey: () => ipcRenderer.invoke('dart:get-key'),
    saveDartSettings: (settings: any) => ipcRenderer.invoke('dart:save-settings', settings),
    getDartSettings: () => ipcRenderer.invoke('dart:get-settings'),
    syncDartCorpCodes: () => ipcRenderer.invoke('dart:sync-corp-codes'),
    getFinancialData: (stockCode: string) => ipcRenderer.invoke('dart:get-financial-data', stockCode),
    syncDartWatchlistSchedules: () => ipcRenderer.invoke('dart:sync-watchlist-schedules'),
    syncBatchFinancials: (stockCodes: string[]) => ipcRenderer.invoke('dart:sync-batch-financials', stockCodes),
    fetchDartDisclosures: (options: { corpCodes: string[], bgnDe: string, endDe: string }) =>
        ipcRenderer.invoke('dart:fetch-disclosures', options),

    // Schedule Settings
    saveScheduleSettings: (settings: { notificationTime: string, globalDailyNotify: boolean, sendMissedOnStartup?: boolean }) =>
        ipcRenderer.invoke('schedule:save-settings', settings),
    getScheduleSettings: () => ipcRenderer.invoke('schedule:get-settings'),
    syncSchedules: (schedules: any[]) => ipcRenderer.invoke('schedule:sync', schedules),
    deleteSchedule: (id: string) => ipcRenderer.invoke('schedule:delete', id),
    getSchedules: () => ipcRenderer.invoke('schedule:get-all'),
    getSchedulesByStock: (stockCode: string) => ipcRenderer.invoke('schedule:get-by-stock', stockCode),
    onScheduleNotified: (callback: any) => ipcRenderer.on('schedule:notified', callback),
    testScheduleSummary: () => ipcRenderer.invoke('schedule:test-summary'),
    openExternal: (url: string) => ipcRenderer.invoke('open-external', url),
    testYahooFinance: () => ipcRenderer.invoke('yahoo:test-connection'),

    // AI Trade
    onAiTradeStream: (callback: (data: any) => void) => {
        const listener = (_event: any, data: any) => callback(data)
        ipcRenderer.on('ai-trade:stream', listener)
        return () => ipcRenderer.removeListener('ai-trade:stream', listener)
    },
    onAiTradeEvaluationUpdate: (callback: (data: { isEvaluating: boolean, stock: { code: string, name: string } | null }) => void) => {
        const listener = (_event: any, data: any) => callback(data)
        ipcRenderer.on('ai-trade:evaluation-update', listener)
        return () => ipcRenderer.removeListener('ai-trade:evaluation-update', listener)
    },
    getAiTradeStatus: () => ipcRenderer.invoke('ai-trade:get-status'),
    setAiAutoPilot: (active: boolean) => ipcRenderer.invoke('ai-trade:set-autopilot', active),
    getAiAutoPilot: () => ipcRenderer.invoke('ai-trade:get-autopilot'),
    getAiTradeLogs: () => ipcRenderer.invoke('ai-trade:get-logs'),
    resetAiAccount: () => ipcRenderer.invoke('ai-trade:reset-account'),
    getAiAccountState: () => ipcRenderer.invoke('ai-trade:get-account-state'),
    getAiStrategies: () => ipcRenderer.invoke('ai-trade:get-strategies'),
    setAiActiveStrategy: (id: string) => ipcRenderer.invoke('ai-trade:set-active-strategy', id),
    deleteAiStrategy: (id: string) => ipcRenderer.invoke('ai-trade:delete-strategy', id),
    runAiRetrospective: () => ipcRenderer.invoke('ai-trade:run-retrospective'),
    getAiRuntimeConfig: () => ipcRenderer.invoke('ai-trade:get-runtime-config'),
    saveAiRuntimeConfig: (config: any) => ipcRenderer.invoke('ai-trade:save-runtime-config', config),
    syncStrategyConfig: () => ipcRenderer.invoke('ai-trade:sync-strategy-config'),
    saveAiSettings: (settings: { geminiKey: string, modelName?: string, virtualInitialBalance?: number }) => ipcRenderer.invoke('ai:save-settings', settings),
    getAiSettings: () => ipcRenderer.invoke('ai:get-settings'),
    testAiConnection: (settings: { geminiKey: string, modelName: string }) => ipcRenderer.invoke('ai:test-connection', settings),
})
