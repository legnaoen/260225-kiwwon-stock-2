import { DatabaseService } from './DatabaseService';
import { AiService } from './AiService';
import { eventBus, SystemEvent } from '../utils/EventBus';
import { JsonUtils } from '../utils/JsonUtils';

export class MaiisDomainService {
    private static instance: MaiisDomainService;
    private db = DatabaseService.getInstance();
    private ai = AiService.getInstance();

    private constructor() {}

    public static getInstance() {
        if (!MaiisDomainService.instance) {
            MaiisDomainService.instance = new MaiisDomainService();
        }
        return MaiisDomainService.instance;
    }

    /**
     * 유튜브 원본 자막(Transcript)을 긁어와 '개인투자자(FOMO/FUD) 심리' 페르소나로 분석합니다.
     */
    public async analyzeYoutubeDomain(date?: string): Promise<{ success: boolean; data?: any; error?: string }> {
        const targetDate = date || this.db.getKstDate();
        try {
            // 1. DB에서 오늘 자로 수집된 유튜브 원본 자막 로그들을 가져옵니다. (기존 크롤러 사용)
            // Note: youtube_narrative_logs 테이블에서 최근 5개 정도의 영상을 가져와 분석 (시간별 수집에 따라 다름)
            const rawLogs = this.db.getDb().prepare(`
                SELECT title, channel_id, transcript, summary_json 
                FROM youtube_narrative_logs 
                ORDER BY published_at DESC 
                LIMIT 15
            `).all() as any[];

            if (!rawLogs || rawLogs.length === 0) {
                return { success: false, error: '분석할 유튜브 원본 데이터가 없습니다.' };
            }

            // 2. 인풋 데이터 조합 (자막이나 개별 요약본 텍스트 압축 등)
            const rawInputText = rawLogs.map((log, idx) => {
                const content = log.transcript?.trim() ? log.transcript : (log.summary_json || '내용 없음');
                return `[영상${idx + 1}] 제목: ${log.title}\n발언 요약: ${String(content).slice(0, 1500)}...`;
            }).join('\n\n');

            // 3. MAIIS 전용 페르소나 프롬프트 (유튜브 = 개인 투자자의 광기/공포 탐지기)
            const systemPrompt = `
당신은 '대한민국 개인 투자자(Retail Investor)들의 심리 및 FOMO/FUD'를 전문적으로 추적하는 수급 심리학자입니다.
주어진 데이터는 주식 전문 유튜버들의 최신 영상 자막 및 제목입니다.
유튜버들이 지금 "무엇을 사라고 선동하는지", 혹은 "무엇을 두려워하고 패닉 셀을 조장하는지"를 분석하십시오.

[출력 요구사항 - 반드시 아래 JSON 규격으로만 응답할 것]
{
  "domain_summary": "현재 개인 투자자들의 투자 심리와 시장을 바라보는 관점 전반에 대한 깊이 있는 분석 (최소 3~5문장 이상 구체적으로 상세 서술)",
  "sentiment_index": 유튜브 광기 점수 (-1.0은 극도의 공포/현금 확보, 1.0은 극도의 맹신/투기적 매수),
  "trend_pivot": "이전과 대비하여 갑자기 등장한 특이점이나 급변한 군중 심리 변곡점 (상세 서술)",
  "vocal_risks": ["유튜버들이 공통적으로 경고하거나 우려하고 있는 시장의 꼬리 리스크 요인 1", "리스크 요인 2"],
  "top_themes": [
    {
      "theme_name": "개미들이 열광하거나 패닉에 빠진 주도 테마명 (관련된 증시 표준 섹터명)",
      "intensity": 테마의 강도/관심도 점수 (0~100),
      "evidence": "관련 영상들에서 뽑아낸 상징적 인용구 또는 주장의 핵심 논리 (2~3문장 이상 상세 서술)",
      "bullish_arguments": ["상승 또는 하락을 주장하는 구체적 근거 1", "구체적 근거 2"],
      "related_stocks": [
        {
          "stock": "특정 종목명",
          "context": "해당 종목을 콕 집어 언급한 구체적인 이유와 기대감/공포"
        }
      ],
      "related_keywords": ["세부 키워드1", "세부 키워드2", "세부 키워드3"]
    }
  ] // 영상 내용을 종합하여 최소 4개 ~ 최대 6개의 테마/섹터 도출
}
            `.trim();

            const userPrompt = `[최신 유튜브 자막 원본 데이터]\n${rawInputText}\n\n위 데이터를 분석하여 완벽한 JSON으로 응답하십시오.`;

            // 4. AI 호출 및 결과 저장
            const aiResponse = await this.ai.askGemini(userPrompt, systemPrompt);
            const parsedJson = JsonUtils.extractAndParse(aiResponse);

            // 5. DB 저장 (maiis_domain_insights)
            this.db.saveMaiisDomainInsight({
                date: targetDate,
                domain_type: 'YOUTUBE',
                raw_input_text: userPrompt,
                used_prompt: systemPrompt,
                generated_json: JSON.stringify(parsedJson, null, 2)
            });

            console.log(`[MaiisDomainService] Youtube Domain Insight Generated successfully.`);
            return { success: true, data: parsedJson };

        } catch (error: any) {
            console.error('[MaiisDomainService] Youtube Analysis Failed:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * 메가 트렌드 뉴스 원본을 긁어와 '거시경제/팩트 관점' 페르소나로 분석합니다.
     */
    public async analyzeNewsDomain(date?: string): Promise<{ success: boolean; data?: any; error?: string }> {
        const targetDate = date || this.db.getKstDate();
        try {
            // 1. 기존 뉴스 에이전트가 긁어둔 'source_news' (원본 기사 리스트)를 불러옵니다.
            const lastConsensus = this.db.getLatestMarketNewsConsensus(1)[0];
            
            if (!lastConsensus || !lastConsensus.source_news) {
                return { success: false, error: '분석할 뉴스 원본 소스가 없습니다. (MarketNewsService 수집 선행 필요)' };
            }

            let rawNewsItems = [];
            try {
                rawNewsItems = JSON.parse(lastConsensus.source_news);
            } catch (e) {
                return { success: false, error: '뉴스 원본 데이터 파싱에 실패했습니다.' };
            }

            // 2. 인풋 데이터 조합
            const rawInputText = rawNewsItems.map((n: any, idx: number) => `[기사${idx + 1}] ${n.title}`).join('\n');

            // 3. MAIIS 전용 페르소나 프롬프트 (뉴스 = 기관/외인 관점의 매크로 팩트체커)
            const systemPrompt = `
당신은 '글로벌 기관 투자자 및 매크로 전략가' 관점에서 시장 팩트(Fact)를 분석하는 전문가입니다.
주어진 데이터는 오늘의 주요 경제/주식 시장 뉴스 헤드라인입니다.
주관적 예측이나 유행어는 철저히 배제하고, "거시 지표, 금리, 환율, 기업의 확정적 실적발표, 정부 정책" 등 '확인된 팩트'가 시장에 미칠 영향을 분석하십시오.

[출력 요구사항 - 반드시 아래 JSON 규격으로만 응답할 것]
{
  "domain_summary": "현재 쏟아지는 뉴스 헤드라인들을 종합하여 거시 경제 환경을 관통하는 하나의 거대한 팩트 시나리오 작성 (최소 3~5문장 이상 상세 서술)",
  "sentiment_index": 경제 지표 및 팩트에 기반한 리스크 점수 (-1.0은 투매/위험 회피장, 1.0은 적극 매수/위험 선호장),
  "trend_pivot": "어제와 비교했을 때 거시 경제 지표, 정부 정책, 지정학적 이슈에서 새롭게 등장한 게임 체인저나 변곡점 서술",
  "macro_indicators": [
    {
      "indicator": "금리/환율/유가/물가지수 등 변동 요인",
      "status": "상승/하락/부합 등 현재 수치적 상태",
      "impact": "이 지표 변동이 한국 주식 시장(환차손, 비용, 수출 등)에 미치는 구체적 영향 논리"
    }
  ],
  "top_themes": [
    {
      "theme_name": "호재/악재 팩트가 직접적으로 꽂히는 테마명 (가급적 증시 표준 섹터명 사용)",
      "intensity": 해당 팩트의 시장 영향력 및 자금 쏠림 파급력 (0~100),
      "evidence": "뉴스가 전달하는 팩트(숫자, 일정, 정부 정책, 기업 실적 등)와 향후 전개 방향 (2~3문장 이상 상세 서술)",
      "factual_catalysts": ["언급된 구체적인 촉매 변수 (예: FOMC 일자, 법안 통과 등)"],
      "related_stocks": [
        {
          "stock": "특정 종목명",
          "context": "이 기사의 팩트로 인해 직접적으로 수혜/피해를 입게 되는 정확한 비즈니스 논리"
        }
      ],
      "related_keywords": ["세부 키워드1", "세부 키워드2", "세부 키워드3"]
    }
  ] // 시장의 핵심 동인이 되는 주요 테마 최소 4개 ~ 최대 6개 도출
}
            `.trim();

            const userPrompt = `[최신 네이버 증권/경제 뉴스 원본 데이터]\n${rawInputText}\n\n위 데이터를 분석하여 완벽한 JSON으로 응답하십시오.`;

            // 4. AI 호출 및 결과 저장
            const aiResponse = await this.ai.askGemini(userPrompt, systemPrompt);
            const parsedJson = JsonUtils.extractAndParse(aiResponse);

            // 5. DB 저장 (maiis_domain_insights)
            this.db.saveMaiisDomainInsight({
                date: targetDate,
                domain_type: 'NEWS',
                raw_input_text: userPrompt,
                used_prompt: systemPrompt,
                generated_json: JSON.stringify(parsedJson, null, 2)
            });

            console.log(`[MaiisDomainService] News Domain Insight Generated successfully.`);
            return { success: true, data: parsedJson };

        } catch (error: any) {
            console.error('[MaiisDomainService] News Analysis Failed:', error);
            return { success: false, error: error.message };
        }
    }
}
