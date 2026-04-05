import { AiExecutionQueue } from '../AiExecutionQueue';
import { DatabaseService } from '../DatabaseService';
import { KiwoomService } from '../KiwoomService';
import { TechnicalAnalyzer } from './TechnicalAnalyzer';

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
                } catch (e) {}
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

            // 1. Fetch today's picks from the 3 analysts
            const todaysPicks = this.db.getAiAnalystPicksByDate(dateStr) as any[];
            if (!todaysPicks || todaysPicks.length === 0) {
                console.warn(`[PortfolioManager] ${dateStr} 당일 전송된 애널리스트 추천 종목이 없습니다.`);
                return null;
            }

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

            // Add/Merge today's picks
            todaysPicks.forEach(pick => {
                if (!evalPool[pick.stock_name]) {
                    evalPool[pick.stock_name] = {
                        stock_code: pick.stock_code,
                        stock_name: pick.stock_name,
                        source: 'NEW_PICK',
                        analysts: [],
                        today_analysts: []
                    };
                } else {
                    evalPool[pick.stock_name].source = 'PORTFOLIO_AND_PICK';
                    if (!evalPool[pick.stock_name].today_analysts) {
                        evalPool[pick.stock_name].today_analysts = [];
                    }
                }
                
                if (pick.stock_name && pick.stock_code) {
                    codeMap[pick.stock_name] = pick.stock_code;
                }
                
                evalPool[pick.stock_name].today_analysts.push({
                    type: pick.agent_type,
                    reason: pick.reason,
                    confidence: pick.confidence,
                    lifespan: pick.lifespan_days
                });
            });

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
3. **시황 위험도 반영**: 브리핑의 risk_score가 80 이상이면 IMMEDIATE_BUY 기준을 평소보다 10점 높여 적용. 60 미만이면 적극적 편입.
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
3. [차트 분석 교본 최우선 반영]: 위에 주입된 '차트 리스크 분석 교본'의 조건(이격도, 단기 모멘텀, 역배열 등)을 절대적으로 준수하라. 가이드북의 위험 기준에 해당할 경우 스토리가 아무리 좋아도 추격매수(IMMEDIATE_BUY)를 불허한다.
4. 기존 보유 종목 중 수익률이 부진하고 한 달 이상 모멘텀이 죽었다면 과감히 떨어내라(DROP). 단, strategy가 PULLBACK/VALUE인 종목은 위 전략별 기준을 따른다.
5. 주도 대장주는 여러 애널리스트(서브 AI)들이 중복으로 추천하거나 타임라인에 등장 빈도가 높을 수밖에 없다. 여러 근거가 합쳐질수록 편입 확신도를 극대화해라.
6. 각 종목에 대해 팩트시트를 근거로 '최종 확신 점수(conviction_score: 0~100)'와 '포지션(IMMEDIATE_BUY, WAIT_DIP, HOLD, DROP, HIT)'을 내려라.
7. last_signal_reason 서술 시 ①시장 맥락(Alpha 포함 여부, 이슈 수혜/피해 섹터 해당 여부) ②전략별 판단 근거를 반드시 명시하라.

응답은 오직 JSON 형식으로만 작성해라:
\`\`\`json
{
    "decisions": [
        {
            "stock_code": "000000",
            "stock_name": "종목명",
            "status": "WATCHLIST",
            "last_signal": "IMMEDIATE_BUY | WAIT_DIP | HOLD | DROP",
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
                systemInstruction: systemPrompt,
                customModel: 'gemini-exp-1206'
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

                        // 차트 요약 텍스트에서 현재가를 파싱하여 DB 기록 시 활용
                        let curPrice = 0;
                        const match = specificContext.match(/현재가: ([0-9,]+)원/);
                        if (match && match[1]) {
                            curPrice = parseInt(match[1].replace(/,/g, ''), 10);
                        }

                        this.db.upsertPortfolioWatchlist({
                            stock_code: finalCode,
                            stock_name: dec.stock_name,
                            status: dec.last_signal === 'DROP' ? 'DROPPED' : (dec.status || 'WATCHLIST'),
                            strategy: dec.strategy || 'SWING',
                            conviction_score: dec.conviction_score,
                            theme: dec.analysts_json.join(', '),
                            last_signal: dec.last_signal,
                            last_signal_reason: dec.last_signal_reason,
                            analysts_json: dec.analysts_json,
                            lifespan_days: dec.lifespan_days,
                            entry_date: dateStr,
                            created_at: this.db.getKstTimestamp(),
                            raw_context: specificContext,
                            current_price: curPrice,
                            entry_price: curPrice
                        });

                        // 장중 파이프라인의 경우 현재가가 존재하면 추천종목 테이블의 0원 기준가도 후행적으로 실시간 업데이트
                        if (curPrice > 0) {
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
