import { V2PipelineManager } from '../v2_pipeline/V2PipelineManager';
import { AiExecutionQueue } from '../AiExecutionQueue';
import { DatabaseService } from '../DatabaseService';
import { eventBus } from '../../utils/EventBus';
import { PerformanceTracker } from './PerformanceTracker';

export const INTRADAY_PERSONAS = [
    {
        id: 'MOMENTUM',
        name: '모멘텀 트레이더 (🐂 Momentum)',
        prompt: `당신은 외국인과 프로그램의 수급(Flow)이 강한 방향으로 당일 추세가 무조건 지속된다고 믿는 순응형 데이트레이더입니다. 
아침의 시가 갭(Gap)과 수급의 쏠림 현상을 읽어내며, 반등이나 되돌림보다는 '가는 말이 더 간다'는 철학을 가지고 있습니다. 
현재 수급이 매수 우위라면 UP, 매도 우위라면 DOWN을 강하게 주장하십시오.`,
    },
    {
        id: 'CONTRARIAN',
        name: '역발상 트레이더 (🐻 Contrarian)',
        prompt: `당신은 단기 수급의 과도한 쏠림은 반드시 당일 되돌림(Reversal)을 만든다고 믿는 역추세 데이트레이더입니다.
외국인이 오전 내내 강하게 매도했더라도, 특정 지지선이나 시간대(예: 11시 이후)에는 반발 매수세가 들어올 것이라 봅니다.
과열구간에서는DOWN을, 투매구간에서는 UP을 제시하며, 너무 뻔한 추세 추종을 경계하십시오.`,
    },
    {
        id: 'DAY_QUANT',
        name: '데이 퀀트 (📊 Day Quant)',
        prompt: `당신은 특정 시간대의 수급 통계(예: 외인 현물 누적, 프로그램 누적 매매액)와 종가 마감의 상관관계를 철저히 확률적으로 계산하는 냉혈한 퀀트입니다.
업종별 등락(Local Flow)과 주체별 수급(Investor Flow)의 숫자를 기반으로 가장 통계적으로 마감 확률이 높은 방향(UP, DOWN, HOLD)만을 제시합니다. 감정이나 감을 철저하게 배제하십시오.`,
    },
    {
        id: 'DEALER',
        name: '기관 딜러 (🏦 Dealer)',
        prompt: `당신은 철저한 리스크 관리 위주로 포지션을 잡는 보수적인 기관 딜러입니다.
프로그램 매매의 전환점, 환율의 미세한 변동, 그리고 양매수/양매도 등 명확한 신호가 있을 때만 움직입니다.
상승이나 하락의 근거가 조금이라도 모호하다면 포지션을 유지(HOLD)하며 관망하는 것을 강력히 선호합니다.`,
    }
];

export class IntradaySwarmAgent {
    private static instance: IntradaySwarmAgent;
    private pipeline: V2PipelineManager;
    private db: DatabaseService;

    private constructor() {
        this.pipeline = V2PipelineManager.getInstance();
        this.db = DatabaseService.getInstance();
    }

    public static getInstance(): IntradaySwarmAgent {
        if (!IntradaySwarmAgent.instance) {
            IntradaySwarmAgent.instance = new IntradaySwarmAgent();
        }
        return IntradaySwarmAgent.instance;
    }

