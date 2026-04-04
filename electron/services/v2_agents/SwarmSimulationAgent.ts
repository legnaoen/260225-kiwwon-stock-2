import { AiExecutionQueue } from '../AiExecutionQueue';
import { IssueLedgerDB, SwarmSession, SwarmVote } from './IssueLedgerDB';
import { IssueRecord } from './IssueLedgerDB';

// 5명의 페르소나 시스템 프롬프트 정의
const PERSONAS = [
    {
        id: 'BULL',
        name: '강세론자 (🐂 Bull)',
        prompt: `당신은 긍정적이고 시장의 회복 탄력성을 강력히 믿는 강세론자(Bull)입니다. 
어떤 악재가 나와도 유동성, 기업의 펀더멘털, 저가 매수 기회로 해석하는 경향이 있습니다.
현재 이슈의 위험도가 너무 높게 평가되었다고 지적하며, 시장이 이를 쉽게 극복할 것이라 주장하세요.`,
    },
    {
        id: 'BEAR',
        name: '약세론자 (🐻 Bear)',
        prompt: `당신은 비관적이고 시장의 구조적 결함을 파고드는 약세론자(Bear)입니다.
작은 악재도 꼬리 위험(Tail Risk)으로 번질 수 있다고 경고하며, 최악의 시나리오를 강조합니다.
현재 이슈의 위험도가 너무 낮게 평가되었다고 지적하며, 숨겨진 더 큰 파급력을 경고하세요.`,
    },
    {
        id: 'BANKER',
        name: '기관투자자 (🏦 Banker)',
        prompt: `당신은 실용적이고 안정성을 최우선으로 하는 보수적인 기관투자자(Banker)입니다.
감정에 휩쓸리지 않고 중앙은행의 스탠스, 국채 금리 변화 등 안정적 지표에 근거하여 판단합니다.
극단적인 긍정이나 부정을 피하고, 가장 중도적이고 합리적인 수준의 위험도를 지지하세요.`,
    },
    {
        id: 'QUANT',
        name: '퀀트 분석가 (📊 Quant)',
        prompt: `당신은 데이터와 통계적 평균 회귀 원칙만을 믿는 차가운 퀀트 분석가(Quant)입니다.
과거 유사한 이벤트 발생 시 주가의 통계적 변동성을 바탕으로 철저히 확률적으로 접근합니다.
감정적인 과잉 반응을 배제하고, 통계적으로 적절한 객관적 위험도와 확률을 제시하세요.`,
    },
    {
        id: 'GLOBAL',
        name: '지정학 전문가 (🌍 Global)',
        prompt: `당신은 글로벌 공급망, 패권 경쟁, 지정학적 리스크를 분석하는 거시 전문가(Global)입니다.
단일 국가의 이슈가 글로벌 무역과 환율, 원자재 시장에 미칠 나비효과를 추적합니다.
이슈가 특정 지역에 국한된 것인지, 글로벌 전이 위험이 있는지 기반으로 넓은 시각의 위험도를 제시하세요.`,
    }
];

export class SwarmSimulationAgent {
    private static instance: SwarmSimulationAgent;

    private constructor() {}

    public static getInstance(): SwarmSimulationAgent {
        if (!SwarmSimulationAgent.instance) {
            SwarmSimulationAgent.instance = new SwarmSimulationAgent();
        }
        return SwarmSimulationAgent.instance;
    }

