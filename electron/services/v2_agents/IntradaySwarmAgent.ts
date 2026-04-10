import { V2PipelineManager } from '../v2_pipeline/V2PipelineManager';
import { AiExecutionQueue } from '../AiExecutionQueue';
import { DatabaseService } from '../DatabaseService';
import { eventBus } from '../../utils/EventBus';
import { PerformanceTracker } from './PerformanceTracker';
import { PriceStore } from '../PriceStore';
import { KiwoomService } from '../KiwoomService';
import { TechnicalAnalyzer } from './TechnicalAnalyzer';
import { ChartRenderService } from '../ChartRenderService';

export const INTRADAY_PERSONAS = [
    {
        id: 'MOMENTUM',
        name: '모멘텀 트레이더 (🐂 Momentum)',
        prompt: `당신은 실시간 5분봉 차트의 초단기 추세(VWAP 돌파 유지, 거래량 폭발) 방향으로 당일 시장이 무조건 지속된다고 믿는 순응형 데이트레이더입니다. 
아침 시가(Open Price) 갭, 당일 VWAP 지지/저항 라인과 분봉 캔들의 쏠림 현상을 읽어내며, 반등보다는 장중 차트의 절대적인 힘(가는 말이 더 간다)을 철학으로 삼습니다. 
초단기 이평선(5선/20선)이 정배열이고 주가가 VWAP 위에 위치하며 거래량이 실리면 UP, 반대면 DOWN을 거침없이 주장하십시오. (뚜렷한 돌파 없이 이평선이 혼재된 횡보장이라면 억지 베팅을 피하고 당당히 'HOLD'를 외치십시오.)`,
    },
    {
        id: 'CONTRARIAN',
        name: '역발상 차티스트 (🐻 Contrarian)',
        prompt: `당신은 특정 시간대의 급격한 차트 모멘텀(VWAP 대비 지나친 괴리, 거래량 없는 억지 상승/하락)은 단기 되돌림(Reversal)을 반드시 만든다고 믿는 역추세 데이트레이더입니다.
하지만 분봉이 VWAP을 강하게 이탈하여 수급과 함께 박살나는 하락기조에서는 섣불리 역추세 매수를 논하지 않습니다. 
주가가 VWAP에서 너무 멀어지거나 단기 이평 다이버전스가 생기며 극단적 피로감을 보일 때만 꼬리(Wick) 캔들을 근거로 역행 타점을 잡습니다. 타점이 안 나오면 관망(HOLD)합니다.`,
    },
    {
        id: 'DAY_QUANT',
        name: '기술적 데이 퀀트 (📊 Day Quant)',
        prompt: `당신은 당일 VWAP 궤적과 거래량 가중치 상승/하락 비율을 통계적으로 계산하는 냉혈한 퀀트입니다.
일봉 추세는 철저히 배제하고, 가장 중요한 것은 오직 현재 가격이 '당일 VWAP선'과 '5분봉 20선' 위인지 아래인지입니다.
VWAP을 하향 이탈하고 5분봉 20선이 꺾이면 어떤 호재에도 무조건 DOWN을 제시하여 감정을 완전히 배제합니다. (애매한 돌파 시도 중에는 HOLD를 선택하여 통계적 오차를 줄입니다.)`,
    },
    {
        id: 'DEALER',
        name: '기관 딜러 (🏦 Dealer)',
        prompt: `당신은 리스크 관리에 가장 민감하며 철저한 승률 위주로 진입 타점을 잡는 보수적인 기관 딜러입니다.
만약 현재 주가가 VWAP을 밑돌고 5분 선이 짓눌려 있다면 강력하게 하방(DOWN) 뷰를 견지하며 보수적으로 대응합니다.
상승 근거가 '단기 정배열/VWAP 지지'와 '외국인/기관 쌍끌이 수급' 양쪽에서 완벽히 교집합을 이룬 상태여야만 진입(UP/DOWN)에 투표합니다. 하나라도 엇갈리면 100% 홀딩(HOLD)을 선호합니다.`,
    },
    {
        id: 'PRICE_ACTION',
        name: '프라이스 액션 스캘퍼 (🕯️ PA Sniper)',
        prompt: `당신은 복잡한 지표보다 캔들의 모양(밑꼬리 지지, 윗꼬리 저항)과 당일 거래량 폭발(Volume Spike)에만 집착하는 프라이스 액션 스캘퍼입니다.
VWAP이나 단기 지지선 근처에서 "강력한 매수세(긴 밑꼬리 캔들과 거래량 급증)"가 보이면 즉시 UP을 투표하여 미세 타점을 포착합니다. 반대로 저항선에서 윗꼬리가 길게 달리고 거래량이 터지면 가차없이 DOWN을 투표합니다. 잔잔하고 거래량 없는 캔들에서는 'HOLD'를 선언합니다.`,
    },
    {
        id: 'OSCILLATOR_FANATIC',
        name: '보조지표 맹신론자 (📊 Oscillator Fanatic)',
        prompt: `당신은 감정을 배제하고 CCI(20) 및 단기 이동평균선 크로스 수치만을 기계적으로 추종하는 시스템 트레이더입니다.
차트 방향성이 좋아보여도 CCI가 '과매수 유지/이탈'을 가리키고 5/20 이평이 데드크로스를 내면 DOWN을, 투매가 쏟아져도 CCI '과매도 이탈' 및 거래량 동반 골든크로스가 생기면 이유 불문 UP을 외칩니다. 지표들이 상충하거나 0 기준선 근방 횡보면 주저 없이 'HOLD'를 외치십시오.`,
    },
    {
        id: 'DOOM_SAYER',
        name: '레드팀 비관론자 (🐻 Doom Sayer)',
        prompt: `당신은 태생적으로 주식 시장의 하락(Short) 베팅을 선호하는 폭락론자입니다.
모두가 V자 반등을 외칠 때, 홀로 "VWAP 아래에서의 데드캣 바운스나, 거래량 터진 음봉"을 경계합니다. 압도적인 VWAP 상향 돌파 시그널 및 대량 매수세가 확인되지 않는 한, 모든 저항선을 핑계로 DOWN에 투표하며 리스크를 방어합니다. (단, 폭락 이후 하락세가 완전히 진정되어 투매가 멈추면 억지 DOWN 대신 HOLD를 선택합니다.)`,
    },
    {
        id: 'BREAKOUT_PIRATE',
        name: '돌파 해적 (🏴‍☠️ Breakout Pirate)',
        prompt: `당신은 주가가 VWAP이나 20선 주변에서 지루하게 박스권 횡보하는 것을 극도로 혐오하는 돌파 매매 전문가입니다.
당일 엄청난 거래량(Volume Spike)이 터지면서 전고점이나 시가, VWAP을 '확실하게 돌파'하는 찰나의 순간에만 환호하며 편승(UP/DOWN)합니다. 추세가 모호하고 거래량 없이 핑퐁을 치는 휩소 장세에서는 무조건 "HOLD"(판단 보류)를 외치며 난전에 참여하지 않습니다.`,
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
            // 1. 장중 데이터 수집 (외국인/기관 수급만 반영, 업종단위는 배제)
            const investorResult = await this.pipeline.runPipeline('PL-InvestorFlow' as any);

            // 차트 브리핑 (Daily 1줄 요약 + Intraday VWAP/변동성/거래량) 가져오기
            let chartDigest = '[오류] 분봉 차트 데이터를 불러오지 못했습니다.';
            try {
                const analyzer = new TechnicalAnalyzer(KiwoomService.getInstance());
                const dailyDigest = await analyzer.generateDailyTechnicalDigest();
                const intraDigest = await analyzer.generateIntradayTechnicalDigest();
                
                chartDigest = `${dailyDigest}\n\n---\n\n${intraDigest}`;
            } catch (e: any) {
                console.error('[IntradaySwarm] 차트 분석기 로드 실패:', e.message);
                chartDigest = `[오류] 차트 데이터를 생성하는 중 문제가 발생했습니다: ${e.message}`;
            }

            const dataParts: string[] = [];
            dataParts.push(`[📈 실시간 종합 차트 추세]\n${chartDigest}`);
            if (investorResult.status === 'fulfilled') dataParts.push(`[PL-InvestorFlow (외인/기관 수급 동향 - 장중 집계용)]\n${investorResult.value.aggregated_markdown}`);
            const contextData = dataParts.join('\n\n---\n\n');

            // --- 실시간 차트 이미지 캡처 (상하단 분할) ---
            let base64Image = null;
            try {
                const imageBuffer = await ChartRenderService.captureChart('069500', 'KODEX 200', 'dark');
                base64Image = imageBuffer.toString('base64');
            } catch(e) {
                console.error('[IntradaySwarm] 이미지 캡처 실패:', e);
            }

            // 2. 8인방 블라인드 개별 투표 집행 (병렬이 아닌 AiExecutionQueue를 통한 직렬 큐잉)
            const queue = AiExecutionQueue.getInstance();
            const votes: Array<{ id: string, name: string, predict: string, rationale: string }> = [];

            // --- 실시간 자기 성찰 피드백을 위한 데이터 사전 소싱 ---
            const rawDb = (DatabaseService.getInstance() as any).db;
            const kstDate = DatabaseService.getInstance().getKstDate();
            
            const pastPreds = rawDb.prepare(`
                SELECT time_slot, comments_json, entry_price 
                FROM intraday_predictions 
                WHERE date = ? AND entry_price > 0 AND comments_json IS NOT NULL
                ORDER BY time_slot ASC
            `).all(kstDate) as any[];

            let curK200 = 0; let curInv = 0;
            try {
                // 실시간 피드백 및 최종 진입가를 위해 차트의 가장 최근 종가를 확보
                const k200Chart = await KiwoomService.getInstance().getOhlcv5m('069500', 1);
                if (k200Chart.length > 0) curK200 = k200Chart[k200Chart.length - 1].close;
                
                const invChart = await KiwoomService.getInstance().getOhlcv5m('114800', 1);
                if (invChart.length > 0) curInv = invChart[invChart.length - 1].close;
            } catch(e) {
                console.error('[IntradaySwarm] 실시간 피드백을 위한 현재가 조회 실패', e);
            }
            // -----------------------------------------------------------

            for (const persona of INTRADAY_PERSONAS) {

                // 개별 페르소나의 오늘 승률 추적 및 프롬프트 주입
                let feedbackPrompt = "";
                let myPastVotes = [];
                for (const p of pastPreds) {
                    try {
                        const comments = JSON.parse(p.comments_json || '[]');
                        const myVote = comments.find((c: any) => c.id === persona.id);
                        if (myVote && (myVote.predict === 'UP' || myVote.predict === 'DOWN')) {
                            myPastVotes.push({ time_slot: p.time_slot, predict: myVote.predict, entry_price: p.entry_price });
                        }
                    } catch(e) {}
                }

                if (myPastVotes.length > 0) {
                    let reportLines = [];
                    for (const pv of myPastVotes) {
                        const curPrice = pv.predict === 'UP' ? curK200 : curInv;
                        if (curPrice > 0) {
                            const yieldPct = ((curPrice - pv.entry_price) / pv.entry_price) * 100;
                            const sign = yieldPct > 0 ? '+' : '';
                            reportLines.push(`- [${pv.time_slot} 시점] 귀하의 ${pv.predict} 예측: 현재 수익률 ${sign}${yieldPct.toFixed(2)}%`);
                        }
                    }
                    if (reportLines.length > 0) {
                        feedbackPrompt = `\n[🚨 실시간 자기 객관화 피드백]\n오늘 장중 귀하가 앞서 예측했던 내역들의 현재 누적 수익률입니다:\n${reportLines.join('\n')}\n* 만약 귀하의 이전 예측들이 연달아 큰 손실(-마이너스) 중이라면, 현재 시장 추세가 귀하의 차트 인식을 벗어났음을 인정하고, 기존 편향을 과감히 뒤집어 순응하거나 당장 포지션 진입을 보류(HOLD)하십시오!\n`;
                    }
                }

                const prompt = `[${slot} KST 기준 실시간 시장 데이터]\n${contextData}\n${feedbackPrompt}\n위 데이터 및 첨부된 차트 이미지(위:일봉, 아래:5분봉)를 함께 바탕으로 오늘 장마감 코스피 종가의 최종 방향성을 예측하시오. 외국인/기관의 장중 수급 동향(건수/대금)과 분봉 차트의 형태(시가 지지/이탈, 거래량 등)를 종합적으로 고려하여 결론을 내리십시오.\n\n[중요 룰셋]: 당신은 당신 특유의 매매 철학(페르소나)에 입각하여 판단해야 합니다. 방향성에 대한 확신이 부족하거나 수급과 차트가 서로 엇갈리는 애매한 횡보장이라면 억지로 예측하지 말고 반드시 'HOLD(관망)'를 선택하세요. 확실할 때만 UP/DOWN을 선택해야 누적 승률을 방어할 수 있습니다.\n\n논리가 단호하고 통찰력 있는 1~2문장의 아주 짧은 근거(50자 내외)와 최종 판단 방향(UP, DOWN, HOLD)을 아래 JSON 포맷으로 제출하시오. 길게 쓰면 감점입니다.\n\n{ "predict": "UP" | "DOWN" | "HOLD", "argument": "수급 및 차트 형태 기반 핵심 근거 (50자 이내)" }`;

                let customMessages = undefined;
                if (base64Image) {
                    customMessages = [
                        {
                            role: "user",
                            content: [
                                { type: "text", text: prompt },
                                { type: "image_url", image_url: { url: `data:image/png;base64,${base64Image}` } }
                            ]
                        }
                    ];
                }

                try {
                    const answerText = await queue.enqueue({
                        agentId: `SWARM_${persona.id}`,
                        agentName: `${persona.name}`,
                        triggerType: 'CRON',
                        targetType: 'local',
                        prompt: base64Image ? "" : prompt, // customMessages가 있으면 prompt는 무효화되므로 빈 문자열로 넘기기
                        customMessages: customMessages,
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
                // 전체 승률과 최근 10회 승률을 병기하여 출력
                const winRateStr = weights[v.id]?.winRate !== undefined 
                    ? `전체 ${weights[v.id].winRate}% / 최근10회 ${weights[v.id].recent10Rate}%` 
                    : `신규`;
                return `- ${v.name} (승률: ${winRateStr}, 발언권: ${pWeight.toFixed(1)}배): [${v.predict}] ${v.rationale}`;
            }).join('\n');
            
            const judgePrompt = `당신은 8명의 데이트레이더로 구성된 위원회의 위원장(판사)입니다.
아래 8명의 의견을 모두 읽고, 종합적인 결론을 내려야 합니다. 
핵심 지침 1: 발언권(Weight)이 1.0 초과인 '최근 장세에 잘 적응한(Hot Hand)' 페르소나의 논리를 무조건적으로 신뢰하며, 반대로 발언권이 0.0 배(박탈)인 페르소나의 의견은 철저히 무시하십시오. 발언권 비중을 곱한 다수결을 우선 고려하여 판단하십시오.
핵심 지침 2: 페르소나들의 의견이 팽팽하게 엇갈리거나, 절대다수가 'HOLD'를 외쳤다면 무리하게 UP/DOWN으로 결론 내지 말고 위원장 직권으로 최종 결정도 당당히 'HOLD(관망)'로 선언하십시오. 수익이 확실한 자리에만 들어가는 것이 데이트레이딩의 핵심입니다.

[위원회의 투표 의견 및 발언권(최근 적중률 기반 입김)]
${voteSummary}

이 의견들을 바탕으로 오늘 장마감 코스피 종가의 최종 예측 방향을 아래 JSON으로 결정하시오.
반드시 "judge_rationale"은 길고 지루한 문장 대신, 발언권이 높은 주요 의견을 차용하여 1~2개의 글머리 기호(•)로 아주 간결하게(다 합쳐서 70자 이내) 팩트 폭격하듯 요약해야 합니다!!
{ "final_predict": "UP" | "DOWN" | "HOLD", "confidence": 0~100, "judge_rationale": "• (예시)수급 주체 양매도 및 하방 추세 뚜렷하여 DOWN 우세" }`;

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
            
            const cciMatch = chartDigest.match(/5\.\s*CCI\(20\)\s*보조지표:\s*(.*?)(?=\n|$)/);
            const cciText = cciMatch ? `\n📊 [CCI 지표 상태]\n${cciMatch[1]}\n` : '';

            // 4. 합산 Rationale 조립 및 UI 표시용 Comments 생성
            const totalRationale = `[군집 위원회 종합판결]
${finalParsed.judge_rationale}
${cciText}
[위원별 상세의견]
${votes.map(v => {
    const w = weights[v.id];
    const winText = w ? ` (누적: ${Math.round(w.winRate)}% | 오늘: ${w.todayRate !== null ? Math.round(w.todayRate) + '%' : '신규'})` : '';
    return `• ${v.name.split(' ')[0]}: ${v.predict}${winText}`;
}).join('\n')}`.trim();

            const enrichedComments = votes.map(v => ({
                id: v.id,
                name: v.name,
                predict: v.predict,
                comment: v.rationale,
                weight: weights[v.id]?.weight || 1.0,
                winRate: weights[v.id]?.winRate !== undefined ? weights[v.id].winRate : null,
                recent10Rate: weights[v.id]?.recent10Rate !== undefined ? weights[v.id].recent10Rate : null
            }));

            // UI 통계/디버깅을 위해 AI에게 전달되었던 '원본 다이제스트(차트 요약텍스트)'도 배열에 추가
            enrichedComments.push({
                id: 'SYSTEM_CONTEXT',
                name: '시스템 전처리 다이제스트 (입력 데이터)',
                predict: 'INFO',
                comment: contextData,
                weight: 0,
                winRate: null,
                recent10Rate: null
            });

            const swarmSentiment = `${predict} (${confidence}%)`;

            // 5. DB 저장 및 진입가(entry_price) 조회
            const position = predict === 'UP' ? 'KODEX 200' : predict === 'DOWN' ? 'KODEX 인버스' : 'HOLD';
            // HOLD도 KODEX 200(069500)을 기준 인덱스로 사용 (기회비용 평가를 위해)
            const code = predict === 'DOWN' ? '114800' : '069500';
            let entryPrice = 0;
            
            // 1순위: 위에서 방금 긁어온 5분봉의 가장 최근 종가를 사용하여 차트와 완벽히 일치시킴
            if (code === '069500' && curK200 > 0) {
                entryPrice = curK200;
            } else if (code === '114800' && curInv > 0) {
                entryPrice = curInv;
            }

            // 2순위: 혹시라도 5분봉 조회에 실패했다면 REST API 직접 조회 강제 호출 (PriceStore 의존성 회피)
            if (!entryPrice || entryPrice <= 0) {
                try {
                    const res = await KiwoomService.getInstance().getCurrentPrice(code);
                    const body = res?.Body || res?.output || res;
                    const p = body?.stck_prpr || body?.cur_prc || body?.prpr || body?.close;
                    if (p) {
                        entryPrice = Math.abs(Number(p));
                    }
                } catch (e) {
                    console.error('[IntradaySwarm] 진입가 직접 백업 조회 실패:', e);
                }
            }

            // 3순위: REST 호출마저 실패하면 최종 수단으로 웹소켓 캐시(PriceStore) 값 사용. 단, 오래된 값일 수 있음.
            if (!entryPrice || entryPrice <= 0) {
                entryPrice = PriceStore.getInstance().getPrice(code) || 0;
            }

            // 저장소 동기화 (웹소켓 연결이 끊겼더라도 UI 상에 올바른 가격을 보여주도록 덮어쓰기)
            if (entryPrice > 0) {
                PriceStore.getInstance().setPrice(code, entryPrice);
            }

            const sourcesArr: string[] = ['SWARM_LOCAL'];

            rawDb.prepare(`
                INSERT OR REPLACE INTO intraday_predictions 
                (id, date, time_slot, predict, confidence, rationale, position, entry_price, sources_json, comments_json, swarm_sentiment, image_base64, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))
            `).run(predId, dateStr, slot, predict, confidence, totalRationale, position, entryPrice, JSON.stringify(sourcesArr), JSON.stringify(enrichedComments), swarmSentiment, base64Image || null);

            PerformanceTracker.getInstance().invalidatePendingCache()

            // 6. UI 이벤트 발송
            const resultPayload = { 
                id: predId, date: dateStr, time_slot: slot, predict, confidence, rationale: totalRationale, 
                position, entry_price: entryPrice, sources_json: JSON.stringify(sourcesArr), 
                comments_json: JSON.stringify(enrichedComments), swarm_sentiment: swarmSentiment 
            };
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
    public async runSwarmCommentary(predId: string, geminiPredict: string, geminiRationale: string, tableName: string = 'intraday_predictions', technicalDigest: string = '') {
        console.log(`[IntradaySwarm] 💬 메인 기사(${predId})에 대한 군집 댓글 작성 시작...`);
        const queue = AiExecutionQueue.getInstance();
        const comments: Array<{ id: string, name: string, predict: string, comment: string }> = [];

        try {
            // 1. 4인방 개별 댓글 작성
            for (const persona of INTRADAY_PERSONAS) {
                const prompt = `[메인 시황 AI의 예측 리포트]
결론: ${geminiPredict}
근거: ${geminiRationale}

[🔥장중 실시간 차트/모멘텀/CCI 기초 데이터🔥]
${technicalDigest}

당신은 위 리포트와 실시간 차트 데이터를 바탕으로 논평을 다는 데이트레이딩/운용역 전문가입니다. 메인 AI의 의견에 동조하든 비판하든 상관없이, 당신의 고유한 분석 관점(페르소나)과 '기초 데이터(특히 CCI 지표와 추세)'를 적극 결합하여 향후 시장 방향성에 대해 분석하고 1~2문장의 단호한 코멘트를 남겨주세요.
오직 아래 JSON 포맷으로만 응답해야 합니다. (상승 = UP, 하락 = DOWN, 관망/판단보류 = HOLD)
{ "predict": "UP" | "DOWN" | "HOLD", "comment": "CCI 등 차트 지표를 언급한 촌철살인 댓글 1~2문장" }`;

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
            let finalCommentsToSave = comments.map(c => ({
                ...c,
                weight: weights[c.id]?.weight || 1.0,
                winRate: weights[c.id]?.winRate !== undefined ? weights[c.id].winRate : null,
                recent10Rate: weights[c.id]?.recent10Rate !== undefined ? weights[c.id].recent10Rate : null
            }));

            // (C) DB 저장 전, 이미 존재하는 Pre-Comments (전담 AI 브리핑) 이 있는지 확인하고 병합
            const rawDb = (this.db as any).db;
            try {
                const existingRow = rawDb.prepare(`SELECT comments_json FROM ${tableName} WHERE id = ?`).get(predId);
                let analystComments: any[] = [];
                if (existingRow && existingRow.comments_json) {
                    const existingComments = JSON.parse(existingRow.comments_json);
                    analystComments = existingComments.filter((c: any) => c.predict === 'INFO' || c.id.startsWith('ANALYST_'));
                }
                
                // 만약 SYSTEM_CONTEXT가 원래 없었고 파라미터로 받은 technicalDigest가 있다면 제일 뒤에 삽입 (UI 하단 배치)
                if (technicalDigest && technicalDigest.trim().length > 0) {
                    const hasSysCtx = analystComments.some(c => c.id === 'SYSTEM_CONTEXT');
                    if (!hasSysCtx) {
                        finalCommentsToSave.push({
                            id: 'SYSTEM_CONTEXT',
                            name: '시스템 전처리 다이제스트 (입력 데이터)',
                            predict: 'INFO',
                            comment: `[🔥 실시간 일봉/5분봉 종합 차트 추세 🔥]\n${technicalDigest}`,
                            weight: 0,
                            winRate: null,
                            recent10Rate: null
                        });
                    }
                }

                if (analystComments.length > 0) {
                    // 전담 분석가 코멘트를 맨 위로 올리거나 합칩니다.
                    finalCommentsToSave = [...analystComments, ...finalCommentsToSave];
                }
            } catch (e: any) {
                console.error(`[IntradaySwarm-Comment] 기존 전처리 댓글 파싱 실패:`, e.message);
            }

            // 3. DB 업데이트 (comments_json, swarm_sentiment 컬럼)
            rawDb.prepare(`
                UPDATE ${tableName} 
                SET comments_json = ?, swarm_sentiment = ?
                WHERE id = ?
            `).run(JSON.stringify(finalCommentsToSave), swarmSentiment, predId);

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