    /**
     * 장중 군집 A/B 테스트 (09:45 ~ 13:45 간 30분 단위)
     */
    public async runSwarm(slot: string) {
        const startTime = Date.now();
        const now = new Date();
        const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        const predId = `INTRADAY_${dateStr}_${slot.replace(':', '')}`;

        console.log(`[IntradaySwarm] 🧠 ${slot} 군집 시황 분석 시작...`);

        try {
            // 1. 장중 데이터 수집 (시황 AI와 동일하게 수급 위주)
            const [localResult, investorResult] = await Promise.allSettled([
                this.pipeline.runPipeline('PL-LocalFlow' as any),
                this.pipeline.runPipeline('PL-InvestorFlow' as any)
            ]);

            const dataParts: string[] = [];
            if (investorResult.status === 'fulfilled') dataParts.push(`[PL-InvestorFlow]\n${investorResult.value.aggregatedMarkdown}`);
            if (localResult.status === 'fulfilled') dataParts.push(`[PL-LocalFlow]\n${localResult.value.aggregatedMarkdown}`);
            const contextData = dataParts.join('\n\n---\n\n');

            // 2. 4인방 블라인드 개별 투표 집행 (병렬이 아닌 AiExecutionQueue를 통한 직렬 큐잉)
            const queue = AiExecutionQueue.getInstance();
            const votes: Array<{ id: string, name: string, predict: string, rationale: string }> = [];

            for (const persona of INTRADAY_PERSONAS) {
                const prompt = `[${slot} KST 기준 실시간 시장 데이터]\n${contextData}\n\n위 데이터를 바탕으로 오늘 장마감 코스피 종가 방향을 예측하시오. 당신의 통찰력 있는 1~2문장의 근거와 결론(UP, DOWN, HOLD)을 아래 JSON 포맷으로 제출하시오.\n\n{ "predict": "UP" | "DOWN" | "HOLD", "argument": "당신의 주장" }`;

                try {
                    const answerText = await queue.enqueue({
                        agentId: `SWARM_${persona.id}`,
                        agentName: `${persona.name}`,
                        triggerType: 'CRON',
                        targetType: 'local',
                        prompt: prompt,
                        systemInstruction: persona.prompt
                    });

                    // JSON 추출
                    let parsed: any = null;
                    const jsonMatch = answerText.match(/\{[\s\S]*?\}/);
                    if (jsonMatch) {
                        try { parsed = JSON.parse(jsonMatch[0]); } catch (e) {}
                    }
                    
                    if (parsed && parsed.predict && parsed.argument) {
                        const predict = ['UP', 'DOWN', 'HOLD'].includes(parsed.predict.toUpperCase()) ? parsed.predict.toUpperCase() : 'HOLD';
                        votes.push({
                            id: persona.id,
                            name: persona.name,
                            predict: predict,
                            rationale: parsed.argument
                        });
                        console.log(`[IntradaySwarm] ${persona.name} 투표 완료: ${predict}`);
                    }
                } catch (err: any) {
                    console.error(`[IntradaySwarm] ${persona.name} 투표 실패:`, err.message);
                }
            }

            if (votes.length === 0) {
                throw new Error("모든 페르소나 투표 실패");
            }

            // [Phase 3] 과거 성적에 따른 가중치 추출 (Judge 반영 위함)
            const weights = PerformanceTracker.getInstance().getPersonaWeights();

            // 3. 로컬 판사(Judge) 요약 및 최종 결정
            const voteSummary = votes.map(v => {
                const pWeight = weights[v.id]?.weight || 1.0;
                const winRate = weights[v.id]?.winRate !== undefined ? `${weights[v.id].winRate}% 적중` : `신규`;
                return `- ${v.name} (승률: ${winRate}, 발언권: ${pWeight.toFixed(1)}배): [${v.predict}] ${v.rationale}`;
            }).join('\n');
            const judgePrompt = `당신은 4명의 데이트레이더로 구성된 위원회의 위원장(판사)입니다.
아래 4명의 의견을 모두 읽고, 종합적인 결론을 내려야 합니다. 
핵심 지침: 발언권(Weight)이 1.0보다 높은 페르소나의 논리를 우선적으로 신뢰하며, 발언권이 낮거나 최근 적중률이 낮은 페르소나의 의견은 의심하십시오. 발언권 비중을 곱한 다수결(수급 강도 고려)을 종합하여 판단하십시오.

[위원회의 투표 의견 및 발언권(입김)]
${voteSummary}

이 의견들을 바탕으로 오늘 장마감 코스피 종가의 최종 예측 방향을 아래 JSON으로 결정하시오.
{ "final_predict": "UP" | "DOWN" | "HOLD", "confidence": 0~100, "judge_rationale": "판사의 최종 결론 요약 (핵심 논거 위주 2문장)" }`;

            const judgeResponse = await queue.enqueue({
                agentId: 'SWARM_JUDGE',
                agentName: '로컬 군집 위원장',
                triggerType: 'CRON',
                targetType: 'local',
                prompt: judgePrompt,
                systemInstruction: '당신은 상반된 의견들의 근거를 냉철히 비교 분석하여, 가장 현실적인 타점을 잡아내는 최고 책임자입니다. 오직 JSON만 출력합니다.'
            });

            let finalParsed: any = { final_predict: 'HOLD', confidence: 50, judge_rationale: '판정 실패 (HOLD)' };
            const judgeMatch = judgeResponse.match(/\{[\s\S]*?\}/);
            if (judgeMatch) {
                try {
                    const temp = JSON.parse(judgeMatch[0]);
                    if (temp.final_predict) finalParsed = temp;
                } catch (e) {}
            }

            const predict = ['UP', 'DOWN', 'HOLD'].includes((finalParsed.final_predict || '').toUpperCase()) ? (finalParsed.final_predict || '').toUpperCase() : 'HOLD';
            const confidence = typeof finalParsed.confidence === 'number' ? finalParsed.confidence : 50;
            
            // 4. 합산 Rationale 조립
            const totalRationale = `[군집 위원회 종합판결]\n${finalParsed.judge_rationale}\n\n[위원별 상세의견]\n${votes.map(v => `• ${v.name.split(' ')[0]}: ${v.predict}`).join('\n')}`;

            // 5. DB 저장
            const position = predict === 'UP' ? 'KODEX 200' : predict === 'DOWN' ? 'KODEX 인버스' : 'HOLD';
            const sourcesArr: string[] = ['SWARM_LOCAL'];
            const rawDb = (this.db as any).db;

            rawDb.prepare(`
                INSERT OR REPLACE INTO intraday_predictions 
                (id, date, time_slot, predict, confidence, rationale, position, sources_json, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))
            `).run(predId, dateStr, slot, predict, confidence, totalRationale, position, JSON.stringify(sourcesArr));

            // 6. UI 이벤트 발송
            const resultPayload = { id: predId, date: dateStr, time_slot: slot, predict, confidence, rationale: totalRationale, position, sources_json: JSON.stringify(sourcesArr) };
            eventBus.emit('INTRADAY_PREDICTION_UPDATED' as any, resultPayload);

            console.log(`[IntradaySwarm] ${slot} 전체 프로세스 완료: ${predict} (${confidence}%) | 소요시간: ${Date.now() - startTime}ms`);
            
        } catch (error: any) {
            console.error(`[IntradaySwarm] ${slot} 프로세스 런타임 에러:`, error.message);
            const rawDb = (this.db as any).db;
            rawDb.prepare(`
                INSERT OR IGNORE INTO intraday_predictions 
                (id, date, time_slot, predict, confidence, rationale, created_at)
                VALUES (?, ?, ?, 'HOLD', 0, ?, datetime('now', 'localtime'))
            `).run(predId, dateStr, slot, `군집 투표 에러: ${error.message}`);
        }
    }