    /**
     * 특정 이슈에 대해 5개의 페르소나를 호출하여 의견을 수집하고, 결과를 DB에 저장합니다.
     */
    public async evaluateIssue(issueId: string, dummyData?: IssueRecord): Promise<SwarmSession | null> {
        const db = IssueLedgerDB.getInstance();
        const activeIssues = db.getActiveIssues();
        let issue = activeIssues.find(i => i.id === issueId);

        if (!issue) {
            if (dummyData) {
                console.log(`[Swarm] DB에 '${issueId}'가 없어 더미 데이터를 삽입합니다.`);
                // map created_date, updated_date if missing
                const insertData = {
                  ...dummyData,
                  created_date: (dummyData as any).date || new Date().toISOString(),
                  updated_date: new Date().toISOString(),
                };
                db.upsertIssue(insertData);
                issue = insertData;
            } else {
                console.error(`[Swarm] 이슈를 찾을 수 없습니다: ${issueId}`);
                return null;
            }
        }

        console.log(`[Swarm] 🧠 이슈 평가 시작: [${issue.name}] (현재 등급: ${issue.severity})`);

        // KST 로칼 날짜 기준으로 sessionId 생성 (UTC toISOString 사용 시 UTC 기준 하루 전 날짜가 나오는 버그 방지)
        const _now = new Date();
        const _pad = (n: number) => String(n).padStart(2, '0');
        const localDate = `${_now.getFullYear()}-${_pad(_now.getMonth() + 1)}-${_pad(_now.getDate())}`;
        const localTs = `${String(_now.getFullYear())}${_pad(_now.getMonth() + 1)}${_pad(_now.getDate())}T${_pad(_now.getHours())}${_pad(_now.getMinutes())}${_pad(_now.getSeconds())}`;
        const sessionId = `SS_${localTs}_${issueId}`;
        const sessionDate = localDate;
        const queue = AiExecutionQueue.getInstance();
        const votes: SwarmVote[] = [];

        // 5명의 역량별 페르소나가 투표 수행
        for (const persona of PERSONAS) {
            const systemMsg = `
${persona.prompt}
당신은 자본 시장의 전문가 위원회 소속입니다. 
편집장(메인 AI)이 아래 이슈에 대해 위험도(Severity)를 [${issue.severity}]로 평가했습니다.
(위험도 단계: S(크래시 수준) > A(섹터 급락) > B(단기 노이즈) > C(영향 미미))

[이슈 정보]
- 제목: ${issue.name}
- 현재 방향성: ${issue.impactDirection}
- 요약: ${issue.summary}

사용자의 평가에 상관없이, 이 이슈가 시장에 미칠 **원초적 방향성**(UP: 시장 상승, DOWN: 시장 하락, HOLD: 중립/관망)과
당신이 제안하는 **파급력/위험도**(S, A, B, C 중 택1), 그리고 1~2문장의 논리적인 주장을 작성하세요.

반드시 아래 JSON 포맷만을 출력하세요. 마크다운 백틱(\`\`\`json 등)은 절대 쓰지 마세요.
{
    "voteResult": "UP" | "DOWN" | "HOLD",
    "suggestedSeverity": "S" | "A" | "B" | "C",
    "argument": "귀하의 1~2문장 주장"
}
            `.trim();

            const prompt = `이슈 [${issue.name}]에 대한 당신의 방향성 예측(UP/DOWN/HOLD)과 위험도 평가 결과를 JSON 포맷으로 제출해 주세요.`;

            try {
                // AiExecutionQueue에 로컬 AI 타겟팅으로 작업 추가
                const answerText = await queue.enqueue({
                    agentId: `SWARM_${issueId.substring(0,6)}`,
                    agentName: `${persona.id} AI`,
                    triggerType: 'MANUAL',
                    prompt: prompt,
                    targetType: 'local',
                    systemInstruction: systemMsg
                });

                // 응답에서 JSON 파싱 (로컬 모델의 오류 마진 고려해서 regex로 추출)
                let parsed: any = null;
                try {
                    // 먼저 전체가 깔끔한 JSON인지 파싱 시도
                    parsed = JSON.parse(answerText);
                } catch {
                    // 앞뒤로 <think> 등 추론 텍스트나 사족이 붙어있는 경우, 중괄호 묶음들을 모두 찾아 유효한 JSON 탐색
                    const matches = answerText.match(/\{[\s\S]*?\}/g);
                    if (matches) {
                        for (const m of matches) {
                            try {
                                const temp = JSON.parse(m);
                                if (temp.voteResult || temp.suggestedSeverity) {
                                    parsed = temp;
                                    break;
                                }
                            } catch(err) {
                                // 파싱 안 되는 텍스트 조각은 무시
                            }
                        }
                    }
                }

                if (parsed) {
                    votes.push({
                        sessionId: sessionId,
                        personaId: persona.id,
                        voteResult: parsed.voteResult || 'HOLD',
                        suggestedSeverity: parsed.suggestedSeverity || issue.severity,
                        argument: parsed.argument || '응답 포맷을 분석할 수 없습니다.',
                    });
                    console.log(`[Swarm] ${persona.name} 투표 완료: ${parsed.suggestedSeverity} (${parsed.voteResult})`);
                } else {
                    console.warn(`[Swarm] ${persona.id} 응답이 JSON 형식이 아닙니다:`, answerText.substring(0, 150) + '...');
                    votes.push({
                        sessionId: sessionId,
                        personaId: persona.id,
                        voteResult: 'HOLD',
                        suggestedSeverity: issue.severity,
                        argument: answerText.substring(0, 100) + '...', // 날것의 텍스트 일부만 저장
                    });
                }
            } catch (error) {
                console.error(`[Swarm] ${persona.id} 평가 실패:`, error);
                votes.push({
                    sessionId: sessionId,
                    personaId: persona.id,
                    voteResult: 'HOLD',
                    suggestedSeverity: issue.severity,
                    argument: 'AI 타임아웃 또는 연결 오류',
                });
            }
        }

        // 합의된 최종 결과 도출 로직 (다수결 또는 보수적 평균 계산)
        const severities = votes.map(v => v.suggestedSeverity);
        const consensusSeverity = this.calculateConsensus(severities, issue.severity);

        const session: SwarmSession = {
            id: sessionId,
            issueId: issueId,
            sessionDate: sessionDate,
            targetSeverity: issue.severity,
            consensusSeverity: consensusSeverity,
            status: 'COMPLETED',
            votes: votes
        };

        // DB에 저장
        db.saveSwarmSession(session);
        console.log(`[Swarm] 🎯 세션 완료! 최종 군집 평가 등급: ${consensusSeverity}`);

        return session;
    }

    /**
     * 투표 결과 배열(['S','A','B','B','C'])을 기반으로 군집 합의 결과를 도출합니다.
     */
    private calculateConsensus(votes: string[], fallback: string): string {
        const counts: Record<string, number> = {};
        for (const v of votes) {
            counts[v] = (counts[v] || 0) + 1;
        }

        let maxCount = 0;
        let consensus = fallback;
        
        // 가장 많이 나온 투표로 우선 결정
        for (const [severity, count] of Object.entries(counts)) {
            if (count > maxCount) {
                maxCount = count;
                consensus = severity;
            }
        }
        
        // 동률일 경우 등 향후 보수적 평균(S>A>B>C) 등을 계산할 수 있도록 추가 확장 가능 
        return consensus;
    }
}
