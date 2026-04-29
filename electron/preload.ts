import { contextBridge, ipcRenderer } from 'electron'

// --------- Expose some API to the Renderer process ---------
contextBridge.exposeInMainWorld('electronAPI', {
    on: (channel: string, callback: (...args: any[]) => void) => {
        ipcRenderer.on(channel, (_event, ...args) => callback(...args))
    },
    send: (channel: string, ...args: any[]) => {
        ipcRenderer.send(channel, ...args)
    },
    invoke: (channel: string, ...args: any[]) => {
        return ipcRenderer.invoke(channel, ...args)
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
    getChart5m: (ticker: string, days?: number) => ipcRenderer.invoke('kiwoom:get-chart-5m', ticker, days),
    wsRegister: (symbols: string[]) => ipcRenderer.invoke('kiwoom:ws-register', symbols),
    wsUnregister: (symbols: string[]) => ipcRenderer.invoke('kiwoom:ws-unregister', symbols),
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
    onConditionSearchMatched: (callback: (data: {seq: string, stocks: any[]}) => void) => {
        const listener = (_event: any, data: {seq: string, stocks: any[]}) => callback(data)
        ipcRenderer.on('kiwoom:condition-matched', listener)
        return () => ipcRenderer.removeListener('kiwoom:condition-matched', listener)
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
    saveAiSettings: (settings: { geminiKey: string, modelName?: string, virtualInitialBalance?: number, buyStartTime?: string, buyEndTime?: string, portfolioLimits?: any }) => ipcRenderer.invoke('ai:save-settings', settings),
    getAiSettings: () => ipcRenderer.invoke('ai:get-settings'),
    testAiConnection: (settings: { geminiKey: string, modelName: string, deepModelName?: string }) => ipcRenderer.invoke('ai:test-connection', settings),

    // Market Condition Agent V2
    getIntradayTechnicalDigest: () => ipcRenderer.invoke('mca:get-technical-digest'),
    runImageAnalysisTest: () => ipcRenderer.invoke('run-image-analysis-test'),

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
    getDomainInsightsHistory: (domainType: string, days?: number) => ipcRenderer.invoke('maiis:get-domain-insights-history', { domainType, days }),
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
    runPipelineManual: (pipelineId: string) => ipcRenderer.invoke('maiis:run-pipeline-manual', pipelineId),

    // V2 Data Pipeline
    runV2Pipeline: (pipelineId: string, options?: { forceFetch?: boolean }) => ipcRenderer.invoke('v2-pipeline:run', { pipelineId, options }),
    getThemeTrackerData: (type: 'SECTOR' | 'THEME', date: string, limitDays?: number, topN?: number) => ipcRenderer.invoke('naverflow:get-tracker-data', type, date, limitDays, topN),
    getThemeMockTradingPicks: () => ipcRenderer.invoke('naverflow:get-mock-trading-picks'),
    deleteThemeMockTradingPicksByDate: (date: string) => ipcRenderer.invoke('naverflow:delete-mock-trading-picks', date),
    updateThemeMockLivePrices: () => ipcRenderer.invoke('naverflow:update-mock-live-prices'),
    analyzeThemes: (date: string) => ipcRenderer.invoke('naverflow:analyze-themes', date),
    resetThemeLedger: () => ipcRenderer.invoke('naverflow:reset-themes'),
    verifyThemeIntelligence: (params: any) => ipcRenderer.invoke('naverflow:verify-theme', params),
    getThemeRelatedNews: (themeName: string, keywords: string[]) => ipcRenderer.invoke('naverflow:get-theme-news', themeName, keywords),
    getStockThemeTags: (stockCode: string) => ipcRenderer.invoke('naverflow:get-stock-theme-tags', stockCode),
    searchLiveNews: (keyword: string) => ipcRenderer.invoke('naverflow:search-live-news', keyword),
    getMarketLeaders: (days: number, topN: number, peakoutSettings?: any) => ipcRenderer.invoke('v2:get-market-leaders', { days, topN, peakoutSettings }),
    getCrossPeriodProfile: (topN?: number, peakoutSettings?: any) => ipcRenderer.invoke('v2:get-cross-period-profile', { topN, peakoutSettings }),
    getSimTradePicks: () => ipcRenderer.invoke('v2:get-sim-trade-picks'),
    getPerformanceStats: (picks: any[], targetReturn: number) => ipcRenderer.invoke('v2:get-performance-stats', { picks, targetReturn }),
    forceRefreshSimTradePrices: () => ipcRenderer.invoke('v2:force-refresh-sim-trade-prices'),
    runOhlcvCollection: () => ipcRenderer.invoke('v2:run-ohlcv-collection'),
    runTrackABuyAgent: (date?: string) => ipcRenderer.invoke('track-a:run-buy-agent', date),
    runTrackBBuyAgent: (date?: string) => ipcRenderer.invoke('track-b:run-buy-agent', date),
    runTrackCBuyAgent: (date?: string) => ipcRenderer.invoke('track-c:run-buy-agent', date),
    runTrackDBuyAgent: (date?: string) => ipcRenderer.invoke('track-d:run-buy-agent', date),
    runTrackEBuyAgent: (date?: string) => ipcRenderer.invoke('track-e:run-buy-agent', date),
    updateTrackBEntryPrices: (date?: string) => ipcRenderer.invoke('track-b:update-entry-prices', date),
    scoreTrackBPerformance: (date?: string) => ipcRenderer.invoke('track-b:score-performance', date),
    deleteTrackBPicksByDate: (date: string) => ipcRenderer.invoke('track-b:delete-by-date', date),
    deleteSimTradePickById: (id: number, category: string) => ipcRenderer.invoke('simtrade:delete-pick-by-id', id, category),
    getTrackBResearchReports: (stockCode: string) => ipcRenderer.invoke('track-b:get-research-reports', stockCode),
    getStockNarrative: (stockCode: string) => ipcRenderer.invoke('stock:get-narrative', stockCode),

    getTrackBGuideline: (fileName: string) => ipcRenderer.invoke('track-b:get-guideline', fileName),
    saveTrackBGuideline: (fileName: string, content: string) => ipcRenderer.invoke('track-b:save-guideline', { fileName, content }),
    runThemeOntology: () => ipcRenderer.invoke('v2:run-theme-ontology'),
    // Graph RAG: Knowledge Edges
    getKnowledgeEdgesFrom: (sourceType: string, sourceId: string, targetType?: string) => ipcRenderer.invoke('graph:edges-from', sourceType, sourceId, targetType),
    getKnowledgeEdgesTo: (targetType: string, targetId: string) => ipcRenderer.invoke('graph:edges-to', targetType, targetId),
    getMarketKnowledgeEdges: () => ipcRenderer.invoke('graph:market-edges'),
    upsertKnowledgeEdge: (edge: any) => ipcRenderer.invoke('graph:upsert-edge', edge),

    // V2 Agent Swarm: Market Condition Agent
    getMarketConditionSettings: () => ipcRenderer.invoke('agent:market:settings:get'),
    saveMarketConditionSettings: (settings: any) => ipcRenderer.invoke('agent:market:settings:save', settings),
    runMarketConditionAgent: (cycle: 'A' | 'B') => ipcRenderer.invoke('agent:market:run', cycle),
    getMarketConditionHistory: (limit?: number) => ipcRenderer.invoke('agent:market:history', limit),
    deleteMarketPrediction: (id: string, tableName?: 'agent_predictions' | 'intraday_predictions') => ipcRenderer.invoke('agent:market:delete', id, tableName),
    deleteManyMarketPredictions: (ids: string[], tableName?: 'agent_predictions' | 'intraday_predictions') => ipcRenderer.invoke('agent:market:delete-many', ids, tableName),
    getMarketConditionLatest: () => ipcRenderer.invoke('agent:market:latest'),
    getMarketConditionStats: () => ipcRenderer.invoke('agent:market:stats'),
    getDetailedMarketConditionStats: () => ipcRenderer.invoke('agent:market:detailed-stats'),
    getMarketConditionRules: () => ipcRenderer.invoke('agent:market:rules'),
    clearPersonaPerformance: () => ipcRenderer.invoke('agent:market:clear-persona'),
    getMarketRetrospectives: (type: 'DAILY' | 'WEEKLY' | 'MONTHLY', limit?: number) => ipcRenderer.invoke('agent:market:retrospectives:get', type, limit),
    runMarketRetrospective: (type: 'DAILY' | 'WEEKLY' | 'MONTHLY') => ipcRenderer.invoke('agent:market:retrospectives:run', type),
    onMarketConditionComplete: (callback: (data: any) => void) => {
        const listener = (_event: any, data: any) => callback(data)
        ipcRenderer.on('MARKET_AGENT_PREDICTION_COMPLETE', listener)
        return () => ipcRenderer.removeListener('MARKET_AGENT_PREDICTION_COMPLETE', listener)
    },
    onMarketConditionPerformanceUpdated: (callback: (data: any) => void) => {
        const listener = (_event: any, data: any) => callback(data)
        ipcRenderer.on('MARKET_AGENT_PERFORMANCE_UPDATED', listener)
        return () => ipcRenderer.removeListener('MARKET_AGENT_PERFORMANCE_UPDATED', listener)
    },
    // \uc7a5\uc911 \uc778\ud2b8\ub77c\ub370\uc774 \uc608\uce21
    getIntradayPredictions: () => ipcRenderer.invoke('agent:intraday:predictions'),
    runIntradayPrediction: (slot: '09:30' | '11:00' | '13:00') => ipcRenderer.invoke('agent:intraday:run', slot),
    runIntradaySwarmPrediction: (slot: string) => ipcRenderer.invoke('agent:intradayswarm:run', slot),
    runTracker: () => ipcRenderer.invoke('agent:tracker:run'),

    // V2 이슈 관리 (Macro/News) Agent
    getActiveIssues: () => ipcRenderer.invoke('agent:issues:active'),
    getIssueTimeline: (issueId: string) => ipcRenderer.invoke('agent:issues:timeline', issueId),
    resolveIssue: (issueId: string) => ipcRenderer.invoke('agent:issues:resolve', issueId),
    runIssueAnalysis: () => ipcRenderer.invoke('agent:issues:run'),
    getIssueBriefing: () => ipcRenderer.invoke('agent:issues:briefing'),
    getBriefingsHistory: (limit?: number) => ipcRenderer.invoke('agent:issues:briefings', limit),

    // V2 Co-Pilot (HITL)
    sendCoPilotMessage: (message: string, mode: 'auto' | 'short' | 'detail' = 'auto') => ipcRenderer.send('copilot:chat', { message, mode }),
    onCoPilotReply: (callback: (data: { text: string, isDone: boolean }) => void) => {
        const listener = (_event: any, data: any) => callback(data)
        ipcRenderer.on('copilot:reply', listener)
        return () => ipcRenderer.removeListener('copilot:reply', listener)
    },

    runIssueSwarm: (issueId: string, dummyData?: any) => ipcRenderer.invoke('agent:issues:run-swarm', issueId, dummyData),
    getIssueSwarm: (issueId: string) => ipcRenderer.invoke('agent:issues:get-swarm', issueId),
    deleteSwarmSession: (sessionId: string) => ipcRenderer.invoke('agent:issues:delete-swarm-session', sessionId),

    // AI Orchestrator Dashboard
    getAiQueueStatus: () => ipcRenderer.invoke('ai:get-queue-status'),
    getAiExecutionLog: (limit: number = 50) => ipcRenderer.invoke('ai:get-execution-log', limit),
    testLocalAi: (prompt: string) => ipcRenderer.invoke('ai:test-local-ai', prompt),

    onSystemError: (callback: (error: { message: string, code: string, time: string }) => void) => {
        const listener = (_event: any, error: any) => callback(error)
        ipcRenderer.on('system:error', listener)
        return () => ipcRenderer.removeListener('system:error', listener)
    },

    // NewsDataHub
    getNewsHubSettings: () => ipcRenderer.invoke('news-hub:get-settings'),
    saveNewsHubSettings: (settings: any) => ipcRenderer.invoke('news-hub:save-settings', settings),
    collectNewsHubNow: () => ipcRenderer.invoke('news-hub:collect-now'),
    getNewsHubCacheStatus: () => ipcRenderer.invoke('news-hub:get-cache-status'),
    getNewsHubArticles: (options?: { category?: string; limit?: number }) => ipcRenderer.invoke('news-hub:get-articles', options),

    getNaverFlowSettings: () => ipcRenderer.invoke('naverflow:get-settings'),
    saveNaverFlowSettings: (settings: any) => ipcRenderer.invoke('naverflow:save-settings', settings),

    // Phase 2.5: AI Analysts & Portfolio Manager
    runMomentumAnalyst: () => ipcRenderer.invoke('ai-analyst:run-momentum'),
    runFundamentalAnalyst: () => ipcRenderer.invoke('ai-analyst:run-fundamental'),
    runPortfolioManager: () => ipcRenderer.invoke('ai-analyst:run-portfolio-manager'),
    runPortfolioManagerPhase1: () => ipcRenderer.invoke('ai-analyst:run-portfolio-manager-phase1'),
    runPortfolioManagerPhase2: () => ipcRenderer.invoke('ai-analyst:run-portfolio-manager-phase2'),
    runPortfolioJudge: () => ipcRenderer.invoke('ai-analyst:run-daily-judge'),
    getActivePortfolio: () => ipcRenderer.invoke('ai-analyst:get-portfolio-active'),
    getPortfolioHistory: () => ipcRenderer.invoke('ai-analyst:get-portfolio-history'),
    getAiPicks: () => ipcRenderer.invoke('ai-analyst:get-picks'),
    clearPortfolio: () => ipcRenderer.invoke('ai-analyst:clear-portfolio'),
    clearAiPicks: () => ipcRenderer.invoke('ai-analyst:clear-picks'),
    // 관심종목(WAIT_DIP/HOLD/WATCHLIST)에 잘못 기록된 진입가·수익률만 선택적 초기화
    cleanupWatchlistPrices: () => ipcRenderer.invoke('ai-analyst:cleanup-watchlist-prices'),
    refreshHeldPrices: () => ipcRenderer.invoke('ai-analyst:refresh-held-prices'),
    // [TEST] 종목 차트 다이제스트 테스트
    testChartDigest: (code: string, name: string) => ipcRenderer.invoke('ai-analyst:test-chart-digest', code, name),
    // 서브 AI 오답노트 작성 (수동)
    runRetrospectiveManual: () => ipcRenderer.invoke('ai-analyst:run-retrospective'),
    // PM 성적표 AI 분석 (포트폴리오 매니저 성적 분석 & 개선안)
    runPortfolioRetrospective: () => ipcRenderer.invoke('portfolio:run-retrospective'),
    getLatestPortfolioRetrospective: () => ipcRenderer.invoke('portfolio:get-latest-retrospective'),
    getPm2MasterGuideContent: () => ipcRenderer.invoke('ai-analyst:get-pm2-master-guide'),
    savePm2MasterGuideContent: (content: string) => ipcRenderer.invoke('ai-analyst:save-pm2-master-guide', content),
    getSubAiSkills: () => ipcRenderer.invoke('ai-analyst:get-sub-ai-skills'),

    // AI 수동실행 로그
    saveAiRunLog: (message: string) => ipcRenderer.invoke('ai-run-logs:save', message),
    getAiRunLogs: () => ipcRenderer.invoke('ai-run-logs:get'),
    clearAiRunLogs: () => ipcRenderer.invoke('ai-run-logs:clear'),

    // AI 데일리 원본 전문 (Raw Log)
    getAiDailyRawLog: (date: string, agentType: string) => ipcRenderer.invoke('ai-daily-raw-logs:get', date, agentType),

    // P4: 인큐베이터 (Pool B)
    getIncubatorList: (status?: string) => ipcRenderer.invoke('incubator:get-list', status),
    updateIncubatorStatus: (stock_code: string, status: string, reason?: string) => ipcRenderer.invoke('incubator:update-status', { stock_code, status, reason }),
    runIncubatorScan: () => ipcRenderer.invoke('incubator:run-scan'),
    addIncubatorStock: (stock_code: string, stock_name: string, reason: string) => ipcRenderer.invoke('incubator:add-manual', { stock_code, stock_name, reason }),
    deleteIncubatorItem: (stock_code: string) => ipcRenderer.invoke('incubator:delete-item', stock_code),

    // PM Event Logs
    getPortfolioEventLogs: (stock_code: string) => ipcRenderer.invoke('maiisAdmin:getPortfolioEventLogs', stock_code),

    // 개별 항목 삭제
    deletePortfolioItem: (id: number) => ipcRenderer.invoke('ai-analyst:delete-portfolio-item', id),
    deleteTradeHistoryItem: (id: number) => ipcRenderer.invoke('ai-analyst:delete-trade-history-item', id),
    deleteAnalystPick: (id: number) => ipcRenderer.invoke('ai-analyst:delete-pick', id),
    deleteEventLog: (id: number) => ipcRenderer.invoke('ai-analyst:delete-event-log', id),
    runPerformanceOptimizer: (picks: any[]) => ipcRenderer.invoke('ai-analyst:run-performance-optimizer', picks),
    syncEntryPrice: (stockCode: string, price: number, entryDate: string) => ipcRenderer.invoke('ai-analyst:sync-entry-price', stockCode, price, entryDate),

    // ── Mega Theme Ledger ──
    getMegaThemeLedger: () => ipcRenderer.invoke('mega-theme:get-ledger'),
    getMegaThemeDetail: (name: string) => ipcRenderer.invoke('mega-theme:get-detail', name),
    runThemeContextBuilder: (mode?: 'auto' | 'backfill' | 'incremental') => ipcRenderer.invoke('mega-theme:run-builder', mode || 'auto'),
    getMegaThemeBriefing: () => ipcRenderer.invoke('mega-theme:get-briefing'),
    // AI 모델 설정
    getMegaThemeAiConfig: () => ipcRenderer.invoke('mega-theme:get-ai-config'),
    setMegaThemeAiConfig: (config: { targetType: 'gemini' | 'local' }) => ipcRenderer.invoke('mega-theme:set-ai-config', config),
    checkMegaThemeLocalAi: () => ipcRenderer.invoke('mega-theme:check-local-ai'),

    // ── 조건검색 (MoonshotTab / TenBagger) ──
    connectConditionWs: () => ipcRenderer.invoke('kiwoom:connect-condition-ws'),
    getConditionList: () => ipcRenderer.invoke('kiwoom:get-condition-list'),
    startConditionSearch: (seq: string) => ipcRenderer.invoke('kiwoom:start-condition-search', seq),
    onConditionList: (callback: (conditions: any[]) => void) => {
        const listener = (_event: any, conditions: any[]) => callback(conditions)
        ipcRenderer.on('kiwoom:condition-list', listener)
        return () => ipcRenderer.removeListener('kiwoom:condition-list', listener)
    },
    onConditionSearchMatched: (callback: (data: { seq: string, stocks: any[] }) => void) => {
        const listener = (_event: any, data: { seq: string, stocks: any[] }) => callback(data)
        ipcRenderer.on('kiwoom:condition-matched', listener)
        return () => ipcRenderer.removeListener('kiwoom:condition-matched', listener)
    },
    
    // ── Moonshot 텐베거 발굴 전용 추가 API ──
    getSmartMoneyFlow: (stk_cd: string) => ipcRenderer.invoke('kiwoom:get-smart-money-flow', stk_cd),
    getFundamentalInfo: (stk_cd: string) => ipcRenderer.invoke('kiwoom:get-fundamental-info', stk_cd),
    validateMoonshotStocks: (stocks: any[], ignoreCooldown?: boolean) => ipcRenderer.invoke('moonshot:validate-stocks', stocks, ignoreCooldown),
    onMoonshotProgressLog: (callback: (data: { code: string, log: any }) => void) => {
        const listener = (_event: any, data: any) => callback(data)
        ipcRenderer.on('moonshot:progress-log', listener)
        return () => ipcRenderer.removeListener('moonshot:progress-log', listener)
    },
    onMoonshotEvalStart: (callback: (code: string) => void) => {
        const listener = (_event: any, code: string) => callback(code)
        ipcRenderer.on('moonshot:eval-start', listener)
        return () => ipcRenderer.removeListener('moonshot:eval-start', listener)
    },
    onMoonshotEvalComplete: (callback: (data: { code: string, result: any }) => void) => {
        const listener = (_event: any, data: any) => callback(data)
        ipcRenderer.on('moonshot:eval-complete', listener)
        return () => ipcRenderer.removeListener('moonshot:eval-complete', listener)
    },
    runMoonshotDailyTracker: () => ipcRenderer.invoke('moonshot:run-daily-tracker'),
    onMoonshotTrackerProgress: (callback: (log: any) => void) => {
        const listener = (_event: any, log: any) => callback(log)
        ipcRenderer.on('moonshot:tracker-progress', listener)
        return () => ipcRenderer.removeListener('moonshot:tracker-progress', listener)
    },

    // Live Trade V2
    getLiveTradeStrategies: () => ipcRenderer.invoke('livetrade:get-strategies'),
    saveLiveTradeStrategy: (strategy: any) => ipcRenderer.invoke('livetrade:save-strategy', strategy),
    getLiveTradeTickets: () => ipcRenderer.invoke('livetrade:get-tickets'),
    // Kill-Switch (긴급 중단)
    getLiveTradeKillSwitch: () => ipcRenderer.invoke('livetrade:get-kill-switch'),
    setLiveTradeKillSwitch: (active: boolean) => ipcRenderer.invoke('livetrade:set-kill-switch', active),
    testLiveTradeBuyOrder: (stockCode: string, qty: number, accountNo?: string) => ipcRenderer.invoke('livetrade:test-buy-order', stockCode, qty, accountNo),
    getLiveTradeDailyLogs: () => ipcRenderer.invoke('livetrade:get-daily-logs'),
    deleteFailedTicket: (ticketId: string) => ipcRenderer.invoke('livetrade:delete-ticket', ticketId),
    // Live Trade Error Log
    onLiveTradeError: (callback: (error: any) => void) => {
        const listener = (_event: any, data: any) => callback(data)
        ipcRenderer.on('livetrade:error', listener)
        return () => ipcRenderer.removeListener('livetrade:error', listener)
    },
    // Grid Search 최적 파라미터 캐시 조회
    getGridSearchResults: () => ipcRenderer.invoke('optimizer:get-grid-search-results'),
})


