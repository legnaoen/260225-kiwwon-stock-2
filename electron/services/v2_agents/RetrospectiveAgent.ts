import { DatabaseService } from '../DatabaseService';
import { KiwoomService } from '../KiwoomService';
import { AiExecutionQueue } from '../AiExecutionQueue';
import fs from 'fs';
import path from 'path';

export class RetrospectiveAgent {
    private db = DatabaseService.getInstance();
    private kiwoomSvc: KiwoomService;

    constructor(kiwoomSvc: KiwoomService) {
        this.kiwoomSvc = kiwoomSvc;
    }

    /**
     * 1단계: 만료된 종목들의 성과를 기계적으로 채점
     */
    public async evaluatePastPicks() {
        console.log('[RetrospectiveAgent] 1단계: 기준가가 누락된 종목들의 당일 종가 보완 및 만기 도래 추천 종목 성과 채점 시작...');
        
        // 0. 누락된 기준가 보완 로직 (장전 추천: 시가, 장중/마감 후 추천: 종가)
        const missingPricePicks = this.db.db.prepare("SELECT * FROM ai_analyst_picks WHERE entry_price IS NULL OR entry_price = 0").all() as any[];
        for (const pick of missingPricePicks) {
            try {
                // 당일을 포함해 최근 일봉 데이터 수집
                const chartData = await this.kiwoomSvc.getOhlcvDaily(pick.stock_code, 5); 
                if (!chartData || chartData.length === 0) continue;
                
                const targetDate = pick.date.replace(/-/g, '');
                // 키움증권 데이터는 최신 날짜가 index 0. 목표일 이후의 데이터 중 가장 오래된 날(목표일 당일 혹은 목표일 이후 첫 개장일)을 찾음.
                const futureCandles = chartData.filter((c: any) => c.date >= targetDate).reverse();
                
                if (futureCandles.length > 0) {
                    const dayCandle = futureCandles[0];
                    let fallbackPrice = 0;
                    
                    // 작성 시간이 09시 이전인지 판별하여 장전(Pre-market) 판단
                    let isPreMarket = false;
                    if (pick.created_at && pick.created_at.length >= 13) {
                        const hour = parseInt(pick.created_at.substring(11, 13), 10);
                        if (hour < 9) isPreMarket = true;
                    }
                    // 목표일이 휴일이어서 다음 장으로 넘어간 본 개장일인 경우 무조건 시가
                    if (dayCandle.date > targetDate) {
                        isPreMarket = true; 
                    }

                    if (isPreMarket) {
                        fallbackPrice = Math.abs(Number(String(dayCandle.open).replace(/[^0-9\-\.]/g, '')));
                    } else {
                        fallbackPrice = Math.abs(Number(String(dayCandle.close).replace(/[^0-9\-\.]/g, '')));
                    }
                    
                    if (fallbackPrice > 0) {
                        this.db.db.prepare("UPDATE ai_analyst_picks SET entry_price = ? WHERE id = ?").run(fallbackPrice, pick.id);
                        pick.entry_price = fallbackPrice; // 아래 eval logic에서도 쓰기 위해 객체 속성 메모리 갱신
                    }
                }
            } catch (err) {
                console.error(`[RetrospectiveAgent] 기준가 보완 에러 (${pick.stock_name}):`, err);
            }
        }

        const pendingPicks = this.db.db.prepare("SELECT * FROM ai_analyst_picks WHERE evaluation_status = 'PENDING'").all() as any[];

        let evaluatedCount = 0;
        for (const pick of pendingPicks) {
            // 추천일로부터 경과일 계산
            const entryDate = new Date(pick.date);
            const today = new Date();
            const diffTime = Math.abs(today.getTime() - entryDate.getTime());
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

            // 아직 수명(lifespan_days)이 안 지났으면 평가 보류
            // (차후 장기 종목 중간 평가를 추가할 수도 있으나, 우선 만기도래 원칙 적용)
            if (diffDays < pick.lifespan_days) {
                continue;
            }

            try {
                // 키움증권에서 해당 기간 동안의 일봉 데이터 수집 (최대 diffDays+5 개)
                const chartData = await this.kiwoomSvc.getOhlcvDaily(pick.stock_code, diffDays + 5);
                if (!chartData || chartData.length === 0) continue;

                // entry_date 이후의 봉만 필터링 (가장 최신 봉이 index 0)
                // 간단히 기간 내 고점(high)과 현재/최종 종가(close) 계산
                let maxHigh = 0;
                let lastClose = 0;
                // chartData는 최신데이터가 0번 인덱스에 있음.
                const relevantCandles = chartData.filter((c: any) => {
                    const cDate = c.date; // 형식에 맞게 파싱 필요
                    return cDate >= pick.date.replace(/-/g, ''); // 단순 비교
                });

                if (relevantCandles.length > 0) {
                    for (const c of relevantCandles) {
                        const h = Math.abs(Number(String(c.high).replace(/[^0-9\-\.]/g, '')));
                        if (h > maxHigh) maxHigh = h;
                    }
                    lastClose = Math.abs(Number(String(relevantCandles[0].close).replace(/[^0-9\-\.]/g, '')));
                } else {
                    // 데이터 파싱 실패시 제일 첫번째 봉 
                    maxHigh = Math.abs(Number(String(chartData[0].high).replace(/[^0-9\-\.]/g, '')));
                    lastClose = Math.abs(Number(String(chartData[0].close).replace(/[^0-9\-\.]/g, '')));
                }

                const entryPrice = pick.entry_price || lastClose; // 초기 기록이 없으면 임시 보정
                const targetRate = pick.target_profit_rate || 5.0;

                const maxProfitRate = ((maxHigh - entryPrice) / entryPrice) * 100;
                const finalProfitRate = ((lastClose - entryPrice) / entryPrice) * 100;

                let evalStatus = 'PENDING';
                if (maxProfitRate >= targetRate) {
                    evalStatus = 'SUCCESS';
                } else if (finalProfitRate >= 0) {
                    evalStatus = 'HOLD';
                } else {
                    evalStatus = 'FAIL';
                }

                this.db.db.prepare("UPDATE ai_analyst_picks SET max_profit_rate = ?, evaluation_status = ? WHERE id = ?").run(
                    maxProfitRate, evalStatus, pick.id
                );
                evaluatedCount++;

            } catch (err) {
                console.error(`[RetrospectiveAgent] 채점 에러 (${pick.stock_name}):`, err);
            }
        }
        console.log(`[RetrospectiveAgent] 채점 완료: ${evaluatedCount}건 업데이트 됨.`);
        return evaluatedCount;
    }