    /**
     * Phase 1: 비동기 댓글 작성기 (Asynchronous Commentary Writer)
     * Gemini가 작성한 메인 시황 리포트(predId)를 전달받아, 로컬 군집 4인방이 댓글을 달고 여론(Sentiment)을 갱신합니다.
     */
    public async runSwarmCommentary(predId: string, geminiPredict: string, geminiRationale: string, tableName: string = 'intraday_predictions') {
        console.log(`[IntradaySwarm] 💬 메인 기사(${predId})에 대한 군집 댓글 작성 시작...`);
        const queue = AiExecutionQueue.getInstance();
        const comments: Array<{ id: string, name: string, predict: string, comment: string }> = [];

        try {
            // 1. 4인방 개별 댓글 작성
            for (const persona of INTRADAY_PERSONAS) {
                const prompt = `[메인 시황 AI의 예측 리포트]
결론: ${geminiPredict}
근거: ${geminiRationale}

당신은 위 리포트에 논평을 다는 데이트레이딩/운용역 전문가입니다. 위 메인 AI의 의견과 당신의 고유한 분석 관점을 결합하여, 향후 시장 방향성에 대해 분석하고 1~2문장의 단호한 코멘트를 남겨주세요.
오직 아래 JSON 포맷으로만 응답해야 합니다. (상승 = UP, 하락 = DOWN, 관망/판단보류 = HOLD)
{ "predict": "UP" | "DOWN" | "HOLD", "comment": "당신의 촌철살인 댓글" }`;

                try {
                    const answerText = await queue.enqueue({
                        agentId: `COMMENT_${persona.id}`,
                        agentName: `${persona.name} (댓글작성)`,
                        triggerType: 'CRON',
                        targetType: 'local',
                        prompt: prompt,
                        systemInstruction: persona.prompt
                    });

                    // JSON 파싱 시도 (로컬 LLM 고려)
                    let parsed: any = null;
                    const jsonMatch = answerText.match(/\{[\s\S]*?\}/);
                    if (jsonMatch) {
                        try { parsed = JSON.parse(jsonMatch[0]); } catch (e) {}
                    }
                    
                    if (parsed && parsed.predict && parsed.comment) {
                        const predict = ['UP', 'DOWN', 'HOLD'].includes(parsed.predict.toUpperCase()) ? parsed.predict.toUpperCase() : 'HOLD';
                        comments.push({
                            id: persona.id,
                            name: persona.name,
                            predict: predict,
                            comment: parsed.comment
                        });
                        console.log(`[IntradaySwarm-Comment] ${persona.name} 댓글 작성 완료: ${predict}`);
                    }
                } catch (err: any) {
                    console.error(`[IntradaySwarm-Comment] ${persona.name} 댓글 작성 실패:`, err.message);
                }
            }

            if (comments.length === 0) {
                console.log(`[IntradaySwarm-Comment] 모든 댓글 작성 실패로 취소됨.`);
                return;
            }

            // [Phase 3] 과거 성적에 따른 페르소나 가중치 적용 (가중 투표 방식)
            const weights = PerformanceTracker.getInstance().getPersonaWeights();

            // 2. 군집 여론(Swarm Sentiment) 종합 (가중치 기반 계산)
            let upWeight = 0;
            let downWeight = 0;
            let holdWeight = 0;

            comments.forEach(c => {
                const pWeight = weights[c.id]?.weight || 1.0;
                if (c.predict === 'UP') upWeight += pWeight;
                else if (c.predict === 'DOWN') downWeight += pWeight;
                else holdWeight += pWeight;
            });
            const totalWeight = upWeight + downWeight + holdWeight;
            
            let dominantSentiment = 'HOLD';
            if (upWeight > downWeight && upWeight >= holdWeight) dominantSentiment = 'UP';
            else if (downWeight > upWeight && downWeight >= holdWeight) dominantSentiment = 'DOWN';
            
            // 승률 우세율 계산 (가중치 기준)
            const maxWeight = Math.max(upWeight, downWeight, holdWeight);
            const sentimentPercentage = totalWeight > 0 ? Math.round((maxWeight / totalWeight) * 100) : 0;
            
            const swarmSentiment = `${dominantSentiment} (${sentimentPercentage}%)`;

            // 댓글 배열 자체에도 가중치, 승률(UI 표시용) 객체를 포함해서 저장
            const enrichedComments = comments.map(c => ({
                ...c,
                weight: weights[c.id]?.weight || 1.0,
                winRate: weights[c.id]?.winRate !== undefined ? weights[c.id].winRate : null
            }));

            // 3. DB 업데이트 (comments_json, swarm_sentiment 컬럼)
            const rawDb = (this.db as any).db;
            rawDb.prepare(`
                UPDATE ${tableName} 
                SET comments_json = ?, swarm_sentiment = ?
                WHERE id = ?
            `).run(JSON.stringify(enrichedComments), swarmSentiment, predId);

            // 4. UI 갱신 이벤트 발송 (기존 데이터 다시 읽어서 전송하거나, 간단히 아이디만 전송)
            const updatedRow = rawDb.prepare(`SELECT * FROM ${tableName} WHERE id = ?`).get(predId);
            if (updatedRow) {
                const eventName = tableName === 'intraday_predictions' ? 'INTRADAY_PREDICTION_UPDATED' : 'MARKET_CONDITION_COMPLETE';
                eventBus.emit(eventName as any, updatedRow);
            }

            console.log(`[IntradaySwarm] 💬 메인 기사(${tableName}: ${predId}) 댓글 반영 완료 | 여론: ${swarmSentiment}`);

        } catch (error: any) {
            console.error(`[IntradaySwarm-Comment] 런타임 에러:`, error.message);
        }
    }
}
