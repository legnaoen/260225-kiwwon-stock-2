import { AiExecutionQueue } from '../AiExecutionQueue';
import { DatabaseService } from '../DatabaseService';
import { KiwoomService } from '../KiwoomService';
import { TechnicalAnalyzer } from './TechnicalAnalyzer';
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
        await this.runPhase1_Screening(targetDate);
        return await this.runPhase2_Rebalancing(targetDate);
    }

    public async runPhase1_Screening(targetDate?: string) {
        const kiwoomSvc = KiwoomService.getInstance();
        const dateStr = targetDate || this.db.getKstDate();
        console.log(`[PortfolioManager] 🧑‍💼 ${dateStr} 1차 심사 (루키 오디션) 시작...`);

        try {
            const todaysPicks = this.db.getAiAnalystPicksByDate(dateStr) as any[];
            if (!todaysPicks || todaysPicks.length === 0) {
                console.warn(`[PortfolioManager] 1차 심사 대상이 없습니다 (당일 추천주 없음).`);
                return null;
            }

            // Remove already active portfolio stocks from Phase 1 evaluation to save tokens (they go straight to Phase 2)
            const activePortfolio = this.db.getActivePortfolio() as any[];
            const activeCodeSet = new Set(activePortfolio.map((p: any) => p.stock_code));
            const newPicks = todaysPicks.filter(p => !activeCodeSet.has(p.stock_code));

            if (newPicks.length === 0) {
                console.log(`[PortfolioManager] 추천주 전원이 이미 포트폴리오에 있습니다. 1차 심사 패스.`);
                return null;
            }

            const evalPool: Record<string, any> = {};
            const codeMap: Record<string, string> = {};

            newPicks.forEach(pick => {
                if (!evalPool[pick.stock_name]) {
                    codeMap[pick.stock_name] = pick.stock_code;
                    evalPool[pick.stock_name] = {
                        stock_code: pick.stock_code,
                        stock_name: pick.stock_name,
                        source: 'NEW_PICK',
                        analysts: [],
                        today_analysts: []
                    };
                }
                // Merge reasons
                if (pick.analyst) {
                    evalPool[pick.stock_name].today_analysts.push({
                        agent: pick.analyst,
                        reason: pick.reason,
                        confidence: pick.confidence
                    });
                }
            });

            // Build dossiers (Simplified for Phase 1)
            const analyzer = new TechnicalAnalyzer(kiwoomSvc);
            const stockList = Object.values(evalPool);

            for (let i = 0; i < stockList.length; i += 3) {
                const chunk = stockList.slice(i, i + 3);
                await Promise.all(chunk.map(async (s: any) => {
                    try { s.chart_digest = await analyzer.generateStockDigest(s.stock_code, s.stock_name, 200); }
                    catch (e) { s.chart_digest = '차트 데이터 없음'; }

                    let ds = `[${s.stock_name} (${s.stock_code})]\n`;
                    ds += `> 차트 리스크 분석:\n${s.chart_digest}\n`;
                    ds += `> 오늘 애널리스트 추천 근거:\n`;
                    s.today_analysts.forEach((a: any) => ds += `- [${a.agent}] ${a.reason}\n`);
                    s.dossier = ds;
                }));
                if (i + 3 < stockList.length) await new Promise(r => setTimeout(r, 300));
            }

            const aiSettings: any = store.get('ai_settings') || {};
            const phase1PassLimit = aiSettings.phase1PassLimit || 10;

            const promptContext = `[1차 심사 대상 신규 종목 총 ${stockList.length}개]\n\n` + stockList.map(s => s.dossier).join('\n\n');
            const systemPrompt = `너는 차트 분석과 종목 필터링을 담당하는 1차 심사관(Portfolio Manager Phase 1)이다. 오늘은 ${stockList.length}개의 새로운 종목 추천이 올라왔다.
관심종목(WATCHLIST) 풀을 여유롭게 유지하는 것이 목표다. 차트가 아주 극단적인 고점이거나 상장폐지급 폭락이 아니고, 실적이나 모멘텀 개선의 여지가 약간이라도 보이면 가급적 WATCHLIST에 통과시켜라.
절대평가를 통해 최대 ${phase1PassLimit}개의 종목을 2차 심사(WATCHLIST)로 올려보내되, 허들을 대폭 낮춰 종류별로 폭넓게 담아내는 데 집중하라.

응답 형식 (JSON):
\`\`\`json
{
    "decisions": [
        {
            "stock_code": "000000",
            "stock_name": "종목명",
            "status": "WATCHLIST | DROP",
            "reason": "차트 이격도 안정적, 모멘텀 우수",
            "strategy": "SWING"
        }
    ]
}
\`\`\``;

            console.log(`[PortfolioManager] 1차 심사 요청 전송 중... (후보 ${stockList.length}개, 최대 ${phase1PassLimit}개 통과)`);
            const response = await AiExecutionQueue.getInstance().enqueue({
                agentId: 'PORTFOLIO_MANAGER_PHASE1',
                agentName: '포트폴리오 매니저 (1차)',
                triggerType: 'CRON',
                targetType: 'gemini',
                prompt: promptContext,
                systemInstruction: systemPrompt
            });

            let jsonStr = response;
            const jsonMatch = response.match(/```(?:json)?\n?([\s\S]*?)\n?```/);
            if (jsonMatch && jsonMatch[1]) jsonStr = jsonMatch[1];

            const parsed = JSON.parse(jsonStr);
            let passedCount = 0;

            if (parsed.decisions) {
                const passed = parsed.decisions.filter((d: any) => d.status === 'WATCHLIST').slice(0, phase1PassLimit);
                for (const dec of passed) {
                    const finalCode = codeMap[dec.stock_name] || dec.stock_code;
                    if (!finalCode || finalCode === 'N/A') continue;

                    this.db.upsertPortfolioWatchlist({
                        stock_code: finalCode,
                        stock_name: dec.stock_name,
                        status: 'WATCHLIST',
                        strategy: dec.strategy || 'SWING',
                        conviction_score: 50, // 기본 점수
                        last_signal: 'WATCHLIST',
                        last_signal_reason: `[1차 심사 통과] ${dec.reason}`,
                        theme: '',
                        analysts_json: ['PHASE1_PASS'],
                        lifespan_days: null,
                        entry_date: dateStr,
                        created_at: this.db.getKstTimestamp(),
                        raw_context: '1차 풀 통과',
                        current_price: 0,
                        entry_price: 0
                    });

                    // 신규 관심종목 포트폴리오 편입 로그
                    this.db.logPortfolioEvent(finalCode, p.stock_name, 'WATCHLIST_ADDED', null, 'WATCHLIST', p.reason || '1차 풀 지정 조건 통과', 0);

                    passedCount++;
                }
            }
            console.log(`[PortfolioManager] 1차 심사 완료: ${stockList.length}개 후보 중 ${passedCount}개 종목이 2차 심사로 진출(WATCHLIST 편입).`);

            // --- Phase 1 텔레그램 스냅샷 발송 ---
            try {
                const { TelegramService } = await import('../TelegramService');
                const topPassed = (parsed.evaluations || [])
                    .filter((e: any) => e.status === 'PASS')
                    .sort((a: any, b: any) => (b.score || 0) - (a.score || 0))
                    .slice(0, 3);

                let tgMsg = `🧑‍💼 [PM 1차 평가 완료] 루키 오디션\n총 ${stockList.length}개 후보 중 ${passedCount}종목 2차 진출`;
                if (topPassed.length > 0) {
                    tgMsg += `\n\n📌 [대표 진출 종목 Top 3]`;
                    topPassed.forEach((p: any, idx: number) => {
                        tgMsg += `\n${idx + 1}. ${p.stock_name} (${p.score}점)\n   👉 ${p.reason}`;
                    });
                } else {
                    tgMsg += `\n\n⚠️ 지정된 허들을 넘은 신규 관심 종목이 없습니다.`;
                }
                TelegramService.getInstance().sendMessage(tgMsg);
            } catch (tgErr) {
                console.error(`[PortfolioManager] 1차 텔레그램 발송 오류:`, tgErr);
            }

            return parsed;
        } catch (e) {
            console.error(`[PortfolioManager] 1차 심사 에러:`, e);
        }
    }

    public async runPhase2_Rebalancing(targetDate?: string) {
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

            // 1. Phase 2는 오직 Active Portfolio(위치: maiis_portfolio)만 평가합니다. (Phase 1을 방금 통과한 종목 포함)

            // 2. Fetch existing active portfolio
            const activePortfolio = this.db.getActivePortfolio() as any[];

            // 3. Group ALL stocks for evaluation (Dossier Pool)
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
                    if (s.status) ds += `현재 상태: ${s.status} / 현재 수익률: ${s.profit_rate || 0}%\n`;
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

                    s.dossier = ds;
                    dossiersMap[s.stock_name] = ds;
                }));
                // Rate Limit 방지 딜레이
                if (i + 2 < stockList.length) await new Promise(r => setTimeout(r, 400));
            }

            // --- Resilience Phase 2: EventBus & AI Prompt Injection ---
            let sysConditionMsg = "";
            if (kiwoomSvc.isCircuitBroken()) {
                sysConditionMsg = "\n[🚨시스템 상태: 실시간 시세 및 차트 서버 연결 장애 발동 중]\n현재 증권사 API 장애로 인해 최신 호가와 차트 데이터를 받아올 수 없습니다. 따라서 무리하게 공격적인 IMMEDIATE_BUY 신호를 내리는 것을 지양하고, 관망(WATCHLIST) 또는 HOLD 위주로 보수적인(Defensive) 판정을 내리십시오.\n";
            }

            // --- AI Skill Injection: 차트 리스크 분석 지침서 (SKILL.md) ---
            let chartRiskSkill = '';
            try {
                const fs = require('fs');
                const path = require('path');
                chartRiskSkill = fs.readFileSync(path.join(process.cwd(), '.agents/skills/chart_risk_analysis/SKILL.md'), 'utf-8');
            } catch (e) {
                console.warn('[PortfolioManager] ⚠️ 차트 리스크 분석 가이드북(SKILL.md)을 읽을 수 없습니다. 기본 룰 적용.');
                chartRiskSkill = "MA20 이격도가 극심하게 높을 경우 IMMEDIATE_BUY를 금지하라.";
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
                    marketContextBlock += `\n> Alpha Top 15 안에 포함된 종목이 오늘 애널리스트 추천을 받았다면 conviction_score +10점 가산.\n> Alpha Top 15 종목이 오늘 조정(-3%~-8%)이면 눌림목 진입 타점 고려.\n\n`;
                    console.log(`[PortfolioManager] ✅ Alpha 주도주 Top ${leaders.length} 수집 완료`);
                }
            } catch (e) {
                console.warn('[PortfolioManager] ⚠️ Alpha 데이터 수집 실패 (무시하고 계속):', (e as any).message);
            }

            // 5-B. 이슈AI / 시황AI 맥락 수집
            try {
                const { IssueLedgerDB } = await import('./IssueLedgerDB');
                const issueDb = IssueLedgerDB.getInstance();

                const briefing = issueDb.getLatestBriefing();
                if (briefing) {
                    marketContextBlock += `#### 📋 오늘의 시황 브리핑 (위험도: ${briefing.risk_score}/100)\n`;
                    marketContextBlock += `${briefing.summary_markdown}\n\n`;
                }

                const activeIssues = issueDb.getActiveIssues();
                const criticalIssues = activeIssues
                    .filter(i => ['CRITICAL', 'HIGH'].includes(i.severity))
                    .slice(0, 5);

                if (criticalIssues.length > 0) {
                    marketContextBlock += `#### 🚨 활성 핵심 이슈 & 섹터 영향\n`;
                    criticalIssues.forEach(issue => {
                        marketContextBlock += `\n**[${issue.severity}] ${issue.name}**\n`;
                        marketContextBlock += `> ${issue.current_stance || issue.summary || '분석 없음'}\n`;
                        if (issue.goodSectors?.length > 0) {
                            marketContextBlock += `- ✅ 수혜 섹터: ${issue.goodSectors.map(s => `${s.name}(${s.reason})`).join(' / ')}\n`;
                        }
                        if (issue.badSectors?.length > 0) {
                            marketContextBlock += `- ❌ 피해 섹터: ${issue.badSectors.map(s => `${s.name}(${s.reason})`).join(' / ')}\n`;
                        }
                    });
                    marketContextBlock += '\n';
                }
                console.log(`[PortfolioManager] ✅ 이슈 맥락 수집 완료 (${criticalIssues.length}개)`);
            } catch (e) {
                console.warn('[PortfolioManager] ⚠️ 이슈 맥락 수집 실패 (무시하고 계속):', (e as any).message);
            }

            // 5-C. Load Dynamic Limits from Store
            const aiSettings: any = store.get('ai_settings') || {};
            const limits = aiSettings.portfolioLimits || {
                buy: { MOMENTUM: 2, PULLBACK: 2, SWING: 4, VALUE: 2 },
                watchlist: { MOMENTUM: 3, PULLBACK: 3, SWING: 6, VALUE: 3 }
            };
            const totalBuy = Object.values(limits.buy).reduce((a: any, b: any) => a + Number(b), 0);
            const totalWatch = Object.values(limits.watchlist).reduce((a: any, b: any) => a + Number(b), 0);
            const quotaText = `시스템상 HELD(매수 보유) 포지션 총 한도는 ${totalBuy}개 (MOMENTUM ${limits.buy.MOMENTUM}, PULLBACK ${limits.buy.PULLBACK}, SWING ${limits.buy.SWING}, VALUE ${limits.buy.VALUE}), WATCHING(관심 대기) 종목 총 한도는 ${totalWatch}개 (MOMENTUM ${limits.watchlist.MOMENTUM}, PULLBACK ${limits.watchlist.PULLBACK}, SWING ${limits.watchlist.SWING}, VALUE ${limits.watchlist.VALUE})까지만 유지 가능하다.`;

            // 6. Construct System Prompt Context (맥락 블록 앞에 삽입)
            const marketContextHeader = marketContextBlock
                ? `[🌐 오늘의 시장 맥락 — 종목 판단 전 반드시 숙지]\n\n${marketContextBlock}\n---\n\n`
                : '';

            const promptContext =
                marketContextHeader +
                `[종합 심사 대상 팩트시트 리스트 (신규+보유 통합 총 ${stockList.length}개 종목)]\n\n` +
                stockList.map(s => s.dossier).join('\n\n');

            const systemPrompt = `너는 여의도 최고 수익률을 자랑하는 헤지펀드 매니저(Portfolio Manager) 포지션이다.
오늘 3개 부서(테마/이슈, 수급/모멘텀, 펀더멘털/리포트)가 올린 종목별 종합 타임라인 리포트를 검토하고, 현재 관리 중인 종목들을 포함해 포지션을 평가해라.
${sysConditionMsg}

[차트 리스크 분석 교본 (필수 준수 지침)]
${chartRiskSkill}

[🌐 시장 맥락 활용 원칙 — 반드시 준수]
프롬프트 최상단에 오늘의 시장 맥락(Alpha 랭킹 + 이슈 수혜/피해 섹터 + 시황 브리핑)이 제공된다.
1. **Alpha Top 15 교차 확인**: 애널리스트 추천 종목이 Alpha Top 15 안에 있으면 conviction_score +10점 가산. 시장이 실제로 인정한 종목이라는 증거.
2. **이슈 수혜 섹터 우대**: 이슈AI가 판정한 수혜 섹터 종목은 시장 전체 하락 시에도 역발상 매수 기회. conviction_score +10~15점. 피해 섹터 종목의 반등에는 보수적 판단.
3. **시황 위험도 반영**: 브리핑의 risk_score가 80 이상이면 BUY 기준을 평소보다 10점 높여 적용. 60 미만이면 적극적 편입.
4. **Alpha + 이슈 쌍발 신호**: Alpha Top 15 + 이슈 수혜 섹터 동시 해당 시 최우선 편입 대상.

[전략별 판단 기준 — 반드시 구분하여 적용]
각 종목의 strategy 필드를 확인하고, 전략에 맞는 기준으로 DROP/HOLD/BUY를 판정하라:
- **MOMENTUM (1~3일)**: 신규 재료와 거래량 폭증이 핵심. 수명 초과 or 재료 소멸 시 신속히 DROP. 추격매수(등락률 +15% 이상) 불허.
- **PULLBACK (3~7일)**: MA20 위에서 지지 여부가 핵심. 거래량이 줄어드는 것은 긍정 신호(매물 소화 중). MA20 이탈 시에만 DROP.
- **SWING (5~20일)**: 테마 내러티브의 성장이 핵심. 단기 조정(-5%~-10%)은 HOLD. MA20 이탈 + 테마 소멸 시에만 DROP.
- **VALUE (본질가치)**: 수급과 거래량이 바닥일 때 인내. 펀더멘털 훼손(적자 전환, 목표주가 대폭 하향) 시에만 DROP.

[펀드매니저 추가 업무 지침]
1. [독립적 개별 평가]: 종목별로 제공되는 '과거~현재 AI 분석 리포트 타임라인'을 세밀하게 읽어라. 이 종목의 내러티브가 점진적으로 쌓이고 있는지 확인하라.
2. 타임라인 과거에 등장하던 부정적 평가나 리스크가 최근 타임라인의 뉴스와 수급을 통해 해소되었다면 가산점을 주라. 반대로 과거와 동일한 재료만 앵무새처럼 반복된다면 피로감이 쌓인 것으로 보고 점수를 차감하라.
3. [차트 분석 교본 최우선 반영]: 위에 주입된 '차트 리스크 분석 교본'의 조건(이격도, 단기 모멘텀, 역배열 등)을 절대적으로 준수하라. 가이드북의 위험 기준에 해당할 경우 스토리가 아무리 좋아도 추격매수(BUY)를 불허한다.
4. 기존 보유 종목 중 수익률이 부진하고 한 달 이상 모멘텀이 죽었다면 과감히 떨어내라(DROP). 단, strategy가 PULLBACK/VALUE인 종목은 위 전략별 기준을 따른다.
5. 주도 대장주는 여러 애널리스트(서브 AI)들이 중복으로 추천하거나 타임라인에 등장 빈도가 높을 수밖에 없다. 여러 근거가 합쳐질수록 편입 확신도를 극대화해라.
6. 각 종목에 대해 팩트시트를 근거로 '최종 확신 점수(conviction_score: 0~100)'와 '요청 시그널(BUY, HOLD, SELL)'을 내려라.
7. last_signal_reason 서술 시 ①시장 맥락(Alpha 포함 여부, 이슈 수혜/피해 섹터 해당 여부) ②전략별 판단 근거를 반드시 명시하라.
8. [포지션 용량 하드캡(Capacity Limit) 준수]: ${quotaText} 한도를 초과하면 낮은 점수부터 자동 삭제(SELL) 처리된다. 
따라서 무의미한 나열을 피하고, 진심으로 확신하는 최상위 종목에만 편입 점수를 높게 주어라. 기준에 미달하는 종목들은 과감히 SELL 처리해야 한다.

응답은 오직 JSON 형식으로만 작성해라:
\`\`\`json
{
    "decisions": [
        {
            "stock_code": "000000",
            "stock_name": "종목명",
            "last_signal": "BUY | HOLD | SELL",
            "conviction_score": 95,
            "strategy": "SWING",
            "lifespan_days": 20,
            "analysts_json": ["REPORT", "MOMENTUM"], 
            "last_signal_reason": "Alpha Top 5 + 방산 이슈 수혜 섹터 일치. 과거 타임라인 내러티브 지속 성장 중. SWING 전략 기준 MA20 지지 확인."
        }
    ]
}
\`\`\``;

            const response = await AiExecutionQueue.getInstance().enqueue({
                agentId: 'PORTFOLIO_MANAGER',
                agentName: '포트폴리오 매니저',
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
                    for (const dec of parsed.decisions) {
                        // Sanitize stock_code to prevent LLM hallucination (like "N/A" or swapping name with code)
                        const realCode = codeMap[dec.stock_name];
                        const finalCode = (realCode && dec.stock_code !== realCode) ? realCode : dec.stock_code;

                        if (!finalCode || finalCode === 'N/A' || finalCode === dec.stock_name) {
                            console.warn(`[PortfolioManager] 유효하지 않은 종목코드 무시: ${dec.stock_name} / ${finalCode}`);
                            continue;
                        }

                        const specificContext = dossiersMap[dec.stock_name] || `[담당 AI 추천 기초근거]\n데이터 누락 (단순 참조용)`;

                        // ★ PM AI 확정 시점에 키움 REST API로 실시간 현재가 조회 (텍스트 정규식 파싱 대신)
                        let curPrice = 0;
                        let upperLimitPrice = 0;
                        const isBuySignal = dec.last_signal === 'BUY';
                        const isSellSignal = dec.last_signal === 'SELL' || dec.last_signal === 'DROP';
                        
                        // ★ 기존 포트폴리오 상태 보존 및 전이 로직
                        const previousInfo = activePortfolio.find(p => p.stock_code === finalCode);
                        let finalStatus = 'WATCHING';
                        
                        if (previousInfo) {
                            if (previousInfo.status === 'HELD' || previousInfo.status === 'IMMEDIATE_BUY') {
                                if (isSellSignal) {
                                    finalStatus = 'DROPPED';
                                } else {
                                    finalStatus = 'HELD'; // HOLD or BUY maintains HELD state
                                }
                            } else {
                                // Was WATCHING or WATCHLIST
                                if (isBuySignal) finalStatus = 'HELD';
                                else if (isSellSignal) finalStatus = 'DROPPED';
                                else finalStatus = 'WATCHING';
                            }
                        } else {
                            if (isBuySignal) finalStatus = 'HELD';
                            else if (isSellSignal) finalStatus = 'DROPPED';
                            else finalStatus = 'WATCHING';
                        }
                        
                        const isImmediateBuy = finalStatus === 'HELD';

                        try {
                            const priceInfo = await kiwoomSvc.getStockBasicInfo(finalCode);
                            const body = priceInfo?.Body || priceInfo?.out1 || priceInfo || {};
                            const rawCur = String(body.stk_prc || body.cur_prc || body.stck_prpr || body.currentPrice || 0).replace(/[^0-9-]/g, '');
                            const rawUpper = String(body.upl_pric || body.stck_mxpr || body.uplPric || 0).replace(/[^0-9-]/g, '');
                            curPrice = Math.abs(parseInt(rawCur, 10)) || 0;
                            upperLimitPrice = Math.abs(parseInt(rawUpper, 10)) || 0;
                        } catch (apiErr) {
                            // API 조회 실패 시 차트 텍스트 폴백
                            console.warn(`[PortfolioManager] ${dec.stock_name} 현재가 API 조회 실패, 텍스트 파싱으로 폴백`);
                            const match = specificContext.match(/현재가: ([0-9,]+)원/);
                            if (match && match[1]) curPrice = parseInt(match[1].replace(/,/g, ''), 10);
                        }

                        // ★ HELD 종목이 상한가에 도달해 있으면 실제 매수 불가 → 건너뜀 (매수 시그널일 때만, 홀딩은 넘겨야함 판단 필요)
                        if (isBuySignal && previousInfo?.status !== 'HELD' && upperLimitPrice > 0 && curPrice > 0 && curPrice >= upperLimitPrice) {
                            console.log(`[PortfolioManager] ⛔ ${dec.stock_name}(${finalCode}) 상한가 도달(${curPrice}원 ≥ ${upperLimitPrice}원). 매수불가 종목 편입 제외.`);
                            continue;
                        }

                        // 키움 API Rate Limit 방지 딜레이 (200ms)
                        await new Promise(r => setTimeout(r, 200));

                        this.db.upsertPortfolioWatchlist({
                            stock_code: finalCode,
                            stock_name: dec.stock_name,
                            status: finalStatus,
                            strategy: dec.strategy || 'SWING',
                            conviction_score: dec.conviction_score,
                            theme: dec.analysts_json.join(', '),
                            last_signal: dec.last_signal,
                            last_signal_reason: dec.last_signal_reason,
                            analysts_json: dec.analysts_json,
                            // 수명은 IMMEDIATE_BUY 전환 시에만 확정 (관심종목은 PM이 매일 재검토하므로 수명 불필요)
                            lifespan_days: isImmediateBuy ? (dec.lifespan_days || null) : null,
                            entry_date: dateStr,
                            created_at: this.db.getKstTimestamp(),
                            raw_context: specificContext,
                            current_price: curPrice,
                            entry_price: curPrice  // upsert 내부에서 WAIT_DIP/HOLD/WATCHLIST면 0으로 처리됨
                        });

                        // 장중 파이프라인의 경우 IMMEDIATE_BUY 종목의 추천종목 테이블 기준가도 업데이트
                        if (isImmediateBuy && curPrice > 0) {
                            try {
                                this.db.getDb().prepare(`
                                    UPDATE ai_analyst_picks 
                                    SET entry_price = ? 
                                    WHERE stock_code = ? AND date = ? AND (entry_price IS NULL OR entry_price = 0)
                                `).run(curPrice, finalCode, dateStr);
                            } catch (err) {
                                console.error(`[PortfolioManager] 기준가 후행 업데이트 실패:`, err);
                            }
                        }
                    }
                    console.log(`[PortfolioManager] ✅ 총 ${parsed.decisions.length}개의 종목 풀 리뷰 완료.`);

                    // --- Phase 2 텔레그램 스냅샷 발송 ---
                    try {
                        const { TelegramService } = await import('../TelegramService');
                        const afterPortfolio = this.db.getActivePortfolio() as any[];

                        // 신규 매수 (Before에는 HELD가 아니었는데 After에 HELD가 된 것)
                        const newBuys = afterPortfolio.filter(a => a.status === 'HELD' && !activePortfolio.find(b => b.stock_code === a.stock_code && (b.status === 'HELD' || b.status === 'IMMEDIATE_BUY')));

                        // 탈락 종목 (Before에는 있었으나 지금은 afterPortfolio에서 안 보이는 것)
                        const droppedList = activePortfolio.filter(b => !afterPortfolio.find(a => a.stock_code === b.stock_code));
                        const watchCount = afterPortfolio.filter(a => a.status === 'WATCHING' || a.status === 'WATCHLIST').length;
                        const buyCount = afterPortfolio.filter(a => a.status === 'HELD' || a.status === 'IMMEDIATE_BUY').length;

                        let tgMsg = `🧑‍💼 [PM 2차 리밸런싱 완료]\n`;
                        tgMsg += `📊 포지션 현황: 매수 ${buyCount} / 관심 ${watchCount}`;

                        if (newBuys.length > 0) {
                            tgMsg += `\n\n🎉 [신규 매수 승급]`;
                            newBuys.forEach(b => {
                                tgMsg += `\n- ${b.stock_name} (${b.strategy} | ${b.conviction_score}점)`;
                                const reasonMatch = parsed.decisions.find((d: any) => d.stock_code === b.stock_code);
                                const reason = reasonMatch ? (reasonMatch.last_signal_reason || reasonMatch.reason) : 'PM 매수 승급 확정';
                                this.db.logPortfolioEvent(b.stock_code, b.stock_name, 'BUY_UPGRADED', 'WATCHLIST', 'IMMEDIATE_BUY', reason || 'PM 매수 승급 확정', b.current_price || 0);
                            });
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
                            tgMsg += `\n\n🗑️ [포트폴리오 탈락(매도)]`;
                            droppedList.forEach(d => {
                                const droppedDb = rawDb.prepare("SELECT profit_rate FROM maiis_portfolio WHERE stock_code = ?").get(d.stock_code) as any;
                                tgMsg += `\n- ${d.stock_name} (최종 추정 수익률: ${droppedDb?.profit_rate || d.profit_rate || 0}%)`;
                                const reasonMatch = parsed.decisions.find((dInfo: any) => dInfo.stock_code === d.stock_code);
                                // DROP 판정을 직접 받은 경우, 아니면 Cap 초과 탈락인 경우로 추정
                                const reason = (reasonMatch && (reasonMatch.last_signal === 'SELL' || reasonMatch.last_signal === 'DROP'))
                                    ? (reasonMatch.last_signal_reason || 'PM 익/손절 판정')
                                    : '관심/매수 종목 한도 초과(Cap)에 따른 서바이벌 탈락';
                                this.db.logPortfolioEvent(d.stock_code, d.stock_name, 'DROPPED', d.status, 'CLEARED', reason, d.current_price || 0);
                                
                                // DROP된 종목 인큐베이터 강등 처리
                                this.db.demoteToIncubator({
                                    stock_code: d.stock_code,
                                    stock_name: d.stock_name,
                                    current_price: d.current_price || 0,
                                    last_signal_reason: reason,
                                    id: d.id
                                });
                            });
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
}
