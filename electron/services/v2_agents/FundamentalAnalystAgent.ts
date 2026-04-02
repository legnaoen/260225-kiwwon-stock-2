import { AiExecutionQueue } from '../AiExecutionQueue';
import { DatabaseService } from '../DatabaseService';

export class FundamentalAnalystAgent {
    private static instance: FundamentalAnalystAgent;
    private db: DatabaseService;

    private constructor() {
        this.db = DatabaseService.getInstance();
    }

    public static getInstance(): FundamentalAnalystAgent {
        if (!FundamentalAnalystAgent.instance) {
            FundamentalAnalystAgent.instance = new FundamentalAnalystAgent();
        }
        return FundamentalAnalystAgent.instance;
    }

    public async runAnalysis(targetDate?: string) {
        const dateStr = targetDate || this.db.getKstDate();
        console.log(`[FundamentalAnalyst] 🤖 ${dateStr} 펀더멘털/증권사 리포트 분석 시작...`);

        try {
            const rawDb = (this.db as any).db;
            
            // 1. Get today's research reports
            let reports = rawDb.prepare(`
                SELECT industry_name, report_title, analyst, broker, content_snippet 
                FROM naver_research_flow 
                WHERE date = ? 
            `).all(dateStr) as any[];

            if (!reports || reports.length === 0) {
                console.warn(`[FundamentalAnalyst] ${dateStr} 당일 증권사 리포트 데이터가 없어 AI 파이프라인(PL-Research)을 자동 실행합니다...`);
                try {
                    const { V2PipelineManager } = await import('../v2_pipeline/V2PipelineManager');
                    await V2PipelineManager.getInstance().runPipeline('PL-Research', { forceFetch: true });
                    
                    reports = rawDb.prepare(`
                        SELECT industry_name, report_title, analyst, broker, content_snippet 
                        FROM naver_research_flow 
                        WHERE date = ? 
                    `).all(dateStr) as any[];
                } catch (pipeErr) {
                    console.error('[FundamentalAnalyst] 파이프라인 자동 실행 실패:', pipeErr);
                }
            }

            if (!reports || reports.length === 0) {
                console.warn(`[FundamentalAnalyst] ${dateStr} 파이프라인 실행 후에도 당일 증권사 리포트 데이터가 없어 스킵합니다.`);
                return null;
            }

            let promptContext = `[당일 네이버 증권 리서치 집중 산업 & 리포트 요약]\n\n`;
            
            // Group by industry
            const byIndustry: Record<string, any[]> = {};
            reports.forEach(r => {
                if (!byIndustry[r.industry_name]) byIndustry[r.industry_name] = [];
                byIndustry[r.industry_name].push(r);
            });

            for (const ind of Object.keys(byIndustry)) {
                promptContext += `### [${ind}] 섹터 리포트\n`;
                byIndustry[ind].forEach(r => {
                    promptContext += `- 제목: ${r.report_title} (${r.broker}, ${r.analyst})\n`;
                    promptContext += `  요약: ${r.content_snippet}\n`;
                });
                promptContext += `\n`;
            }

            const systemPrompt = `너는 여의도의 최고참 프랍 트레이더이자 리서치 센터장이다.
아래는 오늘 발간된 각종 산업 및 기업 리포트의 주요 내용(제목과 스니펫)이다. 
단순 동향이나 '시장 예상치 부합', '유지(HOLD)' 사인의 브리핑성 리포트는 전부 다 걸러내라.
오직 '구조적 증익', '영업 이익 턴어라운드', '시장 예상 밖 수주 대박', '목표주가 대폭 상향' 과 같이 폭발력이 가장 강한 종목만 찾아내라. 리포트 제목과 내용을 보면 이 리포트가 어떤 개별 종목을 대상으로 썼는지 유추할 수 있다.

[펀더멘털 선별 원칙]
1. 단순 매크로/경제 시황 분석 문서는 버린다. (종목 유추 불가 시 버림)
2. 가장 호평받고, 1달 내에 +15% 상승 논리가 명백한 찐 실적(펀더멘털) 가치주를 최대 3개 선별하라.
3. 어떤 종목명인지 제목이나 요약에서 유추할 수 있어야 한다. 만약 개별 기업 리포트가 아니면 제외하라.

결과물은 오직 JSON으로만 반환하라.
\`\`\`json
{
    "picks": [
        {
            "stock_code": "해당 종목의 6자리 숫자 코드 (검색이 불가능하면 000000으로 기입)",
            "stock_name": "유추된 기업명",
            "reason": "테마가 아닌 오직 리포트의 펀더멘털, 밸류에이션 리레이팅 관점에서의 추천 논리 (ex. 1분기 어닝 서프라이즈 확실시, 목표주가 66,000원으로 40% 상향 조정 등)",
            "confidence": 90,
            "lifespan_days": 20
        }
    ]
}
\`\`\``;

            const response = await AiExecutionQueue.getInstance().enqueue({
                taskType: 'FUNDAMENTAL_ANALYST',
                modelName: 'gemini-exp-1206',
                prompt: systemPrompt + '\n\n' + promptContext,
                temperature: 0.1
            });

            const jsonMatch = response.match(/```json\n([\s\S]*?)\n```/);
            if (jsonMatch && jsonMatch[1]) {
                const parsed = JSON.parse(jsonMatch[1]);
                if (parsed.picks && Array.isArray(parsed.picks)) {
                    let mappedPicks = parsed.picks.map((p: any) => ({
                        date: dateStr,
                        agent_type: 'REPORT',
                        stock_code: p.stock_code,
                        stock_name: p.stock_name,
                        reason: p.reason,
                        confidence: p.confidence,
                        lifespan_days: p.lifespan_days || 20,
                        created_at: this.db.getKstTimestamp()
                    }));

                    if (mappedPicks.length > 0) {
                        this.db.saveAiAnalystPicks(mappedPicks);
                        console.log(`[FundamentalAnalyst] ✅ ${mappedPicks.length}개 펀더멘털/리포트 종목 추천 완료.`);
                    }
                    return mappedPicks;
                }
            }

            console.warn(`[FundamentalAnalyst] 파싱 실패 또는 추천 종목 없음:`, response);
            return null;

        } catch (e) {
            console.error(`[FundamentalAnalyst] 분석 중 오류 발생:`, e);
            throw e;
        }
    }
}
