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
            try { fs.appendFileSync(logPath, line); } catch (_) {}
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
            log(`[2] getActivePortfolio() = ${activePortfolio.length}개 (${activePortfolio.map((p:any)=>p.stock_code).join(',')})`);

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
            log(`[6] selectedPicks = ${selectedPicks.length}개 (${selectedPicks.map((p:any)=>p.stock_code).join(',')})`);

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
                    });
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
            } catch (_) {}
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
                const todayPicksFallback = this.db.getAiAnalystPicksByDate(dateStr) as any[];
                const newPicksFallback = todayPicksFallback.filter((p: any) => !activeCodes.has(p.stock_code));

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
            const limits = aiSettings.portfolioLimits || {
                buy: { MOMENTUM: 2, PULLBACK: 2, SWING: 4, VALUE: 2 },
                watchlist: { MOMENTUM: 3, PULLBACK: 3, SWING: 6, VALUE: 3 }
            };
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
2. **[강제 T/O 서바이벌 스코어링]**: 매수(BUY / HOLD / SELL)로 판정된 최상위 종목 혹은 청산종목을 제외한 >>나머지 모든 종목<<(기존 관심종목 + 새로 올라온 추천주 전체)에 대해서는 무단으로 탈락(DROP)시키지 마라.
대신에, 이들을 관심종목 후보(WATCHING)로 두고 각각 해당하는 전략(strategy) 내에서 0점~100점의 **매력도 점수(conviction_score)** 를 매우 촘촘하게(상대적인 랭킹을 매긴다는 느낌으로) 평가하라.
시스템적으로 각 전략 바스켓당 최대 허용 개수가 정해져 있으며, 네가 매긴 점수순으로 정렬한 뒤 시스템(코드)이 하위권 종목들을 자동으로 탈락(DROP) 처리할 것이다. 즉, 너의 역할은 후보 종목 간의 성적표(등수별 점수)를 냉정하게 매기는 것이다!

[전략 지정 기준]
각 종목의 strategy를 반드시 지정해야 하며(MOMENTUM, PULLBACK, SWING, VALUE 중 택1), 점수는 이 전략 바스켓 내에서의 경쟁력을 의미한다.
- MOMENTUM: 당일/초단기 재료와 거래량
- PULLBACK: 단기 눌림목 및 MA20 지지
- SWING: 중기 모멘텀 유지 (테마 내러티브 성장 가능성)
- VALUE: 저점 가치투자

[응답 가이드]
결과는 반드시 JSON 형식이어야 하며, 풀에 있는 모든 종목을 누락 없이 반환하여야 한다.
\`\`\`json
{
    "decisions": [
        {
            "stock_code": "000000",
            "stock_name": "종목명",
            "last_signal": "BUY | HOLD | SELL | WATCHING", // 매수/보유는 BUY/HOLD, 보유하다 매도할땐 SELL, 나머지 관심종목 후보들은 모두 WATCHING
            "conviction_score": 95, // WATCHING 종목일수록 이 점수가 랭킹 서바이벌의 결정적 요인이 됨 (100점에 가까울수록 생존률 높음)
            "strategy": "SWING",
            "lifespan_days": 20, // BUY 판정시에만 유효
            "analysts_json": ["REPORT", "MOMENTUM"], 
            "last_signal_reason": "알파 Top 5 + 방산. (BUY 이유 혹은 WATCHING 고득점 편성 이유 명시)"
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

                    // [추가] 매수 및 대기(WATCHING) 슬롯 분리 처리 배열
                    const buysAndSells: any[] = [];
                    const groupedWatchlist: Record<string, any[]> = { MOMENTUM: [], PULLBACK: [], SWING: [], VALUE: [] };
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
                        
                        let finalStatus = 'WATCHING';
                        
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
                                // AI가 아주 의도적으로 버린 쓰레기
                                dec.finalStatus = 'DROPPED';
                                dec.conviction_score = -1; 
                                validDecisions.push(dec);
                            } else {
                                // WATCHING 후보군 (나머지 전부)
                                dec.finalStatus = 'WATCHING';
                                const s = dec.strategy || 'SWING';
                                if (!groupedWatchlist[s]) groupedWatchlist[s] = [];
                                groupedWatchlist[s].push(dec);
                            }
                        }
                    }

                    // 카테고리별 Cut-Off 실행 (T/O 강제 충원 및 하위권 서바이벌 탈락 적용)
                    const watchLimits = limits.watchlist || { MOMENTUM: 2, PULLBACK: 2, SWING: 4, VALUE: 2 };
                    const cutOffDropped: any[] = [];
                    const survivedWatchlist: any[] = [];

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

                    const finalProcessed = [...buysAndSells, ...survivedWatchlist, ...cutOffDropped, ...validDecisions];

                    // DB 기록 실행 루프
                    for (const dec of finalProcessed) {
                        // AI가 직접 DROP한 것도 처리 (컷오프 서바이벌로 밀려난 종목들도 포함)
                        if (dec.finalStatus === 'DROPPED') {
                            const previousInfo = activePortfolio.find(p => p.stock_code === dec.finalCode);
                            if (previousInfo) {
                                // 기존에 포트폴리오에 있었던 종목이 밀려난 거라면 DB 상태 변경
                                this.db.updatePortfolioStatus(dec.finalCode, 'DROPPED', dec.last_signal_reason || '관심종목 서바이벌 컷오프 탈락');
                            }
                            continue; // 그 외 신규 픽이었다가 탈락한 건 DB에 넣을 필요 없으므로 생략
                        }

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
                        });

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

                                // ✅ 실제 매수(HELD) 포지션이었던 종목만 이벤트 로그 기록
                                // WATCHING → DROPPED 종목은 성적표/이벤트 로그 대상 아님
                                if (d.status === 'HELD' || d.status === 'IMMEDIATE_BUY') {
                                    this.db.logPortfolioEvent(d.stock_code, d.stock_name, 'DROPPED', d.status, 'CLEARED', reason, d.current_price || 0);
                                }
                                
                                // 인큐베이터 강등은 WATCHING/HELD 모두 대상
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