    /**
     * 2단계: 실패/성공 사례를 묶어 Gemini에게 회고 지시 -> SKILL 파일 갱신
     */
    public async runRetrospectiveLogic() {
        console.log('[RetrospectiveAgent] 2단계: AI 회고 및 오답노트 작성 로직 가동...');
        
        // 1. 최신 채점 결과 가져오기 (가장 최근 30개 기준)
        const recentEvaluated = this.db.db.prepare("SELECT * FROM ai_analyst_picks WHERE evaluation_status != 'PENDING' ORDER BY date DESC LIMIT 50").all() as any[];

        // 에이전트 타입별로 분류
        const agentMap: Record<string, any[]> = {};
        for (const item of recentEvaluated) {
            if (!agentMap[item.agent_type]) agentMap[item.agent_type] = [];
            agentMap[item.agent_type].push(item);
        }

        // 2. 각 에이전트별로 LLM 회고 진행
        for (const [agentType, picks] of Object.entries(agentMap)) {
            const fails = picks.filter(p => p.evaluation_status === 'FAIL');
            const successes = picks.filter(p => p.evaluation_status === 'SUCCESS');

            if (fails.length === 0) {
                console.log(`[RetrospectiveAgent] ${agentType} 패스 - 지적할 실패 사례가 없음`);
                continue;
            }

            const promptContext = `
[✅ 최근 훌륭한 타점 (SUCCESS - 목표 +5% 이상 도달)]
${successes.slice(0, 5).map(s => `- 종목: ${s.stock_name} / 최고수익: +${s.max_profit_rate.toFixed(1)}% / 당시 추천 사유: ${s.reason}`).join('\n') || '사례 없음'}

[🚨 최근 실패 타점 (FAIL - 마이너스 마감)]
${fails.slice(0, 5).map(f => `- 종목: ${f.stock_name} / 최고수익: ${f.max_profit_rate.toFixed(1)}% / 당시 추천 사유: ${f.reason}`).join('\n')}
            `.trim();

            const systemPrompt = `너는 냉혹한 헤지펀드 트레이딩 감사관(Auditor)이다.
담당 애널리스트 AI(${agentType})가 최근 제출한 추천 종목들의 성적표를 보고 뼈아픈 오답노트(규칙)를 만들어야 한다.

임무:
1. '최근 실패 타점(FAIL)' 목록과 당시의 추천 사유를 꼼꼼히 분석하라.
2. 어떤 패턴/조건에서 추천했을 때 주가가 오르지 못하고 하락(FAIL)했는지 공통점과 원인을 날카롭게 추론하라. (예: "당일 급등 관련 뉴스만 보고 고점 10% 이격도에서 추격 매수 추천함")
3. 해당 애널리스트가 다음부터 절대 같은 실수를 반복하지 않도록, 강압적이고 구체적인 "행동 지침(Skill Rule)" 1~2가지를 생성하라.

응답 형식 (반드시 아래 마크다운 형식으로만 출력할 것):
### 🚨 [AI 자동 오답노트 & 회피 패턴] (업데이트: {날짜})
* **실패 분석 요약**: [실패 원인에 대한 1~2줄 분석결과]
* **절대 규칙 1**: [새롭게 지켜야 할 프롬프트 행동 강령]
* **절대 규칙 2**: [새롭게 지켜야 할 프롬프트 행동 강령 (필요시)]
`;

            try {
                const response = await AiExecutionQueue.getInstance().enqueue({
                    taskType: 'RETROSPECTIVE',
                    prompt: systemPrompt + '\n\n' + promptContext,
                    temperature: 0.3
                });

                // 3. SKILL 파일 시스템 업데이트
                this.updateSkillFile(agentType, response);

            } catch (err) {
                console.error(`[RetrospectiveAgent] ${agentType} 회고 에러:`, err);
            }
        }
    }

