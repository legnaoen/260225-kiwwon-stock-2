const fs = require('fs');
const path = require('path');

const pmPath = path.join(__dirname, 'electron/services/v2_agents/PortfolioManagerAgent.ts');
let code = fs.readFileSync(pmPath, 'utf8');

// 1. Rename runDailyReview to runPhase2_Rebalancing
code = code.replace(
    'public async runDailyReview(targetDate?: string) {',
    `public async runDailyReview(targetDate?: string) {
        await this.runPhase1_Screening(targetDate);
        return await this.runPhase2_Rebalancing(targetDate);
    }
    
    public async runPhase2_Rebalancing(targetDate?: string) {`
);

// 2. Remove Phase 1's "today's picks" block from Phase 2
code = code.replace(
    `            // 1. Fetch today's picks from the 3 analysts
            const todaysPicks = this.db.getAiAnalystPicksByDate(dateStr) as any[];
            if (!todaysPicks || todaysPicks.length === 0) {
                console.warn(\`[PortfolioManager] \${dateStr} 당일 전송된 애널리스트 추천 종목이 없습니다.\`);
                return null;
            }`,
    `            // 1. Phase 2는 오직 Active Portfolio(위치: maiis_portfolio)만 평가합니다. (Phase 1 통과자 포함)`
);

code = code.replace(
    `            // Add/Merge today's picks
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
                
                // Keep references to today's reasoning if available
                if (pick.analyst && typeof pick.analyst === 'string') {
                    evalPool[pick.stock_name].today_analysts.push({
                        agent: pick.analyst,
                        reason: pick.reason,
                        confidence: pick.confidence,
                        lifespan: pick.lifespan_days
                    });
                }
            });`,
    `            // Phase 2에서는 오늘의 미통과 추천주(NEW_PICK)를 무시합니다 (Phase 1에서 걸러져서 WATCHLIST로 들어옴)`
);

// 3. Inject runPhase1_Screening logic before runPhase2_Rebalancing (or inside the class)
const phase1Logic = `
    public async runPhase1_Screening(targetDate?: string) {
        const kiwoomSvc = KiwoomService.getInstance();
        const dateStr = targetDate || this.db.getKstDate();
        console.log(\`[PortfolioManager] 🧑‍💼 \${dateStr} 1차 심사 (루키 오디션) 시작...\`);

        try {
            const todaysPicks = this.db.getAiAnalystPicksByDate(dateStr) as any[];
            if (!todaysPicks || todaysPicks.length === 0) {
                console.warn(\`[PortfolioManager] 1차 심사 대상이 없습니다 (당일 추천주 없음).\`);
                return null;
            }

            // Remove already active portfolio stocks from Phase 1 evaluation to save tokens (they go straight to Phase 2)
            const activePortfolio = this.db.getActivePortfolio() as any[];
            const activeCodeSet = new Set(activePortfolio.map(p => p.stock_code));
            const newPicks = todaysPicks.filter(p => !activeCodeSet.has(p.stock_code));

            if (newPicks.length === 0) {
                console.log(\`[PortfolioManager] 추천주 전원이 이미 포트폴리오에 있습니다. 1차 심사 패스.\`);
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
                    
                    let ds = \`[$\{s.stock_name} (\${s.stock_code})]\n\`;
                    ds += \`> 차트 리스크 분석:\\n\${s.chart_digest}\\n\`;
                    ds += \`> 오늘 애널리스트 추천 근거:\\n\`;
                    s.today_analysts.forEach((a: any) => ds += \`- [\${a.agent}] \${a.reason}\\n\`);
                    s.dossier = ds;
                }));
                if (i + 3 < stockList.length) await new Promise(r => setTimeout(r, 300));
            }

            const aiSettings: any = store.get('ai_settings') || {};
            const phase1PassLimit = aiSettings.phase1PassLimit || 10;

            const promptContext = \`[1차 심사 대상 신규 종목 총 \${stockList.length}개]\\n\\n\` + stockList.map(s => s.dossier).join('\\n\\n');
            const systemPrompt = \`너는 헤지펀드 매니저다. 오늘은 \${stockList.length}개의 새로운 종목 추천이 올라왔다.
모든 종목을 살 수는 없다. 차트 이격도가 너무 높거나(과열), 재료가 부실한 종목은 즉시 쳐내라(DROP).
절대평가를 통해 최대 \${phase1PassLimit}개의 종목만 2차 심사(WATCHLIST)로 올려보내라.

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
\`\`\`\`;

            console.log(\`[PortfolioManager] 1차 심사 요청 전송 중... (후보 \${stockList.length}개, 최대 \${phase1PassLimit}개 통과)\`);
            const response = await AiExecutionQueue.getInstance().enqueue({
                agentId: 'PORTFOLIO_MANAGER_PHASE1',
                agentName: '포트폴리오 매니저 (1차)',
                triggerType: 'CRON',
                targetType: 'gemini',
                prompt: promptContext,
                systemInstruction: systemPrompt,
                customModel: 'gemini-1.5-flash' // 1차는 더 빠르고 저렴한 모델도 가능
            });

            let jsonStr = response;
            const jsonMatch = response.match(/\`\`\`(?:json)?\\n?([\\s\\S]*?)\\n?\`\`\`/);
            if (jsonMatch && jsonMatch[1]) jsonStr = jsonMatch[1];
            
            const parsed = JSON.parse(jsonStr);
            let passedCount = 0;
            
            if (parsed.decisions) {
                // 상위 패스리밋만큼만 커트
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
                        last_signal_reason: \`[1차 심사 통과] \${dec.reason}\`,
                        theme: '',
                        analysts_json: ['PHASE1_PASS'],
                        lifespan_days: null,
                        entry_date: dateStr,
                        created_at: this.db.getKstTimestamp(),
                        raw_context: '1차 풀 통과',
                        current_price: 0,
                        entry_price: 0
                    });
                    passedCount++;
                }
            }
            console.log(\`[PortfolioManager] 1차 심사 완료: \${stockList.length}개 후보 중 \${passedCount}개 종목이 2차 심사로 진출(WATCHLIST 편입).\`);
            return parsed;
        } catch (e) {
            console.error(\`[PortfolioManager] 1차 심사 에러:\`, e);
        }
    }
`;

code = code.replace(
    'public async runPhase2_Rebalancing(targetDate?: string) {',
    phase1Logic + '\n    public async runPhase2_Rebalancing(targetDate?: string) {'
);

fs.writeFileSync(pmPath, code, 'utf8');
console.log('Successfully refactored PortfolioManagerAgent.ts for Phase 1 & 2');
