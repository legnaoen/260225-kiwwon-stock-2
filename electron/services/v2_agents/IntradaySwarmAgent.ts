import { V2PipelineManager } from '../v2_pipeline/V2PipelineManager';
import { AiExecutionQueue } from '../AiExecutionQueue';
import { DatabaseService } from '../DatabaseService';
import { eventBus } from '../../utils/EventBus';
import { PerformanceTracker } from './PerformanceTracker';
import { PriceStore } from '../PriceStore';
import { KiwoomService } from '../KiwoomService';
import { TechnicalAnalyzer } from './TechnicalAnalyzer';
import { ChartRenderService } from '../ChartRenderService';
import { AiService } from '../AiService';
import { TelegramService } from '../TelegramService';

export class IntradaySwarmAgent {
    private static instance: IntradaySwarmAgent;
    private pipeline: V2PipelineManager;
    private db: DatabaseService;

    private constructor() {
        this.pipeline = V2PipelineManager.getInstance();
        this.db = DatabaseService.getInstance();
    }

    public static getInstance() {
        if (!IntradaySwarmAgent.instance) {
            IntradaySwarmAgent.instance = new IntradaySwarmAgent();
        }
        return IntradaySwarmAgent.instance;
    }

    public async runSwarm(slot: string) {
        const startTime = Date.now();
        const now = new Date();
        const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        const predId = `INTRADAY_${dateStr}_${slot.replace(':', '')}`;

        console.log(`[IntradaySmartMonitor] 🧠 ${slot} 장중 스마트 점검 시작...`);

        try {
            const investorResult = await this.pipeline.runPipeline('PL-InvestorFlow' as any);
            
            let newsMarkdown = '';
            try {
                const { NewsDataHub } = await import('../NewsDataHub');
                const hub = NewsDataHub.getInstance();
                if (!hub.getCacheStatus().isValid) {
                    console.log('[IntradaySmartMonitor] 뉴스 캐시 만료/없음. 강제 수집 진행...');
                    await hub.runBatchCollect();
                }
                newsMarkdown = hub.getNewsAsMarkdown({ maxPerCategory: 15, skipKeywords: false });
            } catch(e: any) {
                console.error('[IntradaySmartMonitor] 뉴스 데이터 허브 로드 실패:', e.message);
            }

            let chartDigest = '[오류] 분봉 차트 데이터를 불러오지 못했습니다.';
            try {
                const analyzer = new TechnicalAnalyzer(KiwoomService.getInstance());
                const dailyDigest = await analyzer.generateDailyTechnicalDigest();
                const intraDigest = await analyzer.generateIntradayTechnicalDigest();
                chartDigest = `${dailyDigest}\n\n---\n\n${intraDigest}`;
            } catch (e: any) {
                console.error('[IntradaySmartMonitor] 차트 분석기 로드 실패:', e.message);
                chartDigest = `[오류] 차트 데이터를 생성하는 중 문제가 발생했습니다: ${e.message}`;
            }

            let morningBaseline = "진행된 아침 브리핑이 없습니다.";
            try {
                const rawDb = (this.db as any).db;
                const kstDate = new Date(new Date().getTime() + 9 * 60 * 60 * 1000).toISOString().split('T')[0];
                const morningRow = rawDb.prepare(`
                    SELECT rationale FROM agent_predictions 
                    WHERE date = ? AND cycle = 'A'
                `).get(kstDate) as any;
                if (morningRow && morningRow.rationale) {
                    morningBaseline = morningRow.rationale;
                }
            } catch(e) { }

            const dataParts: string[] = [];
            dataParts.push(`[🔥 아침 08:50 기조 (오늘의 기준점)]\n${morningBaseline}`);
            dataParts.push(`[📈 실시간 종합 차트 추세]\n${chartDigest}`);
            if (investorResult.status === 'success') dataParts.push(`[PL-InvestorFlow (당일 외인/기관 연속성)]\n${investorResult.aggregated_markdown}`);
            if (newsMarkdown) dataParts.push(`[PL-NewsHub (최신 뉴스)]\n${newsMarkdown}`);
            const contextData = dataParts.join('\n\n---\n\n');

            let base64Image = null;
            try {
                const imageBuffer = await ChartRenderService.captureChart('069500', 'KODEX 200', 'dark');
                base64Image = imageBuffer.toString('base64');
            } catch(e) {
                console.error('[IntradaySmartMonitor] 이미지 캡처 실패:', e);
            }

            const queue = AiExecutionQueue.getInstance();

            const prompt = `당신은 전체 시장 관점의 맥락을 감시하는 '장중 스마트 모니터링 탑다운(Top-Down) 전략가'입니다.

시간: ${slot} (KST)
아래의 [입력 데이터]를 바탕으로 시황을 판단하세요. (특히 뉴스를 최우선으로 분석하세요!!)

목표: 
단순히 수치나 차트만 보지 말고, **현재 시장을 지배하는 새로운 뉴스/이슈**를 파악한 뒤 이를 수급 및 차트와 결합하여 시황 스토리를 생성합니다. 
의미 있는 악재/호재 뉴스 출회, 수급의 급격한 이탈, 투심의 변화 등이 발생했는지 점검합니다.

[판단 규칙]
1. 의미 없는 횡보장이나 특기할 뉴스와 가격 변동이 함께 관찰되지 않으면 is_meaningful_change 를 false 로 설정합니다. (쓸데없는 알람 자제)
2. 의미 있는 시장의 테마/뉴스 변동이 있다면 true로 설정하고, 아래 3개 항목(news, technicals, forecast)을 개조식으로 요약하세요.
3. 🔴 아주 중요: 모든 텍스트는 장황한 문장(~~합니다) 대신 뉴스 브리핑처럼 짧고 명확한 '개조식(음슴체 불필요, 명사형 종결 등)'으로 작성하세요! (예: "수출 둔화 우려 확산", "차익실현 매물 출회", "반등 시 비중 축소")

[입력 데이터]
${contextData}

오직 아래 JSON 포맷으로 수집된 데이터에 근거하여 응답하십시오:
{
  "predict": "UP" | "DOWN" | "HOLD",
  "confidence": 70, 
  "is_meaningful_change": true, // 특이동향 없으면 무조건 false. true일 경우 텍스트 기입.
  "trend_news": "1. 시장 핵심 동향 (현재 지배적인 뉴스/이슈/테마 등 짧은 개조식 요약)",
  "trend_technicals": "2. 수급 및 기술적 특이점 (외인/기관 동향 및 차트 지표 연관성 짧은 개조식 팩트체크)",
  "trend_forecast": "3. 단기 전망 및 대응 (뉴스 모멘텀 기반 향후 방향성과 전략)"
}`;

            console.log(`[IntradaySmartMonitor] LLM에 분석 요청 중...`);
            const responseText = await queue.enqueue({
                agentId: 'INTRADAY_MONITOR',
                agentName: '장중 스마트 모니터',
                triggerType: 'CRON',
                targetType: 'gemini',
                prompt: prompt,
                systemInstruction: "You are a professional market maker AI."
            });

            let parsed: any;
            try {
                let cleanJson = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
                parsed = JSON.parse(cleanJson);
            } catch (e) {
                console.error('[IntradaySmartMonitor] JSON 파싱 실패. 원본:', responseText);
                parsed = {
                    predict: "HOLD",
                    confidence: 0,
                    is_meaningful_change: false,
                    trend_news: "응답 파싱 오류",
                    trend_technicals: "LLM이 JSON 형식을 반환하지 않음",
                    trend_forecast: "관망"
                };
            }

            const predict = parsed.predict || 'HOLD';
            const confidence = parsed.confidence || 0;
            const position = predict === 'HOLD' ? 'NEUTRAL' : predict;
            const swarmSentiment = predict; 

            // 결과 객체를 comments_json 배열로 변환 (UI 호환용)
            const newComments = [];
            if (parsed.trend_news) newComments.push({ personaName: '📰 News & Issue', personaId: 'INFO', title: '시장 핵심 동향', predict: 'INFO', reason: parsed.trend_news });
            if (parsed.trend_technicals) newComments.push({ personaName: '📊 Flow & Chart', personaId: 'INFO', title: '수급/기술적 팩트체크', predict: 'INFO', reason: parsed.trend_technicals });
            if (parsed.trend_forecast) newComments.push({ personaName: '🔮 Strategy', personaId: 'INFO', title: '전망 및 대응', predict: predict, reason: parsed.trend_forecast });

            const totalRationale = `[스마트 모니터 브리핑]\n변동성 감지: ${parsed.is_meaningful_change ? 'Yes 🚨' : 'No 💤'}\n이슈: ${parsed.trend_news}\n팩트체크: ${parsed.trend_technicals}\n전략: ${parsed.trend_forecast}`;

            const kiwoom = KiwoomService.getInstance();
            let entryPrice = 0;
            try {
                const kodex = kiwoom.getDailyData('069500');
                if (kodex && kodex.length > 0) {
                    entryPrice = kodex[kodex.length - 1].close;
                }
            } catch(e) { }

            if (entryPrice > 0) {
                PriceStore.getInstance().setPrice('069500', entryPrice);
            }

            const sourcesArr: string[] = ['SMART_MONITOR_PIPELINE'];

            const rawDb = (this.db as any).db;
            rawDb.prepare(`
                INSERT OR REPLACE INTO intraday_predictions 
                (id, date, time_slot, predict, confidence, rationale, position, entry_price, sources_json, comments_json, swarm_sentiment, image_base64, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))
            `).run(predId, dateStr, slot, predict, confidence, totalRationale, position, entryPrice, JSON.stringify(sourcesArr), JSON.stringify(newComments), swarmSentiment, base64Image || null);

            PerformanceTracker.getInstance().invalidatePendingCache();

            // 텔레그램 발송 (is_meaningful_change == true 일때만)
            if (parsed.is_meaningful_change) {
                const trendIcon = predict === 'UP' ? '📈' : (predict === 'DOWN' ? '📉' : '⚖️');
                const safeNews = (parsed.trend_news || '').replace(/[*_`]/g, '');
                const safeTech = (parsed.trend_technicals || '').replace(/[*_`]/g, '');
                const safeForecast = (parsed.trend_forecast || '').replace(/[*_`]/g, '');

                const telegramMsg = `🔔 *[장중 시장 종합 브리핑]* (${slot})\n` +
                    `의견: ${trendIcon} *${predict}*\n\n` +
                    `*📰 1. 시장 핵심 동향 (News)*\n${safeNews}\n\n` +
                    `*📊 2. 수급 및 기술적 특이점 (Flow)*\n${safeTech}\n\n` +
                    `*🔮 3. 단기 전망 및 대응 (Strategy)*\n${safeForecast}`;
                
                try {
                    await TelegramService.getInstance().sendMessage(telegramMsg);
                    console.log(`[IntradaySmartMonitor] 텔레그램 발송 완료.`);
                } catch (e: any) {
                    console.error(`[IntradaySmartMonitor] 텔레그램 발송 실패:`, e.message);
                }
            } else {
                console.log(`[IntradaySmartMonitor] 특이 동향 없음 (is_meaningful_change=false). 알람 스킵.`);
            }

            // 6. UI 이벤트 발송
            const resultPayload = { 
                id: predId, date: dateStr, time_slot: slot, predict, confidence, rationale: totalRationale, 
                position, entry_price: entryPrice, sources_json: JSON.stringify(sourcesArr), 
                comments_json: JSON.stringify(newComments), swarm_sentiment: swarmSentiment 
            };
            eventBus.emit('INTRADAY_PREDICTION_UPDATED' as any, resultPayload);

            console.log(`[IntradaySmartMonitor] ${slot} 전체 프로세스 완료: ${predict} | 소요시간: ${Date.now() - startTime}ms`);
            
        } catch (error: any) {
            console.error(`[IntradaySmartMonitor] ${slot} 런타임 에러:`, error.message);
            const rawDb = (this.db as any).db;
            rawDb.prepare(`
                INSERT OR IGNORE INTO intraday_predictions 
                (id, date, time_slot, predict, confidence, rationale, created_at)
                VALUES (?, ?, ?, 'HOLD', 0, ?, datetime('now', 'localtime'))
            `).run(predId, dateStr, slot, `[에러] 분석 실패: ${error.message}`);
        }
    }

    /**
     * 특정 종목 추론 (MarketConditionAgent 등에서 호출되는 레거시 지원용)
     */
    public async runSwarmCommentary(predId: string, basePredict: string, baseRationale: string, tableName: 'market_predictions' | 'agent_predictions' = 'market_predictions') {
        const queue = AiExecutionQueue.getInstance();
        console.log(`[IntradaySmartMonitor] ${predId} 보조 댓글 작성 (단일 뷰)...`);

        try {
            const prompt = `메인 AI의 의견을 읽고, 부연 설명 1문장을 명확하게 추가하세요.
[메인 AI 의견]: ${basePredict} - ${baseRationale}

출력 포맷 (JSON):
{
  "predict": "UP" | "DOWN",
  "reason": "..."
}`;
            const res = await queue.enqueue({
                agentId: 'SWARM_MONITOR',
                agentName: '장중 스마트 모니터 (부연설명)',
                triggerType: 'MANUAL',
                targetType: 'gemini',
                prompt: prompt,
                systemInstruction: "You are a professional market analyzer AI."
            });

            let p = "UP"; let rsn = "";
            try {
                let cleanJson = res.replace(/```json/g, '').replace(/```/g, '').trim();
                let parsed = JSON.parse(cleanJson);
                p = parsed.predict || "UP";
                rsn = parsed.reason || "";
            } catch(e) { rsn = `의견 작성 불가`; }

            const parsedComments = [{
                personaName: '장중 스마트 모니터',
                personaId: 'MONITOR',
                title: 'AI 부연설명',
                predict: p,
                reason: rsn
            }];

            const rawDb = (this.db as any).db;
            rawDb.prepare(`
                UPDATE ${tableName} 
                SET comments_json = ? 
                WHERE id = ?
            `).run(JSON.stringify(parsedComments), predId);
            
            console.log(`[IntradaySmartMonitor] ${predId} 댓글 업데이트 완료`);

        } catch (error: any) {
            console.error(`[IntradaySmartMonitor] ${predId} 댓글 생성 실패:`, error.message);
        }
    }
}
