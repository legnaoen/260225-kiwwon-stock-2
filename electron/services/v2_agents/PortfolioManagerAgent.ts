import { AiExecutionQueue } from '../AiExecutionQueue';
import { DatabaseService } from '../DatabaseService';
import { KiwoomService } from '../KiwoomService';
import { TechnicalAnalyzer } from './TechnicalAnalyzer';
import { StockSignalBuilder } from '../v2_pipeline/StockSignalBuilder';
import Store from 'electron-store';

const store = new Store();

export class PortfolioManagerAgent {
    private static instance: PortfolioManagerAgent;
    private db: DatabaseService;

    private constructor() {
        this.db = DatabaseService.getInstance();
    }

    public static getInstance(): PortfolioManagerAgent {
        if (!PortfolioManagerAgent.instance) {
            PortfolioManagerAgent.instance = new PortfolioManagerAgent();
        }
        return PortfolioManagerAgent.instance;
    }

    public async runDailyReview(targetDate?: string) {
        const newPicks = await this.runPhase1_Screening(targetDate);
        return await this.runPhase2_Rebalancing(targetDate, newPicks);
    }

    public async runPhase1_Screening(targetDate?: string) {
        const dateStr = targetDate || this.db.getKstDate();
        const fs = require('fs');
        const logPath = require('path').join(require('electron').app.getPath('userData'), 'pm1_debug.log');
        const log = (msg: string) => {
            const line = `[${new Date().toISOString()}] ${msg}\n`;
            console.log(msg);
            try { fs.appendFileSync(logPath, line); } catch (_) { }
        };

        log(`===== PM1 시작: dateStr=${dateStr} =====`);

        try {
            const todaysPicks = this.db.getAiAnalystPicksByDate(dateStr) as any[];
            log(`[1] getAiAnalystPicksByDate(${dateStr}) = ${todaysPicks?.length ?? 'null'}개`);

            if (!todaysPicks || todaysPicks.length === 0) {
                log('[1-EARLY] 추천주 없음, 종료');
                return null;
            }

            const activePortfolio = this.db.getActivePortfolio() as any[];
            log(`[2] getActivePortfolio() = ${activePortfolio.length}개 (${activePortfolio.map((p: any) => p.stock_code).join(',')})`);

            const activeCodeSet = new Set(activePortfolio.map((p: any) => p.stock_code));
            const newPicks = todaysPicks.filter((p: any) => !activeCodeSet.has(p.stock_code));
            log(`[3] newPicks(기존 제외 후) = ${newPicks.length}개`);

            if (newPicks.length === 0) {
                log('[3-EARLY] 신규 종목 없음, 종료');
                return null;
            }

            const aiSettings: any = store.get('ai_settings') || {};
            const phase1PassLimit: number = aiSettings.phase1PassLimit ?? 10;
            log(`[4] phase1PassLimit = ${phase1PassLimit}`);

            const byCategory: Record<string, any[]> = {};
            newPicks.forEach((pick: any) => {
                const cat = pick.agent_type || 'MOMENTUM';
                if (!byCategory[cat]) byCategory[cat] = [];
                byCategory[cat].push(pick);
            });
            Object.values(byCategory).forEach(arr =>
                arr.sort((a: any, b: any) => (b.confidence || 0) - (a.confidence || 0))
            );
            log(`[5] byCategory keys = ${Object.keys(byCategory).join(',')}`);

            const selectedPicks: any[] = [];
            const categories = Object.keys(byCategory);
            let changed = true;
            while (selectedPicks.length < phase1PassLimit && changed) {
                changed = false;
                for (const cat of categories) {
                    if (selectedPicks.length >= phase1PassLimit) break;
                    if (byCategory[cat].length > 0) {
                        selectedPicks.push(byCategory[cat].shift());
                        changed = true;
                    }
                }
            }
            log(`[6] selectedPicks = ${selectedPicks.length}개 (${selectedPicks.map((p: any) => p.stock_code).join(',')})`);

            const evalPool: Record<string, any> = {};
            selectedPicks.forEach((pick: any) => {
                if (!evalPool[pick.stock_name]) {
                    evalPool[pick.stock_name] = {
                        stock_code: pick.stock_code,
                        stock_name: pick.stock_name,
                        source: 'NEW_PICK',
                        analysts: [],
                        today_analysts: []
                    };
                }
                evalPool[pick.stock_name].today_analysts.push({
                    agent: pick.agent_type,
                    reason: pick.reason,
                    confidence: pick.confidence
                });
            });

            const stockList = Object.values(evalPool);
            log(`[7] evalPool = ${stockList.length}개, 저장 시작`);

            let savedCount = 0;
            for (const pick of stockList as any[]) {
                try {
                    this.db.upsertPortfolioWatchlist({
                        stock_code: pick.stock_code,
                        stock_name: pick.stock_name,
                        status: 'WATCHLIST',
                        strategy: 'SWING',
                        conviction_score: 50,
                        analysts_json: pick.today_analysts.map((a: any) => a.agent),
                        last_signal_reason: '[PM 1차 오디션 수집] 2차 통합 심사 대기 중'
                    }, true);
                    savedCount++;
                    log(`[7-OK] upsert 성공: ${pick.stock_code} ${pick.stock_name}`);
                } catch (upsertErr: any) {
                    log(`[7-ERR] upsert 실패: ${pick.stock_code} ${pick.stock_name} → ${upsertErr.message}`);
                }
            }

            log(`[8] PM1 완료: ${savedCount}/${stockList.length}개 저장 성공`);
            return stockList;
        } catch (e: any) {
            log(`[ERROR] PM1 전체 에러: ${e.message}\n${e.stack}`);
            try {
                const { TelegramService } = await import('../TelegramService');
                TelegramService.getInstance().sendMessage(`❌ [PM1] 1차 스크리닝 실패: ${e.message}`);
            } catch (_) { }
            return null;
        }
    }

