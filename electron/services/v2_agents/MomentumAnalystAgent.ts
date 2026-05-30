import { AiExecutionQueue } from '../AiExecutionQueue';
import { DatabaseService } from '../DatabaseService';
import { KiwoomService } from '../KiwoomService';
import { NaverNewsService } from '../NaverNewsService';
import { isETFOrSPAC } from '../../utils/StockFilters';

export class MomentumAnalystAgent {
    private static instance: MomentumAnalystAgent;
    private db: DatabaseService;

    private constructor() {
        this.db = DatabaseService.getInstance();
    }

    public static getInstance(): MomentumAnalystAgent {
        if (!MomentumAnalystAgent.instance) {
            MomentumAnalystAgent.instance = new MomentumAnalystAgent();
        }
        return MomentumAnalystAgent.instance;
    }

    public async runAnalysis(targetDate?: string) {
        const dateStr = targetDate || this.db.getKstDate();
        console.log(`[MomentumAnalyst] 🤖 ${dateStr} 모멘텀/수급/뉴스 통합 메가 파이프라인(One-Shot) 분석 시작...`);
        const kiwoom = KiwoomService.getInstance();
        const naver = NaverNewsService.getInstance();
        
        try {
            const rawDb = (this.db as any).db;
            
            // 1. 순수 데이터 영끌 (AI 비개입)
            console.log(`[MomentumAnalyst] 실시간 시장 주도주 데이터 수집 중...`);
            let rawCombinedList = [] as any[];
            try {
                rawCombinedList = await kiwoom.getCombinedTopStocks(15, 15);
            } catch (kErr) {
                console.warn(`[MomentumAnalyst] 키움 실시간 데이터 수집 실패. 기존 DB 데이터로 폴백 시도...`);
                const fallbackList = rawDb.prepare(`
                    SELECT stock_code as code, stock_name as name, change_rate as changeRate, trading_value as tradingValue, 'DB_FALLBACK' as source 
                    FROM daily_rising_stocks 
                    WHERE date = ? 
                    ORDER BY trading_value DESC LIMIT 30
                `).all(dateStr) as any[];
                if (!fallbackList || fallbackList.length === 0) {
                    console.warn(`[MomentumAnalyst] 폴백 데이터도 존재하지 않습니다. 스킵합니다.`);
                    return null;
                }
                rawCombinedList = fallbackList;
            }
            
            // 필터링: ETF 등 노이즈 종목 제외
            let initialStocks = rawCombinedList.filter(s => {
                const name = s.name.toUpperCase().replace(/\s+/g, '');
                if (isETFOrSPAC(name)) return false;
                if (name.endsWith('우') || name.endsWith('우B') || name.includes('우(')) return false;
                if (s.changeRate <= 0) return false;
                return true;
            });

            // 상위 30개 한정
            const targetStocks = initialStocks.slice(0, 30);
            
            if (targetStocks.length === 0) {
                console.warn(`[MomentumAnalyst] ${dateStr} 시장 데이터 수집 실패로 스킵합니다.`);
                return null;
            }

            console.log(`[MomentumAnalyst] 총 ${targetStocks.length}개 종목의 최신 뉴스(10개씩) 및 과거 노트 수집 시작...`);

            // 2-A. 시장 전체 주체별 수급 수집 (PL-InvestorFlow)
            let investorFlowMarkdown = '';
            try {
                const { V2PipelineManager } = await import('../v2_pipeline/V2PipelineManager');
                const flowResult = await V2PipelineManager.getInstance().runPipeline('PL-InvestorFlow' as any);
                if (flowResult?.aggregatedMarkdown) {
                    investorFlowMarkdown = flowResult.aggregatedMarkdown;
                    console.log(`[MomentumAnalyst] ✅ 주체별 수급 데이터 수집 완료 (InvestorFlow)`);
                }
            } catch (e) {
                console.warn(`[MomentumAnalyst] ⚠️ 주체별 수급 데이터 수집 실패 (무시하고 계속):`, (e as any).message);
            }

            // 2-B. 이슈AI / 시황AI 맥락 수집 (IssueLedgerDB)
            let issueContextBlock = '';
            try {
                const { IssueLedgerDB } = await import('./IssueLedgerDB');
                const issueDb = IssueLedgerDB.getInstance();

                // 1) 일일 브리핑 (시황 AI 종합 판단)
                const briefing = issueDb.getLatestBriefing();
                if (briefing) {
                    issueContextBlock += `#### 📋 오늘의 시황 브리핑 (위험도: ${briefing.risk_score}/100)\n`;
                    issueContextBlock += `${briefing.summary_markdown}\n\n`;
                }

                // 2) 활성 이슈별 수혜/피해 섹터 정리
                const activeIssues = issueDb.getActiveIssues();
                const criticalIssues = activeIssues
                    .filter(i => ['CRITICAL', 'HIGH'].includes(i.severity))
                    .slice(0, 5); // 상위 5개만 (토큰 절약)

                if (criticalIssues.length > 0) {
                    issueContextBlock += `#### 🚨 현재 활성 핵심 이슈 & 섹터 영향\n`;
                    criticalIssues.forEach(issue => {
                        issueContextBlock += `\n**[${issue.severity}] ${issue.name}**\n`;
                        issueContextBlock += `> ${issue.current_stance || issue.summary || '분석 없음'}\n`;
                        if (issue.goodSectors?.length > 0) {
                            issueContextBlock += `- ✅ 수혜 섹터: ${issue.goodSectors.map(s => `${s.name}(${s.reason})`).join(' / ')}\n`;
                        }
                        if (issue.badSectors?.length > 0) {
                            issueContextBlock += `- ❌ 피해 섹터: ${issue.badSectors.map(s => `${s.name}(${s.reason})`).join(' / ')}\n`;
                        }
                    });
                    issueContextBlock += '\n';
                }
                console.log(`[MomentumAnalyst] ✅ 이슈 맥락 수집 완료 (활성 이슈 ${criticalIssues.length}개)`);
            } catch (e) {
                console.warn(`[MomentumAnalyst] ⚠️ 이슈 맥락 수집 실패 (무시하고 계속):`, (e as any).message);
            }

            // 2-C. 뉴스 및 과거 이력 수집 (병렬 제어)
            let promptContext = `[📊 오늘의 시장 주체별 수급 현황]\n${investorFlowMarkdown || '수급 데이터 없음'}\n\n---\n\n[🗞️ 시황·이슈 AI 맥락 (역발상 섹터 판별 핵심)]\n${issueContextBlock || '이슈 맥락 데이터 없음'}\n\n---\n\n[당일 시장 수급 및 급등주 ${targetStocks.length}선 Raw Data]\n\n`;

            
            // 2개씩 끊어서 뉴스 수집 (네이버 API Rate Limit 방지 - 1초에 10회 이하 유지)
            for (let i = 0; i < targetStocks.length; i += 2) {
                const chunk = targetStocks.slice(i, i + 2);
                
                await Promise.all(chunk.map(async (stock) => {
                    // 뉴스 수집 (최대 10개)
                    let newsDesc = '최신 뉴스 없음';
                    try {
                        const newsItems = await naver.searchNews(stock.name, 10);
                        if (newsItems && newsItems.length > 0) {
                            // HTML 태그와 불필요 공백을 지우는 전처리
                            newsDesc = newsItems.map((n: any) => {
                                const cleanDesc = (n.description || '').replace(/<[^>]*>?/gm, '').replace(/\s+/g, ' ').trim().slice(0, 100);
                                return `- ${n.title.replace(/<[^>]*>?/gm, '')} / ${cleanDesc}`;
                            }).join('\n');
                        }
                    } catch (e) {
                        console.warn(`[MomentumAnalyst] ${stock.name} 뉴스 수집 실패`);
                    }

                    // 과거 이력 수집 (최근 3건)
                    let pastDesc = '이전 기록 없음';
                    try {
                        const safeCode = stock.code.replace(/[^0-9]/g, '').padStart(6, '0');
                        const pastRecords = rawDb.prepare(`
                            SELECT date, reason 
                            FROM ai_analyst_picks 
                            WHERE stock_code = ? AND date < ? AND agent_type = 'MOMENTUM'
                            ORDER BY date DESC LIMIT 3
                        `).all(safeCode, dateStr) as any[];

                        if (pastRecords && pastRecords.length > 0) {
                            pastDesc = pastRecords.map((r: any) => `[${r.date}] 사유: ${r.reason}`).join('\n');
                        }
                    } catch (e) { }

                    promptContext += `### [${stock.name} (${stock.code})]\n`;
                    promptContext += `- 당일 거래대금: ${Number(stock.tradingValue).toLocaleString()}억\n`;
                    promptContext += `- 당일 등락률: ${stock.changeRate}%\n`;
                    promptContext += `- 특징: ${stock.source === 'RISING' ? '급등 랭킹 우선 진입' : '거래대금 랭킹 우선 진입'}\n`;
                    promptContext += `\n[최신 관련 뉴스 10건]\n${newsDesc}\n`;
                    promptContext += `\n[과거 AI 분석 노트]\n${pastDesc}\n`;
                    promptContext += `-------------------------------------------------\n\n`;
                }));

                // Rate limit 방지 딜레이
                await new Promise(r => setTimeout(r, 200));
            }

            // 3. 메가 프롬프트 작성
            const systemPrompt = `너는 대한민국 주식시장의 천재적인 모멘텀/수급 트레이더이자, 각 종목의 깊은 내막을 알고 있는 리서치 센터장이다.
너에게는 오늘 시장을 가장 강하게 주도하는 ${targetStocks.length}개의 주도주 정보(거래대금, 등락률, 종목별 최신 뉴스 10건, 과거 흐름 노트)가 '단 한 번에' 주어졌다.
이 방대한 문맥(Context) 속에서 전체 지도의 퍼즐을 맞추며 다음 임무를 수행해야 한다.

[🏦 수급 + 이슈 맥락 통합 판단 원칙 — 반드시 준수]
오늘의 시장 주체별 수급 현황과 이슈AI/시황AI의 분석 결과가 함께 제공된다.

1. **수급은 '맥락 파악'용** — 코스피/코스닥 전체 외인 순매도 = 시장 분위기 파악. 이것만으로 종목 확신도를 낮추지 마라.
2. **이슈 '수혜 섹터' 종목은 시장 하락 시에도 역발상 매수 기회** — 관세 전쟁 → 방산 수혜 섹터 급등은 확신도 +15~20점 가산. 이슈 피해 섹터 반등은 추격 금물.
3. **시황 브리핑의 dominant_regime(국면)과 종목을 매칭** — "내수/안전자산 순환 국면"이면 수출주 대신 내수주 우대.
4. **수급+이슈 쌍발 신호** — 이슈 수혜 섹터이면서 동시에 해당 시장(코스피/코스닥) 외인 순매수이면 최고 확신도. 반대(이슈 피해 + 외인 순매도)이면 단호히 제외.
5. **개인 단독 급등 경고** — 시장 전체 외인 순매도 + 이슈 맥락 없는 급등 = 개인 세력 작전 가능성. 확신도 -20점.

[지시사항] 통합 주도주 분석 리포트(analyzed_stocks) 작성
- 제공된 모든 맥락(수급 + 이슈 수혜·피해 섹터 + 시황 국면)을 교차하여 '진짜 수익 가능한 주도 종목(최대 10개 내외)'을 선별하라.
- 뉴스 요약과 거래대금 파워를 결합해 "이 상승이 이슈 맥락과 맞닿아 있는지", "단순 개인 세력 장난인지" 날카롭게 짚어 종합적인 사유(reason)로 서술해라.
- 각 종목마다 '매수 확신도(confidence)'를 0~100으로 평가.
- **[매우 중요 - 매수 가설(Thesis) 구체화 및 기각 조건 명시]**:
  reason 서술 시 단순히 "수급이 몰렸다"고 표현하지 말고, 반드시 아래 3가지 요소를 포함하여 구체적이고 완결성 있는 매수 가설로 서술하라.
  ① **이슈 맥락 및 수급 환경** (수혜/피해 여부와 매수 주체)
  ② **매수 가설 (Catalyst)**: 향후 3~5일 내에 결론이 나거나 시세를 분출할 구체적 재료/모멘텀
  ③ **기각 조건 (Invalidation Point)**: 이 추천이 틀렸음을 증명하는 구체적인 기술적/재료적 조건 (예: 5일선 종가 이탈 시 기각, 특정 발표 지연 시 기각 등)

결과물은 오직 JSON으로만 반환하라. 시작이나 끝에 마크다운 이외의 불필요한 사족은 달지 마라.
\`\`\`json
{
    "analyzed_stocks": [
        {
            "stock_code": "000000",
            "stock_name": "종목명",
            "reason": "[모멘텀 및 재료 분석] 오늘 어떤 뉴스 때문에 수급이 몰렸는지, 과거 흐름 대비 어떤 파급력이 있는지에 대한 완결형 상세 인사이트",
            "confidence": 95,
            "lifespan_days": 10
        }
    ]
}
\`\`\``;

            console.log(`[MomentumAnalyst] AI에게 100만 컨텍스트 메가 프롬프트 전송 시작... (Tokens 대기 중)`);
            const response = await AiExecutionQueue.getInstance().enqueue({
                agentId: 'MOMENTUM_ANALYST',
                agentName: '수급/모멘텀 분석기',
                triggerType: 'CRON',
                targetType: 'gemini',
                prompt: promptContext,
                systemInstruction: systemPrompt
            });

            const jsonMatch = response.match(/```json\n([\s\S]*?)\n```/);
            if (jsonMatch && jsonMatch[1]) {
                const parsed = JSON.parse(jsonMatch[1]);
                
                if (parsed.analyzed_stocks && Array.isArray(parsed.analyzed_stocks)) {
                    const mappedPicks = parsed.analyzed_stocks.map((p: any) => ({
                        date: dateStr,
                        agent_type: 'MOMENTUM',
                        stock_code: p.stock_code,
                        stock_name: p.stock_name,
                        reason: p.reason,
                        confidence: p.confidence,
                        lifespan_days: p.lifespan_days || 5,
                        created_at: this.db.getKstTimestamp()
                    }));

                    if (mappedPicks.length > 0) {
                        this.db.saveAiAnalystPicks(mappedPicks);
                        console.log(`[MomentumAnalyst] ✅ ${mappedPicks.length}개 수급/모멘텀 통합 리포트 DB 저장 완료.`);
                    }
                    return mappedPicks;
                }
            }

            console.warn(`[MomentumAnalyst] 파싱 실패 또는 분석 결과 없음:`, response);
            return null;

        } catch (e) {
            console.error(`[MomentumAnalyst] 분석 중 오류 발생:`, e);
            throw e;
        }
    }
}
