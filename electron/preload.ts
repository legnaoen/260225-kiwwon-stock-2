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
    getTopRisingStocks: () => ipcRenderer.invoke('kiwoom:get-top-rising-stocks'),
    getTopTradingValueStocks: () => ipcRenderer.invoke('kiwoom:get-top-trading-value-stocks'),
    getCombinedTopStocks: (options: { risingLimit?: number, tradingValueLimit?: number }) => ipcRenderer.invoke('kiwoom:get-combined-top-stocks', options),
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
    resetCircuitBreaker: () => ipcRenderer.invoke('kiwoom:reset-circuit'),
    analyzeStock: (stockCode: string) => ipcRenderer.invoke('kiwoom:analyze-stock', stockCode),
    getHoldingHistory: () => ipcRenderer.invoke('holding:get-history'),
    getTradingDays: () => ipcRenderer.invoke('kiwoom:get-trading-days'),

    // Auto Trade
    saveAutoTradeSettings: (settings: any) => ipcRenderer.invoke('kiwoom:save-autotrade-settings', settings),
    getAutoTradeSettings: () => ipcRenderer.invoke('kiwoom:get-autotrade-settings'),
    getAutoTradeStatus: () => ipcRenderer.invoke('kiwoom:get-autotrade-status'),
    setAutoTradeStatus: (status: boolean) => ipcRenderer.invoke('kiwoom:set-autotrade-status', status),
    executeManualBuy: () => ipcRenderer.invoke('kiwoom:execute-manual-buy'),
    executeD3AutoSell: () => ipcRenderer.invoke('kiwoom:execute-d3-auto-sell'),
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
    saveTelegramSettings: (settings: { botToken: string, chatId: string, chartTheme?: string, dailyTopRisingNotify?: boolean, dailyTopRisingTime1?: string, dailyTopRisingTime2?: string }) => ipcRenderer.invoke('telegram:save-settings', settings),
    saveTelegramTheme: (theme: string) => ipcRenderer.invoke('telegram:save-theme', theme),
    getTelegramSettings: () => ipcRenderer.invoke('telegram:get-settings'),
    sendTelegramTestMessage: () => ipcRenderer.invoke('telegram:test-message'),
    testTelegramTopRising: () => ipcRenderer.invoke('telegram:test-top-rising'),
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
    getYahooMacros: (symbols: string[]) => ipcRenderer.invoke('yahoo:get-macros', symbols),

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
    saveAiSettings: (settings: { geminiKey: string, modelName?: string, virtualInitialBalance?: number, buyStartTime?: string, buyEndTime?: string }) => ipcRenderer.invoke('ai:save-settings', settings),
    getAiSettings: () => ipcRenderer.invoke('ai:get-settings'),
    testAiConnection: (settings: { geminiKey: string, modelName: string }) => ipcRenderer.invoke('ai:test-connection', settings),
    
    // YouTube
    saveYoutubeApiKey: (key: string) => ipcRenderer.invoke('youtube:save-key', key),
    getYoutubeApiKey: () => ipcRenderer.invoke('youtube:get-key'),
    getYoutubeChannels: () => ipcRenderer.invoke('youtube:get-channels'),
    getLatestYoutubeInsights: (limit: number) => ipcRenderer.invoke('youtube:get-latest-insights', limit),
    testYoutubeApi: (key: string) => ipcRenderer.invoke('youtube:test-api', key),
    addYoutubeChannel: (args: { id: string, name: string }) => ipcRenderer.invoke('youtube:add-channel', args),
    updateYoutubeTrust: (args: { id: string, score: number }) => ipcRenderer.invoke('youtube:update-trust', args),
    collectYoutubeNow: (channelId?: string) => ipcRenderer.invoke('youtube:collect-now', channelId),
    removeYoutubeChannel: (channelId: string) => ipcRenderer.invoke('youtube:remove-channel', channelId),
    onYoutubeProgress: (callback: (data: { stage: string, message: string, current: number, total: number }) => void) => {
        const listener = (_event: any, data: any) => callback(data)
        ipcRenderer.on('youtube:progress', listener)
        return () => ipcRenderer.removeListener('youtube:progress', listener)
    },
    reanalyzeYoutubeVideo: (videoId: string) => ipcRenderer.invoke('youtube:reanalyze-video', videoId),
    getYoutubeTrends: (limit?: number) => ipcRenderer.invoke('youtube:get-trends', limit),
    getYoutubeConsensus: (limit?: number) => ipcRenderer.invoke('youtube:get-consensus', limit),
    syncYoutubeVideos: () => ipcRenderer.invoke('youtube:sync-videos'),
    getYoutubeSettings: () => ipcRenderer.invoke('youtube:get-settings'),
    saveYoutubeSettings: (settings: any) => ipcRenderer.invoke('youtube:save-settings', settings),

    onMarketOpenedDetected: (callback: (data: { date: string, tradingDays: string[] }) => void) => {
        const listener = (_event: any, data: any) => callback(data)
        ipcRenderer.on('kiwoom:market-opened-detected', listener)
        return () => ipcRenderer.removeListener('kiwoom:market-opened-detected', listener)
    },
    saveNaverApiKeys: (keys: { clientId: string, clientSecret: string }) => ipcRenderer.invoke('naver:save-keys', keys),
    getNaverApiKeys: () => ipcRenderer.invoke('naver:get-keys'),
    testNaverApi: (keys: { clientId: string, clientSecret: string }) => ipcRenderer.invoke('naver:test-api', keys),

    // Market News Briefing
    getNewsSettings: () => ipcRenderer.invoke('market-news:get-settings'),
    saveNewsSettings: (settings: any) => ipcRenderer.invoke('market-news:save-settings', settings),
    getLatestBriefings: (limit: number) => ipcRenderer.invoke('market-news:get-latest-briefings', limit),
    generateNewsBriefingNow: () => ipcRenderer.invoke('market-news:generate-now'),
    getNewsTrends: (limit?: number) => ipcRenderer.invoke('market-news:get-trends', limit),

    // Rising Stocks Analysis
    saveMarketDailyReport: (report: any) => ipcRenderer.invoke('analysis:save-market-report', report),
    getMarketDailyReport: (options: { date: string, timing?: string }) => ipcRenderer.invoke('analysis:get-market-report', options),
    saveRisingStockAnalysis: (analysis: any) => ipcRenderer.invoke('analysis:save-stock-analysis', analysis),
    getRisingStocksByDate: (options: { date: string, timing?: string }) => ipcRenderer.invoke('analysis:get-stocks-by-date', options),
    getStockAnalysis: (stockCode: string) => ipcRenderer.invoke('analysis:get-stock-analysis', stockCode),
    runStockAnalysis: (options: { code: string, name: string, changeRate: number, tradingValue?: number, source?: string, timing?: string }) => ipcRenderer.invoke('analysis:run-stock-analysis', options),
    runMarketReport: (options: { date: string, timing?: string }) => ipcRenderer.invoke('analysis:run-market-report', options),
    getReportHistory: () => ipcRenderer.invoke('analysis:get-report-history'),
    runBatchReport: (timing?: string) => ipcRenderer.invoke('analysis:run-batch-report', timing),
    // MAIIS Agent Tester & World State
    analyzeDomain: (options: { domain: 'YOUTUBE' | 'NEWS', date?: string }) => ipcRenderer.invoke('maiis:analyze-domain', options),
    getDomainInsights: (date?: string) => ipcRenderer.invoke('maiis:get-domain-insights', date),
    getMaiisWorldState: (date?: string) => ipcRenderer.invoke('maiis:get-world-state', date),
    getMacroSnapshot: () => ipcRenderer.invoke('maiis:get-macro-snapshot'),
    getRisingStocksSummary: (date?: string) => ipcRenderer.invoke('maiis:get-rising-stocks-summary', date),
    generateMasterState: (timing: '0845' | '0930' | '1530', date?: string) => ipcRenderer.invoke('maiis:generate-master-state', { timing, date }),
    getCommandCenterDashboard: (date?: string) => ipcRenderer.invoke('maiis:get-command-center-dashboard', date),
    runRankingAggregation: (date?: string) => ipcRenderer.invoke('maiis:run-ranking-aggregation', date),
    runPortfolioReview: () => ipcRenderer.invoke('maiis:run-portfolio-review'),
    getPortfolioTracker: () => ipcRenderer.invoke('maiis:get-portfolio-tracker'),
    getStrategyProfiles: () => ipcRenderer.invoke('pm:get-strategy-profiles'),
    saveStrategyProfiles: (profiles: any) => ipcRenderer.invoke('pm:save-strategy-profiles', profiles),
    resetStrategyProfiles: () => ipcRenderer.invoke('pm:reset-strategy-profiles'),
    getReviewSchedule: () => ipcRenderer.invoke('pm:get-review-schedule'),
    saveReviewSchedule: (schedule: any) => ipcRenderer.invoke('pm:save-review-schedule', schedule),
    runPortfolioReview2: (mode: string) => ipcRenderer.invoke('pm:run-review', mode),

    onBatchProgress: (callback: (data: { step: string, current: number, total: number, message: string }) => void) => {
        const listener = (_event: any, data: any) => callback(data)
        ipcRenderer.on('analysis:batch-progress', listener)
        return () => ipcRenderer.removeListener('analysis:batch-progress', listener)
    },
    getRawData: (options: { date: string, stockCode: string }) => ipcRenderer.invoke('analysis:get-raw-data', options),
    collectNews: (options: { date: string, stockCode: string, stockName: string }) => ipcRenderer.invoke('naver:collect-news', options),
    collectDisclosures: (options: { date: string, stockCode: string, stockName: string }) => ipcRenderer.invoke('dart:collect-disclosures', options),
    saveAiScheduleSettings: (settings: any) => ipcRenderer.invoke('analysis:save-ai-schedule-settings', settings),
    getAiScheduleSettings: () => ipcRenderer.invoke('analysis:get-ai-schedule-settings'),
    // Skills
    skillsGetAll: () => ipcRenderer.invoke('skills:get-all'),
    skillsGetHistory: (fileName: string) => ipcRenderer.invoke('skills:get-history', fileName),
    skillsGetVersion: (options: { fileName: string, version: number }) => ipcRenderer.invoke('skills:get-version', options),
    skillsSave: (options: { fileName: string, content: string, diffSummary: string }) => ipcRenderer.invoke('skills:save', options),
    // MAIIS Pipeline Monitoring
    getMaiisInventory: () => ipcRenderer.invoke('maiis:get-inventory'),
    getMaiisStats: (limit?: number) => ipcRenderer.invoke('maiis:get-stats', limit),
    triggerMaiisSync: (providerId: string, options?: any) => ipcRenderer.invoke('maiis:trigger-sync', { providerId, options }),
    getLatestPipelineRuns: () => ipcRenderer.invoke('pipeline:get-latest-runs'),
    getPipelineRunDetail: (runId: string) => ipcRenderer.invoke('pipeline:get-run-detail', runId),
    getAllPipelineRuns: (date?: string) => ipcRenderer.invoke('pipeline:get-all-runs', date),
    
    onSystemError: (callback: (error: { message: string, code: string, time: string }) => void) => {
        const listener = (_event: any, error: any) => callback(error)
        ipcRenderer.on('system:error', listener)
        return () => ipcRenderer.removeListener('system:error', listener)
    },
})
