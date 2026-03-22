import { DatabaseService } from './DatabaseService'
import { AiService } from './AiService'
import { MaiisDomainService } from './MaiisDomainService'
import { MaiisMacroService } from './MaiisMacroService';
import { MEGA_THEMES } from './MaiisThemeConstants';

export class MasterAiService {
    private static instance: MasterAiService
    private db: DatabaseService
    private domainService: MaiisDomainService

    private constructor() {
        this.db = DatabaseService.getInstance()
        this.domainService = MaiisDomainService.getInstance()
    }

    public static getInstance(): MasterAiService {
        if (!MasterAiService.instance) {
            MasterAiService.instance = new MasterAiService()
        }
        return MasterAiService.instance
    }

    /**
     * 마스터 AI 메인 진입점.
     * @param timing '0845' (장전) | '0930' (장중) | '1530' (장마감)
     * @param targetDate YYYY-MM-DD
     */
    public async generateWorldState(timing: '0845' | '0930' | '1530', targetDate?: string) {
        // 날짜 형식 정규화: getKstDate()가 'YYYY-MM-DD' → DB 형식 'YYYYMMDD'
        const rawDate = targetDate || this.db.getKstDate();
        const date = rawDate.replace(/-/g, '');
        console.log(`[MasterAiService] 트리거: ${date} ${timing} World State 생성 시작`);

        // 1. 병렬 데이터 페치 (Zero-State Safety 보장)
        const [newsRes, youtubeRes, macroRes, risingStocksData] = await Promise.all([
            this.safeFetch(() => this.getDomainData(date, 'NEWS')),
            this.safeFetch(() => this.getDomainData(date, 'YOUTUBE')),
            this.safeFetch(() => MaiisMacroService.getInstance().getDailyMacroSnapshot()),
            this.safeFetch(() => this.domainService.getRisingStocksSummary(date))
        ]);

        const reflection = this.db.getRecentReflection(date);
        const reflectionText = reflection ? reflection.self_reflection : '최근 기록 없음';

        // 2. 프롬프트 생성 (시간대별 분기)
        let prompt = "";
        
        const currentThemes = this.db.getActiveThemeRankings(date) || [];
        const currentPicks = this.db.getActivePicks() || [];

        // 장중 수급 변화 텍스트를 급등주 어댑터에서 명시적으로 추출하여 하이라이트
        const intraDayShift = risingStocksData?.intra_day_shift_insight || '장중 수급 변화 기록 없음';

        // 서브에이전트 역할 태깅 기반 baseContext (계획서 §6-1 역할 B 반영)
        const baseContext = `
[📰 센서 #1: 뉴스 매크로 팩트체커 리포트 (제도권·기관 관점)]
${JSON.stringify(newsRes)}

[🎬 센서 #2: 유튜브 개인투자자 심리·FOMO 분석 리포트 (소매 투심 관점)]
${JSON.stringify(youtubeRes)}

[📊 센서 #3: 글로벌 매크로 지표 스냅샷 (수학적 사전 계산치)]
${JSON.stringify(macroRes)}

[📈 센서 #4: 당일 급등주·수급주 테마별 요약 (실제 자금 쏠림)]
테마별 수급: ${JSON.stringify(risingStocksData?.pure_rising_themes || [])}
기관/외인 수급: ${JSON.stringify(risingStocksData?.institutional_volume_themes || [])}
⚡ 장중 수급 변화 핵심: ${intraDayShift}

[⚙️ 현재 DB 기계적 랭킹 현황 (Aggregator가 산출한 객관적 base_score)]
상위 테마 랭킹: ${JSON.stringify(currentThemes)}
현재 보유 추천 종목: ${JSON.stringify(currentPicks)}
`;

        if (timing === '0845') {
            prompt = `
${baseContext}
[🧠 전일 오답 노트 및 교훈 (Self-Reflection)]
${reflectionText}

위 데이터를 바탕으로 오늘(08:45 기준) 개장 전 시장의 '대전제(Market Thesis)'를 선언하고, 
[현재 DB 상위 테마] 중에서 특별히 점수를 올리거나 깎아야 할 대상이 있다면 조정(override) 하세요.
반드시 뉴스 팩트(센서#1)와 유튜브 심리(센서#2) 모두를 교차 검증한 뒤 판단하십시오.
`;
        } else if (timing === '0930') {
            const morningState = this.db.getMasterWorldState(date, '0845');
            prompt = `
${baseContext}
[🌅 08:45 당신의 아침 대전제]
${morningState ? morningState.market_thesis : '아침 예측 누락 - 신규 뷰 수립 필요'}

[🧠 전일 오답 노트 참고 (연속성 보장)]
${reflectionText}

위 데이터를 바탕으로 아침의 예측을 검증하고, 실제 09:30 장 초반 자금 쏠림(센서#4)과 일치하는지 대조하세요.
오늘 수급이 몰린 테마를 신규 추천하거나(new_alpha_picks), 모멘텀이 끝난 기존 보유 종목을 손절/익절(drop_alpha_picks) 하세요.
`;
        } else if (timing === '1530') {
            const morningState = this.db.getMasterWorldState(date, '0845');
            const middayState = this.db.getMasterWorldState(date, '0930');
            const recentClosed = this.getRecentClosedPositions();
            
            prompt = `
${baseContext}
[🌅 08:45 아침 대전제]
${morningState ? morningState.market_thesis : '(기록 없음)'}

[⏱️ 09:30 장중 신규 추천/편출]
${middayState ? middayState.new_alpha_picks_json : '(기록 없음)'}

[📉 최근 청산(손절/익절)된 포트폴리오 성과 (자가학습용)]
${JSON.stringify(recentClosed)}

[🧠 전일 오답 노트 참고 (연속성 보장)]
${reflectionText}

장 마감입니다. 오늘 하루 시장 데이터와 당신의 예측을 철저히 대조 반성하세요.
특히 [최근 청산된 포트폴리오 성과] 목록을 살펴보고, 당신이 지시했던 뷰(market_thesis)와 편입 판단에 어떤 오류(또는 성공 요인)가 있었는지 자아비판적 관점에서 철저히 원인을 분석하여, 내일 아침을 위한 피드백 교훈을 'self_reflection' 필드에 상세히 작성하세요. 그리고 내일을 위한 최종 종목 편출입을 점검하세요.
`;
        } else {
            throw new Error(`Invalid timing: ${timing}`);
        }

        // 3. System Instruction 세팅 (Ontology Mapping 제약 포함)
        const systemInstruction = `
당신은 대한민국 주식 시장을 지배하는 최상위 마스터 AI 'World State Generator' 입니다.
당신의 임무는 4개의 하위 센서가 물어온 정보를 종합하여 단 하나의 거대한 뷰를 내리는 것입니다.

[시맨틱 단절 방지 룰 (Critical)]
하위 에이전트들이 제각각 파편화된 테마명이나 신조어를 쓰더라도, 당신은 반드시 아래의 [MAIIS 표준 메가 테마 리스트] 중 가장 가까운 단어로 번역/통합하여 JSON의 템플릿에 출력해야 합니다.
목록: ${MEGA_THEMES.join(', ')}

[출력 포맷 (JSON Only)]
{
  "market_thesis": "어제의 뷰 유지, 매크로 이슈에 따른 방어주 중심.",
  "sentiment_score": 0.45,
  "score_adjustments": [
    { 
      "target_theme": "표준 테마 리스트 내의 단어 사용 필수", 
      "adjustment_point": -20, // (-50 ~ +50)
      "reason": "왜 점수를 깎고 더했는지 (매크로, 뉴스 근거)" 
    }
  ],
  "new_alpha_picks": [
    { "stock_name": "신규 종목명", "reason": "수급 쏠림 확인, 편입 필요" }
  ],
  "drop_alpha_picks": [
    { "stock_name": "기존 보유 종목명 목록 중 선택", "reason": "이평선 이탈, 익절/손절" }
  ],
  "self_reflection": "오답 노트 (1530 에 핵심 작성, 다른 시간엔 빈 문자열)"
}
`;

        // 4. AI 호출 및 결과 저장
        try {
            const aiResponse = await AiService.getInstance().askGemini(prompt, systemInstruction);
            const parsed = JSON.parse(aiResponse.replace(/```json|```/g, '').trim());

            console.log(`[MasterAiService] ${timing} 산출 완료. DB 저장 중...`);
            this.db.saveMasterWorldState(date, timing, parsed);
            return { success: true, data: parsed };
        } catch (error: any) {
            console.error(`[MasterAiService] ${timing} 생성 실패:`, error);
            return { success: false, error: error.message };
        }
    }

