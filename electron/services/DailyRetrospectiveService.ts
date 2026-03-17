import { DatabaseService } from './DatabaseService'
import { VirtualAccountService } from './VirtualAccountService'
import { AiService } from './AiService'
import { DataLoggingService } from './DataLoggingService'
import { v4 as uuidv4 } from 'uuid'
import Store from 'electron-store';

const store = new Store();

export class DailyRetrospectiveService {
    private static instance: DailyRetrospectiveService;
    private db = DatabaseService.getInstance();
    private account = VirtualAccountService.getInstance();
    private aiService = AiService.getInstance();

    private constructor() { }

    public static getInstance(): DailyRetrospectiveService {
        if (!DailyRetrospectiveService.instance) {
            DailyRetrospectiveService.instance = new DailyRetrospectiveService();
        }
        return DailyRetrospectiveService.instance;
    }

    /**
     * Run the daily retrospective process:
     * 1. Analyze today's virtual account performance
     * 2. Generate a new strategy reasoning (using Gemini AI)
     * 3. Create and save a new strategy version to the Database
     */
    public async runRetrospective(): Promise<any> {
        console.log('[DailyRetrospectiveService] Starting AI Retrospective Analysis...');

        // 1. Get today's state
        const state = this.account.getAccountState();
        const trades = state.history.filter(h => h.type === 'SELL');
        let params: any = {
            targetProfit: 3.0,
            stopLoss: -2.0,
            minAiScore: 60,
            maxPositions: 2,
            scoringWeights: { vwap: 30, velocity: 25, trend: 20, gap: 10, leader: 15 },
            masterPrompt: ""
        };

        let winCount = 0;
        let lossCount = 0;
        let totalPnlRate = 0;

        trades.forEach(trade => {
            if (trade.pnlRate && trade.pnlRate > 0) winCount++;
            else lossCount++;
            totalPnlRate += (trade.pnlRate || 0);
        });

        const winRate = trades.length > 0 ? (winCount / trades.length) * 100 : 0;
        const avgReturn = trades.length > 0 ? totalPnlRate / trades.length : 0;

        // 1.1 Fetch AI Decision logs for deep analysis
        const decisionLogs = DataLoggingService.getInstance().getTodayDecisions();
        const successSamples = decisionLogs.filter(l => l.action === 'BUY' && trades.find(t => t.code === l.code && (t.pnlRate || 0) > 0)).slice(0, 3);
        const failureSamples = decisionLogs.filter(l => l.action === 'BUY' && trades.find(t => t.code === l.code && (t.pnlRate || 0) <= 0)).slice(0, 3);
        const passSamples = decisionLogs.filter(l => l.action === 'PASS').slice(0, 3);

        // 2. Generate new strategy reasoning
        let reason = '';
        const today = this.db.getKstDate();

        try {
            const prompt = `당일 매매 데이터와 AI 의사결정 로그를 정밀 분석하여 다음 분기를 위한 전략 보정안을 제안해줘.
            
[당일 성과 데이터]
- 매매 횟수: ${trades.length}회
- 승률: ${winRate.toFixed(1)}%
- 평균 수익률: ${avgReturn.toFixed(2)}%
- 가상계좌 시스템 환경: 매수 슬리피지 0.15%, 매도 슬리피지/세금 0.25% 적용 중 (총 비용 약 0.4%)

[AI 분석 샘플 (성공)]
${successSamples.map(s => `- ${s.name}: ${s.reason}`).join('\n')}

[AI 분석 샘플 (실패)]
${failureSamples.map(s => `- ${s.name}: ${s.reason}`).join('\n')}

[AI 매수 보류 샘플 (PASS)]
${passSamples.map(s => `- ${s.name}: ${s.reason}`).join('\n')}

요구사항:
1. 분석 브리핑(reason)은 당일의 슬리피지 비용 대비 수익 구조와 AI의 판단 오류 여부를 포함하여 간결한 한국어로 작성할 것.
2. 성과 분석을 바탕으로 다음 요소들을 최적화할 것:
   - scoringWeights: 각 지표(VWAP, Velocity, Trend, Gap, leader)의 중요도 합이 100이 되도록 조정.
   - masterPrompt: AI가 매수 판단 시 참고할 추가 지침(예: "비용 보전을 위해 2% 이상의 확실한 반등 자리만 노릴 것" 등)을 포함한 전체 프롬프트 전문.
3. 보정된 수치를 이전 설정과 비교할 수 있도록 Markdown 테이블 형식을 브리핑 마지막에 포함할 것.
4. 다음의 JSON 형식으로만 최종 응답할 것:
{
  "reason": "분석 브리핑 (Markdown 테이블 포함)",
  "parameters": {
    "targetProfit": %, "stopLoss": %, "minAiScore": 점수, "maxPositions": 슬롯수,
    "scoringWeights": { "vwap": %, "velocity": %, "trend": %, "gap": %, "leader": % },
    "masterPrompt": "전체 마스터 프롬프트 전문"
  }
}`;

            const systemInstruction = "너는 자가 진화하는 퀀트 투자 AI 엔진이야. 사용자의 자동매매 데이터를 복기하고 다음날의 매매 공식(가중치)과 AI 지침(프롬프트)을 생성해. 반드시 JSON 형태로만 응답해.";

            const aiResponse = await this.aiService.askGemini(prompt, systemInstruction);
            const jsonStr = aiResponse.replace(/```json/g, '').replace(/```/g, '').trim();
            const result = JSON.parse(jsonStr);
            reason = result.reason;
            params = result.parameters;
        } catch (error) {
            console.warn('[DailyRetrospectiveService] AI Analysis failed, falling back to rule-based reasoning.', error);
            // Fallback to rule-based logic
            const defaultPrompt = "당신은 시장 주도주 눌림목 매매 전문가입니다. 당일 거래대금이 터진 종목 중 VWAP 부근의 안정적인 타점인지 분석하세요.";
            if (trades.length === 0) {
                reason = `오늘 장중 진입 조건을 만족하는 주도주가 부족하여 보수적으로 관망했습니다. 현재 볼륨 가이드를 소폭 완화하여 다음 장에 더 많은 기회를 포착하도록 보정합니다.`;
                params = { targetProfit: 3.0, stopLoss: -1.5, minAiScore: 60, maxPositions: 2, scoringWeights: { vwap: 30, velocity: 25, trend: 20, gap: 10, leader: 15 }, masterPrompt: defaultPrompt };
            } else if (winRate > 60) {
                reason = `오늘 ${trades.length}번의 교전에서 ${winRate.toFixed(1)}%의 우수한 승률을 기록했습니다. 공격적인 진입 기준을 유지합니다.`;
                params = { targetProfit: 3.5, stopLoss: -1.5, minAiScore: 65, maxPositions: 3, scoringWeights: { vwap: 20, velocity: 30, trend: 20, gap: 10, leader: 20 }, masterPrompt: defaultPrompt + " 적극적인 돌파 타점을 노리세요." };
            } else {
                reason = `오늘 승률이 ${winRate.toFixed(1)}%로 다소 저조했습니다. 진입 시 폼(Form) 기준을 높여 방어력을 높이는 방향으로 보정합니다.`;
                params = { targetProfit: 2.5, stopLoss: -1.0, minAiScore: 75, maxPositions: 2, scoringWeights: { vwap: 40, velocity: 20, trend: 20, gap: 10, leader: 10 }, masterPrompt: defaultPrompt + " 위험 구간에서는 무조건 PASS 하세요." };
            }
        }

        // 3. Create new strategy version
        const existingStrategies = this.db.getAiStrategies();
        const latestVersionNumber = existingStrategies.length > 0
            ? parseFloat(existingStrategies[0].version.replace('v', '')) + 0.1
            : 1.0;

        const newVersionDesc = `v${latestVersionNumber.toFixed(1)}.${today.replace(/-/g, '').slice(4)}`; // e.g. v1.1.0305

        const newStrategyId = uuidv4();

        // [Fix] Remove dummy history backfilling. Only copy real history from previous strategy.
        const prevActive = existingStrategies.find(s => s.isActive);
        const newHistory = prevActive ? [...prevActive.history] : [];

        // Calculate today's ACTUAL total daily return (Total Assets / Initial Balance)
        const aiSettings = store.get('ai_settings') as any;
        const initialBalance = aiSettings?.virtualInitialBalance ?? 10000000; // Default to 10M if not set
        const dailyReturn = ((state.totalAssets - initialBalance) / initialBalance) * 100;

        // Add today's performance
        newHistory.unshift({ date: today, return: Number(dailyReturn.toFixed(2)) });

        const newStrategy = {
            id: newStrategyId,
            version: newVersionDesc,
            name: `Momentum Alpha [${newVersionDesc}]`,
            created_at: new Date().toISOString(),
            reasonToPropose: reason,
            isActive: true,
            win_rate: Number(winRate.toFixed(1)),
            avg_hold_time: trades.length === 0 ? '0m' : '15m',
            history: newHistory,
            targetProfit: params.targetProfit,
            stopLoss: params.stopLoss,
            minAiScore: params.minAiScore,
            maxPositions: params.maxPositions,
            scoringWeights: params.scoringWeights,
            masterPrompt: params.masterPrompt
        };

        this.db.saveAiStrategy(newStrategy);
        console.log(`[DailyRetrospectiveService] Generated new strategy ${newVersionDesc}`);

        return newStrategy;
    }

    private shiftDate(dateString: string, days: number): string {
        const d = new Date(dateString);
        d.setDate(d.getDate() + days);
        return this.db.getKstDate(d);
    }
}
