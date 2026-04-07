import { AiExecutionQueue } from '../AiExecutionQueue';
import { DatabaseService } from '../DatabaseService';
import { eventBus, SystemEvent } from '../../utils/EventBus';

export interface IncubatorEvaluation {
    stock_code: string;
    stock_name: string;
    issue_id: string; // The root cause/catalyst ID
    theme_name: string;
    fundamental_status: 'SOLID' | 'AVERAGE' | 'WEAK';
    neglect_score: number; // 0 to 100
    action: 'WATCHING' | 'READY_TO_IGNITE' | 'DROP';
    reason: string;
}

/**
 * Value Incubator Agent (가치 발굴 & 소외주 감시 AI)
 * - 장기 호재(Narrative)가 있으나 현재 시장에서 소외(Neglect)된 종목들을 
 *   별도의 인큐베이터 망에 담아두고 매일 수급 고갈 상태를 체크합니다.
 * - 특정 타점(거래량 급등, 외국인 매수세 등) 포착 시 Portfolio Manager에게 강제 매수 신호를 올립니다.
 */
export class ValueIncubatorAgent {
    private static instance: ValueIncubatorAgent;
    private db: DatabaseService;

    private constructor() {
        this.db = DatabaseService.getInstance();
        console.log('[ValueIncubatorAgent] 🧪 초기화 완료 - 장기 주도주 감시망 오픈');
    }

    public static getInstance(): ValueIncubatorAgent {
        if (!ValueIncubatorAgent.instance) {
            ValueIncubatorAgent.instance = new ValueIncubatorAgent();
        }
        return ValueIncubatorAgent.instance;
    }

    /**
     * 당일 인큐베이터 종목들에 대한 소외 지수(Neglect Score) 및 타점 스캔 실행 (매일 장 마감 후 또는 배치)
     */
    public async scanIncubatorPool(targetDate?: string) {
        const dateStr = targetDate || this.db.getKstDate();
        console.log(`[ValueIncubator] 🧪 ${dateStr} 인큐베이터 소외주 레이더 스캔 시작...`);

        try {
            // TODO: 실제 DB 연동 (DatabaseService에 maiis_incubator 테이블 추가 필요)
            // 임시 하드코딩된 모의 스캔 데이터
            const pool = [
                { stock_code: "005930", stock_name: "테스트전자", peak_volume: 15400000, current_volume: 320000, days_dormant: 14 }
            ];

            if (pool.length === 0) {
                console.log(`[ValueIncubator] 현재 감시 중인 인큐베이터 종목이 없습니다.`);
                return;
            }

            let promptContext = `[현재 인큐베이터 감시 풀 (총 ${pool.length}개)]\n\n`;
            pool.forEach(p => {
                const volRatio = (p.current_volume / p.peak_volume) * 100;
                promptContext += `- ${p.stock_name}(${p.stock_code}) | 잠복기: ${p.days_dormant}일 | 현재 거래량 비율: 고점 대비 ${volRatio.toFixed(1)}%\n`;
            });

            const systemPrompt = `너는 워런 버핏, 피터 린치와 같은 전설적인 '가치/모멘텀 발굴 투자자'다.
현재 우리가 '인큐베이터'에 담아두고 장기 감사 중인 우량주 목록과, 오늘자 거래량/수급 고갈 상태가 주어졌다.

[소외주 판별 및 타점(Ignition) 포착 원칙]
1. 거래량이 고점 대비 20% 이하로 바싹 마르고(수급 고갈), 하락세가 멈춘 상태라면 "소외 지수(neglect_score)"를 80~100점으로 높게 줘라. 이는 완벽한 매집 구간이다.
2. 만약 소외 지수가 90점이 넘는데, 당일 키움 조건검색(외인 순매수 등) 추가 신호가 감지될 조짐이 보인다면 action을 'READY_TO_IGNITE'로 변경하라.
3. 펀더멘털이 훼손되었거나 이슈가 아예 소멸(취소)되었다면 'DROP' 처리하라.

결과물은 오직 JSON으로만 반환하라.
\`\`\`json
{
    "evaluations": [
        {
            "stock_code": "000000",
            "stock_name": "기업명",
            "fundamental_status": "SOLID",
            "neglect_score": 95,
            "action": "READY_TO_IGNITE",
            "reason": "거래량이 10분의 1로 폭감하였으나 가격 이탈 징후 없음. 조만간 터질 확실한 타점 구간."
        }
    ]
}
\`\`\``;

            const response = await AiExecutionQueue.getInstance().enqueue({
                taskType: 'INCUBATOR_ANALYST',
                prompt: systemPrompt + '\n\n' + promptContext,
                temperature: 0.2
            });

            const jsonMatch = response.match(/```json\n([\s\S]*?)\n```/);
            if (jsonMatch && jsonMatch[1]) {
                const parsed = JSON.parse(jsonMatch[1]);
                if (parsed.evaluations && Array.isArray(parsed.evaluations)) {
                    console.log(`[ValueIncubator] ✅ ${parsed.evaluations.length}개 종목 소외 지수 평가 완료.`);
                    
                    // TODO: 평가 결과를 DB에 반영 (maiis_incubator 테이블 업데이트)
                    // 만약 action이 'READY_TO_IGNITE'라면, Portfolio Manager 호출 큐에 적재!

                    return parsed.evaluations;
                }
            }
            console.warn(`[ValueIncubator] 파싱 실패:`, response);
            return null;

        } catch (e) {
            console.error(`[ValueIncubator] 스캔 중 오류 발생:`, e);
            throw e;
        }
    }
}
