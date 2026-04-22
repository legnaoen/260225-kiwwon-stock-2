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

    // Forward Mega Theme Builder Progress (단계별 진행 상태)
    eventBus.on('MEGA_THEME_PROGRESS' as any, (data: { step: string; detail: string }) => {
        if (win && !win.isDestroyed()) {
            win.webContents.send('mega-theme:progress', data)
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

// === Tags =========================================================================
ipcMain.handle('naverflow:get-stock-theme-tags', async (_event, stockCode: string) => {
    try {
        return DatabaseService.getInstance().getStockThemeTags(stockCode);
    } catch (e: any) {
        console.error('[IPC] get-stock-theme-tags err:', e);
        return [];
    }
})

// === DART 공시 수집 테스트 ==========================================================
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

ipcMain.handle('ai-analyst:run-portfolio-manager-phase1', async () => {
    try {
        const { PortfolioManagerAgent } = await import('./services/v2_agents/PortfolioManagerAgent');
        const data = await PortfolioManagerAgent.getInstance().runPhase1_Screening();
        return { success: true, data };
    } catch (e: any) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('ai-analyst:run-portfolio-manager-phase2', async () => {
    try {
        const { PortfolioManagerAgent } = await import('./services/v2_agents/PortfolioManagerAgent');
        const data = await PortfolioManagerAgent.getInstance().runPhase2_Rebalancing();
        return { success: true, data };
    } catch (e: any) {
        return { success: false, error: e.message };
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

// 성적표 AI 분석 실행
ipcMain.handle('portfolio:run-retrospective', async () => {
    try {
        const { PortfolioRetrospectiveAgent } = await import('./services/v2_agents/PortfolioRetrospectiveAgent');
        const result = await PortfolioRetrospectiveAgent.getInstance().run();
        return result;
    } catch (e: any) {
        console.error('[Main] portfolio:run-retrospective 오류:', e);
        return { success: false, error: e.message };
    }
});

// 최신 성적표 분석 리포트 조회
ipcMain.handle('portfolio:get-latest-retrospective', async () => {
    try {
        const { DatabaseService } = await import('./services/DatabaseService');
        return DatabaseService.getInstance().getLatestRetrospectiveReport();
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

// 관심종목(WAIT_DIP/HOLD/WATCHLIST)에 잘못 기록된 진입가·수익률 초기화
// 이전 버전 데이터 정합성 복구용 (전체 삭제 아님, 해당 필드만 0으로 리셋)
ipcMain.handle('ai-analyst:cleanup-watchlist-prices', async () => {
    try {
        const { DatabaseService } = await import('./services/DatabaseService');
        const result = DatabaseService.getInstance().cleanupWatchlistEntryPrices();
        console.log(`[Main] 관심종목 진입가 초기화 완료: ${result.fixed}건`);
        return { success: true, fixed: result.fixed };
    } catch (e: any) {
        console.error('[Main] cleanup-watchlist-prices 오류:', e);
        return { success: false, error: e.message };
    }
});

ipcMain.handle('maiisAdmin:getPortfolioEventLogs', async (_event, stock_code: string) => {
    try {
        const { DatabaseService } = await import('./services/DatabaseService');
        const logs = DatabaseService.getInstance().getPortfolioEventLogs(stock_code);
        return { success: true, data: logs };
    } catch (e: any) {
        return { success: false, error: e.message };
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
            case 'PRE_MARKET': await schedulerService.runPreMarketAnalysis(); break
            case 'AM_EXECUTION': await schedulerService.runPendingExecution(); break
            case 'MORNING': await schedulerService.runMorningPipeline(); break
            case 'INTRADAY': await schedulerService.runIntradayReview(); break
            case 'EVENING': await schedulerService.runEveningPipeline(); break
            case 'CLOSING': await schedulerService.runClosingReview(); break
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
ipcMain.handle('v2:get-market-leaders', async (_event, { days, topN, peakoutSettings }) => {
    try {
        const { MarketLeaderDiscoveryService, DEFAULT_PEAKOUT_SETTINGS } = await import('./services/v2_pipeline/MarketLeaderDiscoveryService')
        const { getPastDateKst } = await import('./utils/DateUtils');
        const DatabaseService = (await import('./services/DatabaseService')).DatabaseService;
        const db = DatabaseService.getInstance().db as any;

        const targetDays = days ?? 10;
        const targetDate = getPastDateKst(targetDays);
        const settings = peakoutSettings ?? DEFAULT_PEAKOUT_SETTINGS;

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
        } catch (e) { }

        const service = MarketLeaderDiscoveryService.getInstance()
        // KODEX 200 상승률을 시장 지수 대비 알파 계산의 기준으로 주입
        const leaders = service.getMarketLeaders(targetDays, marketIndexChange, topN ?? 30, settings)
        const themes = service.discoverMainThemes(leaders)
        console.log(`[MarketLeader V2] days=${targetDays}, KODEX=${marketIndexChange.toFixed(2)}%, leaders=${leaders.length}, themes=${themes.length}`)
        return { success: true, leaders, themes, marketIndexChange }
    } catch (error: any) {
        console.error('[MarketLeader] get-market-leaders error:', error)
        return { success: false, error: error.message, leaders: [], themes: [] }
    }
})

// ═══ V2 CrossPeriod 추천 종목 프로파일 ═══
ipcMain.handle('v2:get-cross-period-profile', async (_event, { topN, peakoutSettings } = {}) => {
    try {
        const { CrossPeriodAnalyzer } = await import('./services/v2_pipeline/CrossPeriodAnalyzer');
        const { DEFAULT_PEAKOUT_SETTINGS } = await import('./services/v2_pipeline/MarketLeaderDiscoveryService');
        const settings = peakoutSettings ?? DEFAULT_PEAKOUT_SETTINGS;
        const result = CrossPeriodAnalyzer.getInstance().getCrossPeriodProfile(topN ?? 60, settings);
        console.log(`[CrossPeriod] candidates=${result.candidates?.length}, stats=`, result.stats);
        return result;
    } catch (error: any) {
        console.error('[CrossPeriod] get-cross-period-profile error:', error);
        return { success: false, error: error.message, candidates: [], themes: [], stats: { total: 0, byCategory: {} } };
    }
})

// ═══ Track B: 모의매매 데이터 조회 ═══
ipcMain.handle('v2:get-sim-trade-picks', async () => {
    try {
        const { DatabaseService } = await import('./services/DatabaseService');
        const db = DatabaseService.getInstance().getDb();
        // ROW_NUMBER() 윈도우 함수로 (stock_code, pick_date) 파티션 내 1위 레코드만 선택
        // 동일 종목이 여러 Track 테이블에 중복 저장되어도 DB 레벨에서 완전 dedup
        const picks = db.prepare(`
            WITH combined AS (
                SELECT * FROM track_a_buy_picks
                UNION ALL
                SELECT * FROM track_b_buy_picks
                UNION ALL
                SELECT * FROM track_c_buy_picks
                UNION ALL
                SELECT * FROM track_d_buy_picks
                UNION ALL
                SELECT * FROM track_e_buy_picks
            ),
            ranked AS (
                SELECT *,
                    ROW_NUMBER() OVER (
                        PARTITION BY stock_code, pick_date
                        ORDER BY
                            CASE category
                                WHEN 'TRUE_LEADER'              THEN 1
                                WHEN 'INTRADAY_SURGE'           THEN 2
                                WHEN 'SHORT_TERM_CONSOLIDATION' THEN 3
                                WHEN 'EMERGING_STAR'            THEN 4
                                WHEN 'PULLBACK_REBOUND'         THEN 5
                                WHEN 'PULLBACK_DIP'             THEN 6
                                ELSE 7
                            END ASC,
                            id ASC
                    ) AS rn
                FROM combined
            )
            SELECT
                id, pick_date, pick_rank, stock_code, stock_name, category,
                signals_json, buy_score, reason, risk, related_themes_json,
                theme_lifespan, entry_price, exit_price, current_price,
                holding_days, target_days, target_return_pct, peak_return,
                peak_date, final_return, status, result, entry_date, exit_date
            FROM ranked
            WHERE rn = 1
            ORDER BY
                pick_date DESC,
                CASE category
                    WHEN 'TRUE_LEADER'              THEN 1
                    WHEN 'INTRADAY_SURGE'           THEN 2
                    WHEN 'SHORT_TERM_CONSOLIDATION' THEN 3
                    WHEN 'EMERGING_STAR'            THEN 4
                    WHEN 'PULLBACK_REBOUND'         THEN 5
                    WHEN 'PULLBACK_DIP'             THEN 6
                    ELSE 7
                END ASC,
                pick_rank ASC
            LIMIT 500
        `).all();
        return { picks };
    } catch (error: any) {
        console.error('[SimTrade] get-sim-trade-picks error:', error);
        return { picks: [] };
    }
})

// ── 수동 현재가 갱신 기능 (모의매매 탭 전용) ──
ipcMain.handle('v2:force-refresh-sim-trade-prices', async () => {
    try {
        const { DatabaseService } = await import('./services/DatabaseService');
        const db = DatabaseService.getInstance().getDb();
        const { KiwoomService } = await import('./services/KiwoomService');
        const kiwoom = KiwoomService.getInstance();
        
        const tables = [
            'track_a_buy_picks', 'track_b_buy_picks', 'track_c_buy_picks',
            'track_d_buy_picks', 'track_e_buy_picks'
        ];
        
        let refreshedCount = 0;

        for (const table of tables) {
            let activeAndPending;
            try {
                activeAndPending = db.prepare(`SELECT id, stock_code, entry_price, entry_date, peak_return, peak_date FROM ${table} WHERE status IN ('ACTIVE', 'PENDING')`).all() as any[];
            } catch (_) { continue; }
            const { getKstDate } = await import('./utils/DateUtils');
            const today = getKstDate();

            for (const row of activeAndPending) {
                try {
                    const priceInfo = await kiwoom.getStockBasicInfo(row.stock_code);
                    const body = priceInfo?.Body || priceInfo?.out1 || priceInfo || {};
                    const currentPrcStr = String(body.stk_prc || body.currentPrice || body.cur_prc || body.stck_prpr || '').replace(/[^0-9-]/g, '');
                    const highPrcStr = String(body.stck_hgpr || body.highPrice || body.hgpr || '').replace(/[^0-9-]/g, '');
                    
                    if (currentPrcStr) {
                        const todayClosePrice = Math.abs(parseFloat(currentPrcStr));
                        const todayHighPrice = highPrcStr ? Math.abs(parseFloat(highPrcStr)) : todayClosePrice;
                        
                        let newPeakReturn = row.peak_return;
                        let newPeakDate = row.peak_date;

                        // PENDING 또는 당일 진입 종목은 제외, entry_price가 존재하는 경우에만 고점 갱신
                        if (row.entry_price > 0 && row.entry_date !== today) {
                            const dailyHighReturn = ((todayHighPrice - row.entry_price) / row.entry_price) * 100;
                            if (row.peak_return == null || dailyHighReturn > row.peak_return) {
                                newPeakReturn = dailyHighReturn;
                                newPeakDate = today;
                            }
                        }
                        
                        db.prepare(`
                            UPDATE ${table} 
                            SET current_price = ?, peak_return = ?, peak_date = ?, updated_at = ? 
                            WHERE id = ?
                        `).run(todayClosePrice, newPeakReturn, newPeakDate, new Date().toISOString(), row.id);
                        
                        refreshedCount++;
                    }
                    await new Promise(r => setTimeout(r, 200));
                } catch (e) {
                    continue;
                }
            }
        }
        
        return { success: true, refreshedCount };
    } catch (e: any) {
        return { success: false, error: e.message };
    }
});

// ── 전종목 OHLCV 수동 갱신 (모의매매 탭 전용 더보기 메뉴용) ──
ipcMain.handle('v2:run-ohlcv-collection', async () => {
    try {
        const { MarketDataCollectorService } = await import('./services/v2_pipeline/MarketDataCollectorService');
        const result = await MarketDataCollectorService.getInstance().runDailyCollection();
        return { success: true, result };
    } catch (error: any) {
        console.error('[MarketDataCollector] runDailyCollection error:', error);
        return { success: false, error: error.message };
    }
});

// [Track A] 대장주 모의매매 AI 수동 실행
ipcMain.handle('track-a:run-buy-agent', async (_event, date?: string) => {
    try {
        const { TrackABuyAgent } = await import('./services/v2_agents/TrackABuyAgent');
        const result = await TrackABuyAgent.getInstance().run(date);
        return { success: result.success, saved: result.saved, skipped: result.skipped, error: result.error };
    } catch (error: any) {
        console.error('[TrackABuyAgent] manual run error:', error);
        return { success: false, error: error.message };
    }
})

// [Track B] 모의매매 AI 수동 실행
ipcMain.handle('track-b:run-buy-agent', async (_event, date?: string) => {
    try {
        const { TrackBBuyAgent } = await import('./services/v2_agents/TrackBBuyAgent');
        const result = await TrackBBuyAgent.getInstance().run(date);
        return { success: result.success, saved: result.saved, skipped: result.skipped, error: result.error };
    } catch (error: any) {
        console.error('[TrackBBuyAgent] manual run error:', error);
        return { success: false, error: error.message };
    }
})

// [Track C] 모의매매 AI 수동 실행 (눌림목)
ipcMain.handle('track-c:run-buy-agent', async (_event, date?: string) => {
    try {
        const { TrackCBuyAgent } = await import('./services/v2_agents/TrackCBuyAgent');
        const result = await TrackCBuyAgent.getInstance().run(date);
        return { success: result.success, saved: result.saved, skipped: result.skipped, error: result.error };
    } catch (error: any) {
        console.error('[TrackCBuyAgent] manual run error:', error);
        return { success: false, error: error.message };
    }
})

// [Track D] 당일 급등주 종가베팅 AI 수동 실행
ipcMain.handle('track-d:run-buy-agent', async (_event, date?: string) => {
    try {
        const { TrackDBuyAgent } = await import('./services/v2_agents/TrackDBuyAgent');
        const result = await TrackDBuyAgent.getInstance().run(date);
        return { success: result.success, saved: result.saved, skipped: result.skipped, error: result.error };
    } catch (error: any) {
        console.error('[TrackDBuyAgent] manual run error:', error);
        return { success: false, error: error.message };
    }
})

// [Track E] 단기 눌림목 종가베팅 AI 수동 실행
ipcMain.handle('track-e:run-buy-agent', async (_event, date?: string) => {
    try {
        const { TrackEBuyAgent } = await import('./services/v2_agents/TrackEBuyAgent');
        const result = await TrackEBuyAgent.getInstance().run(date);
        return { success: result.success, saved: result.saved, skipped: result.skipped, error: result.error };
    } catch (error: any) {
        console.error('[TrackEBuyAgent] manual run error:', error);
        return { success: false, error: error.message };
    }
})

// [Track B] 진입가 수동 확정 (장 마감 후 테스트용)
ipcMain.handle('track-b:update-entry-prices', async (_event, date?: string) => {
    try {
        const { TrackBBuyAgent } = await import('./services/v2_agents/TrackBBuyAgent');
        const updated = TrackBBuyAgent.getInstance().updateEntryPrices(date);
        return { success: true, updated };
    } catch (error: any) {
        console.error('[TrackBBuyAgent] update-entry-prices error:', error);
        return { success: false, error: error.message };
    }
})

// [Track B] 모의매매 성과 수동 채점
ipcMain.handle('track-b:score-performance', async (_event, date?: string) => {
    try {
        const { TrackBBuyAgent } = await import('./services/v2_agents/TrackBBuyAgent');
        const result = TrackBBuyAgent.getInstance().scoreDailyPerformance(date);
        return { success: true, ...result };
    } catch (error: any) {
        console.error('[TrackBBuyAgent] score-performance error:', error);
        return { success: false, error: error.message };
    }
})

// [Track B] 종목별 Gemma 리서치 리포트 조회 (종목 상세 모달 타임라인용)
ipcMain.handle('track-b:get-research-reports', async (_event, stock_code: string) => {
    try {
        const db = DatabaseService.getInstance();
        const reports = db.getStockResearchReports(stock_code, 30);
        return { success: true, reports };
    } catch (error: any) {
        console.error('[TrackB] get-research-reports error:', error);
        return { success: false, reports: [], error: error.message };
    }
})

// [Track B] 특정 일자의 데이터 전체 삭제
ipcMain.handle('track-b:delete-by-date', async (_event, date: string) => {
    try {
        const db = DatabaseService.getInstance();
        db.deleteTrackBDataByDate(date);
        return { success: true };
    } catch (error: any) {
        console.error('[TrackB] delete-by-date error:', error);
        return { success: false, error: error.message };
    }
})

// [SimTrade] 모의매매 개별 종목 삭제
ipcMain.handle('simtrade:delete-pick-by-id', async (_event, id: number, category: string) => {
    try {
        const db = DatabaseService.getInstance().getDb();
        const intId = Math.floor(id);
        
        // 어느 테이블에 있는지 먼저 찾기
        const tables = ['track_a_buy_picks', 'track_b_buy_picks', 'track_c_buy_picks', 'track_d_buy_picks', 'track_e_buy_picks'];
        let stockCode: string | null = null;
        let foundTable: string | null = null;
        
        for (const table of tables) {
            const row = db.prepare(`SELECT stock_code FROM ${table} WHERE id = ?`).get(intId) as any;
            if (row) {
                stockCode = row.stock_code;
                foundTable = table;
                console.log(`[SimTrade Delete] id=${intId} found in ${table}, stock_code=${stockCode}`);
                break;
            }
        }
        
        if (!stockCode) {
            console.warn(`[SimTrade Delete] id=${intId} not found in any table!`);
            return { success: false, error: `id=${intId} not found` };
        }
        
        // 해당 stock_code를 pick_date 기준으로 모든 테이블에서 삭제
        // (같은 날짜에 여러 테이블에 중복 존재할 수 있음)
        const pickDateRow = db.prepare(`SELECT pick_date FROM ${foundTable} WHERE id = ?`).get(intId) as any;
        const pickDate = pickDateRow?.pick_date;
        
        let totalDeleted = 0;
        for (const table of tables) {
            let info;
            if (pickDate) {
                info = db.prepare(`DELETE FROM ${table} WHERE stock_code = ? AND pick_date = ?`).run(stockCode, pickDate);
            } else {
                info = db.prepare(`DELETE FROM ${table} WHERE stock_code = ?`).run(stockCode);
            }
            if (info.changes > 0) {
                console.log(`[SimTrade Delete] ${table}: ${info.changes}건 삭제 (stock_code=${stockCode}, pick_date=${pickDate})`);
                totalDeleted += info.changes;
            }
        }
        
        console.log(`[SimTrade Delete] 완료: 총 ${totalDeleted}건 삭제`);
        return { success: true };
    } catch (error: any) {
        console.error('[SimTrade] delete-pick-by-id error:', error);
        return { success: false, error: error.message };
    }
})

// [Track B] 가이드라인 문서 읽기/쓰기
ipcMain.handle('track-b:get-guideline', async (_event, fileName: string) => {
    try {
        const filePath = path.join(process.cwd(), 'guidelines', fileName || 'track_b_phase1.md');
        if (require('fs').existsSync(filePath)) {
            const content = require('fs').readFileSync(filePath, 'utf-8');
            return { success: true, content };
        }
        return { success: true, content: '' };
    } catch (e: any) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('track-b:save-guideline', async (_event, data: { fileName: string, content: string }) => {
    try {
        const { fileName, content } = data;
        const dir = path.join(process.cwd(), 'guidelines');
        if (!require('fs').existsSync(dir)) {
            require('fs').mkdirSync(dir, { recursive: true });
        }
        require('fs').writeFileSync(path.join(dir, fileName || 'track_b_phase1.md'), content, 'utf-8');
        return { success: true };
    } catch (e: any) {
        return { success: false, error: e.message };
    }
});

// ═══ Project Moonshot (Ten-Bagger) ═══
ipcMain.handle('moonshot:get-active-tracking', async () => {
    try {
        const { DatabaseService } = await import('./services/DatabaseService');
        const db = DatabaseService.getInstance().getDb();
        const records = db.prepare(`
            SELECT 
                mat.*,
                COALESCE(
                    (SELECT close FROM market_ohlcv_history 
                     WHERE stock_code = REPLACE(mat.stock_code, 'A', '') 
                     ORDER BY date DESC LIMIT 1),
                    mat.current_price
                ) AS dynamic_current_price,
                mdr.daily_narrative AS latest_daily_narrative,
                mdr.verdict AS latest_verdict,
                mdr.reviewed_at AS latest_reviewed_at
            FROM moonshot_active_tracking mat
            LEFT JOIN (
                SELECT stock_code, daily_narrative, verdict, reviewed_at,
                       ROW_NUMBER() OVER(PARTITION BY stock_code ORDER BY reviewed_at DESC) as rn
                FROM moonshot_daily_review
            ) mdr ON mdr.stock_code = mat.stock_code AND mdr.rn = 1
            ORDER BY mat.created_at DESC
        `).all();
        
        // Map dynamic_current_price to current_price for UI consumption
        const processedRecords = records.map((r: any) => {
            const row = { ...r };
            row.current_price = row.dynamic_current_price;
            delete row.dynamic_current_price;
            return row;
        });

        return { success: true, data: processedRecords };
    } catch (error: any) {
        console.error('[Moonshot] get-active-tracking error:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('moonshot:delete-active-tracking', async (_event, stock_code: string) => {
    try {
        const { DatabaseService } = await import('./services/DatabaseService');
        const db = DatabaseService.getInstance().getDb();
        
        // 보관(Archive) 처리
        const stockInfo = db.prepare(`
            SELECT mat.*, mdr.daily_narrative, mdr.verdict
            FROM moonshot_active_tracking mat
            LEFT JOIN (
                SELECT stock_code, daily_narrative, verdict,
                       ROW_NUMBER() OVER(PARTITION BY stock_code ORDER BY reviewed_at DESC) as rn
                FROM moonshot_daily_review
            ) mdr ON mat.stock_code = mdr.stock_code AND mdr.rn = 1
            WHERE mat.stock_code = ?
        `).get(stock_code) as any;

        if (stockInfo) {
            const sellPrice = stockInfo.current_price || 0;
            const returnRate = stockInfo.entry_price > 0 ? ((sellPrice / stockInfo.entry_price) - 1) * 100 : 0;
            const success = returnRate > 0 ? 1 : 0;
            const finalNarrative = stockInfo.daily_narrative || '사용자에 의한 등재 취소 및 수동 폐기';

            db.prepare(`
                INSERT INTO moonshot_archive 
                (stock_code, stock_name, tag, original_thesis, bull_case, bear_case, entry_price, sell_price, return_rate, buy_date, sell_date, success, final_narrative)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'), ?, ?)
            `).run(
                stockInfo.stock_code,
                stockInfo.stock_name,
                stockInfo.tag,
                stockInfo.narrative,
                stockInfo.bull_case,
                stockInfo.bear_case,
                stockInfo.entry_price,
                sellPrice,
                returnRate,
                stockInfo.entry_date,
                success,
                finalNarrative
            );
        }

        const info = db.prepare('DELETE FROM moonshot_active_tracking WHERE stock_code = ?').run(stock_code);
        if (info.changes > 0) {
            console.log(`[Moonshot] Deleted and Archived Active Tracking stock: ${stock_code}`);
            return { success: true };
        }
        return { success: false, error: '삭제할 대상이 없습니다.' };
    } catch (error: any) {
        console.error('[Moonshot] delete-active-tracking error:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('moonshot:get-archive', async () => {
    try {
        const { DatabaseService } = await import('./services/DatabaseService');
        const db = DatabaseService.getInstance().getDb();
        return db.prepare('SELECT * FROM moonshot_archive ORDER BY sell_date DESC').all();
    } catch (error: any) {
        console.error('[Moonshot] get-archive error:', error);
        return [];
    }
});

// Settings Handlers
ipcMain.handle('moonshot:get-settings', () => {
    return store.get('moonshot_settings') || {
        scannerCronTime: '15:00',
        trackerCronTime: '15:30',
        enabled: true
    };
});

ipcMain.handle('moonshot:save-settings', (_event, settings) => {
    store.set('moonshot_settings', settings);
    // Reload scheduler logic
    schedulerService.initSchedules();
    return true;
});


ipcMain.handle('moonshot:enroll-active', async (_event, evaluationResult: any) => {
    try {
        const { DatabaseService } = await import('./services/DatabaseService');
        const db = DatabaseService.getInstance().getDb();
        const kiwoom = kiwoomService;

        // Fetch precise real-time price if possible
        let entryPrice = 0;
        try {
            const priceStr = await kiwoom.getCurrentPrice(evaluationResult.code.replace(/^A/, ''));
            if (priceStr) {
                entryPrice = Math.abs(parseInt(priceStr, 10)); // Price might have sign
            }
        } catch (e) {
            console.warn(`[Moonshot] Failed to fetch realtime price for ${evaluationResult.code}`);
        }

        const now = DatabaseService.getInstance().getKstTimestamp();
        
        db.prepare(`
            INSERT OR REPLACE INTO moonshot_active_tracking 
            (stock_code, stock_name, tag, tbp_score, mega_trend, bull_case, bear_case, milestones_json, invalidation_condition, entry_price, current_price, entry_date, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            evaluationResult.code,
            evaluationResult.name,
            evaluationResult.tag,
            evaluationResult.tbpScore,
            evaluationResult.megaTrend || '',
            evaluationResult.bullCase || '',
            evaluationResult.bearCase || '',
            JSON.stringify(evaluationResult.milestones || []),
            evaluationResult.invalidationCondition || '',
            entryPrice,
            entryPrice, // initial current price is the entry price
            now.split('T')[0],
            now,
            now
        );

        console.log(`[Moonshot] Enrolled Active Tracking: ${evaluationResult.name} at ${entryPrice} KRW`);
        return { success: true, entryPrice };
    } catch (error: any) {
        console.error('[Moonshot] enroll error:', error);
        return { success: false, error: error.message };
    }
});

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

// ═══ Track A: LeaderRegime 수급 레짐 IPC ═══

/** 수동 레짐 분석 실행 (오늘 날짜 기준) */
ipcMain.handle('track-a:run-regime-analysis', async (_event, date?: string) => {
    try {
        const { LeaderRegimeTracker } = await import('./services/v2_pipeline/LeaderRegimeTracker')
        const { DatabaseService } = await import('./services/DatabaseService')
        const db = DatabaseService.getInstance()
        const today = date || db.getKstDate()
        const tracker = new LeaderRegimeTracker(db)
        const result = await tracker.analyzeDailyRegime(today)
        return { success: true, data: result }
    } catch (error: any) {
        console.error('[TrackA] run-regime-analysis error:', error)
        return { success: false, error: error.message }
    }
})

/** 특정 날짜의 LeaderRegime 스냅샷 조회 (Track A 탭 표시용) */
ipcMain.handle('track-a:get-regime-snapshot', async (_event, params: {
    date?: string
    type?: 'THEME' | 'SECTOR'
    signals?: string[]
}) => {
    try {
        const { DatabaseService } = await import('./services/DatabaseService')
        const db = DatabaseService.getInstance()
        const today = params?.date || db.getKstDate()
        const result = db.getLeaderRegimeSnapshot(today, {
            type:    params?.type,
            signals: params?.signals,
        })
        return { success: true, data: result.data, date: result.date }
    } catch (error: any) {
        console.error('[TrackA] get-regime-snapshot error:', error)
        return { success: false, error: error.message, data: [] }
    }
})

/** 특정 테마/섹터의 30일 Regime 타임라인 (상세 패널용) */
ipcMain.handle('track-a:get-regime-timeline', async (_event, params: {
    type: string
    name: string
    days?: number
}) => {
    try {
        const { DatabaseService } = await import('./services/DatabaseService')
        const db = DatabaseService.getInstance()
        const data = db.getRegimeTimeline(params.type, params.name, params.days ?? 30)
        return { success: true, data }
    } catch (error: any) {
        console.error('[TrackA] get-regime-timeline error:', error)
        return { success: false, error: error.message, data: [] }
    }
})

ipcMain.handle('track-a:get-stock-candidates', async (_event, params?: { date?: string }) => {
    try {
        const { DatabaseService } = await import('./services/DatabaseService')
        const db = DatabaseService.getInstance()
        const today = params?.date || db.getKstDate()
        const data = (db as any).getTrackAStockCandidates ? (db as any).getTrackAStockCandidates(today) : []
        return { success: true, data }
    } catch (error: any) {
        console.error('[TrackA] get-stock-candidates error:', error)
        return { success: false, error: error.message, data: [] }
    }
})

ipcMain.handle('track-a:get-theme-stocks', async (_event, params: { name: string, date?: string }) => {
    try {
        const { DatabaseService } = await import('./services/DatabaseService')
        const db = DatabaseService.getInstance()
        const today = params?.date || db.getKstDate()
        const data = db.getThemeConstituentStocks(params.name, today)
        return { success: true, data }
    } catch (error: any) {
        console.error('[TrackA] get-theme-stocks error:', error)
        return { success: false, error: error.message, data: [] }
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

ipcMain.handle('naverflow:reset-themes', async () => {
    try {
        const { DatabaseService } = await import('./services/DatabaseService')
        const rawDb = (DatabaseService.getInstance() as any).db;
        rawDb.prepare('DELETE FROM mega_theme_ledger').run();
        return { success: true }
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
            try { source = item.originallink ? new URL(item.originallink).hostname.replace('www.', '') : 'Naver'; } catch (e) { }
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
        const allEdges = IssueLedgerDB.getInstance().getEdgesTo(targetType, targetId)
        // ISSUE 섹션에는 오직 ISSUE → 테마 연결만 표시 (THEME→THEME RELATE 엣지는 별도 섹션용)
        const issueEdges = allEdges.filter((e: any) => e.source_type === 'ISSUE')
        return { success: true, data: issueEdges }
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
ipcMain.on('copilot:chat', async (event, data: { message: string, mode: 'auto' | 'short' | 'detail' }) => {
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

ipcMain.handle('agent:market:detailed-stats', async () => {
    try {
        const { MarketConditionAgent } = await import('./services/v2_agents/MarketConditionAgent')
        const result = MarketConditionAgent.getInstance().getDetailedStats()
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
    console.log(`[Main] kiwoom:start-condition-search 수신 - seq: "${seq}"`)
    return kiwoomService.startConditionSearch(seq)
})

// === Moonshot APIs ===
ipcMain.handle('kiwoom:get-smart-money-flow', async (_event, stk_cd: string) => {
    return kiwoomService.getSmartMoneyFlow(stk_cd);
})

ipcMain.handle('kiwoom:get-fundamental-info', async (_event, stk_cd: string) => {
    return kiwoomService.getFundamentalInfo(stk_cd);
})

// === Telegram Settings IPC Handlers ===
ipcMain.handle('telegram:save-settings', async (_event, settings: any) => {
    try {
        if (settings && settings.botToken) {
            const { Telegraf } = require('telegraf')
            const tempBot = new Telegraf(settings.botToken)
            await tempBot.telegram.getMe() // Validate token
        }
        store.set('telegram_settings', settings)
        telegramService.reloadConfig()
        return { success: true }
    } catch (error: any) {
        console.error('[TelegramService] Telegram Token validation failed:', error.message)
        return { success: false, error: '유효하지 않은 텔레그램 봇 토큰입니다. 올바른 토큰인지 확인해주세요.' }
    }
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

ipcMain.handle('run-image-analysis-test', async () => {
    try {
        const { ChartRenderService } = await import('./services/ChartRenderService');
        const { LocalAiService } = await import('./services/LocalAiService');

        console.log('[ImageTest] 📸 KODEX 200 차트 이미지 캡처 렌더링 시작...');
        const imageBuffer = await ChartRenderService.captureChart('069500', 'KODEX 200', 'dark');
        
        // 디버깅용으로 이미지 파일 저장
        const fs = await import('node:fs/promises');
        const path = await import('node:path');
        const debugImgPath = path.join(process.cwd(), 'debug_chart_capture.png');
        await fs.writeFile(debugImgPath, imageBuffer);
        const clickableLink = `file:///${debugImgPath.replace(/\\/g, '/')}`;
        console.log(`[ImageTest] 🛠️ 디버깅용 캡처 이미지 저장 완료! (Ctrl+Click으로 열기)`);
        console.log(`🔗 링크: ${clickableLink}`);

        const base64Image = imageBuffer.toString('base64');
        console.log('[ImageTest] ✅ 차트 캡처 완료 (Base64 길이: ' + base64Image.length + ')');

        const prompt = `이 이미지는 주식(KODEX 200)의 차트 시각화 화면 캡처본입니다.
화면은 위아래 두 개의 차트로 분할되어 있습니다:
- 상단 차트: **일간 추세 (Daily)**
- 하단 차트: **장중 당일 흐름 (5-Min)**

우리는 오늘 당일 1~2% 단기 수익을 목표로 하는 '장중 단기 트레이딩'을 진행합니다.
다음 내용들을 중점적으로 확인하고 한글로 팩트만 짧고 날카롭게 브리핑하십시오:

1. [일봉(Daily) 관점 - 20% 비중]
   - 캔들이 이동평균선(기준선) 위에서 지지받고 있는지, 역배열 폭락중인지?

2. [5분봉(5-Min) 관점 - 80% 비중 (가장 중요함)]
   - 오늘 장 시작 후 당일 추세가 상승(돌파)중인지, 저항에 막혀 하락중인지?
   - 5분봉 하단에 폭발적인 대량 거래량이 터지면서 누군가(세력)가 개입한 흔적이 있는지?
   - 총평: 현재 이 종목을 '장중 매수(LONG)' 하는 것이 유리한지, 아니면 '관망(HOLD) / 매도(SHORT)'가 유리한지 당신의 직관적인 판단은?`;

        const messages = [
            {
                role: "user",
                content: [
                    { type: "text", text: prompt },
                    { type: "image_url", image_url: { url: `data:image/png;base64,${base64Image}` } }
                ]
            }
        ];

        console.log('[ImageTest] 🤖 Local AI(Gemma Vision API) 타겟으로 데이터 전송 중...');
        // askLocalAi의 4번째 인자 customMessages를 사용하여 멀티모달 객체 전송
        const result = await LocalAiService.getInstance().askLocalAi(
            "", 
            "당신은 엘리트 프라이스액션 차트 분석가입니다. 차트 캡처본의 패턴을 시각적으로 읽어냅니다.", 
            undefined, 
            messages
        );

        console.log('[ImageTest] 🎯 분석 완료:\n', result);
        return result;
    } catch (err: any) {
        console.error('[ImageTest] Error:', err);
        throw new Error(`이미지 테스트 파이프라인 에러: ${err.message}`);
    }
});

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

// ── Moonshot IPC Handlers ──
ipcMain.handle('moonshot:validate-stocks', async (event, stocks: any[], ignoreCooldown: boolean = false) => {
    try {
        const { MoonshotValidationAgent } = await import('./services/v2_agents/MoonshotValidationAgent');
        const agent = MoonshotValidationAgent.getInstance();
        const results = await agent.runValidation(stocks, win || undefined, ignoreCooldown);
        return { success: true, data: results };
    } catch (err: any) {
        return { success: false, error: err.message };
    }
});

ipcMain.handle('moonshot:run-daily-tracker', async () => {
    try {
        const { MoonshotTrackerAgent } = await import('./services/v2_agents/MoonshotTrackerAgent');
        const results = await MoonshotTrackerAgent.getInstance().runDailyReview(win || undefined);
        return { success: true, data: results };
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

// ── 개별 항목 삭제 IPC ────────────────────────────────────────────────────────

ipcMain.handle('ai-analyst:delete-portfolio-item', async (_event, id: number) => {
    try {
        const { DatabaseService } = await import('./services/DatabaseService')
        return DatabaseService.getInstance().deletePortfolioItem(id)
    } catch (err: any) {
        return { deleted: false, error: err.message }
    }
})

ipcMain.handle('ai-analyst:delete-trade-history-item', async (_event, id: number) => {
    try {
        const { DatabaseService } = await import('./services/DatabaseService')
        return DatabaseService.getInstance().deleteTradeHistoryItem(id)
    } catch (err: any) {
        return { deleted: false, error: err.message }
    }
})

ipcMain.handle('ai-analyst:run-performance-optimizer', async (_event, picks: any[]) => {
    try {
        const { DatabaseService } = await import('./services/DatabaseService')
        return DatabaseService.getInstance().runPerformanceOptimizer(picks)
    } catch (err: any) {
        return { deleted: false, error: err.message }
    }
})

ipcMain.handle('ai-analyst:delete-event-log', async (_event, id: number) => {
    try {
        const { DatabaseService } = await import('./services/DatabaseService')
        return DatabaseService.getInstance().deletePortfolioEventLog(id)
    } catch (err: any) {
        return { deleted: false, error: err.message }
    }
})

ipcMain.handle('ai-analyst:delete-pick', async (_event, id: number) => {
    try {
        const { DatabaseService } = await import('./services/DatabaseService')
        return DatabaseService.getInstance().deleteAnalystPick(id)
    } catch (err: any) {
        return { deleted: false, error: err.message }
    }
})

ipcMain.handle('incubator:delete-item', async (_event, stock_code: string) => {
    try {
        const { DatabaseService } = await import('./services/DatabaseService')
        return DatabaseService.getInstance().deleteIncubatorItem(stock_code)
    } catch (err: any) {
        return { deleted: false, error: err.message }
    }
})

ipcMain.handle('ai-analyst:sync-entry-price', async (_event, stock_code: string, price: number, entry_date: string) => {
    try {
        console.log(`[Main] sync-entry-price called for ${stock_code} at ${price} (date: ${entry_date})`)
        const { DatabaseService } = await import('./services/DatabaseService')
        return DatabaseService.getInstance().syncPortfolioEntryPrice(stock_code, price, entry_date)
    } catch (e: any) {
        return { success: false, error: e.message }
    }
})

// ═══ Mega Theme Ledger IPC Handlers ═══

ipcMain.handle('mega-theme:get-ledger', async () => {
    try {
        const { DatabaseService } = await import('./services/DatabaseService')
        const rows = DatabaseService.getInstance().getMegaThemeLedger()
        // JSON 필드 파싱
        return rows.map((r: any) => ({
            ...r,
            sub_themes:      tryParse(r.sub_themes_json, []),
            selected_stocks: tryParse(r.selected_stocks_json, []),
            daily_log:       tryParse(r.daily_log_json, []),
        }))
    } catch (e: any) {
        return []
    }
})

ipcMain.handle('mega-theme:get-detail', async (_event, name: string) => {
    try {
        const { DatabaseService } = await import('./services/DatabaseService')
        const db = DatabaseService.getInstance()
        const row = db.getMegaThemeByName(name)
        if (!row) return null
        const subThemes = tryParse(row.sub_themes_json, []) as any[]
        // 각 하위 테마의 최신 theme_intelligence 조회
        const rawDb = (db as any).db
        const enriched = subThemes.map((st: any) => {
            const intel = rawDb.prepare(`
                SELECT reason, lifespan_type FROM theme_intelligence
                WHERE name = ? ORDER BY date DESC LIMIT 1
            `).get(st.name)
            return { ...st, intel }
        })
        return {
            ...row,
            sub_themes:      enriched,
            selected_stocks: tryParse(row.selected_stocks_json, []),
            daily_log:       tryParse(row.daily_log_json, []),
        }
    } catch (e: any) {
        return null
    }
})

ipcMain.handle('mega-theme:run-builder', async (_event, _mode?: string) => {
    // 진행 상태를 렌더러로 push하는 헬퍼
    const sendProgress = (step: string, detail?: string) => {
        const sender = _event.sender
        if (!sender.isDestroyed()) {
            sender.send('mega-theme:progress', { step, detail, ts: Date.now() })
        }
    }

    try {
        sendProgress('STARTING', '당일 메가 테마 분석 시작...')
        const { ThemeContextBuilder } = await import('./services/v2_agents/ThemeContextBuilder')
        const builder = ThemeContextBuilder.getInstance()

        sendProgress('DB_QUERY', '시장 데이터 수집 중...')
        // v2: 항상 당일 데이터만 분석 (Backfill 폐지)
        const result = await builder.runDaily()
        sendProgress('DONE', `메가 테마 집계 완료 (${result.processed}건)`)
        return { success: true, ...result }
    } catch (e: any) {
        sendProgress('ERROR', e.message)
        return { success: false, error: e.message }
    }
})

ipcMain.handle('mega-theme:get-ai-config', async () => {
    try {
        const { getMegaThemeAiConfig } = await import('./services/v2_agents/ThemeContextBuilder')
        return getMegaThemeAiConfig()
    } catch (e: any) {
        return { targetType: 'gemini' }
    }
})

ipcMain.handle('mega-theme:set-ai-config', async (_event, config: { targetType: 'gemini' | 'local' }) => {
    try {
        const { setMegaThemeAiConfig } = await import('./services/v2_agents/ThemeContextBuilder')
        setMegaThemeAiConfig(config)
        return { success: true }
    } catch (e: any) {
        return { success: false, error: e.message }
    }
})

ipcMain.handle('mega-theme:check-local-ai', async () => {
    try {
        const { LocalAiService } = await import('./services/LocalAiService')
        return await LocalAiService.getInstance().checkServerStatus()
    } catch (e: any) {
        return { isOnline: false, models: [], error: e.message }
    }
})


ipcMain.handle('mega-theme:get-briefing', async () => {
    try {
        const { DatabaseService } = await import('./services/DatabaseService')
        const db = DatabaseService.getInstance()
        const rows = db.getMegaThemeLedger()
        const active = rows
            .filter((r: any) => !['DORMANT', 'FADING'].includes(r.status))
            .slice(0, 5)
        const lines = active.map((r: any, i: number) =>
            `${i + 1}. [${r.status}] ${r.mega_theme_name} — ${r.core_narrative?.slice(0, 60) ?? ''}...`
        )
        return {
            briefing: lines.join('\n'),
            updated_at: active[0]?.updated_at ?? null,
            count: active.length,
        }
    } catch (e: any) {
        return { briefing: '', count: 0, error: e.message }
    }
})

function tryParse<T>(str: string, fallback: T): T {
    try { return JSON.parse(str) as T } catch { return fallback }
}