    public async runPhase2_Rebalancing(targetDate?: string, newPicksParams?: any[]) {
        const kiwoomSvc = KiwoomService.getInstance();

        // --- Resilience Phase 3: 핵심 배치 크론들의 서스펜드(Suspend) & 자동 복구 ---
        if (kiwoomSvc.isCircuitBroken()) {
            const kstHour = new Date().getHours();
            if (kstHour >= 9 && kstHour <= 15) { // 장중 시간대
                console.warn(`[PortfolioManager] 🚨 장중 서킷 브레이커 발동 감지. 5분 뒤로 리뷰를 지연(Suspend)합니다.`);
                try {
                    const { SchedulerService } = await import('../SchedulerService');
                    const { eventBus } = await import('../../utils/EventBus');

                    eventBus.emit('system:error' as any, {
                        message: `[포트폴리오 AI] 키움 API 서킷 브레이커로 인해 모니터링이 5분 지연됩니다.`,
                        code: 'KIWOOM_CIRCUIT_BROKEN',
                        time: new Date().toLocaleTimeString('ko-KR')
                    });

                    SchedulerService.getInstance().scheduleOnceFallback(
                        '포트폴리오 매니저 (서킷 브레이커 지연)',
                        5 * 60 * 1000,
                        async () => {
                            await PortfolioManagerAgent.getInstance().runDailyReview(targetDate);
                        }
                    );
                } catch (e) { }
                return null;
            } else {
                console.warn(`[PortfolioManager] ⚠️ 서킷 브레이커가 감지되었으나, 장마감 이후이므로 Fallback 모드로 리뷰를 강행합니다.`);
            }
        }

        const dateStr = targetDate || this.db.getKstDate();
        console.log(`[PortfolioManager] 🧑‍💼 ${dateStr} 종목 관리 AI(펀드매니저) 리뷰 시작...`);

        try {
            const rawDb = (this.db as any).db;

            // Clean up potentially corrupted stock codes caused by LLM hallucinations
            try {
                const info = rawDb.prepare("DELETE FROM maiis_portfolio WHERE length(stock_code) != 6 OR stock_code GLOB '*[^0-9]*'").run();
                if (info.changes > 0) {
                    console.log(`[PortfolioManager] 🧹 이전에 잘못 생성된 가비지 종목 ${info.changes}개 정리 완료`);
                }
            } catch (e: any) {
                console.warn(`[PortfolioManager] 정리 스크립트 실행 중 에러 (무시): ${e.message}`);
            }

            // 1. Fetch existing active portfolio
            const activePortfolio = this.db.getActivePortfolio() as any[];

            // ── [Pre-refresh] PM2 실행 전 보유 종목 당일 현재가/수익률 DB 갱신 ─────────────────
            // 문제: AI 프롬프트에 삽입되는 profit_rate가 전날 15:41 채점(PortfolioJudgeScheduler) 기준값이었음.
            // 해결: PM2 직전에 HELD 종목을 키움 API로 사전 조회하여 DB & 인메모리값을 실시간값으로 덮어씀.
            //       이후 evalPool 구성 시 p.profit_rate가 당일 실시간 수익률로 전달됩니다.
            const heldStocks = activePortfolio.filter((p: any) => p.status === 'HELD' || p.status === 'HOLDING');
            if (heldStocks.length > 0) {
                console.log(`[PortfolioManager] 📊 [Pre-refresh] ${heldStocks.length}개 보유종목 당일 현재가 갱신 시작...`);
                const rawDb = (this.db as any).db;
                for (const stock of heldStocks) {
                    try {
                        const priceInfo = await kiwoomSvc.getStockBasicInfo(stock.stock_code);
                        const body = priceInfo?.Body || priceInfo?.out1 || priceInfo || {};
                        const rawCur = String(body.stk_prc || body.cur_prc || body.stck_prpr || body.currentPrice || 0).replace(/[^0-9-]/g, '');
                        const curPrice = Math.abs(parseInt(rawCur, 10)) || 0;
                        if (curPrice > 0 && stock.entry_price > 0) {
                            const profitRate = ((curPrice - stock.entry_price) / stock.entry_price) * 100;
                            rawDb.prepare(
                                `UPDATE maiis_portfolio SET current_price = ?, profit_rate = ?, updated_at = ? WHERE stock_code = ?`
                            ).run(curPrice, profitRate, this.db.getKstTimestamp(), stock.stock_code);
                            // 인메모리 activePortfolio 배열도 즉시 반영 (evalPool 구성 및 프롬프트에 사용됨)
                            stock.current_price = curPrice;
                            stock.profit_rate = profitRate;
                            console.log(`[PortfolioManager]   ✅ ${stock.stock_name}(${stock.stock_code}): ${curPrice.toLocaleString()}원 / ${profitRate > 0 ? '+' : ''}${profitRate.toFixed(2)}%`);
                        } else if (curPrice > 0) {
                            // entry_price가 없는 신규 편입 종목: current_price만 갱신
                            rawDb.prepare(
                                `UPDATE maiis_portfolio SET current_price = ?, updated_at = ? WHERE stock_code = ?`
                            ).run(curPrice, this.db.getKstTimestamp(), stock.stock_code);
                            stock.current_price = curPrice;
                        }
                        await new Promise(r => setTimeout(r, 300)); // API Rate limit 보호
                    } catch (e: any) {
                        console.warn(`[PortfolioManager]   ⚠️ ${stock.stock_name} 가격 갱신 실패 (기존 DB값 유지):`, e.message);
                    }
                }
                console.log(`[PortfolioManager] ✅ [Pre-refresh] 보유종목 현재가/수익률 갱신 완료`);
            }

            // 2. Group ALL stocks for evaluation (Dossier Pool)
            // 통함 풀 구성: 기존 보유 + 기존 관심 + 1차 취합 신규 추천주
            const evalPool: Record<string, any> = {};
            const codeMap: Record<string, string> = {}; // To sanitize LLM hallucinations

            // Add existing portfolio
            activePortfolio.forEach(p => {
                if (p.stock_name && p.stock_code) {
                    codeMap[p.stock_name] = p.stock_code;
                    evalPool[p.stock_name] = {
                        stock_code: p.stock_code,
                        stock_name: p.stock_name,
                        source: 'PORTFOLIO',
                        status: p.status,
                        profit_rate: p.profit_rate,
                        conviction_score: p.conviction_score,
                        analysts: JSON.parse(p.analysts_json || '[]')
                    };
                }
            });

            // ─── 신규 추천주 주입 ────────────────────────────────────────────────
            // (A) runDailyReview()로 순차 실행 시 PM1 결과물이 직접 전달됨
            if (newPicksParams && newPicksParams.length > 0) {
                newPicksParams.forEach((p: any) => {
                    codeMap[p.stock_name] = p.stock_code;
                    evalPool[p.stock_name] = {
                        stock_code: p.stock_code,
                        stock_name: p.stock_name,
                        source: 'NEW_PICK',
                        status: 'NEW',
                        profit_rate: 0,
                        conviction_score: 50,
                        analysts: p.today_analysts || []
                    };
                });
            } else {
                // (B) Fallback: 스케줄러 단독 호출 또는 PM1 실패 시 DB에서 직접 당일 WATCHLIST 종목 조회
                // getActivePortfolio()가 이미 WATCHLIST를 포함하므로 source만 NEW_PICK으로 교정
                const activeCodes = new Set(activePortfolio.map((p: any) => p.stock_code));

                // [Phase 2] 당일 HELD→DROPPED 이력 종목 재진입 차단
                // 오전 PM2에서 이미 매도 처리된 종목이 14:05 미니 리뷰에서 "신규 추천"으로 부활하는 경로 봉쇄
                const todayDroppedCodes = this.db.getTodayHeldDroppedCodes(dateStr);

                const todayPicksFallback = this.db.getAiAnalystPicksByDate(dateStr) as any[];
                const newPicksFallback = todayPicksFallback.filter((p: any) =>
                    !activeCodes.has(p.stock_code) &&
                    !todayDroppedCodes.has(p.stock_code)  // 당일 DROP 종목 재진입 차단
                );

                if (todayDroppedCodes.size > 0 && todayPicksFallback.length !== newPicksFallback.length) {
                    console.log(`[PortfolioManager] 🚫 당일 DROP 종목 재진입 차단: ${Array.from(todayDroppedCodes).join(', ')}`);
                }


                if (newPicksFallback.length > 0) {
                    const byCode: Record<string, any> = {};
                    newPicksFallback.forEach((p: any) => {
                        if (!byCode[p.stock_code]) {
                            byCode[p.stock_code] = {
                                stock_code: p.stock_code,
                                stock_name: p.stock_name,
                                source: 'NEW_PICK',
                                status: 'NEW',
                                profit_rate: 0,
                                conviction_score: p.confidence || 50,
                                analysts: [{ agent: p.agent_type, reason: p.reason, confidence: p.confidence }]
                            };
                        }
                    });
                    Object.values(byCode).forEach((p: any) => {
                        if (!evalPool[p.stock_name]) {
                            codeMap[p.stock_name] = p.stock_code;
                            evalPool[p.stock_name] = p;
                        }
                    });
                    console.log(`[PortfolioManager] 📥 PM1 Fallback: DB에서 신규 추천주 ${Object.keys(byCode).length}개 직접 로드`);
                }
            }

            // ─── P3-4: IGNITE 종목 강제 주입 ────────────────────────────────────
            // neglect_score 80+ 달성 후 READY_TO_IGNITE 상태인 인큐베이터 종목을 evalPool에 강제 삽입
            const igniteList = this.db.getIncubatorList('READY_TO_IGNITE') as any[];
            if (igniteList.length > 0) {
                console.log(`[PortfolioManager] 🔥 IGNITE 후보 ${igniteList.length}개 evalPool 강제 주입`);
                igniteList.forEach(inc => {
                    if (inc.stock_code && inc.stock_name && !evalPool[inc.stock_name]) {
                        codeMap[inc.stock_name] = inc.stock_code;
                        evalPool[inc.stock_name] = {
                            stock_code: inc.stock_code,
                            stock_name: inc.stock_name,
                            source: 'INCUBATOR_IGNITE',
                            status: 'WATCHLIST',
                            profit_rate: 0,
                            conviction_score: inc.neglect_score,
                            analysts: [{
                                agent: 'INCUBATOR',
                                reason: inc.source_context || '인큐베이터 감시 후 IGNITE 신호 발생',
                                confidence: inc.neglect_score,
                                date: inc.updated_at
                            }]
                        };
                    }
                    // GRADUATED 처리 (PM 평가 대상에 편입됨을 기록)
                    this.db.graduateIncubator(inc.stock_code);
                });
            }

            // 4. 종목별 종합 팩트시트(Dossier) 수집
            const analyzer = new TechnicalAnalyzer(kiwoomSvc);
            const stockList = Object.values(evalPool) as any[];
            const { IssueLedgerDB } = await import('./IssueLedgerDB');
            const issueDb = IssueLedgerDB.getInstance();
            const dossiersMap: Record<string, string> = {};
            const signalBuilder = StockSignalBuilder.getInstance();

            for (let i = 0; i < stockList.length; i += 2) {
                const chunk = stockList.slice(i, i + 2);
                await Promise.all(chunk.map(async (s: any) => {
                    // A. Chart Digest
                    try {
                        s.chart_digest = await analyzer.generateStockDigest(s.stock_code, s.stock_name, 200);
                    } catch (e: any) {
                        s.chart_digest = `[${s.stock_name}] 차트 데이터 응답 없음 (장애/비상 모드)`;
                    }

                    // B. Theme/Sector Intelligence fetching
                    try {
                        const tags = rawDb.prepare("SELECT tag_name FROM stock_theme_tags WHERE stock_code = ?").all(s.stock_code) as any[];
                        if (tags.length > 0) {
                            // 1) Get Intelligence Context (Theme AI Reasoning)
                            const tagNames = tags.map((t: any) => t.tag_name);
                            const placeholders = tagNames.map(() => '?').join(',');
                            const intelList = rawDb.prepare(`SELECT name, type, reason FROM theme_intelligence WHERE name IN (${placeholders}) ORDER BY created_at DESC LIMIT 3`).all(...tagNames) as any[];
                            s.theme_sector_context = intelList.map((intel: any) => `[${intel.type}] ${intel.name}: ${intel.reason}`).join('\n');

                            // 2) Get Issue Edges (Issue Ledger)
                            const issues: any[] = [];
                            tagNames.forEach((tag: string) => {
                                issues.push(...issueDb.getEdgesTo('THEME', tag));
                                issues.push(...issueDb.getEdgesTo('SECTOR', tag));
                            });
                            // Deduplicate issues by issue_id
                            const uniqueIssues = new Map();
                            issues.forEach(edge => uniqueIssues.set(edge.source_id, edge.logical_path));
                            s.issue_context = Array.from(uniqueIssues.entries()).map(([id, path]) => `- 이슈거리: ${id} (경로: ${path || '직접 매핑됨'})`).join('\n');
                        } else {
                            s.theme_sector_context = '배정된 테마/섹터 없음';
                            s.issue_context = '연결된 핵심 이슈 없음';
                        }
                    } catch (e) {
                        s.theme_sector_context = '조회 실패';
                        s.issue_context = '조회 실패';
                    }

                    // C. Build specific stock dossier text
                    let ds = `=================================================\n`;
                    ds += `[${s.stock_name} (${s.stock_code})] 📌 소속풀: ${s.source === 'PORTFOLIO' ? '기존 보유/관심종목' : s.source === 'NEW_PICK' ? '금일 신규 추천' : '기존 종목 + 금일 중복 추천'}\n`;
                    if (s.status) ds += `현재 상태: ${s.status} / 현재가: ${(s.current_price || 0).toLocaleString()}원 / 현재 수익률: ${(s.profit_rate || 0) > 0 ? '+' : ''}${Number(s.profit_rate || 0).toFixed(2)}% [당일 실시간 기준]\n`;
                    ds += `-------------------------------------------------\n`;

                    const analysisTimeline = DatabaseService.getInstance().getStockAnalysis(s.stock_code);
                    ds += `[과거~현재 AI 분석 리포트 통합 타임라인 (최신순)]\n`;
                    if (analysisTimeline && analysisTimeline.length > 0) {
                        // 타임라인 내역을 문자열로 결합 (서브 AI의 편향성 배제를 위해 스코어 미제공)
                        ds += analysisTimeline.map(a =>
                            `- [${a.date}] ${a.agent_type} (분석 및 추천 사유): ${a.reason}`
                        ).join('\n') + '\n';
                    } else {
                        ds += `기록된 AI 분석 이력 없음\n`;
                    }

                    ds += `-------------------------------------------------\n`;
                    ds += `[거시 경제 및 테마/섹터 배경 (과거 누적 이력)]\n> 핵심 이슈:\n${s.issue_context}\n\n> 테마/섹터 AI 브리핑:\n${s.theme_sector_context}\n`;
                    ds += `-------------------------------------------------\n`;
                    ds += `[기술적 차트 진단 (MA200)]\n${s.chart_digest}\n`;

                    // D. 수급·재무·신용 통합 신호 (StockSignalBuilder — 카테고리별 1차 가공)
                    // primaryCategory는 이후 단계에서 결정되므로 현재 evalPool의 agents 기준으로 추론
                    try {
                        const agentTypes: string[] = (s.analysts || s.today_analysts || [])
                            .map((a: any) => (a.agent || '').toUpperCase());
                        const AGENT_PRIORITY = ['REPORT', 'PULLBACK', 'THEME', 'MOMENTUM'];
                        const inferredCategory = AGENT_PRIORITY.find(p => agentTypes.includes(p)) ?? 'MOMENTUM';

                        const signalBlock = await signalBuilder.buildSignals(
                            s.stock_code,
                            s.stock_name,
                            inferredCategory
                        );
                        if (signalBlock) {
                            ds += `-------------------------------------------------\n`;
                            ds += signalBlock;
                        }
                    } catch (sigErr: any) {
                        console.warn(`[StockSignalBuilder] ${s.stock_name} 신호 생성 실패 (무시):`, sigErr.message);
                    }

                    s.dossier = ds;
                    dossiersMap[s.stock_name] = ds;
                }));
                // Rate Limit 방지 딜레이 (FinanceInfoCollector가 있는 REPORT 종목은 추가 딜레이 불필요 — Python 프록시가 이미 직렬 처리)
                if (i + 2 < stockList.length) await new Promise(r => setTimeout(r, 400));
            }

            // --- Resilience Phase 2: EventBus & AI Prompt Injection ---
            let sysConditionMsg = "";
            if (kiwoomSvc.isCircuitBroken()) {
                sysConditionMsg = "\n[🚨시스템 상태: 실시간 시세 및 차트 서버 연결 장애 발동 중]\n현재 증권사 API 장애로 인해 최신 호가와 차트 데이터를 받아올 수 없습니다. 따라서 무리하게 공격적인 IMMEDIATE_BUY 신호를 내리는 것을 지양하고, 관망(WATCHLIST) 또는 HOLD 위주로 보수적인(Defensive) 판정을 내리십시오.\n";
            }

            // --- AI Skill Injection: 대장주 추천 가이드 (구 SKILL.md) ---
            let chartRiskSkill = '';
            try {
                const fs = require('fs');
                const path = require('path');
                chartRiskSkill = fs.readFileSync(path.join(process.cwd(), '.agents/skills/leader_stock_guide/대장주_추천_가이드.md'), 'utf-8');
            } catch (e) {
                console.warn('[PortfolioManager] ⚠️ 대장주 추천 가이드(대장주_추천_가이드.md)를 읽을 수 없습니다. 기본 룰 적용.');
                chartRiskSkill = "대장주 위주의 초강세 모멘텀 매매를 지향하라.";
            }

            // 5. 시장 맥락 데이터 수집 (Alpha + 이슈 브리핑)
            let marketContextBlock = '';

            // 5-A. MarketLeader Alpha Top 15 조회 (전일 기준 10일 알파)
            try {
                const { MarketLeaderDiscoveryService } = await import('../v2_pipeline/MarketLeaderDiscoveryService');
                const leaders = MarketLeaderDiscoveryService.getInstance().getMarketLeaders(10, 0, 15);
                if (leaders && leaders.length > 0) {
                    marketContextBlock += `#### 📈 전일 기준 시장 주도주 Alpha Top ${leaders.length} (10일 누적 시장초과수익률)\n`;
                    leaders.forEach((l, idx) => {
                        const themes = l.relatedThemes.slice(0, 2).join(', ') || '테마 미분류';
                        marketContextBlock += `${idx + 1}위. ${l.stockName}(${l.stockCode}) — Alpha +${l.marketAlpha.toFixed(1)}% / 누적 ${l.totalChangeRate.toFixed(1)}% [${themes}]\n`;
                    });
                }
            } catch (e) {
                console.warn('[PortfolioManager] ⚠️ MarketLeader Alpha 조회 실패:', (e as any).message);
            }

            // 5-C. Load Dynamic Limits from Store
            const aiSettings: any = store.get('ai_settings') || {};
            let limits = aiSettings.portfolioLimits || {
                buy: { THEME: 3, MOMENTUM: 3, PULLBACK: 2, REPORT: 2 },
                watchlist: { THEME: 3, MOMENTUM: 3, PULLBACK: 2, REPORT: 2 }
            };

            // 구버전 키(SWING/VALUE) 감지 → 새 기준으로 자동 마이그레이션 적용
            if (limits.watchlist && ('SWING' in limits.watchlist || 'VALUE' in limits.watchlist)) {
                limits = {
                    buy: { THEME: 3, MOMENTUM: 3, PULLBACK: 2, REPORT: 2 },
                    watchlist: { THEME: 3, MOMENTUM: 3, PULLBACK: 2, REPORT: 2 }
                };
            }

            const totalBuy = Object.values(limits.buy).reduce((a: any, b: any) => a + Number(b), 0);
            const totalWatch = Object.values(limits.watchlist).reduce((a: any, b: any) => a + Number(b), 0);

            // 6. Construct System Prompt Context
            const marketContextHeader = marketContextBlock
                ? `[🌐 오늘의 시장 맥락 — 종목 판단 전 반드시 숙지]\n\n${marketContextBlock}\n---\n\n`
                : '';

            const promptContext =
                marketContextHeader +
                `[종합 심사 대상 팩트시트 리스트 (신규+보유 통합 총 ${stockList.length}개 종목)]\n\n` +
                stockList.map(s => s.dossier).join('\n\n');

            const systemPrompt = `너는 여의도 최고 수익률을 자랑하는 헤지펀드 매니저(Portfolio Manager) 포지션이다.
오늘 1) 당일 신규 추천주, 2) 기존 관심종목, 3) 보유종목(매수포지션)이 하나로 통합된 거대한 풀을 심사한다.
${sysConditionMsg}

[차트 리스크 분석 교본 (필수 준수 지침)]
${chartRiskSkill}

[🌐 시장 맥락 활용 원칙 — 반드시 준수]
프롬프트 최상단에 오늘의 시장 맥락(Alpha 랭킹 + 이슈 수혜/피해 섹터 + 시황 브리핑)이 제공된다.
1. **Alpha Top 15 교차 확인**: 애널리스트 추천 종목이 Alpha Top 15 안에 있으면 conviction_score 상향.
2. **이슈 수혜 섹터 우대**: 이슈AI가 판정한 수혜 섹터 종목은 역발상 매수 기회. conviction_score 상향.
3. **Alpha + 이슈 쌍발 신호**: Alpha Top 15 + 이슈 수혜 섹터 동시 해당 시 최강의 매수 신호.

[매수 및 관심종목 판단 이원화 원칙 — 이 지침이 규칙의 알파이자 오메가다]
1. **[매수(HELD) 포지션 엄격 분리]**: 지금 당장 "실제 현금으로 매수"할 만한 초A급 주도주에만 "BUY" 또는 기존 매수종목 유지 시 "HOLD" 판정을 내려라. 매수 조건은 극도로 엄격하게 적용하며, 상단 저항, 재료 소멸, 추격매수 시에는 가차없이 제외한다. (매도는 "SELL" 지시)

1-A. **[수익/손실 무시 및 추세 유지 원칙 (Let winners ride)]**: Sunk Cost를 무시하라는 것은 계좌에 찍힌 과거 수익률 숫자에 집착하지 말라는 뜻이다. 종목이 가진 '상승 추세의 관성'마저 무시하라는 뜻이 아니다. 기계적인 익절/손절은 금지한다. 이미 시장의 수급이 입증되어 20일선 위에서 탄탄하게 상승 중인 주도주는, 명백한 이탈 신호(대량 거래를 동반한 장대음봉 등)가 확인되기 전까지는 쉽게 팔지 말고 홀딩(HOLD)하라. 신규 후보 종목으로의 교체(SELL 후 BUY)는 신규 종목의 추세와 모멘텀이 기존 종목을 **'압도적'**으로 능가할 때만 단행하라. 단, 상승 추세가 무너지고(Alpha 급락, 재료 소멸, 상단 저항+거래량 고갈) 가망이 없다면 단 -1% 손실이더라도 가차없이 매도(SELL)하라.
2. **[강제 T/O 서바이벌 스코어링]**: 매수(BUY / HOLD / SELL)로 판정된 최상위 종목 혹은 청산종목을 제외한 >>나머지 모든 종목<<(기존 관심종목 + 새로 올라온 추천주 전체)에 대해서는 무단으로 탈락(DROP)시키지 마라.
대신에, 이들을 관심종목 후보(WATCHING)로 두고 0점~100점의 **매력도 점수(conviction_score)** 를 매우 촘촘하게(상대적인 랭킹을 매긴다는 느낌으로) 평가하라.
시스템적으로 각 카테고리별 최대 허용 개수는 시스템 로직(코드)이 알아서 계산하여 하위권 종목들을 정밀하게 탈락(DROP)시킬 것이다. 네가 임의로 종목을 누락시키면 심각한 시스템 오류가 발생하므로, 무조건 입력된 전체 ${stockList.length}개 종목 모두에 대하여 리스트에 담아 판정 결과를 반환해라. 즉, 너의 역할은 모든 후보 종목 간의 성적표(등수별 점수)를 냉정하게 매기는 것이다!

[추천 AI 카테고리 가산점 안내]
각 종목의 analysts_json에는 현재 추천 AI 카테고리가 지정되어 있다.
- THEME: 테마 AI 추천 종목 (내러티브·섹터 기반)
- MOMENTUM: 수급/모멘텀 AI 추천 종목 (단기 거래량·강세)
- PULLBACK: 눌림목 AI 추천 종목 (MA 지지·타점 진입)
- REPORT: 리포트 AI 추천 종목 (증권사 보고서 기반)
- ALPHA_TOP: **가산점 신호로 활용**
  → analysts_json에 ALPHA_TOP이 포함된 종목은 conviction_score를 5점 추가로 부여하라 (100점 초과 불가)

※ strategy 필드는 더 이상 사용하지 않는다. 응답 JSON에 strategy를 포함하지 마라.

[응답 가이드]
결과는 반드시 JSON 형식이어야 하며, 풀에 있는 모든 종목을 누락 없이 반환하여야 한다.
\`\`\`json
{
    "decisions": [
        {
            "stock_code": "000000",
            "stock_name": "종목명",
            "last_signal": "BUY | HOLD | SELL | WATCHING",
            "conviction_score": 95,
            "lifespan_days": 20,
            "analysts_json": ["THEME", "ALPHA_TOP"],
            "last_signal_reason": "알파 Top 5 + 테마 AI 수혜. (BUY 이유 혹은 WATCHING 고득점 편성 이유 명시)"
        }
    ]
}
\`\`\``;

            const response = await AiExecutionQueue.getInstance().enqueue({
                agentId: 'PORTFOLIO_MANAGER',
                agentName: '포트폴리오 매니저 (v2.5 Max-Profit)',
                triggerType: 'CRON',
                targetType: 'gemini',
                prompt: promptContext,
                systemInstruction: systemPrompt
            });

            let jsonStr = response;
            const jsonMatch = response.match(/```(?:json)?\n?([\s\S]*?)\n?```/);
            if (jsonMatch && jsonMatch[1]) {
                jsonStr = jsonMatch[1];
            } else {
                const fallbackMatch = response.match(/\{[\s\S]*\}/);
                if (fallbackMatch) {
                    jsonStr = fallbackMatch[0];
                }
            }

            try {
                const parsed = JSON.parse(jsonStr);
                if (parsed.decisions && Array.isArray(parsed.decisions)) {

                    // 누락 경고 (AI Hallucination 방어)
                    if (parsed.decisions.length < stockList.length) {
                        console.warn(`[PortfolioManager] ⚠️ AI 응답 누락 감지: 입력 ${stockList.length}개 중 ${parsed.decisions.length}개만 반환됨.`);
                        try {
                            const { TelegramService } = await import('../TelegramService');
                            TelegramService.getInstance().sendMessage(`⚠️ [PM경고] AI가 ${stockList.length}개 중 ${parsed.decisions.length}개의 분석만 반환하여 나머지 ${stockList.length - parsed.decisions.length}종목은 강제 탈락(DROPPED) 처리됩니다.`);
                        } catch (_) { }
                    }

                    // [Phase 5] 매수 및 대기(WATCHING) 슬롯 분리 처리 배열
                    const buysAndSells: any[] = [];
                    // primaryCategory 기반 그룹화 (THEME/MOMENTUM/PULLBACK/REPORT)
                    const groupedWatchlist: Record<string, any[]> = { THEME: [], MOMENTUM: [], PULLBACK: [], REPORT: [] };
                    const validDecisions: any[] = [];

                    for (const dec of parsed.decisions) {
                        const realCode = codeMap[dec.stock_name];
                        const finalCode = (realCode && dec.stock_code !== realCode) ? realCode : dec.stock_code;

                        if (!finalCode || finalCode === 'N/A' || finalCode === dec.stock_name) {
                            continue;
                        }

                        dec.finalCode = finalCode;
                        const previousInfo = activePortfolio.find(p => p.stock_code === finalCode);
                        const isHeld = previousInfo && (previousInfo.status === 'HELD' || previousInfo.status === 'IMMEDIATE_BUY');

                        // ALPHA_TOP 가산점 +5 적용
                        const decTags: string[] = Array.isArray(dec.analysts_json) ? dec.analysts_json : [];
                        if (decTags.includes('ALPHA_TOP')) {
                            dec.conviction_score = Math.min(100, (dec.conviction_score || 50) + 5);
                        }

                        // primary_category 계산 (analysts_json 기반, ALPHA_TOP 제외 후 우선순위 적용)
                        const AGENT_PRIORITY = ['THEME', 'MOMENTUM', 'PULLBACK', 'REPORT'];
                        const filteredTags = decTags.map((t: string) => {
                            if (t === '테마') return 'THEME';
                            if (t === '수급' || t === '모멘텀') return 'MOMENTUM';
                            if (t === '눌림목') return 'PULLBACK';
                            if (t === '리포트') return 'REPORT';
                            return t;
                        }).filter((t: string) => t !== 'ALPHA_TOP');
                        dec.primaryCategory = AGENT_PRIORITY.find(p => filteredTags.includes(p)) ?? 'MOMENTUM';

                        if (isHeld) {
                            if (dec.last_signal === 'SELL' || dec.last_signal === 'DROP') {
                                dec.finalStatus = 'DROPPED';
                            } else {
                                dec.finalStatus = 'HELD';
                            }
                            buysAndSells.push(dec);
                        } else {
                            if (dec.last_signal === 'BUY' || dec.last_signal === 'HELD') {
                                dec.finalStatus = 'HELD';
                                buysAndSells.push(dec);
                            } else if (dec.last_signal === 'SELL' || dec.last_signal === 'DROP') {
                                dec.finalStatus = 'DROPPED';
                                dec.conviction_score = -1;
                                validDecisions.push(dec);
                            } else {
                                // WATCHING 후보군 — primaryCategory(THEME/MOMENTUM/PULLBACK/REPORT) 기준 그룹화
                                dec.finalStatus = 'WATCHING';
                                const cat = dec.primaryCategory;
                                if (!groupedWatchlist[cat]) groupedWatchlist[cat] = [];
                                groupedWatchlist[cat].push(dec);
                            }
                        }
                    }

                    // [Phase 5] primaryCategory기반 Cut-Off + 총 10개 글로벌 강제 트리밍
                    const TOTAL_WATCH_LIMIT = 10;
                    // 새 기준: THEME:3, MOMENTUM:3, PULLBACK:2, REPORT:2 = 10개
                    const watchLimits = limits.watchlist || { THEME: 3, MOMENTUM: 3, PULLBACK: 2, REPORT: 2 };
                    const cutOffDropped: any[] = [];
                    const survivedWatchlist: any[] = [];

                    // Step A: 전략별 1차 Cut-Off (각 전략 내 과잉 제거)
                    for (const [strategy, items] of Object.entries(groupedWatchlist)) {
                        // 리뷰 대상 종목들을 점수순 정렬
                        items.sort((a, b) => (b.conviction_score || 0) - (a.conviction_score || 0));

                        const limit = watchLimits[strategy as keyof typeof watchLimits] || 0;
                        const passed = items.slice(0, limit);
                        const failed = items.slice(limit);

                        survivedWatchlist.push(...passed);
                        failed.forEach(item => {
                            item.finalStatus = 'DROPPED';
                            cutOffDropped.push(item);
                        });
                    }

                    // Step B: 총 10개 글로벌 강제 트리밍 (절대 한도 보장)
                    survivedWatchlist.sort((a, b) => (b.conviction_score || 0) - (a.conviction_score || 0));
                    if (survivedWatchlist.length > TOTAL_WATCH_LIMIT) {
                        const globalFailed = survivedWatchlist.splice(TOTAL_WATCH_LIMIT);
                        globalFailed.forEach(item => {
                            item.finalStatus = 'DROPPED';
                            cutOffDropped.push(item);
                        });
                        console.log(`[PortfolioManager] ✂️ WATCHING 글로벌 트리밍: ${globalFailed.length}개 DROP (잔류 ${survivedWatchlist.length}개 유지)`);
                    }

                    const finalProcessed = [...buysAndSells, ...survivedWatchlist, ...cutOffDropped, ...validDecisions];
                    const pricesMap: Record<string, number> = {};

                    // DB 기록 실행 루프
                    for (const dec of finalProcessed) {
                        const specificContext = dossiersMap[dec.stock_name] || `[담당 AI 추천 근거 요약]`;

                        // 현재가 처리
                        let curPrice = 0;
                        let upperLimitPrice = 0;
                        const isImmediateBuy = dec.finalStatus === 'HELD';

                        try {
                            const priceInfo = await kiwoomSvc.getStockBasicInfo(dec.finalCode);
                            const body = priceInfo?.Body || priceInfo?.out1 || priceInfo || {};
                            const rawCur = String(body.stk_prc || body.cur_prc || body.stck_prpr || body.currentPrice || 0).replace(/[^0-9-]/g, '');
                            const rawUpper = String(body.upl_pric || body.stck_mxpr || body.uplPric || 0).replace(/[^0-9-]/g, '');
                            curPrice = Math.abs(parseInt(rawCur, 10)) || 0;
                            upperLimitPrice = Math.abs(parseInt(rawUpper, 10)) || 0;
                        } catch (apiErr) {
                            const match = specificContext.match(/현재가: ([0-9,]+)원/);
                            if (match && match[1]) curPrice = parseInt(match[1].replace(/,/g, ''), 10);
                        }

                        pricesMap[dec.finalCode] = curPrice;

                        // AI가 직접 DROP한 것도 처리 (컷오프 서바이벌로 밀려난 종목들도 포함)
                        if (dec.finalStatus === 'DROPPED') {
                            const previousInfo = activePortfolio.find(p => p.stock_code === dec.finalCode);
                            if (previousInfo) {
                                // 기존에 포트폴리오에 있었던 종목이 밀려난 거라면 DB 상태 변경
                                const reason = dec.last_signal_reason || '관심종목 서바이벌 컷오프 탈락';
                                this.db.updatePortfolioStatus(dec.finalCode, 'DROPPED', reason);
                                
                                // ✅ HELD 포지션이 명시적 탈락/컷오프된 경우에만 이벤트 기록 및 Trade Record 닫기
                                // (DB에서 Cap 초과로 잘린 경우는 enforcePortfolioCaps 내부에서 이미 처리됨)
                                if (previousInfo.status === 'HELD' || previousInfo.status === 'IMMEDIATE_BUY') {
                                    this.db.logPortfolioEvent(dec.finalCode, dec.stock_name, 'DROPPED', previousInfo.status, 'CLEARED', reason, curPrice);
                                    const droppedPf = this.db.getDb().prepare("SELECT profit_rate FROM maiis_portfolio WHERE stock_code = ?").get(dec.finalCode) as any;
                                    this.db.closeTradeRecord({
                                        stock_code: dec.finalCode,
                                        exit_price: curPrice,
                                        exit_reason: reason,
                                        profit_rate: droppedPf?.profit_rate || 0
                                    });
                                }

                                // 인큐베이터 강등 (WATCHING/HELD 모두 대상)
                                this.db.demoteToIncubator({
                                    stock_code: dec.finalCode,
                                    stock_name: dec.stock_name,
                                    current_price: curPrice,
                                    last_signal_reason: reason,
                                    id: previousInfo.id
                                });
                            }
                            continue; // 그 외 신규 픽이었다가 탈락한 건 DB에 넣을 필요 없으므로 생략
                        }

                        const previousInfo = activePortfolio.find(p => p.stock_code === dec.finalCode);
                        if (isImmediateBuy && previousInfo?.status !== 'HELD' && upperLimitPrice > 0 && curPrice > 0 && curPrice >= upperLimitPrice) {
                            console.log(`[PortfolioManager] ⛔ ${dec.stock_name}(${dec.finalCode}) 상한가 도달(${curPrice}원). 매수불가 승급 제외`);
                            // 매수불가면 아까운대로 관심종목 T/O에 밀어넣거나 그냥 스킵 
                            continue;
                        }

                        await new Promise(r => setTimeout(r, 200));

                        this.db.upsertPortfolioWatchlist({
                            stock_code: dec.finalCode,
                            stock_name: dec.stock_name,
                            status: dec.finalStatus,
                            strategy: dec.strategy || 'SWING',
                            conviction_score: dec.conviction_score,
                            theme: (dec.analysts_json || []).join(', '),
                            last_signal: dec.last_signal,
                            last_signal_reason: dec.last_signal_reason,
                            analysts_json: dec.analysts_json || [],
                            lifespan_days: isImmediateBuy ? (dec.lifespan_days || null) : null,
                            entry_date: dateStr,
                            created_at: this.db.getKstTimestamp(),
                            raw_context: specificContext,
                            current_price: curPrice,
                            entry_price: curPrice
                        }, true);

                        if (isImmediateBuy && curPrice > 0) {
                            try {
                                this.db.getDb().prepare(`
                                    UPDATE ai_analyst_picks 
                                    SET entry_price = ? 
                                    WHERE stock_code = ? AND date = ? AND (entry_price IS NULL OR entry_price = 0)
                                `).run(curPrice, dec.finalCode, dateStr);
                            } catch (err) { }
                        }
                    }
                    console.log(`[PortfolioManager] ✅ 통합 서바이벌 리뷰 및 DB 반영 완료.`);

                    // ─── [Phase 1 + Phase 3] Cap 재적용 + PM3 교체 재심사 ──────────────
                    // upsertPortfolioWatchlist 내부 자동 Cap은 protectedCodes 없이 실행되므로
                    // BUY 판정 종목을 보호 목록으로 전달하여 재실행. HELD 초과분은 즉시 DROP 대신
                    // pm3Candidates로 반환받아 PM3 재심사 후 최종 결정.
                    const protectedBuyCodes = new Set<string>(
                        buysAndSells
                            .filter((d: any) => d.finalStatus === 'HELD')
                            .map((d: any) => d.finalCode)
                            .filter(Boolean)
                    );
                    const { pm3Candidates } = this.db.enforcePortfolioCaps(protectedBuyCodes);

                    // ─── PM3 재심사: HELD Cap 초과 후보 순차 처리 ─────────────────────
                    if (pm3Candidates.length > 0) {
                        console.log(`[PortfolioManager] ⚖️ PM3 재심사 시작: ${pm3Candidates.length}개 HELD 후보`);

                        // 현재 WATCHING 종목 (대체 후보군) — conviction_score 상위순
                        const watchingCandidates = (this.db.getActivePortfolio() as any[])
                            .filter((p: any) => p.status === 'WATCHING')
                            .slice(0, 5); // 상위 5개만 도전자로 사용

                        // dossiersMap에서 팩트시트 참조 (이미 위에서 구성됨)
                        for (const candidate of pm3Candidates) {
                            try {
                                const challengers = watchingCandidates.map((w: any) => ({
                                    stock_code: w.stock_code,
                                    stock_name: w.stock_name,
                                    dossier: dossiersMap[w.stock_name] || `[${w.stock_name}] 현재 관심종목 (매력도 ${w.conviction_score}점)`
                                }));

                                const pm3Result = await this.runPhase3_SwapReview({
                                    currentHeld: {
                                        stock_code: candidate.stock_code,
                                        stock_name: candidate.stock_name,
                                        entry_reason: candidate.last_signal_reason || '이전 PM2 매수 판정',
                                        dossier: dossiersMap[candidate.stock_name] || `[${candidate.stock_name}] 현재 보유 중 (매력도 ${candidate.conviction_score}점)`
                                    },
                                    challengers
                                });

                                if (pm3Result.decision === 'REPLACE' && pm3Result.winnerCode) {
                                    // REPLACE: 기존 HELD DROP + 도전자 HELD 승급
                                    const winner = watchingCandidates.find((w: any) => w.stock_code === pm3Result.winnerCode);
                                    this.db.dropHeldForReplacement(
                                        candidate.stock_code,
                                        candidate.stock_name,
                                        candidate.current_price || candidate.entry_price || 0,
                                        candidate.profit_rate || 0
                                    );
                                    if (winner) {
                                        // 도전자를 HELD로 승급
                                        this.db.upsertPortfolioWatchlist({ ...winner, status: 'HELD' }, true);
                                        this.db.logPortfolioEvent(winner.stock_code, winner.stock_name, 'BUY_UPGRADED', 'WATCHING', 'HELD', `PM3 재심사 교체 승급: ${pm3Result.reason}`, winner.current_price || 0);
                                        console.log(`[PM3] ✅ REPLACE 확정: [${candidate.stock_name}] → [${winner.stock_name}] 교체 완료`);
                                    }
                                    try {
                                        const { TelegramService } = await import('../TelegramService');
                                        TelegramService.getInstance().sendMessage(
                                            `🔄 [PM3 교체 확정]\n매도: ${candidate.stock_name}\n매수: ${winner?.stock_name || pm3Result.winnerCode}\n이유: ${pm3Result.reason}`
                                        );
                                    } catch (_) { }
                                } else {
                                    // KEEP: 해당 HELD 유지 → WATCHING 최하위 1개를 대신 DROP
                                    const kept = this.db.dropLowestWatching(
                                        `PM3 재심사 KEEP: [${candidate.stock_name}] 보유 유지 — Cap 조정을 위해 관심종목 최하위 탈락`
                                    );
                                    console.log(`[PM3] 🛡️ KEEP 확정: [${candidate.stock_name}] 보유 유지. 사유: ${pm3Result.reason}`);
                                    try {
                                        const { TelegramService } = await import('../TelegramService');
                                        TelegramService.getInstance().sendMessage(
                                            `🛡️ [PM3 KEEP]\n보유 유지: ${candidate.stock_name}\n사유: ${pm3Result.reason}`
                                        );
                                    } catch (_) { }
                                }
                            } catch (pm3Err: any) {
                                // PM3 오류 시 보수적 KEEP (기존 보유 종목 유지)
                                console.warn(`[PM3] ${candidate.stock_name} 재심사 오류 → 보수적 보유 유지:`, pm3Err.message);
                                this.db.dropLowestWatching(`PM3 오류 보수 처리: [${candidate.stock_name}] 보유 유지`);
                            }
                        }
                        console.log(`[PortfolioManager] ✅ PM3 재심사 완료.`);
                    }

                    // BUG FIX #3: AI 응답 누락 좀비 종목 정리 + DB 최종 10개 보장

                    try {
                        const processedCodes = new Set(finalProcessed.map((d: any) => d.finalCode).filter(Boolean));
                        const zombieRows = rawDb.prepare(
                            "SELECT stock_code, stock_name FROM maiis_portfolio WHERE status IN ('WATCHING', 'WATCHLIST')"
                        ).all() as any[];
                        let zombieCount = 0;
                        for (const zombie of zombieRows) {
                            if (!processedCodes.has(zombie.stock_code)) {
                                // evalPool에 있었으나 AI가 응답에서 돌려주지 않은 종목 자동 DROP
                                // entry_price = 0이면 실제 매수 이력이 없으므로 was_held 오마킹 방지를 위해 0으로 리셋
                                rawDb.prepare(
                                    "UPDATE maiis_portfolio SET status = 'DROPPED', last_signal_reason = ?, updated_at = ?, was_held = CASE WHEN entry_price > 0 THEN was_held ELSE 0 END WHERE stock_code = ? AND status IN ('WATCHING', 'WATCHLIST')"
                                ).run('PM2 응답 누락 종목 — 자동 정리', this.db.getKstTimestamp(), zombie.stock_code);
                                console.log(`[PortfolioManager] 🧹 좀비 정리: ${zombie.stock_name}(${zombie.stock_code})`);
                                zombieCount++;
                            }
                        }
                        if (zombieCount > 0) console.log(`[PortfolioManager] 🧹 좀비 종목 총 ${zombieCount}개 정리 완료`);

                        // DB 기준 WATCHING 최종 10개 초과 시 하위 종목 추가 제거 (2중 폴세이프)
                        const finalWatching = rawDb.prepare(
                            "SELECT stock_code FROM maiis_portfolio WHERE status = 'WATCHING' ORDER BY conviction_score DESC"
                        ).all() as any[];
                        if (finalWatching.length > 10) {
                            const excess = finalWatching.slice(10);
                            excess.forEach((s: any) => {
                                // entry_price = 0이면 실제 매수 이력 없으므로 was_held 오마킹 리셋
                                // [드로 경로 ④ 방어] HELD/IMMEDIATE_BUY 상태 종목은 여기서 강제 DROP 제외 — 실제 WATCHING에서 넘친 종목만 없애야 함
                                rawDb.prepare(
                                    "UPDATE maiis_portfolio SET status = 'DROPPED', last_signal_reason = ?, updated_at = ?, was_held = CASE WHEN entry_price > 0 THEN was_held ELSE 0 END WHERE stock_code = ? AND status NOT IN ('HELD', 'IMMEDIATE_BUY')"
                                ).run('WATCHING 10개 한도 초과 — DB 최종 트리밍', this.db.getKstTimestamp(), s.stock_code);
                            });
                            console.log(`[PortfolioManager] ✂️ DB 최종 확인: WATCHING 10개 초과 ${excess.length}개 제거 완료`);
                        }
                    } catch (cleanupErr: any) {
                        console.warn(`[PortfolioManager] 좀비/트리밍 정리 중 오류 (무시):`, cleanupErr.message);
                    }

                    // --- Phase 2 텔레그램 스냅샷 발송 ---
                    try {
                        const { TelegramService } = await import('../TelegramService');
                        const afterPortfolio = this.db.getActivePortfolio() as any[];

                        // 신규 매수 (Before에는 HELD가 아니었는데 After에 HELD가 된 것)
                        const newBuys = afterPortfolio.filter(a =>
                            (a.status === 'HELD' || a.status === 'IMMEDIATE_BUY') &&
                            !activePortfolio.find(b => b.stock_code === a.stock_code && (b.status === 'HELD' || b.status === 'IMMEDIATE_BUY'))
                        );

                        // 탈락 종목 (Before에는 HELD 매수 포지션이었으나 지금은 유지되지 못한 경우만)
                        const droppedList = activePortfolio.filter(b =>
                            (b.status === 'HELD' || b.status === 'IMMEDIATE_BUY') &&
                            !afterPortfolio.find(a => a.stock_code === b.stock_code && (a.status === 'HELD' || a.status === 'IMMEDIATE_BUY'))
                        );
                        const watchCount = afterPortfolio.filter(a => a.status === 'WATCHING' || a.status === 'WATCHLIST').length;
                        const buyCount = afterPortfolio.filter(a => a.status === 'HELD' || a.status === 'IMMEDIATE_BUY').length;

                        let tgMsg = `🧑‍💼 [PM 2차 리밸런싱 완료]\n`;
                        tgMsg += `📊 포지션 현황: 매수 ${buyCount} / 관심 ${watchCount}`;

                        if (newBuys.length > 0) {
                            tgMsg += `\n\n🎉 [신규 매수 승급]`;

                            for (const b of newBuys) {
                                tgMsg += `\n- ${b.stock_name} (${b.strategy} | ${b.conviction_score}점)`;
                                const reasonMatch = parsed.decisions.find((d: any) => d.stock_code === b.stock_code);
                                const reason = reasonMatch ? (reasonMatch.last_signal_reason || reasonMatch.reason) : 'PM 매수 승급 확정';
                                this.db.logPortfolioEvent(b.stock_code, b.stock_name, 'BUY_UPGRADED', 'WATCHLIST', 'IMMEDIATE_BUY', reason || 'PM 매수 승급 확정', b.current_price || 0);
                                // ✅ [거래 단위] 매수 진입 시 trade_history OPEN 레코드 생성
                                this.db.openTradeRecord({
                                    stock_code: b.stock_code,
                                    stock_name: b.stock_name,
                                    entry_price: b.current_price || b.entry_price || 0,
                                    entry_reason: reason || 'PM 매수 승급 확정',
                                    strategy: b.strategy || 'MOMENTUM',
                                    analysts_json: b.analysts_json || []
                                });
                                // ℹ️ 실전 매매 연동은 SchedulerService.ts의 15:05 크론(TrackBuyAgent 완료 직후)에서 처리됩니다.
                            }
                        } else {
                            tgMsg += `\n\n⚠️ [신규 매수 없음]`;

                            // 이미 매수된 종목(HELD)이 아닌, 관심종목 중 가장 점수가 높은 대기 후보군을 찾음
                            const topCandidate = parsed.decisions
                                .filter((d: any) => d.last_signal !== 'SELL' && d.last_signal !== 'BUY' && d.last_signal !== 'DROP')
                                .sort((a: any, b: any) => b.conviction_score - a.conviction_score)[0];

                            if (topCandidate) {
                                tgMsg += `\n대기 중인 후보 [${topCandidate.stock_name}] 등은 매력도 점수가 한도 기준을 넘지 못했거나 포트폴리오 잔여 캡 부족으로 인해 승급이 보류되었습니다.\n👉 PM 의견: ${topCandidate.last_signal_reason}`;
                            } else {
                                tgMsg += `\n현재 승급을 고려할 만한 매력적인 관심종목 후보가 감지되지 않았습니다.`;
                            }
                        }

                        if (droppedList.length > 0) {
                            tgMsg += `\n\n---`;

                            const profitList: string[] = [];
                            const lossList: string[] = [];

                            droppedList.forEach(d => {
                                const droppedDb = rawDb.prepare("SELECT profit_rate FROM maiis_portfolio WHERE stock_code = ?").get(d.stock_code) as any;
                                const rate = droppedDb?.profit_rate ?? d.profit_rate ?? 0;
                                const formattedRate = `${rate > 0 ? '+' : ''}${Number(rate).toFixed(2)}%`;
                                const itemStr = `${d.stock_name} (${formattedRate})`;

                                if (rate > 0) {
                                    profitList.push(itemStr);
                                } else {
                                    lossList.push(itemStr);
                                }
                            });

                            if (profitList.length > 0) {
                                tgMsg += `\n[매도 종목: 수익]`;
                                profitList.forEach((item, i) => {
                                    tgMsg += `\n${i + 1}. ${item}`;
                                });
                            }

                            if (lossList.length > 0) {
                                tgMsg += profitList.length > 0 ? `\n\n[매도 종목: 손절]` : `\n[매도 종목: 손절]`;
                                lossList.forEach((item, i) => {
                                    tgMsg += `\n${i + 1}. ${item}`;
                                });
                            }
                        }

                        TelegramService.getInstance().sendMessage(tgMsg);
                    } catch (tgErr) {
                        console.error(`[PortfolioManager] 2차 텔레그램 발송 오류:`, tgErr);
                    }

                    return parsed.decisions;
                }
            } catch (jsonErr: any) {
                console.error(`[PortfolioManager] JSON 파싱 에러:`, jsonErr.message);
            }

            console.warn(`[PortfolioManager] 구조 파싱 실패 또는 결과 없음:`, response);
            return null;

        } catch (e: any) {
            console.error(`[PortfolioManager] 리뷰 중 오류 발생:`, e);

            // Resilience Plan 2 & 3: 에러 알림 및 임시 크론 예약
            const errMsg = e.message ? e.message.toLowerCase() : '';
            if (errMsg.includes('503') || errMsg.includes('high demand') || errMsg.includes('429') || errMsg.includes('quota') || errMsg.includes('rate-limit') || errMsg.includes('rate limits')) {
                console.warn(`[PortfolioManager] API 과부하 감지. 5분 뒤 임시 크론으로 재시도를 예약합니다.`);
                try {
                    const { SchedulerService } = await import('../SchedulerService');
                    const { eventBus } = await import('../../utils/EventBus');
                    const { TelegramService } = await import('../TelegramService');

                    // 이벤트 버스로 UI에 경고 토스트 띄우기
                    eventBus.emit('system:error' as any, {
                        message: `[포트폴리오 AI] ⚠️ 구글 API 트래픽 과부하로 분석이 지연되었습니다. 5분 뒤 백그라운드에서 자동으로 재시도합니다.`,
                        code: 'AI_OVERLOAD',
                        time: new Date().toLocaleTimeString('ko-KR')
                    });

                    TelegramService.getInstance().sendMessage(`🚨 [포트폴리오 AI 대기] 구글 API 과부하로(503) 종목 리뷰가 취소되었습니다. 5분 뒤 자동으로 1회 재실행합니다.`);

                    // 5분 후 재시작 스케줄 등록
                    SchedulerService.getInstance().scheduleOnceFallback(
                        '포트폴리오 AI 지연 재시도',
                        5 * 60 * 1000,
                        async () => {
                            await PortfolioManagerAgent.getInstance().runPortfolioManager();
                        }
                    );
                } catch (schedErr) {
                    console.error('[PortfolioManager] 재시도 스케줄링 실패:', schedErr);
                }
            }
            throw e;
        }
    }

