import { AiExecutionQueue } from '../AiExecutionQueue';
import { DatabaseService } from '../DatabaseService';

/**
 * AI가 생성한 종목명으로 stocks_master를 검색, 실제 종목코드를 반환합니다.
 * 1차: 완전 일치 / 2차: 정규화 후 일치(주식회사·Inc 등 제거) / 3차: 부분 문자열 포함
 * 모두 실패 시 null 반환 → 해당 pick 제거
 */
function resolveStockCode(db: DatabaseService, aiName: string, aiCode: string): { stock_code: string; stock_name: string } | null {
    const rawDb = (db as any).db;

    // 1차: AI가 준 코드가 6자리 숫자이고 실제 존재하면 그대로 사용
    if (/^\d{6}$/.test(aiCode)) {
        const byCode = rawDb.prepare('SELECT stock_code, stock_name FROM stocks_master WHERE stock_code = ?').get(aiCode);
        if (byCode) return byCode;
    }

    // 2차: 종목명 완전 일치
    const exact = rawDb.prepare('SELECT stock_code, stock_name FROM stocks_master WHERE stock_name = ?').get(aiName);
    if (exact) return exact;

    // 3차: 정규화 (주식회사, (주), Inc, Corp 등 제거 후 일치)
    const normalized = aiName
        .replace(/(주식회사|\(주\)|\(코스닥\)|\(코스피\)|Inc\.?|Corp\.?|Co\.?)/gi, '')
        .trim();
    if (normalized.length >= 2) {
        const normMatch = rawDb.prepare('SELECT stock_code, stock_name FROM stocks_master WHERE stock_name = ?').get(normalized);
        if (normMatch) return normMatch;
    }

    // 4차: 부분 문자열 포함 (LIKE) — 가장 짧은 종목명 우선 (오탐 최소화)
    if (normalized.length >= 2) {
        const likeMatches = rawDb.prepare(
            'SELECT stock_code, stock_name FROM stocks_master WHERE stock_name LIKE ? ORDER BY LENGTH(stock_name) ASC LIMIT 1'
        ).get(`%${normalized}%`);
        if (likeMatches) return likeMatches;
    }

    return null;
}

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

            // ─── [NEW] 당일 기업 실적/수주 속보 뉴스 필터링 ───
            const filteredNewsRows = rawDb.prepare(`
                SELECT title, source, body_snippet 
                FROM naver_news_flow 
                WHERE date = ? AND category = 'STOCK_ANALYSIS'
            `).all(dateStr) as any[];

            const targetKeywords = /실적|영업이익|흑자|수주|공급계약|임상|수출|FDA|사상 최대|어닝/i;
            const coreNews = filteredNewsRows.filter((n: any) => targetKeywords.test(n.title) || targetKeywords.test(n.body_snippet));

            let newsContext = `[당일 기업 실적/수주 속보 뉴스]\n\n`;
            if (coreNews.length === 0) {
                newsContext += `오늘은 주목할 만한 실적/수주 뉴스가 없습니다.\n`;
            } else {
                coreNews.slice(0, 15).forEach((n: any, idx: number) => {
                    newsContext += `**${idx + 1}. ${n.title}** (${n.source})\n> ${n.body_snippet}\n\n`;
                });
            }
            promptContext += `\n\n` + newsContext;

            const systemPrompt = `너는 여의도의 최고참 프랍 트레이더이자 리서치 센터장이다.
오늘 수집된 두 가지 펀더멘털 소스(증권사 리포트 요약본과 핵심 실적/수주 뉴스)를 모두 분석하라.
단순 동향, '유지(HOLD)', 무의미한 사업 협약 등의 브리핑은 걸러내고, 가장 폭발력이 강한 진짜 가치주를 선별한다.

[2-Track 선별 원칙]
너는 다음 두 가지 트랙에서 각각 가장 유망한 종목을 최대 3개씩 선별한다 (총 6개 이하).
트랙 A (증권사 리포트): '구조적 증익', '어닝 서프라이즈 전망', '목표주가 30% 이상 상향' 등 펀더멘털 리레이팅이 명백한 종목
트랙 B (실적/수주 뉴스): '대규모 수주 공시', '흑자 전환', '사상 최대 영업이익' 등 즉각적이고 폭발적인 매출 발생 속보가 뜬 종목

어떤 종목명인지 제목이나 요약에서 정확히 유추할 수 있어야 한다.

- **[매우 중요 - 매수 가설(Thesis) 구체화 및 기각 조건 명시]**:
  reason 서술 시 단순히 "리포트가 좋다"고 표현하지 말고, 반드시 아래 3가지 요소를 포함하여 구체적이고 완결성 있는 매수 가설로 서술하라.
  ① **이슈 맥락 및 실적 수급 환경** (호실적/수주 등 핵심 펀더멘털 내용)
  ② **매수 가설 (Catalyst)**: 향후 실적 턴어라운드 및 목표가 상향 달성 기대의 구체적 타당성
  ③ **기각 조건 (Invalidation Point)**: 이 추천이 틀렸음을 증명하는 구체적인 리스크/재료적 조건 (예: 다음 분기 영업이익 전년비 감소 시 기각, 주요 고객사 납품 연기/취소 시 기각 등)

결과물은 오직 JSON으로만 반환하라.
\`\`\`json
{
    "picks": [
        {
            "stock_code": "000000",
            "stock_name": "리포트나 뉴스에서 유추한 정확한 상장 기업명",
            "reason": "[리포트] 1분기 어닝 서프라이즈 확실시, 목표주가 40% 상향됨 OR [어닝공시] 400억 규모 공급계약 체결로 흑자전환 확정",
            "confidence": 90,
            "lifespan_days": 20
        }
    ]
}
\`\`\``;

            const response = await AiExecutionQueue.getInstance().enqueue({
                agentId: 'FUNDAMENTAL_ANALYST',
                agentName: '펀더멘탈 AI',
                triggerType: 'CRON',
                targetType: 'gemini',
                prompt: promptContext,
                systemInstruction: systemPrompt
            });

            const jsonMatch = response.match(/```json\n([\s\S]*?)\n```/);
            if (jsonMatch && jsonMatch[1]) {
                const parsed = JSON.parse(jsonMatch[1]);
                if (parsed.picks && Array.isArray(parsed.picks)) {
                    // ── 종목코드 검증 및 교체 (핵심 후처리) ──
                    const resolvedPicks: any[] = [];
                    for (const p of parsed.picks) {
                        const resolved = resolveStockCode(this.db, p.stock_name, p.stock_code);
                        if (!resolved) {
                            console.warn(`[FundamentalAnalyst] ⚠️ 종목코드 매칭 실패, 제외: "${p.stock_name}" (AI코드: ${p.stock_code})`);
                            continue; // 매칭 실패 종목은 evalPool에 넣지 않음
                        }
                        if (resolved.stock_code !== p.stock_code) {
                            console.log(`[FundamentalAnalyst] 🔧 종목코드 교정: "${p.stock_name}" ${p.stock_code} → ${resolved.stock_code} (${resolved.stock_name})`);
                        }
                        resolvedPicks.push({
                            date: dateStr,
                            agent_type: 'REPORT',
                            stock_code: resolved.stock_code,
                            stock_name: resolved.stock_name, // DB의 공식 종목명으로 교체
                            reason: p.reason,
                            confidence: p.confidence,
                            lifespan_days: p.lifespan_days || 20,
                            created_at: this.db.getKstTimestamp()
                        });
                    }

                    if (resolvedPicks.length > 0) {
                        this.db.saveAiAnalystPicks(resolvedPicks);
                        console.log(`[FundamentalAnalyst] ✅ ${resolvedPicks.length}개 펀더멘털/리포트 종목 추천 완료 (총 ${parsed.picks.length}개 중 코드 검증 통과).`);
                    } else {
                        console.warn(`[FundamentalAnalyst] ⚠️ 모든 AI 추천 종목이 종목코드 검증 실패로 제외됨.`);
                    }
                    return resolvedPicks;
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
