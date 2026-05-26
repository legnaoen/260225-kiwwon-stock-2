export interface IElectronAPI {
    on: (channel: string, callback: (...args: any[]) => void) => void
    send: (channel: string, ...args: any[]) => void
    minimize: () => void
    maximize: () => void
    close: () => void
    saveApiKeys: (keys: { appkey: string, secretkey: string }) => Promise<{ success: boolean, message?: string, error?: string }>
    getApiKeys: () => Promise<{ appkey: string, secretkey: string } | null>
    getAccountList: () => Promise<any>
    getHoldings: (options: { accountNo: string, nextKey?: string }) => Promise<any>
    getDeposit: (options: { accountNo: string }) => Promise<any>
    getUnexecutedOrders: (options: { accountNo: string }) => Promise<any>
    getAllStocks: (marketType: string) => Promise<any>
    getWatchlist: (symbols: string[]) => Promise<any>
    getChartData: (options: { stk_cd: string, base_dt?: string }) => Promise<any>
    getChart5m: (ticker: string, days?: number) => Promise<any[]>
    wsRegister: (symbols: string[]) => Promise<any>
    onRealTimeData: (callback: (data: any) => void) => () => void
    saveWatchlistSymbols: (symbols: string[]) => Promise<any>
    getWatchlistSymbols: () => Promise<string[]>
    getConnectionStatus: () => Promise<{ connected: boolean, mockConnected: boolean, realConnected: boolean }>
    analyzeStock: (stockCode: string) => Promise<{ success: boolean, data?: any, error?: string }>
    resetCircuitBreaker: () => Promise<{ success: boolean }>
    sendTelegramMessage: (message: string) => Promise<{ success: boolean, error?: string }>
    onMarketStatus: (callback: (data: { code: string, time: string }) => void) => () => void
    onScheduleNotified: (callback: (...args: any[]) => void) => void
    notifyDisparitySlump: (data: { code: string, name: string, disparity: number, changeRate: number }) => void

    // Market / Intraday Agents
    getIntradayPredictions: () => Promise<{ success: boolean, data?: any, error?: string }>
    runIntradayPrediction: (slot: '09:30' | '11:00' | '13:00') => Promise<{ success: boolean, data?: any, error?: string }>
    runIntradaySwarmPrediction: (slot: string) => Promise<{ success: boolean, data?: any, error?: string }>
    runTracker: () => Promise<{ success: boolean, error?: string }>

    // API Diagnostics
    getApiLogs: () => Promise<any[]>
    testMarketScanner: () => Promise<{ success: boolean, data?: any, error?: any }>

    // Telegram
    saveTelegramSettings: (settings: { botToken: string, chatId: string, chartTheme?: string, dailyTopRisingNotify?: boolean, dailyTopRisingTime1?: string, dailyTopRisingTime2?: string }) => Promise<{ success: boolean, message?: string, error?: string }>
    saveTelegramTheme: (theme: string) => Promise<{ success: boolean }>
    getTelegramSettings: () => Promise<{ botToken: string, chatId: string, chartTheme?: string, dailyTopRisingNotify?: boolean, dailyTopRisingTime1?: string, dailyTopRisingTime2?: string } | null>
    sendTelegramTestMessage: () => Promise<{ success: boolean, error?: string }>
    testTelegramTopRising: () => Promise<{ success: boolean, error?: string }>

    // Auto Trade & Condition Search
    saveAutoTradeSettings: (settings: any) => Promise<any>
    getAutoTradeSettings: () => Promise<any>
    getAutoTradeStatus: () => Promise<boolean>
    setAutoTradeStatus: (status: boolean) => Promise<any>
    connectConditionWs: () => Promise<any>
    getConditionList: () => Promise<any>
    startConditionSearch: (seq: string) => Promise<any>
    executeManualBuy: () => Promise<any>
    onConditionList: (callback: (data: any[]) => void) => () => void
    onAutoTradeLog: (callback: (log: any) => void) => () => void
    onAutoTradeStatusChanged: (callback: (running: boolean) => void) => () => void

    // Capture
    sendChartRenderComplete: (code: string) => void

    // DART & Schedules
    saveDartApiKey: (key: string) => Promise<{ success: boolean }>
    getDartApiKey: () => Promise<string>
    saveDartSettings: (settings: any) => Promise<{ success: boolean }>
    getDartSettings: () => Promise<any>
    getFinancialData: (stockCode: string) => Promise<{ success: boolean, data?: any[], error?: string }>
    syncDartCorpCodes: () => Promise<{ success: boolean, error?: string }>
    syncDartWatchlistSchedules: () => Promise<{ success: boolean, error?: string }>
    syncBatchFinancials: (stockCodes: string[]) => Promise<{ success: boolean, error?: string }>
    fetchDartDisclosures: (options: { corpCodes: string[], bgnDe: string, endDe: string }) => Promise<{ success: boolean, data?: any[], error?: string }>
    onMarketOpenedDetected: (callback: (data: { date: string, tradingDays: string[] }) => void) => () => void
    onOrderRealtime: (callback: (order: any) => void) => () => void

    saveScheduleSettings: (settings: { notificationTime: string, globalDailyNotify: boolean, sendMissedOnStartup?: boolean }) => Promise<{ success: boolean }>
    getScheduleSettings: () => Promise<{ notificationTime: string, globalDailyNotify: boolean, sendMissedOnStartup?: boolean }>
    syncSchedules: (schedules: any[]) => Promise<{ success: boolean }>
    deleteSchedule: (id: string) => Promise<{ success: boolean }>
    getSchedules: () => Promise<any[]>
    getSchedulesByStock: (stockCode: string) => Promise<{ success: boolean, data: any[] }>
    testScheduleSummary: () => Promise<{ success: boolean }>
    openExternal: (url: string) => Promise<{ success: boolean, error?: string }>
    testYahooFinance: () => Promise<{ success: boolean, count?: number, error?: string }>
    getTradingDays: () => Promise<string[]>

    // AI Trade
    onAiTradeStream: (callback: (data: any) => void) => () => void
    onAiTradeEvaluationUpdate: (callback: (data: { isEvaluating: boolean, stock: { code: string, name: string } | null }) => void) => () => void
    getAiTradeStatus: () => Promise<boolean>
    getAiStrategies: () => Promise<any[]>
    setAiActiveStrategy: (id: string) => Promise<{ success: boolean }>
    deleteAiStrategy: (id: string) => Promise<{ success: boolean }>
    runAiRetrospective: () => Promise<{ success: boolean, strategy?: any }>
    setAiAutoPilot: (active: boolean) => Promise<{ success: boolean }>
    getAiAutoPilot: () => Promise<boolean>
    getAiTradeLogs: () => Promise<any[]>
    resetAiAccount: () => Promise<{ success: boolean }>
    getAiAccountState: () => Promise<any>
    getAiRuntimeConfig: () => Promise<any>
    saveAiRuntimeConfig: (config: any) => Promise<any>
    syncStrategyConfig: () => Promise<any>
    executeD3AutoSell: () => Promise<any>
    getHoldingHistory: () => Promise<Record<string, string>>

    // AI Settings
    saveAiSettings: (settings: {
        geminiKey: string,
        modelName?: string,
        deepModelName?: string,
        deepModelAgents?: string[],
        lightweightCloudAgents?: string[],
        lightweightCloudModel?: string,
        virtualInitialBalance: number,
        buyStartTime?: string,
        buyEndTime?: string,
        phase1PassLimit?: number,
        portfolioLimits?: {
            buy: { THEME: number, MOMENTUM: number, PULLBACK: number, REPORT: number },
            watchlist: { THEME: number, MOMENTUM: number, PULLBACK: number, REPORT: number }
        }
    }) => Promise<{ success: boolean }>
    getAiSettings: () => Promise<{
        geminiKey: string,
        modelName?: string,
        deepModelName?: string,
        deepModelAgents?: string[],
        lightweightCloudAgents?: string[],
        lightweightCloudModel?: string,
        virtualInitialBalance?: number,
        buyStartTime?: string,
        buyEndTime?: string,
        phase1PassLimit?: number,
        portfolioLimits?: {
            buy: { THEME: number, MOMENTUM: number, PULLBACK: number, REPORT: number },
            watchlist: { THEME: number, MOMENTUM: number, PULLBACK: number, REPORT: number }
        }
    } | null>
    testAiConnection: (settings: { geminiKey: string, modelName: string, deepModelName?: string, lightweightCloudModel?: string }) => Promise<{ success: boolean, response?: string, error?: string }>
    
    // Market Condition Agent V2
    getIntradayTechnicalDigest: () => Promise<string>
    runImageAnalysisTest: () => Promise<string>

    // Rising Stocks Report
    onBatchProgress: (callback: (data: any) => void) => () => void
    getRawData: (params: { date: string, stockCode: string }) => Promise<{ success: boolean, data?: any }>
    collectNews: (params: { date: string, stockCode: string, stockName: string }) => Promise<{ success: boolean, data?: any[], error?: string }>
    collectDisclosures: (params: { date: string, stockCode: string, stockName: string }) => Promise<{ success: boolean, data?: any[], error?: string }>
    getCombinedTopStocks: (options?: { risingLimit?: number, tradingValueLimit?: number }) => Promise<{ success: boolean, data?: any[] }>
    getRisingStocksByDate: (date: string) => Promise<{ success: boolean, data?: any[] }>
    getReportHistory: () => Promise<{ success: boolean, data?: any[] }>
    getMarketDailyReport: (date: string) => Promise<{ success: boolean, data?: any }>
    runStockAnalysis: (params: { code: string, name: string, changeRate: number, tradingValue?: number, source?: string }) => Promise<{ success: boolean, data?: any, error?: string }>
    runMarketReport: (date: string) => Promise<{ success: boolean, data?: any, error?: string }>
    runBatchReport: () => Promise<{ success: boolean, count?: number, error?: string }>

    // Skills / Knowledge Base
    skillsGetAll: () => Promise<{ success: boolean, data?: any[] }>
    skillsGetHistory: (id: string) => Promise<{ success: boolean, data?: any[] }>
    skillsSave: (options: { fileName: string, content: string, diffSummary: string }) => Promise<{ success: boolean, error?: string }>
    skillsGetVersion: (options: { fileName: string, version: number }) => Promise<{ success: boolean, data?: any }>

    // MAIIS AI Pipeline
    analyzeDomain: (options: { domain: 'YOUTUBE' | 'NEWS', date?: string }) => Promise<{ success: boolean, error?: string }>
    getDomainInsights: (date?: string) => Promise<any[]>
    getMaiisWorldState: (date?: string) => Promise<any>
    getMacroSnapshot: () => Promise<{ success: boolean, data?: any, error?: string }>
    getRisingStocksSummary: (date?: string) => Promise<{ success: boolean, data?: any, error?: string }>
    generateMasterState: (timing: '0845' | '0930' | '1530', date?: string) => Promise<{ success: boolean, data?: any, error?: string }>
    getCommandCenterDashboard: (date?: string) => Promise<{ success: boolean, data?: any, error?: string }>
    runRankingAggregation: (date?: string) => Promise<{ success: boolean, error?: string }>

    // MAIIS Pipeline Monitoring
    getMaiisInventory: () => Promise<any[]>
    getMaiisStats: (limit?: number) => Promise<any[]>
    triggerMaiisSync: (providerId: string, options?: any) => Promise<{ success: boolean, count?: number, error?: string }>
    getLatestPipelineRuns: () => Promise<Record<string, any>>
    getPipelineRunDetail: (runId: string) => Promise<any>
    getAllPipelineRuns: (date?: string) => Promise<any[]>
    runPipelineManual: (pipelineId: string) => Promise<{ success: boolean, error?: string }>

    // V2 Data Pipeline
    runV2Pipeline: (pipelineId: string, options?: { forceFetch?: boolean }) => Promise<{ success: boolean, data?: any, error?: string }>
    getThemeTrackerData: (type: 'SECTOR' | 'THEME', date: string, limitDays?: number, topN?: number) => Promise<{ success: boolean, data?: any, error?: string }>
    analyzeThemes: (date: string) => Promise<{ success: boolean, data?: any, error?: string }>
    verifyThemeIntelligence: (params: { date: string, type: 'SECTOR' | 'THEME', name: string, userOpinion: string, currentReason: string }) => Promise<{ success: boolean, data?: any, error?: string }>
    getThemeRelatedNews: (themeName: string, keywords: string[]) => Promise<{ success: boolean, data?: any[], error?: string }>
    searchLiveNews: (keyword: string) => Promise<{ success: boolean, data?: any[], error?: string }>
    // Graph RAG: Knowledge Edges
    getKnowledgeEdgesFrom: (sourceType: string, sourceId: string, targetType?: string) => Promise<{ success: boolean, data?: any[], error?: string }>
    getKnowledgeEdgesTo: (targetType: string, targetId: string) => Promise<{ success: boolean, data?: any[], error?: string }>
    getMarketKnowledgeEdges: () => Promise<{ success: boolean, data?: any[], error?: string }>
    upsertKnowledgeEdge: (edge: any) => Promise<{ success: boolean, error?: string }>

    // V2 Agent Swarm: Market Condition Agent
    getMarketConditionSettings: () => Promise<{ success: boolean, data?: any, error?: string }>
    saveMarketConditionSettings: (settings: any) => Promise<{ success: boolean, error?: string }>
    runMarketConditionAgent: (cycle: 'A' | 'B') => Promise<{ success: boolean, data?: any, error?: string }>
    getMarketConditionHistory: (limit?: number) => Promise<{ success: boolean, data?: any[], error?: string }>
    deleteMarketPrediction: (id: string, tableName?: 'agent_predictions' | 'intraday_predictions') => Promise<{ success: boolean, error?: string }>
    getMarketConditionLatest: () => Promise<{ success: boolean, data?: any, error?: string }>
    getMarketConditionStats: () => Promise<{ success: boolean, data?: any, error?: string }>
    getDetailedMarketConditionStats: () => Promise<{ success: boolean, data?: any, error?: string }>
    getMarketConditionRules: () => Promise<{ success: boolean, data?: string[], error?: string }>
    clearPersonaPerformance: () => Promise<{ success: boolean, error?: string }>
    onMarketConditionComplete: (callback: (data: any) => void) => () => void
    onMarketConditionPerformanceUpdated: (callback: (data: any) => void) => () => void

    // V2 Issues Agent
    getActiveIssues: () => Promise<{ success: boolean, data?: any[], error?: string }>
    getIssueTimeline: (issueId: string) => Promise<{ success: boolean, data?: any[], error?: string }>
    resolveIssue: (issueId: string) => Promise<{ success: boolean, error?: string }>
    runIssueAnalysis: () => Promise<{ success: boolean, error?: string }>
    getIssueBriefing: () => Promise<{ success: boolean, data?: any, error?: string }>

    // V2 Co-Pilot (HITL)
    sendCoPilotMessage: (message: string, mode?: 'auto' | 'short' | 'detail') => void
    onCoPilotReply: (callback: (data: {text: string, isDone: boolean}) => void) => () => void

    // Phase 2.5: AI Analysts & Portfolio Manager
    runMomentumAnalyst: () => Promise<{ success: boolean, data?: any, error?: string }>
    runFundamentalAnalyst: () => Promise<{ success: boolean, data?: any, error?: string }>
    runPortfolioManager: () => Promise<{ success: boolean, data?: any, error?: string }>
    runPortfolioManagerPhase1: () => Promise<{ success: boolean, data?: any, error?: string }>
    runPortfolioManagerPhase2: () => Promise<{ success: boolean, data?: any, error?: string }>
    runPortfolioJudge: () => Promise<{ success: boolean, data?: any, error?: string }>
    getActivePortfolio: () => Promise<any[]>
    getAiPicks: () => Promise<any[]>

    // Live Trade V2
    getLiveTradeStrategies: () => Promise<any[]>
    saveLiveTradeStrategy: (strategy: any) => Promise<{ success: boolean, error?: string }>
    getLiveTradeTickets: () => Promise<any[]>
}

declare global {
    interface Window {
        electronAPI: IElectronAPI
    }
}