    /**
     * [Phase 3] PM3 교체 재심사
     * Cap 초과로 HELD 종목을 DROP해야 하는 상황에서 호출.
     * 두 조건이 동시에 충족되어야만 "REPLACE"를 리턴:
     *   1) 매수 당시 논리(Buy Thesis)가 현재 무너졌는가
     *   2) 대체 종목의 기대 상승률이 현 종목보다 minUpsideDiffPct(%p) 이상 높은가
     *
     * @returns { decision: 'KEEP' | 'REPLACE'; winnerCode?: string; reason: string }
     */
    public async runPhase3_SwapReview(params: {
        currentHeld: {
            stock_code: string;
            stock_name: string;
            entry_reason: string;   // 최초 매수 시 근거
            dossier: string;        // 현재 팩트시트
        };
        challengers: Array<{
            stock_code: string;
            stock_name: string;
            dossier: string;
        }>;
        minUpsideDiffPct?: number;  // 기본값 15 (%p)
    }): Promise<{ decision: 'KEEP' | 'REPLACE'; winnerCode?: string; reason: string }> {
        const minDiff = params.minUpsideDiffPct ?? 15;

        const PM3_SYSTEM_PROMPT = `당신은 포트폴리오 안정성을 최우선으로 하는 리스크 관리자입니다.
현재 보유 중인 종목을 교체할지 여부를 판단합니다.
교체는 극도로 보수적으로 결정해야 하며, 아래 두 조건을 동시에 충족할 때만 "REPLACE"를 리턴합니다.

▶ 조건 1 — 매수 논리 붕괴 확인 (필수)
최초 매수 시 제시된 근거가 현재도 유효한지 판단하십시오.
- 모멘텀 소멸, 재료 소진, 수급 이탈, 테마 소멸 → thesis_status: "BROKEN"
- 근거가 여전히 유효 → thesis_status: "VALID" → 즉시 KEEP 리턴

▶ 조건 2 — 기대 상승률 격차 확인 (필수, 조건 1이 BROKEN인 경우만)
현 종목 대비 교체 후보 종목들의 향후 기대 상승률 차이를 추정하십시오.
격차가 +${minDiff}%p 미만 → upside_gap: "INSUFFICIENT" → KEEP 리턴
격차가 +${minDiff}%p 이상 → upside_gap: "JUSTIFIED" → REPLACE 가능

▶ 최종 판정 규칙
BROKEN + JUSTIFIED 동시 충족 → decision: "REPLACE", winner_code에 최우선 대체 종목 코드 기입
그 외 모든 경우 → decision: "KEEP"

반드시 JSON만 응답:
\`\`\`json
{
    "thesis_status": "VALID | BROKEN",
    "upside_gap": "INSUFFICIENT | JUSTIFIED | N/A",
    "decision": "KEEP | REPLACE",
    "winner_code": "종목코드 또는 null",
    "reason": "판단 근거 요약 (2~3문장)"
}
\`\`\``;

        const prompt = `[현재 보유 종목]
종목명: ${params.currentHeld.stock_name} (${params.currentHeld.stock_code})
최초 매수 근거: ${params.currentHeld.entry_reason}

${params.currentHeld.dossier}

---
[교체 후보 종목들]
${params.challengers.map((c, i) => `${i + 1}. ${c.stock_name} (${c.stock_code})\n${c.dossier}`).join('\n\n')}`;

        try {
            const response = await AiExecutionQueue.getInstance().enqueue({
                agentId: 'PM3_SWAP_REVIEW',
                agentName: `PM3 교체 재심사 — ${params.currentHeld.stock_name}`,
                triggerType: 'CRON',
                targetType: 'gemini',
                prompt,
                systemInstruction: PM3_SYSTEM_PROMPT
            });

            const jsonMatch = response.match(/```(?:json)?\n?([\s\S]*?)\n?```/);
            const jsonStr = jsonMatch?.[1] || response.match(/\{[\s\S]*\}/)?.[0] || '';
            const parsed = JSON.parse(jsonStr);

            console.log(`[PM3] ${params.currentHeld.stock_name} 교체 재심사 결과: ${parsed.decision} (thesis=${parsed.thesis_status}, gap=${parsed.upside_gap})`);

            return {
                decision: parsed.decision === 'REPLACE' ? 'REPLACE' : 'KEEP',
                winnerCode: parsed.winner_code || undefined,
                reason: parsed.reason || '판단 근거 없음'
            };
        } catch (e: any) {
            // AI 응답 실패 시 보수적으로 KEEP
            console.warn(`[PM3] ${params.currentHeld.stock_name} 재심사 실패 → 보수적 KEEP:`, e.message);
            return { decision: 'KEEP', reason: 'PM3 AI 응답 실패 — 보수적 보유 유지' };
        }
    }
}
