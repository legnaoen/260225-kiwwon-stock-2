import { app, BrowserWindow, ipcMain, shell } from 'electron'
import path from 'node:path'
import { spawn, ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import Store from 'electron-store'
import { KiwoomService } from './services/KiwoomService'
import { AutoTradeService } from './services/AutoTradeService'
import { TelegramService } from './services/TelegramService'
import { DatabaseService } from './services/DatabaseService'
// [DEPRECATED] DART 관심종목 연동 기능 비활성화됨 - 재활용 시 아래 import 복원
// import { DartApiService } from './services/DartApiService'
import { CompanyAnalysisService } from './services/CompanyAnalysisService'
// [DEPRECATED] V1 MarketScanner - V2 파이프라인으로 대체됨. 재활용 시 import 복원
// import { MarketScannerService } from './services/MarketScannerService'
import { AiDecisionService } from './services/AiDecisionService'
// [DEPRECATED] V1 DataLoggingService - V2에서 미사용. 재활용 시 import 복원
// import { DataLoggingService } from './services/DataLoggingService'
import { DailyRetrospectiveService } from './services/DailyRetrospectiveService'
import { AiService } from './services/AiService'
import { VirtualAccountService } from './services/VirtualAccountService'
import { SchedulerService } from './services/SchedulerService'
import { StockMasterService } from './services/StockMasterService'
import { IngestionManager } from './services/IngestionManager'
import { ThemeOntologyAgent } from './services/v2_agents/ThemeOntologyAgent'
import { eventBus, SystemEvent } from './utils/EventBus'

const store = new Store()
const kiwoomService = KiwoomService.getInstance()
const autoTradeService = AutoTradeService.getInstance()
const telegramService = TelegramService.getInstance()
// [DEPRECATED] V1 MarketScanner - V2 파이프라인 전환으로 비활성화
// const marketScannerService = MarketScannerService.getInstance()
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
let crawlerProxyProcess: ChildProcess | null = null

// 앱 시작 시 스킬스 파일 초기 스냅샷 DB 기록
import('./services/SkillsService').then(({ SkillsService }) => {
    SkillsService.getInstance().initSnapshots()
}).catch(console.error)

// 실시간 트래커 백그라운드 구동 보장
import('./services/v2_agents/PerformanceTracker').then(({ PerformanceTracker }) => {
    PerformanceTracker.getInstance()
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

    // Forward Market Agent Prediction Complete
    eventBus.on('MARKET_AGENT_PREDICTION_COMPLETE' as any, (data) => {
        if (win && !win.isDestroyed()) {
            win.webContents.send('MARKET_AGENT_PREDICTION_COMPLETE', data)
        }
    })

    // Forward Market Agent Performance Updated
    eventBus.on('MARKET_AGENT_PERFORMANCE_UPDATED' as any, (data) => {
        if (win && !win.isDestroyed()) {
            win.webContents.send('MARKET_AGENT_PERFORMANCE_UPDATED', data)
        }
    })

    // Forward Intraday Prediction Updated to trigger UI refresh
    eventBus.on('INTRADAY_PREDICTION_UPDATED' as any, (data) => {
        if (win && !win.isDestroyed()) {
            win.webContents.send('MARKET_AGENT_PERFORMANCE_UPDATED', data)
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
    if (crawlerProxyProcess) {
        crawlerProxyProcess.kill()
        console.log('[Main] Crawler proxy server terminated.')
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

app.whenReady().then(() => {
    createWindow()

    // Crawler Proxy Server 자동 실행 (NaverFlow 파이프라인용)
    // 개발: electron/python/, 빌드: resources/python/
    const crawlerDir = app.isPackaged
        ? path.join(process.resourcesPath, 'python')
        : path.join(process.cwd(), 'electron', 'python')
    
    // venv가 있으면 사용, 없으면 시스템 python 사용
    const venvPython = path.join(crawlerDir, 'venv', 'Scripts', 'python.exe')
    const pythonExe = fs.existsSync(venvPython) ? venvPython : 'python'

    console.log(`[Main] Crawler dir: ${crawlerDir}`)
    console.log(`[Main] Python exe: ${pythonExe}`)

    try {
        crawlerProxyProcess = spawn(pythonExe, ['crawler_server.py'], {
            cwd: crawlerDir,
            env: process.env,
            stdio: 'pipe'
        })


        crawlerProxyProcess.stdout?.on('data', (data) => console.log(`[CrawlerProxy] ${data.toString().trim()}`))
        crawlerProxyProcess.stderr?.on('data', (data) => console.error(`[CrawlerProxy Error] ${data.toString().trim()}`))
        console.log(`[Main] Started Crawler Proxy Python server (PID: ${crawlerProxyProcess.pid})`)
    } catch (e: any) {
        console.error('[Main] Failed to start Crawler Proxy:', e.message)
    }

    // Startup Stock Master sync after 5 seconds
    setTimeout(async () => {
        try {
            console.log('[Main] Starting startup Stock Master sync...')
            // 종목 마스터 동기화 (내부에서 오늘 날짜 체크함)
            await StockMasterService.getInstance().checkAndUpdate()
            
            // [DEPRECATED] DART 관심종목 일정 동기화 - UI에서 관심종목/DART 탭 삭제됨
            // 재활용 시: await DartApiService.getInstance().syncWatchlistSchedules()
            console.log('[Main] Startup sync completed.')
        } catch (err) {
            console.error('[Main] Startup sync failed:', err)
        }

        // [DEPRECATED] V1 MarketScanner - V2 파이프라인 전환으로 비활성화
        // 재활용 시: marketScannerService.start()
        // marketScannerService.start()
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

ipcMain.handle('kiwoom:get-chart-5m', async (_event, ticker: string, days: number = 2) => {
    try {
        return await kiwoomService.getOhlcv5m(ticker, days);
    } catch (e: any) {
        console.error('[Main] get-chart-5m Error:', e);
        return [];
    }
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

// [MAIIS 통합] 최근 N일간 도메인 인사이트 히스토리 (차트용)
ipcMain.handle('maiis:get-domain-insights-history', async (_event, { domainType, days }) => {
    const { DatabaseService } = await import('./services/DatabaseService');
    const db = DatabaseService.getInstance();
    return db.getMaiisDomainInsightsHistory(domainType, days || 14)
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

ipcMain.handle('maiis:get-rising-stocks-summary', async (_event, date) => {
    try {
        const { MaiisDomainService } = await import('./services/MaiisDomainService');
        const summary = MaiisDomainService.getInstance().getRisingStocksSummary(date);
        return { success: true, data: summary };
    } catch (err: any) {
        return { success: false, error: err.message };
    }
})

ipcMain.handle('maiis:generate-master-state', async (_event, params: { timing: '0845' | '0930' | '1530', date?: string }) => {
    try {
        const { MasterAiService } = await import('./services/MasterAiService')
        return await MasterAiService.getInstance().generateWorldState(params.timing, params.date)
    } catch (error: any) {
        console.error('[MasterAi] Error:', error)
        return { success: false, error: error.message }
    }
})

ipcMain.handle('maiis:get-command-center-dashboard', async (_e, date: string) => {
    try {
        const { MaiisDashboardService } = await import('./services/MaiisDashboardService')
        const data = MaiisDashboardService.getInstance().getCommandCenterData(date)
        return { success: true, data }
    } catch (error: any) {
        console.error('[MaiisDashboard] Error:', error)
        return { success: false, error: error.message }
    }
})

ipcMain.handle('maiis:run-ranking-aggregation', async (_e, date: string) => {
    try {
        console.log('[Main] Running aggregation pipeline for date:', date);
        const { MaiisRankingAggregator } = await import('./services/MaiisRankingAggregator')
        const data = await MaiisRankingAggregator.getInstance().runDailyAggregation(date)
        return { success: true, data }
    } catch (error: any) {
        console.error('[MaiisRankingAggregator] Error:', error)
        return { success: false, error: error.message }
    }
})

ipcMain.handle('maiis:run-portfolio-review', async () => {
    try {
        const { PortfolioManagerService } = await import('./services/PortfolioManagerService')
        return await PortfolioManagerService.getInstance().runPortfolioReview()
    } catch (error: any) {
        console.error('[PortfolioManager] Error:', error)
        return { success: false, error: error.message }
    }
})

// ======================
// Phase 2.5: AI Analysts & Portfolio Manager Test Hooks
// ======================
ipcMain.handle('ai-analyst:run-momentum', async () => {
    try {
        const { MomentumAnalystAgent } = await import('./services/v2_agents/MomentumAnalystAgent');
        return await MomentumAnalystAgent.getInstance().runAnalysis();
    } catch (e: any) {
        return { error: e.message };
    }
});

ipcMain.handle('ai-analyst:run-fundamental', async () => {
    try {
        const { FundamentalAnalystAgent } = await import('./services/v2_agents/FundamentalAnalystAgent');
        return await FundamentalAnalystAgent.getInstance().runAnalysis();
    } catch (e: any) {
        return { error: e.message };
    }
});

ipcMain.handle('ai-analyst:run-portfolio-manager', async () => {
    try {
        const { PortfolioManagerAgent } = await import('./services/v2_agents/PortfolioManagerAgent');
        return await PortfolioManagerAgent.getInstance().runDailyReview();
    } catch (e: any) {
        return { error: e.message };
    }
});

ipcMain.handle('ai-analyst:run-daily-judge', async () => {
    try {
        const { PortfolioJudgeScheduler } = await import('./services/v2_pipeline/PortfolioJudgeScheduler');
        await PortfolioJudgeScheduler.getInstance().runDailyJudgement();
        return { success: true };
    } catch (e: any) {
        return { error: e.message };
    }
});

ipcMain.handle('ai-analyst:get-portfolio-active', async () => {
    try {
        const { DatabaseService } = await import('./services/DatabaseService');
        return DatabaseService.getInstance().getActivePortfolio();
    } catch (e: any) {
        return { error: e.message };
    }
});

ipcMain.handle('ai-analyst:get-portfolio-history', async () => {
    try {
        const { DatabaseService } = await import('./services/DatabaseService');
        return DatabaseService.getInstance().getPortfolioHistory();
    } catch (e: any) {
        return { error: e.message };
    }
});

ipcMain.handle('ai-analyst:get-picks', async () => {
    try {
        const { DatabaseService } = await import('./services/DatabaseService');
        return DatabaseService.getInstance().getLatestAiAnalystPicks();
    } catch (e: any) {
        return { error: e.message };
    }
});

// 포트폴리오 초기화 (maiis_portfolio 전체 삭제)
ipcMain.handle('ai-analyst:clear-portfolio', async () => {
    try {
        const { DatabaseService } = await import('./services/DatabaseService');
        const db = DatabaseService.getInstance().getDb();
        const info = db.prepare('DELETE FROM maiis_portfolio').run();
        console.log(`[Main] maiis_portfolio cleared: ${info.changes}건 삭제`);
        return { success: true, deleted: info.changes };
    } catch (e: any) {
        console.error('[Main] clear-portfolio 오류:', e);
        return { error: e.message };
    }
});

// 관심종목(AI 픽스) 초기화 (ai_analyst_picks 전체 삭제)
ipcMain.handle('ai-analyst:clear-picks', async () => {
    try {
        const { DatabaseService } = await import('./services/DatabaseService');
        const db = DatabaseService.getInstance().getDb();
        const info = db.prepare('DELETE FROM ai_analyst_picks').run();
        console.log(`[Main] ai_analyst_picks cleared: ${info.changes}건 삭제`);
        return { success: true, deleted: info.changes };
    } catch (e: any) {
        console.error('[Main] clear-picks 오류:', e);
        return { error: e.message };
    }
});

// ─── P4: 인큐베이터 IPC 핸들러 (강제 재빌드 터치 v2) ────────────────────────────────
console.log('[Main] Registering Incubator IPC handlers...');
ipcMain.handle('incubator:get-list', async (_event, status?: string) => {
    try {
        const { DatabaseService } = await import('./services/DatabaseService');
        const list = DatabaseService.getInstance().getIncubatorList(status);
        console.log('[Main] incubator:get-list called, count:', list.length);
        return { success: true, data: list };
    } catch (e: any) {
        console.error('[Main] incubator:get-list error:', e);
        return { success: false, error: e.message };
    }
});

ipcMain.handle('incubator:update-status', async (_event, { stock_code, status, reason }: any) => {
    try {
        const { DatabaseService } = await import('./services/DatabaseService');
        DatabaseService.getInstance().updateIncubatorStatus(stock_code, status, reason);
        return { success: true };
    } catch (e: any) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('incubator:run-scan', async () => {
    try {
        const { IncubatorScanEngine } = await import('./services/v2_agents/IncubatorScanEngine');
        await IncubatorScanEngine.getInstance().runDailyScan();
        return { success: true };
    } catch (e: any) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('incubator:add-manual', async (_event, { stock_code, stock_name, reason }: any) => {
    try {
        const { DatabaseService } = await import('./services/DatabaseService');
        DatabaseService.getInstance().upsertIncubator({
            stock_code,
            stock_name,
            source: 'MANUAL',
            source_context: reason || '수동 등록'
        });
        return { success: true };
    } catch (e: any) {
        return { success: false, error: e.message };
    }
});

// [TEST] 종목 차트 다이제스트 테스트 (기본: 삼성전자 005930)
ipcMain.handle('ai-analyst:test-chart-digest', async (_event, code: string = '005930', name: string = '삼성전자') => {
    try {
        console.log(`[Main] 차트 다이제스트 테스트 시작: ${name}(${code})`);
        const { TechnicalAnalyzer } = await import('./services/v2_agents/TechnicalAnalyzer');
        const { KiwoomService } = await import('./services/KiwoomService');
        const analyzer = new TechnicalAnalyzer(KiwoomService.getInstance());
        const digest = await analyzer.generateStockDigest(code, name, 200);
        console.log(`[Main] 차트 다이제스트 결과:\n${digest}`);
        return { success: true, digest };
    } catch (e: any) {
        console.error('[Main] test-chart-digest 오류:', e);
        return { error: e.message };
    }
});

// 회고 및 자가학습 실행 (수동)
ipcMain.handle('ai-analyst:run-retrospective', async () => {
    try {
        console.log(`[Main] 수동 성과 회고 및 오답노트 작성 시작`);
        const { RetrospectiveAgent } = await import('./services/v2_agents/RetrospectiveAgent');
        const { KiwoomService } = await import('./services/KiwoomService');
        const agent = new RetrospectiveAgent(KiwoomService.getInstance());
        
        // 1단계: 채점
        const count = await agent.evaluatePastPicks();
        // 2단계: 피드백(오답노트) 생성
        await agent.runRetrospectiveLogic();
        
        console.log(`[Main] 성과 회고 프로세스 일체 완료 (채점 건수: ${count})`);
        return { success: true, count };
    } catch (e: any) {
        console.error('[Main] run-retrospective 오류:', e);
        return { success: false, error: e.message };
    }
});

ipcMain.handle('maiis:run-pipeline-manual', async (_event, pipelineId: string) => {
    try {
        console.log(`[Main] Manual pipeline trigger: ${pipelineId}`)
        switch (pipelineId) {
            case 'PRE_MARKET':    await schedulerService.runPreMarketAnalysis(); break
            case 'AM_EXECUTION':  await schedulerService.runPendingExecution(); break
            case 'MORNING':       await schedulerService.runMorningPipeline(); break
            case 'INTRADAY':      await schedulerService.runIntradayReview(); break
            case 'EVENING':       await schedulerService.runEveningPipeline(); break
            case 'CLOSING':       await schedulerService.runClosingReview(); break
            default: return { success: false, error: `Unknown pipeline: ${pipelineId}` }
        }
        return { success: true }
    } catch (error: any) {
        console.error(`[Main] Manual pipeline ${pipelineId} error:`, error)
        return { success: false, error: error.message }
    }
})

ipcMain.handle('v2-pipeline:run', async (_event, { pipelineId, options }) => {
    try {
        const { V2PipelineManager } = await import('./services/v2_pipeline/V2PipelineManager')
        const result = await V2PipelineManager.getInstance().runPipeline(pipelineId, options)
        return { success: true, data: result }
    } catch (error: any) {
        console.error(`[V2Pipeline] run error:`, error)
        return { success: false, error: error.message }
    }
})

// ═══ V2 Market Leader Discovery: 주도주 판독 파이프라인 ═══
ipcMain.handle('v2:get-market-leaders', async (_event, { days, topN }) => {
    try {
        const { MarketLeaderDiscoveryService } = await import('./services/v2_pipeline/MarketLeaderDiscoveryService')
        const { getPastDateKst } = await import('./utils/DateUtils');
        const DatabaseService = (await import('./services/DatabaseService')).DatabaseService;
        const db = DatabaseService.getInstance().db as any;

        const targetDays = days ?? 10;
        const targetDate = getPastDateKst(targetDays);

        // KODEX 200을 KOSPI 대용 지수로 사용하여 기간 내 시장 상승률 산출
        let marketIndexChange = 0;
        try {
            const kodexRows = db.prepare(`SELECT close FROM market_ohlcv_history WHERE stock_code='069500' AND date >= ? ORDER BY date ASC`).all(targetDate) as any[];
            if (kodexRows && kodexRows.length > 0) {
                const first = kodexRows[0].close;
                const last = kodexRows[kodexRows.length - 1].close;
                if (first > 0) {
                    marketIndexChange = ((last - first) / first) * 100;
                }
            }
        } catch(e) {}

        const service = MarketLeaderDiscoveryService.getInstance()
        // KODEX 200 상승률을 시장 지수 대비 알파 계산의 기준으로 주입
        const leaders = service.getMarketLeaders(targetDays, marketIndexChange, topN ?? 30)
        const themes = service.discoverMainThemes(leaders)
        console.log(`[MarketLeader] days=${targetDays}, KODEX=${marketIndexChange.toFixed(2)}%, leaders=${leaders.length}, themes=${themes.length}`)
        return { success: true, leaders, themes, marketIndexChange }
    } catch (error: any) {
        console.error('[MarketLeader] get-market-leaders error:', error)
        return { success: false, error: error.message, leaders: [], themes: [] }
    }
})

// ═══ V2 Theme Ontology Agent (수동 트리거) ═══
ipcMain.handle('v2:run-theme-ontology', async () => {
    try {
        const agent = new ThemeOntologyAgent();
        const result = await agent.runOntologyMapping();
        return { success: true, result };
    } catch (error: any) {
        console.error('[ThemeOntology] Error:', error);
        return { success: false, error: error.message };
    }
})

// NaverFlow Settings
ipcMain.handle('naverflow:get-settings', async () => {
    const raw: any = store.get('naverflow_settings') || { enabled: false, scheduleSlots: [{ time: '09:30', enabled: true }, { time: '15:30', enabled: true }] };
    // [Collision Avoidance] 09:30 => 09:40 / 15:30 => 15:45
    let changed = false;
    if (raw && Array.isArray(raw.scheduleSlots)) {
        raw.scheduleSlots = raw.scheduleSlots.map((s: any) => {
            if (s.time === '09:30') { changed = true; return { ...s, time: '09:40' }; }
            if (s.time === '15:30') { changed = true; return { ...s, time: '15:45' }; }
            return s;
        });
    }
    if (changed) { store.set('naverflow_settings', raw); }
    return raw;
})

ipcMain.handle('naverflow:save-settings', async (_event, settings) => {
    store.set('naverflow_settings', settings)
    try {
        const { SchedulerService } = await import('./services/SchedulerService')
        await SchedulerService.getInstance().initSchedules()
        return { success: true }
    } catch (e: any) {
        return { success: false, error: e.message }
    }
})

ipcMain.handle('naverflow:get-tracker-data', async (_event, type: 'SECTOR' | 'THEME', date: string, limitDays?: number, topN?: number) => {
    try {
        const db = DatabaseService.getInstance()
        return { success: true, data: db.getThemeTrackerData(type, date, limitDays, topN) }
    } catch (err: any) {
        return { success: false, error: err.message }
    }
})

ipcMain.handle('naverflow:analyze-themes', async (_event, date: string) => {
    try {
        const { ThemeIntelligenceAgent } = await import('./services/v2_agents/ThemeIntelligenceAgent')
        const data = await ThemeIntelligenceAgent.getInstance().runBatchAnalysis(date)
        return { success: true, data }
    } catch (err: any) {
        return { success: false, error: err.message }
    }
})

ipcMain.handle('naverflow:search-live-news', async (_event, keyword: string) => {
    try {
        const { NaverSearchCollector } = await import('./services/v2_pipeline/collectors/NaverSearchCollector')
        const { DatabaseService } = await import('./services/DatabaseService')
        const collector = new NaverSearchCollector()
        const rawSearch = await collector.collect({ keyword })
        
        const dbSvc = DatabaseService.getInstance()
        const rawDb = (dbSvc as any).db;
        const now = new Date();
        const dateStr = dbSvc.getKstDate();
        const timeBucket = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

        const stmtInsertNews = rawDb.prepare(`
            INSERT INTO naver_news_flow
                (date, category, title, body_snippet, source, article_id, url, collected_at, time_bucket, article_hash, search_keyword)
            VALUES
                (@date, @category, @title, @body_snippet, @source, @article_id, @url, @collected_at, @time_bucket, @article_hash, @search_keyword)
        `);

        // Map Naver open API array items & Save to DB
        const formattedList = (rawSearch?.articles || []).map((item: any) => {
            const title = item.title?.replace(/<[^>]+>/g, '') || '';
            const snippet = item.description?.replace(/<[^>]+>/g, '') || '';
            let source = 'NaverSearchAPI';
            try { source = item.originallink ? new URL(item.originallink).hostname.replace('www.', '') : 'Naver'; } catch(e){}
            const pubDate = item.pubDate ? new Date(item.pubDate).toISOString() : now.toISOString();
            const url = item.originallink || item.link || '';
            const hash = Math.abs((Math.imul(31, 0) + title.charCodeAt(0)) | 0).toString(16) + (item.pubDate || Date.now());

            try {
                stmtInsertNews.run({
                    date: dateStr,
                    category: 'THEME_TARGET_MANUAL', // 연관 뉴스 캐시에 걸리도록 통합
                    title: title,
                    body_snippet: snippet,
                    source: source,
                    article_id: hash,
                    url: url,
                    collected_at: now.toISOString(),
                    time_bucket: timeBucket,
                    article_hash: hash,
                    search_keyword: keyword
                });
            } catch (e) {
                // Ignore unique constraint errors
            }

            return {
                title: title,
                source: source,
                date: pubDate,
                url: url,
                category: 'LIVE_SEARCH_MANUAL'
            }
        });

        return { success: true, data: formattedList }
    } catch (err: any) {
        return { success: false, error: err.message }
    }
})

ipcMain.handle('naverflow:verify-theme', async (_event, params) => {
    try {
        const { ThemeIntelligenceAgent } = await import('./services/v2_agents/ThemeIntelligenceAgent')
        const data = await ThemeIntelligenceAgent.getInstance().verifyIntelligence(params)
        return { success: true, data }
    } catch (err: any) {
        return { success: false, error: err.message }
    }
})

// ═══ Graph RAG: Knowledge Edge IPC ═══

ipcMain.handle('graph:edges-from', async (_event, sourceType: string, sourceId: string, targetType?: string) => {
    try {
        const { IssueLedgerDB } = await import('./services/v2_agents/IssueLedgerDB')
        const db = IssueLedgerDB.getInstance()
        const data = targetType
            ? db.getEdgesFromTo(sourceType, sourceId, targetType)
            : db.getEdgesFrom(sourceType, sourceId)
        return { success: true, data }
    } catch (err: any) {
        return { success: false, error: err.message }
    }
})

ipcMain.handle('graph:edges-to', async (_event, targetType: string, targetId: string) => {
    try {
        const { IssueLedgerDB } = await import('./services/v2_agents/IssueLedgerDB')
        const data = IssueLedgerDB.getInstance().getEdgesTo(targetType, targetId)
        return { success: true, data }
    } catch (err: any) {
        return { success: false, error: err.message }
    }
})

ipcMain.handle('graph:market-edges', async (_event) => {
    try {
        const { IssueLedgerDB } = await import('./services/v2_agents/IssueLedgerDB')
        const data = IssueLedgerDB.getInstance().getMarketEdges()
        return { success: true, data }
    } catch (err: any) {
        return { success: false, error: err.message }
    }
})

ipcMain.handle('graph:upsert-edge', async (_event, edge: any) => {
    try {
        const { IssueLedgerDB } = await import('./services/v2_agents/IssueLedgerDB')
        IssueLedgerDB.getInstance().upsertEdge({ ...edge, created_by: edge.created_by || 'HUMAN' })
        return { success: true }
    } catch (err: any) {
        return { success: false, error: err.message }
    }
})

// ═══ V2 Agent Swarm: Market Condition Agent IPC ═══

ipcMain.handle('naverflow:get-theme-news', async (_event, themeName: string, keywords: string[]) => {
    try {
        const { NewsDataHub } = await import('./services/NewsDataHub')
        const data = NewsDataHub.getInstance().getNewsForIssue(themeName, keywords)
        // 상위 5~10개만 리턴
        return { success: true, data: data.slice(0, 5) }
    } catch (err: any) {
        return { success: false, error: err.message }
    }
})

ipcMain.handle('agent:market:settings:get', async () => {
    return { success: true, data: store.get('market_agent_settings', { telegramEnabled: true }) }
})

ipcMain.handle('agent:market:settings:save', async (_event, settings) => {
    store.set('market_agent_settings', settings)
    return { success: true }
})

ipcMain.handle('telegram:get-logs', async () => {
    try {
        const { DatabaseService } = await import('./services/DatabaseService')
        const data = DatabaseService.getInstance().getTelegramLogs()
        return { success: true, data }
    } catch (err: any) {
        return { success: false, error: err.message }
    }
})

// V2 Co-Pilot IPC
ipcMain.on('copilot:chat', async (event, data: { message: string, mode: 'auto'|'short'|'detail' }) => {
    const { message, mode } = data;
    try {
        const { CoPilotAgent } = await import('./services/v2_agents/CoPilotAgent')
        await CoPilotAgent.getInstance().chat(message, mode, (text, isDone) => {
            event.reply('copilot:reply', { text, isDone })
        })
    } catch (error: any) {
        console.error(`[CoPilot] chat error:`, error)
        event.reply('copilot:reply', { text: `⚠️ 에러가 발생했습니다: ${error.message}\nGemini API 키가 올바른지 확인해 주세요.`, isDone: true })
    }
})

ipcMain.handle('agent:market:run', async (_event, cycle: 'A' | 'B') => {
    try {
        const { MarketConditionAgent } = await import('./services/v2_agents/MarketConditionAgent')
        const result = await MarketConditionAgent.getInstance().runPrediction(cycle)
        
        // 동기적으로 즉시 당일 진입가격(Entry Price)과 가능한 수익률 평가(T+1 등)를 반영 시도
        const { PerformanceTracker } = await import('./services/v2_agents/PerformanceTracker')
        await PerformanceTracker.getInstance().runDailyTracking()
        
        return { success: true, data: result }
    } catch (error: any) {
        console.error(`[Agent] MarketCondition run error:`, error)
        return { success: false, error: error.message }
    }
})

ipcMain.handle('agent:market:history', async (_event, limit: number = 30) => {
    try {
        const { MarketConditionAgent } = await import('./services/v2_agents/MarketConditionAgent')
        const result = MarketConditionAgent.getInstance().getRecentPredictions(limit)
        return { success: true, data: result }
    } catch (error: any) {
        return { success: false, error: error.message }
    }
})

ipcMain.handle('agent:market:delete', async (_event, id: string, tableName?: 'agent_predictions' | 'intraday_predictions') => {
    try {
        const { MarketConditionAgent } = await import('./services/v2_agents/MarketConditionAgent')
        const result = MarketConditionAgent.getInstance().deletePrediction(id, tableName)
        return { success: result }
    } catch (error: any) {
        return { success: false, error: error.message }
    }
})

ipcMain.handle('agent:market:delete-many', async (_event, ids: string[], tableName?: 'agent_predictions' | 'intraday_predictions') => {
    try {
        const { MarketConditionAgent } = await import('./services/v2_agents/MarketConditionAgent')
        const deleted = MarketConditionAgent.getInstance().deleteManyPredictions(ids, tableName)
        return { success: true, deleted }
    } catch (error: any) {
        return { success: false, error: error.message }
    }
})


ipcMain.handle('agent:market:latest', async () => {
    try {
        const { MarketConditionAgent } = await import('./services/v2_agents/MarketConditionAgent')
        const result = MarketConditionAgent.getInstance().getLatestPrediction()
        return { success: true, data: result }
    } catch (error: any) {
        return { success: false, error: error.message }
    }
})

ipcMain.handle('agent:market:stats', async () => {
    try {
        const { MarketConditionAgent } = await import('./services/v2_agents/MarketConditionAgent')
        const result = MarketConditionAgent.getInstance().getStats()
        return { success: true, data: result }
    } catch (error: any) {
        return { success: false, error: error.message }
    }
})

ipcMain.handle('agent:market:rules', async () => {
    try {
        const { MarketConditionAgent } = await import('./services/v2_agents/MarketConditionAgent')
        const result = await MarketConditionAgent.getInstance().getActiveRules()
        return { success: true, data: result }
    } catch (error: any) {
        return { success: false, error: error.message }
    }
})

ipcMain.handle('agent:market:clear-persona', async () => {
    try {
        const db = await import('./services/DatabaseService').then(m => m.DatabaseService.getInstance())
        const rawDb = (db as any).db
        if (rawDb) {
            rawDb.prepare('DELETE FROM persona_performance').run()
        }
        return { success: true }
    } catch (error: any) {
        return { success: false, error: error.message }
    }
})

ipcMain.handle('agent:market:retrospectives:get', async (_event, type: 'DAILY' | 'WEEKLY' | 'MONTHLY', limit?: number) => {
    try {
        const { MarketReviewAgent } = await import('./services/v2_agents/MarketReviewAgent')
        return { success: true, data: MarketReviewAgent.getInstance().getRetrospectives(type, limit) }
    } catch (error: any) {
        return { success: false, error: error.message }
    }
})

ipcMain.handle('agent:market:retrospectives:run', async (_event, type: 'DAILY' | 'WEEKLY' | 'MONTHLY') => {
    try {
        const { MarketReviewAgent } = await import('./services/v2_agents/MarketReviewAgent')
        let data;
        if (type === 'DAILY') {
            data = await MarketReviewAgent.getInstance().runDailyReview()
        } else if (type === 'WEEKLY') {
            data = await MarketReviewAgent.getInstance().runWeeklyReview()
        } else {
            data = await MarketReviewAgent.getInstance().runMonthlyReview()
        }
        return { success: true, data }
    } catch (error: any) {
        return { success: false, error: error.message }
    }
})

// ═══ \uc7a5\uc911 \uc778\ud2b8\ub77c\ub370\uc774 \uc608\uce21 IPC ═══
ipcMain.handle('agent:intraday:predictions', async () => {
    try {
        const { MarketConditionAgent } = await import('./services/v2_agents/MarketConditionAgent')
        return { success: true, data: MarketConditionAgent.getInstance().getIntradayPredictions() }
    } catch (error: any) {
        return { success: false, error: error.message }
    }
})

ipcMain.handle('agent:intraday:run', async (_event, slot: '09:30' | '11:00' | '13:00') => {
    try {
        const { MarketConditionAgent } = await import('./services/v2_agents/MarketConditionAgent')
        const result = await MarketConditionAgent.getInstance().runIntraday(slot)
        return { success: true, data: result }
    } catch (error: any) {
        return { success: false, error: error.message }
    }
})

ipcMain.handle('agent:intradayswarm:run', async (_event, slot: string) => {
    try {
        console.log(`[IPC] 장중 시황 군집 분석 수동 실행 요청: ${slot}`)
        const { IntradaySwarmAgent } = await import('./services/v2_agents/IntradaySwarmAgent')
        await IntradaySwarmAgent.getInstance().runSwarm(slot)
        return { success: true }
    } catch (error: any) {
        return { success: false, error: error.message }
    }
})

// 수동 트래커 실행 (디버깅 & 즉시 성과 업데이트용 — 장전·마감 + 장중 모두 평가)
ipcMain.handle('agent:tracker:run', async () => {
    try {
        const { PerformanceTracker } = await import('./services/v2_agents/PerformanceTracker')
        const tracker = PerformanceTracker.getInstance()
        await tracker.runDailyTracking()
        await tracker.evaluateIntraday()
        return { success: true }
    } catch (error: any) {
        console.error('[Main] agent:tracker:run failed:', error);
        return { success: false, error: error.message }
    }
})

// ═══ 이슈 관리 (Macro/News) Agent IPC ═══
ipcMain.handle('agent:issues:active', async () => {
    try {
        const { IssueLedgerDB } = await import('./services/v2_agents/IssueLedgerDB')
        return { success: true, data: IssueLedgerDB.getInstance().getActiveIssues() }
    } catch (error: any) {
        return { success: false, error: error.message }
    }
})

ipcMain.handle('agent:issues:briefings', async (_event, limit: number = 30) => {
    try {
        const { IssueLedgerDB } = await import('./services/v2_agents/IssueLedgerDB')
        return { success: true, data: IssueLedgerDB.getInstance().getBriefingsHistory(limit) }
    } catch (error: any) {
        return { success: false, error: error.message }
    }
})

ipcMain.handle('agent:issues:timeline', async (_event, issueId: string) => {
    try {
        const { IssueLedgerDB } = await import('./services/v2_agents/IssueLedgerDB')
        return { success: true, data: IssueLedgerDB.getInstance().getIssueTimeline(issueId) }
    } catch (error: any) {
        return { success: false, error: error.message }
    }
})

ipcMain.handle('agent:issues:resolve', async (_event, issueId: string) => {
    try {
        const { IssueLedgerDB } = await import('./services/v2_agents/IssueLedgerDB')
        IssueLedgerDB.getInstance().resolveIssue(issueId)
        return { success: true }
    } catch (error: any) {
        return { success: false, error: error.message }
    }
})

ipcMain.handle('agent:issues:run', async () => {
    try {
        const { IssueManagementAgent } = await import('./services/v2_agents/IssueManagementAgent')
        await IssueManagementAgent.getInstance().runDailyAnalysis()
        return { success: true }
    } catch (error: any) {
        return { success: false, error: error.message }
    }
})

ipcMain.handle('agent:issues:briefing', async () => {
    try {
        const { IssueLedgerDB } = await import('./services/v2_agents/IssueLedgerDB')
        const briefing = IssueLedgerDB.getInstance().getLatestBriefing()
        return { success: true, data: briefing }
    } catch (error: any) {
        return { success: false, error: error.message }
    }
})

ipcMain.handle('agent:issues:run-swarm', async (_event, issueId: string, dummyData?: any) => {
    try {
        const { SwarmSimulationAgent } = await import('./services/v2_agents/SwarmSimulationAgent')
        const session = await SwarmSimulationAgent.getInstance().evaluateIssue(issueId, dummyData)
        return { success: true, data: session }
    } catch (error: any) {
        return { success: false, error: error.message }
    }
})

ipcMain.handle('agent:issues:get-swarm', async (_event, issueId: string) => {
    try {
        const { IssueLedgerDB } = await import('./services/v2_agents/IssueLedgerDB')
        const sessions = IssueLedgerDB.getInstance().getSwarmSessionsForIssue(issueId)
        return { success: true, data: sessions }
    } catch (error: any) {
        return { success: false, error: error.message }
    }
})

ipcMain.handle('agent:issues:delete-swarm-session', async (_event, sessionId: string) => {
    try {
        const { IssueLedgerDB } = await import('./services/v2_agents/IssueLedgerDB')
        IssueLedgerDB.getInstance().deleteSwarmSession(sessionId)
        return { success: true }
    } catch (error: any) {
        return { success: false, error: error.message }
    }
})

// ═══ AI Orchestrator Dashboard ═══
ipcMain.handle('ai:get-queue-status', async () => {
    const { AiExecutionQueue } = await import('./services/AiExecutionQueue')
    return AiExecutionQueue.getInstance().getQueueStatus()
})

ipcMain.handle('ai:get-execution-log', async (_event, limit: number = 50) => {
    const { AiExecutionQueue } = await import('./services/AiExecutionQueue')
    return AiExecutionQueue.getInstance().getExecutionLog(limit)
})

ipcMain.handle('ai:test-local-ai', async (_event, prompt: string) => {
    const { AiExecutionQueue } = await import('./services/AiExecutionQueue')
    try {
        const result = await AiExecutionQueue.getInstance().enqueue({
            agentId: 'LOCAL_TEST',
            agentName: '로컬 AI 테스터',
            triggerType: 'MANUAL',
            targetType: 'local',
            prompt: prompt || '안녕! 너는 누구야? 10단어 이내로 한국어로 대답해 확인용.',
            systemInstruction: '명령에 짧게 단답하는 테스트 봇이다.'
        })
        return { success: true, result }
    } catch (error: any) {
        return { success: false, error: error.message }
    }
})


ipcMain.handle('maiis:get-portfolio-tracker', async () => {
    try {
        const db = DatabaseService.getInstance()
        return {
            success: true,
            data: {
                active: db.getActivePortfolio(),
                closed: db.getClosedPortfolio(),
                stats: db.getPortfolioStats(),
                dailyHistory: db.getDailySnapshots(365),
            }
        }
    } catch (error: any) {
        return { success: false, error: error.message }
    }
})

// ─── Strategy Profiles & Portfolio Review ──────────
ipcMain.handle('pm:get-strategy-profiles', async () => {
    try {
        const { StrategyProfileService } = await import('./services/StrategyProfileService')
        return { success: true, data: StrategyProfileService.getInstance().getProfiles() }
    } catch (error: any) { return { success: false, error: error.message } }
})

ipcMain.handle('pm:save-strategy-profiles', async (_event, profiles) => {
    try {
        const { StrategyProfileService } = await import('./services/StrategyProfileService')
        StrategyProfileService.getInstance().saveProfiles(profiles)
        return { success: true }
    } catch (error: any) { return { success: false, error: error.message } }
})

ipcMain.handle('pm:reset-strategy-profiles', async () => {
    try {
        const { StrategyProfileService } = await import('./services/StrategyProfileService')
        return { success: true, data: StrategyProfileService.getInstance().resetToDefaults() }
    } catch (error: any) { return { success: false, error: error.message } }
})

ipcMain.handle('pm:get-review-schedule', async () => {
    try {
        const { StrategyProfileService } = await import('./services/StrategyProfileService')
        return { success: true, data: StrategyProfileService.getInstance().getReviewSchedule() }
    } catch (error: any) { return { success: false, error: error.message } }
})

ipcMain.handle('pm:save-review-schedule', async (_event, schedule) => {
    try {
        const { StrategyProfileService } = await import('./services/StrategyProfileService')
        const { SchedulerService } = await import('./services/SchedulerService')
        StrategyProfileService.getInstance().saveReviewSchedule(schedule)
        // 설정이 저장되면 백그라운드 스케줄러(cron) 즉각 리셋 및 재시동
        SchedulerService.getInstance().initSchedules()
        return { success: true }
    } catch (error: any) { return { success: false, error: error.message } }
})

ipcMain.handle('pm:run-review', async (_event, mode: string) => {
    try {
        const { PortfolioReviewEngine } = await import('./services/PortfolioReviewEngine')
        const result = await PortfolioReviewEngine.getInstance().runReviewLoop(mode as 'INTRADAY' | 'CLOSING')
        return { success: true, data: result }
    } catch (error: any) { return { success: false, error: error.message } }
})

ipcMain.on('chart-render-complete', (_event, code) => {
    eventBus.emit(SystemEvent.CHART_RENDER_COMPLETE, code)
})

// ─── Pipeline Monitor IPC ─────────────────────────────────────────
ipcMain.handle('pipeline:get-latest-runs', async () => {
    const { PipelineLogger } = await import('./services/PipelineLogger')
    return PipelineLogger.getInstance().getLatestRuns()
})

ipcMain.handle('pipeline:get-run-detail', async (_event, runId: string) => {
    const { PipelineLogger } = await import('./services/PipelineLogger')
    return PipelineLogger.getInstance().getRunDetail(runId)
})

ipcMain.handle('pipeline:get-all-runs', async (_event, date?: string) => {
    const { PipelineLogger } = await import('./services/PipelineLogger')
    return PipelineLogger.getInstance().getAllRuns(date)
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

// [DEPRECATED] 관심종목 기능 비활성화 - UI에서 관심종목 탭 삭제됨
// 재활용 시: store key 'watchlist_symbols' 사용
// ipcMain.handle('kiwoom:save-watchlist-symbols', async (_event, symbols: string[]) => {
//     store.set('watchlist_symbols', symbols)
//     return { success: true }
// })
// ipcMain.handle('kiwoom:get-watchlist-symbols', () => {
//     return store.get('watchlist_symbols') || []
// })

// [DEPRECATED] V1 MarketScanner IPC Handlers - V2 파이프라인 전환으로 비활성화
// 재활용 시: kiwoomService.getVolumeSpikeStocks(), getTopTradingValueStocks(), getTopRisingStocks(), getCombinedTopStocks()
// ipcMain.handle('kiwoom:test-market-scanner', async () => { ... })
// ipcMain.handle('kiwoom:get-top-trading-value-stocks', async () => { ... })
// ipcMain.handle('kiwoom:get-top-rising-stocks', async () => { ... })
// ipcMain.handle('kiwoom:get-combined-top-stocks', async (_event, { risingLimit, tradingValueLimit }) => { ... })

// [DEPRECATED] 관심종목 데이터 조회 - 재활용 시: kiwoomService.getWatchlist(symbols) 참조
// ipcMain.handle('kiwoom:get-watchlist', async (_event, { symbols }) => {
//     try {
//         const data = await kiwoomService.getWatchlist(symbols)
//         return { success: true, data }
//     } catch (error: any) {
//         return { success: false, error: error?.response?.data || { message: error.message } }
//     }
// })

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

// ═══════════════════════════════════════════════════════════════════════════════
// [DEPRECATED] DART API Handlers - UI에서 DART/관심종목 탭 삭제됨
// 재활용 가이드:
//   1. DartApiService import 복원 (파일 상단)
//   2. 아래 핸들러 주석 해제
//   3. store key: 'dart_api_key', 'dart_settings'
//   4. 주요 메서드: syncCorpCodes(), syncWatchlistSchedules(), fetchDisclosures(), syncBatchFinancials()
//   5. DB 메서드: DatabaseService.getFinancialData(stockCode)
// ═══════════════════════════════════════════════════════════════════════════════
// ipcMain.handle('dart:save-key', (_event, key: string) => {
//     store.set('dart_api_key', key)
//     return { success: true }
// })
// ipcMain.handle('dart:get-key', () => {
//     return store.get('dart_api_key') || ''
// })
// ipcMain.handle('dart:save-settings', (_event, settings: any) => {
//     store.set('dart_settings', settings)
//     return { success: true }
// })
// ipcMain.handle('dart:get-settings', () => {
//     return store.get('dart_settings') || {}
// })
// ipcMain.handle('dart:sync-corp-codes', async () => { ... })
// ipcMain.handle('dart:sync-watchlist-schedules', async () => { ... })
// ipcMain.handle('dart:fetch-disclosures', async (_event, { corpCodes, bgnDe, endDe }) => { ... })
// ipcMain.handle('dart:get-financial-data', async (_event, stockCode: string) => { ... })
// ipcMain.handle('dart:sync-batch-financials', async (_event, stockCodes: string[]) => { ... })

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

// === Market Condition Agent V2 ===
ipcMain.handle('mca:get-technical-digest', async () => {
    try {
        const { MarketConditionAgent } = await import('./services/v2_agents/MarketConditionAgent')
        const digest = await MarketConditionAgent.getInstance().getIntradayTechnicalDigest()
        return digest
    } catch (err: any) {
        return `[오류] 다이제스트 생성 실패: ${err.message}`
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

// [DEPRECATED] DART 공시 수집 핸들러 - 재활용 시: DartApiService.getDisclosuresSummaryForAiWithRaw(stockCode) 참조
// ipcMain.handle('dart:collect-disclosures', async (_event, { date, stockCode, stockName }) => {
//     const { DartApiService } = await import('./services/DartApiService')
//     const result = await DartApiService.getInstance().getDisclosuresSummaryForAiWithRaw(stockCode)
//     DatabaseService.getInstance().saveDisclosuresRawData(date, stockCode, stockName, result.items)
//     return { success: true, data: result.items }
// })

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

// ═══ NewsDataHub IPC Handlers ═══════════════════════════════════════════════

ipcMain.handle('news-hub:get-settings', async () => {
    const { DEFAULT_NEWS_HUB_SETTINGS } = await import('./types/NewsHubSettings')
    return store.get('news_hub_settings') || DEFAULT_NEWS_HUB_SETTINGS
})

ipcMain.handle('news-hub:save-settings', async (_event, settings: any) => {
    try {
        const { validateHubTimeline } = await import('./types/NewsHubSettings')
        const validation = validateHubTimeline(settings)
        store.set('news_hub_settings', settings)
        // 크론 즉시 재등록
        const { SchedulerService } = await import('./services/SchedulerService')
        SchedulerService.getInstance().initSchedules()
        return { success: true, warnings: validation.warnings }
    } catch (err: any) {
        return { success: false, error: err.message }
    }
})

ipcMain.handle('news-hub:collect-now', async () => {
    try {
        const { NewsDataHub } = await import('./services/NewsDataHub')
        const result = await NewsDataHub.getInstance().runBatchCollect()
        return { success: true, ...result }
    } catch (err: any) {
        return { success: false, error: err.message }
    }
})

ipcMain.handle('news-hub:get-cache-status', async () => {
    try {
        const { NewsDataHub } = await import('./services/NewsDataHub')
        return NewsDataHub.getInstance().getCacheStatus()
    } catch (err: any) {
        return { isValid: false, error: err.message }
    }
})

ipcMain.handle('news-hub:get-articles', async (_event, options?: { category?: string; limit?: number }) => {
    try {
        const { NewsDataHub } = await import('./services/NewsDataHub')
        return NewsDataHub.getInstance().getCachedArticles(options)
    } catch (err: any) {
        return []
    }
})

// ═══ AI 수동실행 로그 IPC Handlers ═══════════════════════════════════════════════
ipcMain.handle('ai-run-logs:save', async (_event, message: string) => {
    try {
        const { DatabaseService } = await import('./services/DatabaseService')
        DatabaseService.getInstance().saveAiRunLog(message)
        return { success: true }
    } catch (err: any) {
        return { success: false, error: err.message }
    }
})

ipcMain.handle('ai-run-logs:get', async () => {
    try {
        const { DatabaseService } = await import('./services/DatabaseService')
        return DatabaseService.getInstance().getAiRunLogs()
    } catch (err: any) {
        return []
    }
})

ipcMain.handle('ai-run-logs:clear', async () => {
    try {
        const { DatabaseService } = await import('./services/DatabaseService')
        DatabaseService.getInstance().clearAiRunLogs()
        return { success: true }
    } catch (err: any) {
        return { success: false, error: err.message }
    }
})

ipcMain.handle('ai-daily-raw-logs:get', async (_event, date: string, agentType: string) => {
    try {
        const { DatabaseService } = await import('./services/DatabaseService')
        const log = DatabaseService.getInstance().getAiDailyRawLog(date, agentType)
        return { success: true, data: log ? log.raw_text : null }
    } catch (err: any) {
        return { success: false, error: err.message }
    }
})