    private updateSkillFile(agentType: string, newRules: string) {
        // 기존 SKILL.md 가 존재한다면 하단에 덧붙이고, 아니면 새로 만듦
        // 안전한 파일명 생성 (예: 수급 AI -> 수급_ai)
        const safeAgentName = agentType.replace(/ /g, '_').replace(/[^a-zA-Z0-9_\u3131-\uD79D]/g, '').toLowerCase();
        const skillDir = path.join(process.cwd(), '.agents/skills', `${safeAgentName}_guidelines`);
        
        if (!fs.existsSync(skillDir)) {
            fs.mkdirSync(skillDir, { recursive: true });
        }

        const filePath = path.join(skillDir, 'SKILL.md');
        let fileContent = '';
        if (fs.existsSync(filePath)) {
            fileContent = fs.readFileSync(filePath, 'utf-8');
        } else {
            fileContent = `---
description: ${agentType}의 독립적인 매매 지침 및 오답노트 (시스템 자동 진화)
---
# ${agentType} 매매 지침서
이 문서의 룰을 베이스로 종목을 발굴하십시오.
`;
        }

        // 기존에 오답노트 최신판이 있으면 덮어쓰거나 누적
        // 간단하게 하단에 계속 붙여나가되 최대 길이를 제한 (최근 3개만 유지 등)
        const dateStr = new Date().toISOString().substring(0, 10);
        const resolvedRules = newRules.replace('{날짜}', dateStr);

        fileContent += `\n\n${resolvedRules}\n`;
        fs.writeFileSync(filePath, fileContent, 'utf-8');
        
        console.log(`[RetrospectiveAgent] 💾 ${agentType}의 오답노트를 ${filePath} 에 영구 기록했습니다.`);
    }
}