    /**
     * 특정 도메인의 오늘 자 insight JSON을 안전하게 가져옵니다.
     */
    private getDomainData(date: string, domainType: string): any {
        const records = this.db.getMaiisDomainInsights(date);
        const target = records.find(r => r.domain_type === domainType);
        if (target && target.generated_json) {
            try { return JSON.parse(target.generated_json); } catch(e) { return null; }
        }
        return { message: "Data Not Available" };
    }

    /**
     * 에러 방어(Zero-State Safety)용 래퍼 함수
     */
    private async safeFetch(fn: () => any): Promise<any> {
        try {
            const res = await fn();
            return res;
        } catch (error) {
            console.warn(`[MasterAiService] 데이터 페치 중 일부 실패. 빈 데이터로 강행합니다: ${error}`);
            return { error: "Fetch Failed" };
        }
    }

    /**
     * 자가학습(Self-Learning)용: 최근 청산(CLOSED)된 종목들을 가져와 피드백에 활용
     */
    private getRecentClosedPositions(): any[] {
        try {
            const closedItems = this.db.getClosedPortfolio();
            // 최근 5개 청산 내역만 가져와 컨텍스트 길이를 조절
            return closedItems.slice(0, 5).map((item: any) => ({
                stock_name: item.stock_name,
                entry_date: item.entry_date,
                closed_date: item.closed_date,
                actual_entry_price: item.actual_entry_price,
                closed_price: item.closed_price,
                profit_rate_percent: item.closed_profit_rate,
                sell_reason: item.last_signal_reason || '조건에 의한 청산'
            }));
        } catch (e) {
            return [];
        }
    }
}
