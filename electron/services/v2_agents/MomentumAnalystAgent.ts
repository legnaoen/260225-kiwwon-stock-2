import { AiExecutionQueue } from '../AiExecutionQueue';
import { DatabaseService } from '../DatabaseService';
import { KiwoomService } from '../KiwoomService';
import { NaverNewsService } from '../NaverNewsService';

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
            const etfKeywords = ['ETF', 'ETN', 'KODEX', 'TIGER', 'ACE', 'KBSTAR', 'ARIRANG', 'HANARO', 'SOL', 'KOSEF', 'KINDEX', '스팩', 'SPAC'];
            let initialStocks = rawCombinedList.filter(s => {
                const name = s.name.toUpperCase().replace(/\s+/g, '');
                if (etfKeywords.some(kw => name.includes(kw.toUpperCase()))) return false;
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
            
            // 2. 뉴스 및 과거 이력 수집 (병렬 제어)
            let promptContext = `[당일 시장 수급 및 급등주 ${targetStocks.length}선 Raw Data]\n\n`;
            
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

[지시사항] 통합 주도주 분석 리포트(analyzed_stocks) 작성
- 30개 종목을 서로 비교하면서 돈(수급)이 확실하게 쏠리고, 뉴스와 재료가 강하게 맞물리는 '의미 있는 주도 종목(최대 15개 내외)'을 골라 현미경 분석 노트를 작성한다.
- 뉴스 요약과 거래대금 파워를 결합해 "이 상승이 과거의 단순 연장선인지", "진짜 폭발적인 신규 수급 유입인지" 날카롭게 짚어 종합적인 사유(reason)로 서술해라.
- 각 종목마다 이 종목이 얼마나 강력한 대장주인지 '매수 확신도(confidence)'를 0~100 사이로 평가해라. 확신도가 높은 종목일수록 포트폴리오 편입 확률이 높아진다.

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
                taskType: 'MOMENTUM_ANALYST',
                modelName: 'gemini-exp-1206', 
                prompt: systemPrompt + '\n\n' + promptContext,
                temperature: 0.1
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
