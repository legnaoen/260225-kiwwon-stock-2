/**
 * Market Condition Agent (MCA)
 * 
 * KOSPI 방향성을 예측하여 KODEX 200 / 인버스 ETF로 가상 매매하는 독립 에이전트.
 * - Cycle A (08:50): 장전 판단 → 09:00 시초가 진입
 * - Cycle B (15:10): 장마감 판단 → 15:20 동시호가 진입
 * 
 * 설계 원칙:
 * - NXT 등 미구현 파이프라인이 있어도 Promise.allSettled로 graceful skip
 * - PIPELINE_REGISTRY에 한 줄 추가만으로 새 데이터 소스 즉시 통합
 */

import { V2PipelineManager } from '../v2_pipeline/V2PipelineManager'
import { AiService } from '../AiService'
import { AiExecutionQueue } from '../AiExecutionQueue'
import { DatabaseService } from '../DatabaseService'
import { eventBus, SystemEvent } from '../../utils/EventBus'
import { KiwoomService } from '../KiwoomService'
import { AgentCycle, AgentPrediction, DataContext, ParsedDecision, PipelineSlot } from './types/AgentTypes'
import { buildSystemPrompt, buildUserPrompt } from './prompts/market_condition'
import { IntradaySwarmAgent } from './IntradaySwarmAgent'
import { TechnicalAnalyzer } from './TechnicalAnalyzer'

// ═══ 유연한 파이프라인 레지스트리 ═══
// 새 파이프라인 추가 시 여기에 한 줄만 추가하면 자동 통합
// ※ PL-NewsFlow, PL-NewsKeyword는 NewsDataHub 캐시로 대체됨 (API 절약)
const PIPELINE_REGISTRY: PipelineSlot[] = [
    { id: 'PL-Macro',       label: '글로벌 매크로',      required: true,  cycles: ['A', 'B'] },
    { id: 'PL-LocalFlow',   label: '국내 수급',          required: true,  cycles: ['A', 'B'] },
    // 미구현 파이프라인은 주석 처리. 구현 후 주석 해제만 하면 됨:
    // { id: 'PL-NXT',      label: 'NXT 프리마켓 수급', required: false, cycles: ['A'] },
]

export class MarketConditionAgent {
    private static instance: MarketConditionAgent
    private pipeline: V2PipelineManager
    private ai: AiService
    private db: DatabaseService
    private lastIntradayExecutionTime: number = 0

    private constructor() {
        this.pipeline = V2PipelineManager.getInstance()
        this.ai = AiService.getInstance()
        this.db = DatabaseService.getInstance()
    }

    public static getInstance(): MarketConditionAgent {
        if (!MarketConditionAgent.instance) {
            MarketConditionAgent.instance = new MarketConditionAgent()
            // 서버나 앱 시작 시점에 1회 호출해 누락된 과거 가격들을 자동 복구
            setTimeout(() => {
                MarketConditionAgent.instance.syncMissingIntradayPrices().catch(e => {
                    console.error('[MCA-Init] 누락 진입가 복구 에러:', e.message);
                });
            }, 5000); // KiwoomService.getInstance() 안전성을 위해 약간의 지연
        }
        return MarketConditionAgent.instance
    }

    /**
     * 프론트엔드 프리뷰 및 로컬 전담 AI 전처리용: 순수 수학적 기술적 다이제스트 생성
     */
    public async getIntradayTechnicalDigest(): Promise<string> {
        try {
            const analyzer = new TechnicalAnalyzer(KiwoomService.getInstance());
            const daily = await analyzer.generateDailyTechnicalDigest();
            const intraday = await analyzer.generateIntradayTechnicalDigest();
            return daily + "\n\n---\n\n" + intraday;
        } catch (e: any) {
            console.error('[MCA-Digest] 오류:', e);
            return `오류: ${e.message}`;
        }
    }

    /**
     * 메인 실행 메서드
     * 1. 데이터 수집 (실패해도 계속)
     * 2. 컨텍스트 조립
     * 3. AI 판단 요청
     * 4. 결과 파싱 & DB 저장
     * 5. 이벤트 발행
     */
    public async runPrediction(cycle: AgentCycle): Promise<AgentPrediction> {
        const startTime = Date.now()
        const dateStr = this.db.getKstDate()
        const predId = `mca_${dateStr.replace(/-/g, '')}_${cycle}`

        console.log(`[MCA] ═══ Cycle ${cycle} 판단 시작 (${dateStr}) ═══`)

        try {
            // 1. 데이터 수집
            const context = await this.collectData(cycle)

            // 최소 1개의 데이터가 있어야 판단 가능
            if (context.available.length === 0) {
                throw new Error('모든 파이프라인 수집 실패. 판단 불가.')
            }

            // 2. 프롬프트 조립
            const systemPrompt = buildSystemPrompt(context)
            const userPrompt = buildUserPrompt(context)

            console.log(`[MCA] 가용 데이터: ${context.available.map(a => a.id).join(', ')}`)
            if (context.missing.length > 0) {
                console.log(`[MCA] 누락 데이터: ${context.missing.join(', ')}`)
            }

            // 3. AI 판단 요청 (AiExecutionQueue 경유)
            console.log('[MCA] Gemini 판단 요청 중 (큐 대기)...')
            const rawResponse = await AiExecutionQueue.getInstance().enqueue({
                agentId: 'MCA',
                agentName: '시황 AI',
                triggerType: 'CRON',
                prompt: userPrompt,
                systemInstruction: systemPrompt,
            })

            // 4. 결과 파싱
            const decision = this.parseResponse(rawResponse)

            // 5. DB 저장
            const prediction: AgentPrediction = {
                id: predId,
                date: dateStr,
                cycle,
                predict: decision.predict,
                position: decision.position,
                confidence: decision.confidence,
                rationale: decision.rationale,
                sources: decision.key_sources,
                indicators: decision.indicators,
                pipelines_used: context.available.map(a => a.id),
                execution_time_ms: Date.now() - startTime,
                created_at: this.db.getKstTimestamp(),
                raw_context: context.available.map(a => `[${a.id}]\n${a.markdown}`).join('\n\n---\n\n'),
                t1_target_return: decision.t1_target_return,
                t5_predict: decision.t5_predict,
                t5_target_return: decision.t5_target_return,
                t20_predict: decision.t20_predict,
                t20_target_return: decision.t20_target_return
            }

            this.savePrediction(prediction)

            // Cycle B이고 morning_feedback(오답노트)이 있으면 오늘 아침 Cycle A에 업데이트(피기배킹 전략)
            if (cycle === 'B' && decision.morning_feedback && context.todayCycleA) {
                try {
                    const rawDb = (this.db as any).db;
                    rawDb.prepare(`UPDATE agent_predictions SET feedback = ? WHERE id = ?`).run(String(decision.morning_feedback), context.todayCycleA.id);
                    console.log(`[MCA] 오전 예측 피드백(오답노트) 업데이트 완료: ${context.todayCycleA.id}`);
                } catch(e) { console.error('[MCA] 피드백 저장 실패:', e); }
            }

            // 6. 이벤트 발행 → UI 갱신
            eventBus.emit('MARKET_AGENT_PREDICTION_COMPLETE' as any, prediction)

            // 비동기로 군집 AI의 댓글 작성 및 여론 생성 (agent_predictions 타겟)
            IntradaySwarmAgent.getInstance().runSwarmCommentary(predId, decision.predict, decision.rationale, 'agent_predictions').catch(e => {
                console.error('[MCA] 군집 댓글(Swarm Commentary) 생성 중 에러:', e.message);
            });

            console.log(`[MCA] ═══ Cycle ${cycle} 완료 | ${decision.predict} (${(decision.confidence * 100).toFixed(0)}%) | ${Date.now() - startTime}ms ═══`)
            return prediction

        } catch (error: any) {
            console.error(`[MCA] Cycle ${cycle} 실패:`, error.message)

            // 실패해도 HOLD로 기록
            const failPrediction: AgentPrediction = {
                id: predId,
                date: dateStr,
                cycle,
                predict: 'HOLD',
                position: '관망(현금)',
                confidence: 0,
                rationale: `에이전트 실행 실패: ${error.message}`,
                sources: [],
                indicators: [],
                pipelines_used: [],
                execution_time_ms: Date.now() - startTime,
                created_at: this.db.getKstTimestamp(),
                raw_context: '에이전트 실행 실패'
            }

            this.savePrediction(failPrediction)
            eventBus.emit('MARKET_AGENT_PREDICTION_COMPLETE' as any, failPrediction)
            return failPrediction
        }
    }

    /**
     * 유연한 데이터 수집
     * Promise.allSettled로 병렬 실행 → 실패 건 graceful skip
     */
    private async collectData(cycle: AgentCycle): Promise<DataContext> {
        const slots = PIPELINE_REGISTRY.filter(s => s.cycles.includes(cycle))

        const results = await Promise.allSettled(
            slots.map(slot => this.pipeline.runPipeline(slot.id as any))
        )

        const available: { id: string; markdown: string }[] = []
        const missing: string[] = []

        results.forEach((r, i) => {
            const slot = slots[i]
            if (r.status === 'fulfilled' && r.value.status === 'success') {
                available.push({
                    id: slot.id,
                    markdown: (r.value as any).aggregatedMarkdown || (r.value as any).aggregated_markdown || (r.value as any).rawData?.toString() || ''
                })
            } else {
                missing.push(`${slot.id} (${slot.label})`)
                if (slot.required) {
                    console.warn(`[MCA] ⚠️ Required pipeline ${slot.id} failed!`)
                }
            }
        })

        // ── NewsDataHub 캐시 주입 (PL-NewsFlow + PL-NewsKeyword 대체) ──
        // 외부 API 호출 없이 미리 수집된 캐시를 읽음 (키워드 빈도 테이블 포함)
        try {
            const { NewsDataHub } = await import('../NewsDataHub');
            const hubMarkdown = NewsDataHub.getInstance().getNewsAsMarkdown({ maxPerCategory: 10 });
            if (!hubMarkdown.includes('캐시 없음')) {
                available.push({ id: 'NEWS_HUB', markdown: hubMarkdown });
                console.log('[MCA] NewsDataHub 캐시 주입 완료');
            } else {
                missing.push('NEWS_HUB (캐시 미준비 — Hub 배치 수집 대기 중)');
                console.warn('[MCA] NewsDataHub 캐시 없음 — 뉴스 컨텍스트 누락');
            }
        } catch(e: any) {
            missing.push(`NEWS_HUB (오류: ${e.message})`);
        }

        // Active Rules 로드
        const activeRules = this.getActiveRules()

        // 최근 히스토리 로드 (최대 10건)
        const recentHistory = this.getRecentPredictions(10)
        
        // 일간/주간/월간 회고 로드 (오직 Cycle 'A' 판단 전용)
        let dailyReview, weeklyReview, monthlyReview;
        if (cycle === 'A') {
            try {
                const { MarketReviewAgent } = await import('./MarketReviewAgent')
                const dAll = MarketReviewAgent.getInstance().getRetrospectives('DAILY', 1)
                const wAll = MarketReviewAgent.getInstance().getRetrospectives('WEEKLY', 1)
                const mAll = MarketReviewAgent.getInstance().getRetrospectives('MONTHLY', 1)
                if (dAll.length > 0) dailyReview = dAll[0]
                if (wAll.length > 0) weeklyReview = wAll[0]
                if (mAll.length > 0) monthlyReview = mAll[0]
            } catch (e) {
                console.error('[MCA] 실패: 회고 리포트를 불러오지 못했습니다.', e)
            }
        }

        // Cycle B (오후): 오늘 작성된 Cycle A(아침) 예측을 불러와서 일간 오답노트 작성 유도
        let todayCycleA;
        if (cycle === 'B') {
            const dateStr = this.db.getKstDate()
            const aId = `mca_${dateStr.replace(/-/g, '')}_A`
            todayCycleA = recentHistory.find(h => h.id === aId)
        }

        // 로컬 트래커 및 스웜 군집 투표 결과 (이슈 장부) 수집 추가
        let trackerBriefingBlock = undefined;
        try {
            const { IssueLedgerDB } = await import('./IssueLedgerDB');
            const activeIssues = IssueLedgerDB.getInstance().getActiveIssues();
            if (activeIssues && activeIssues.length > 0) {
                trackerBriefingBlock = activeIssues.map(i => 
                    `- [${i.name}] (위험 지정: ${i.severity}, 진행: ${i.status})\n  * 현장 트래커 통보: ${i.summary}\n  * 현장 군집 투표 결과: ${i.swarmSummary || '투표 없음'}`
                ).join('\n\n');
            }
        } catch(e) { 
            console.error('[MCA] 현장 트래커(이슈 장부) 브리핑 로드 실패:', e); 
        }

        return { available, missing, cycle, activeRules, recentHistory, dailyReview, weeklyReview, monthlyReview, todayCycleA, trackerBriefingBlock }
    }

    /**
     * AI 응답 파싱 (JSON 추출)
     */
    private parseResponse(raw: string): ParsedDecision {
        // 코드블록 내 JSON 추출
        let jsonStr = raw
        const codeBlockMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/)
        if (codeBlockMatch) {
            jsonStr = codeBlockMatch[1]
        }

        // 순수 JSON 객체 추출 시도
        const jsonMatch = jsonStr.match(/\{[\s\S]*\}/)
        if (!jsonMatch) {
            console.error('[MCA] JSON 파싱 실패. 원문:', raw.substring(0, 500))
            return {
                predict: 'HOLD',
                position: '관망(현금)',
                confidence: 0,
                rationale: 'AI 응답 파싱 실패. HOLD 처리.',
                indicators: [],
                key_sources: []
            }
        }

        try {
            const parsed = JSON.parse(jsonMatch[0])
            
            // 유효성 검증
            const predict = parsed.t1?.direction && (['LONG', 'SHORT', 'HOLD'].includes(parsed.t1.direction)) 
                ? parsed.t1.direction : (['LONG', 'SHORT', 'HOLD'].includes(parsed.predict) ? parsed.predict : 'HOLD')
            
            const positionMap: Record<string, string> = {
                'LONG': 'KODEX 200',
                'SHORT': 'KODEX 인버스',
                'HOLD': '관망(현금)'
            }

            return {
                predict,
                position: parsed.position || positionMap[predict] || '관망(현금)',
                confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0)),
                rationale: String(parsed.rationale || '판단 근거 없음'),
                indicators: Array.isArray(parsed.indicators) ? parsed.indicators : [],
                key_sources: Array.isArray(parsed.key_sources) ? parsed.key_sources : [],
                morning_feedback: parsed.morning_feedback ? String(parsed.morning_feedback) : undefined,
                t1_target_return: parsed.t1?.target_return ? Number(parsed.t1.target_return) : undefined,
                t5_predict: parsed.t5?.direction && ['LONG', 'SHORT', 'HOLD'].includes(parsed.t5.direction) ? parsed.t5.direction : undefined,
                t5_target_return: parsed.t5?.target_return ? Number(parsed.t5.target_return) : undefined,
                t20_predict: parsed.t20?.direction && ['LONG', 'SHORT', 'HOLD'].includes(parsed.t20.direction) ? parsed.t20.direction : undefined,
                t20_target_return: parsed.t20?.target_return ? Number(parsed.t20.target_return) : undefined,
            }
        } catch (e) {
            console.error('[MCA] JSON parse error:', e)
            return {
                predict: 'HOLD',
                position: '관망(현금)',
                confidence: 0,
                rationale: 'AI 응답 JSON 파싱 오류. HOLD 처리.',
                indicators: [],
                key_sources: []
            }
        }
    }

    // ── DB 헬퍼 메서드 ──

    private savePrediction(p: AgentPrediction) {
        const rawDb = (this.db as any).db
        const stmt = rawDb.prepare(`
            INSERT OR REPLACE INTO agent_predictions 
            (id, date, cycle, predict, position, confidence, rationale, sources_json, indicators_json, pipelines_used, execution_time_ms, created_at, raw_context, t1_target_return, t5_predict, t5_target_return, t20_predict, t20_target_return)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        stmt.run(
            p.id, p.date, p.cycle, p.predict, p.position, p.confidence,
            p.rationale,
            JSON.stringify(p.sources),
            JSON.stringify(p.indicators),
            JSON.stringify(p.pipelines_used),
            p.execution_time_ms,
            p.created_at,
            p.raw_context || '',
            p.t1_target_return ?? null,
            p.t5_predict ?? null,
            p.t5_target_return ?? null,
            p.t20_predict ?? null,
            p.t20_target_return ?? null
        )
        console.log(`[MCA] 예측 저장 완료: ${p.id}`)
    }

    public getActiveRules(): string[] {
        try {
            const rawDb = (this.db as any).db
            const rows = rawDb.prepare(
                `SELECT rule_text FROM agent_rules WHERE agent_type = 'market_condition' AND is_active = 1 ORDER BY id`
            ).all() as { rule_text: string }[]
            return rows.map(r => r.rule_text)
        } catch {
            return []
        }
    }

    public getRecentPredictions(limit: number = 10): AgentPrediction[] {
        try {
            const rawDb = (this.db as any).db
            const rows = rawDb.prepare(
                `SELECT * FROM agent_predictions ORDER BY date DESC, cycle DESC LIMIT ?`
            ).all(limit) as any[]

            return rows.map(r => ({
                ...r,
                sources: JSON.parse(r.sources_json || '[]'),
                indicators: JSON.parse(r.indicators_json || '[]'),
                pipelines_used: JSON.parse(r.pipelines_used || '[]'),
            }))
        } catch {
            return []
        }
    }

    public getLatestPrediction(): AgentPrediction | null {
        const list = this.getRecentPredictions(1)
        return list.length > 0 ? list[0] : null
    }

    /**
     * 특정 리포트(장전/장마감 혹은 장중)를 데이터베이스에서 완전 삭제합니다.
     */
    public deletePrediction(id: string, tableName: 'agent_predictions' | 'intraday_predictions' = 'agent_predictions'): boolean {
        try {
            const rawDb = (this.db as any).db;
            if (tableName === 'agent_predictions') {
                rawDb.prepare(`DELETE FROM agent_predictions WHERE id = ?`).run(id);
                // 관련된 ui 이벤트 발행 (목록 갱신유도)
                eventBus.emit('MARKET_CONDITION_COMPLETE' as any, null);
            } else if (tableName === 'intraday_predictions') {
                rawDb.prepare(`DELETE FROM intraday_predictions WHERE id = ?`).run(id);
                eventBus.emit('INTRADAY_PREDICTION_UPDATED' as any, null);
            }
            console.log(`[MCA] 리포트 삭제 완료: ${tableName}의 ${id}`);
            return true;
        } catch (error: any) {
            console.error(`[MCA] 리포트 삭제 실패 (${id}):`, error.message);
            return false;
        }
    }

    public getStats(): { total: number; wins: number; winRate: number; totalReturn: number } {
        try {
            const rawDb = (this.db as any).db
            const total = (rawDb.prepare(`SELECT COUNT(*) as cnt FROM agent_predictions WHERE predict != 'HOLD' AND t1_final IS NOT NULL`).get() as any)?.cnt || 0
            const wins = (rawDb.prepare(`SELECT COUNT(*) as cnt FROM agent_predictions WHERE predict != 'HOLD' AND t1_final IS NOT NULL AND ((predict = 'LONG' AND t1_final > 0) OR (predict = 'SHORT' AND t1_final < 0))`).get() as any)?.cnt || 0
            const sumReturn = (rawDb.prepare(`SELECT SUM(t1_final) as total FROM agent_predictions WHERE predict != 'HOLD' AND t1_final IS NOT NULL`).get() as any)?.total || 0
            
            return {
                total,
                wins,
                winRate: total > 0 ? wins / total : 0,
                totalReturn: sumReturn
            }
        } catch {
            return { total: 0, wins: 0, winRate: 0, totalReturn: 0 }
        }
    }

    /**
     * 장중 인트라데이 예측 (하이브리드 모드: 09:30 / 13:00)
     * - '(오늘 종가 방향)' 을 UP/HOLD/DOWN 으로 판단
     * - 실제 평가는 15:35 PerformanceTracker가 종가 데이터로 콜
     */
    public async runIntraday(slot: string, force: boolean = false) {
        const nowMs = Date.now()
        if (!force && nowMs - this.lastIntradayExecutionTime < 15 * 60 * 1000) {
            console.log(`[MCA-Intraday] 15분 쿨다운 적용 중. (timeSlot: ${slot}) 실행 스킵.`);
            return;
        }
        this.lastIntradayExecutionTime = nowMs;

        const startTime = Date.now()
        const now = new Date()
        const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
        const predId = `INTRADAY_${dateStr}_${slot.replace(':', '')}`

        console.log(`[MCA-Intraday] ═══ ${slot} 장중 예측 시작 ═══`)

        try {
            // 1. 실시간 데이터 수집 (거시/뉴스는 장중 토큰 낭비이므로 제거. 당일 수급/모멘텀 집중)
            const [localResult, investorResult] = await Promise.allSettled([
                this.pipeline.runPipeline('PL-LocalFlow' as any),
                this.pipeline.runPipeline('PL-InvestorFlow' as any)
            ])

            const dataParts: string[] = []
            // 주체별 수급(가장 중요)을 먼저 배치
            if (investorResult.status === 'fulfilled') dataParts.push(`[PL-InvestorFlow]\n${investorResult.value.aggregatedMarkdown}`)
            if (localResult.status === 'fulfilled') dataParts.push(`[PL-LocalFlow]\n${localResult.value.aggregatedMarkdown}`)

            const queue = AiExecutionQueue.getInstance();

            // 1.5 전담 AI (Front-line Analyst) 병렬 호출 - Chart & News
            let chartAnalystOpinion = "차트 데이터 요약 실패";
            let newsAnalystOpinion = "뉴스 스크랩 실패";

            try {
                // (A) 기술적 다이제스트 생성 및 로컬 AI(CHART_ANALYST) 판독
                const technicalDigest = await this.getIntradayTechnicalDigest();
                const chartPrompt = `[실시간 다중 타임프레임 차트 브리핑]\n${technicalDigest}\n\n당신은 다이제스트에서 20/60일선 등의 거시적 위치(일봉)를 가볍게 체크하되, **초단기 장중 분봉 차트 흐름과 시가 돌파/지지 여부를 절대적으로 최우선(Highest Priority)순위로 삼아** 앞으로의 단기 주가 향방을 단 3문장 이내로 강하게 평가하는 기술적 분석 전담 AI입니다. 거시적 수급 지연 가능성을 대비해 오직 '현재의 가격 모멘텀'을 믿고 단호한 견해를 제시하세요.`;
                
                // (B) NewsDataHub 캐시에서 뉴스 읽기 (직접 API 호출 금지 — NewsDataHub 싱글톤 독점)
                let newsHeadlinesText = "뉴스 없음 (캐시 미준비)";
                try {
                    const { NewsDataHub } = await import('../NewsDataHub');
                    const hubMarkdown = NewsDataHub.getInstance().getNewsAsMarkdown({ maxPerCategory: 5 });
                    // 캐시가 실제로 있으면 헤드라인 텍스트로 사용
                    if (!hubMarkdown.includes('캐시 없음')) {
                        newsHeadlinesText = hubMarkdown;
                    }
                } catch(e) { console.warn('[MCA-Intraday] NewsDataHub 캐시 읽기 실패:', (e as Error).message); }

                const newsPrompt = `[NewsDataHub 수집 뉴스 캐시 — 장중 시황 참고용]\n${newsHeadlinesText}\n\n당신은 시장의 공포와 탐욕을 읽어내는 투심 분석 AI입니다. 위 뉴스들에서 치명적 악재나 강한 호재가 있는지 살펴보고, 시장 분위기가 긍정적인지 부정적인지 단 3문장 이내로 요약 평가하세요.`;

                // 두 로컬 AI를 병렬로 실행 시도
                const [chartRes, newsRes] = await Promise.allSettled([
                    queue.enqueue({
                        agentId: 'ANALYST_CHART',
                        agentName: '로컬 차트 전담 AI',
                        triggerType: 'CRON',
                        targetType: 'local', // 반드시 로컬로 실행
                        prompt: chartPrompt,
                        systemInstruction: "당신은 차트 데이터를 감정없이 읽고 핵심만 브리핑하는 전담 분석가입니다."
                    }),
                    queue.enqueue({
                        agentId: 'ANALYST_NEWS',
                        agentName: '로컬 뉴스 전담 AI',
                        triggerType: 'CRON',
                        targetType: 'local', // 반드시 로컬로 실행
                        prompt: newsPrompt,
                        systemInstruction: "당신은 속보 헤드라인의 긍정/부정 뉘앙스만 빠르게 요약 보고하는 전담 분석가입니다."
                    })
                ]);

                if (chartRes.status === 'fulfilled') chartAnalystOpinion = chartRes.value;
                if (newsRes.status === 'fulfilled') newsAnalystOpinion = newsRes.value;
            } catch (e: any) {
                console.error("[MCA-Intraday] 전담 AI 분석 실패:", e.message);
            }

            // 2. 시간대별 특성 주입 (Time-Context)
            let timeContext = '';
            if (slot === '09:30') {
                timeContext = "시가 갭(Gap) 발생 이후 외국인/기관의 초기 포지셔닝 방향과 아침 변동성(Volatility) 추세를 분석하여 오늘 장 전체의 방향을 예측하라.";
            } else if (slot === '13:00') {
                timeContext = "오후장 진입 시점의 외국인 선물 매매 누적 동향, 프로그램 매매 추이, 그리고 추세 반전(Reversal) 가능성을 엄격히 판별하여 최종 종가가 상승마감일지 하락마감일지 예측하라.";
            }

            // 3. 메인 위원회 (장중 종가 방향 예측 프롬프트)
            const systemPrompt = `당신은 한국 주식 시장의 당일 수급과 모멘텀을 추적하여 장중 방향성을 예측하는 데이트레이더(Day Trader) 퀀트이자 최고 의사결정자입니다.`
            const userPrompt = `[${slot} KST 기준 실시간 시장 데이터]

${dataParts.join('\n\n---\n\n')}

---
[로컬 차트 전담 AI(Front-line Analyst)의 브리핑]
${chartAnalystOpinion}

[로컬 투심 전담 AI(Front-line Analyst)의 브리핑]
${newsAnalystOpinion}

---
${timeContext}
위 주체별 수급(Investor Flow) 및 업종별 등락 데이터와 전담 AI 패널들의 브리핑을 바탕으로 결합하여 오늘 장마감 코스피 종가 방향을 예측하시오.

엄격한 분석 지침:
- 외국인 주가지수 선물 매매 동향을 1순위로, 기관/외국인 현물 쌍끌이 혹은 양매도 여부를 2순위로 강력하게 반영하시오.
- 차트/투심 브리핑은 참고 지표로 삼되 수급 데이터와 충돌한다면 수급을 더 우선시 하시오.
- 반드시 다음 JSON 형식으로만 출력하시오. 다른 텍스트는 일체 금지.

{
  "predict": "UP" | "HOLD" | "DOWN",
  "confidence": (0~100 정수, 수급 쏠림이 강력할수록 향상),
  "trend_status": "현재 장중 추세 판단 요약 (예: 외국인 현선물 양매수로 인한 강한 하락 추세)",
  "key_trigger": "오후장 방향 전환을 일으킬 수 있는 당일의 핵심 변수 (예: 프로그램 매도세의 매수 전환 여부)",
  "rationale": "최종 진입 방향에 대한 결과적인 근거 요약"
}`

            const rawResponse = await AiExecutionQueue.getInstance().enqueue({
                agentId: 'MCA_INTRA',
                agentName: '시황 AI (하이브리드 장중)',
                triggerType: 'CRON',
                prompt: userPrompt,
                systemInstruction: systemPrompt,
            })
            const jsonMatch = rawResponse.match(/\{[\s\S]*?\}/)
            if (!jsonMatch) throw new Error('JSON 파싱 실패: ' + rawResponse.substring(0, 100))

            const parsed = JSON.parse(jsonMatch[0])
            const predict = ['UP', 'HOLD', 'DOWN'].includes(parsed.predict) ? parsed.predict : 'HOLD'
            const confidence = Math.min(100, Math.max(0, Number(parsed.confidence) || 50))
            
            // UI에 보여질 종합 Rationale 텍스트 조립 (여기에 전문 요약을 넣는 대신 댓글로 뺌)
            const assembledRationale = `[추세] ${parsed.trend_status || ''}\n[트리거] ${parsed.key_trigger || ''}\n[결론] ${parsed.rationale || ''}`;

            // (C) 전담 AI 브리핑을 "댓글" 처럼 표시하기 위한 초기 댓글 (Pre-comments)
            const initialComments = [
                { id: 'ANALYST_CHART', name: '차트 스페셜리스트 📈', predict: 'INFO', comment: chartAnalystOpinion, weight: 1.0, winRate: null },
                { id: 'ANALYST_NEWS', name: '투심 스페셜리스트 📰', predict: 'INFO', comment: newsAnalystOpinion, weight: 1.0, winRate: null }
            ];

            // 4. DB 저장 및 진입가(entry_price) 실시간 조회
            const position = predict === 'UP' ? 'KODEX 200' : predict === 'DOWN' ? 'KODEX 인버스' : 'HOLD'
            const code = predict === 'UP' ? '069500' : predict === 'DOWN' ? '114800' : null;
            let entryPrice = 0;
            
            if (code) {
                const { PriceStore } = await import('../PriceStore');
                const { KiwoomService } = await import('../KiwoomService');
                
                try {
                    // 확실한 REST API인 5분봉의 마지막 종가를 현재가(진입가)로 타겟팅
                    const candles = await KiwoomService.getInstance().getOhlcv5m(code, 1);
                    if (candles && candles.length > 0) {
                        entryPrice = candles[candles.length - 1].close;
                        PriceStore.getInstance().setPrice(code, entryPrice);
                    } else {
                        // API 데이터가 비어있으면 메모리 폴백
                        entryPrice = PriceStore.getInstance().getPrice(code) || 0;
                    }
                } catch (e: any) {
                    console.error('[MCA-Intraday] 진입가(5분봉 종가) 조회 실패:', e.message);
                    entryPrice = PriceStore.getInstance().getPrice(code) || 0;
                }
            }

            const sourcesArr: string[] = []
            if (investorResult.status === 'fulfilled') sourcesArr.push('PL-InvestorFlow')
            if (localResult.status === 'fulfilled') sourcesArr.push('PL-LocalFlow')

            const rawDb = (this.db as any).db
            rawDb.prepare(`
                INSERT OR REPLACE INTO intraday_predictions 
                (id, date, time_slot, predict, confidence, rationale, position, entry_price, sources_json, comments_json, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))
            `).run(predId, dateStr, slot, predict, confidence, assembledRationale, position, entryPrice, JSON.stringify(sourcesArr), JSON.stringify(initialComments))

            const result = { 
                id: predId, date: dateStr, time_slot: slot, predict, confidence, 
                rationale: assembledRationale, position, entry_price: entryPrice, sources_json: JSON.stringify(sourcesArr),
                comments_json: JSON.stringify(initialComments)
            }
            eventBus.emit('INTRADAY_PREDICTION_UPDATED' as any, result)

            console.log(`[MCA-Intraday] ${slot} 완료: ${predict} (${confidence}%) | ${Date.now() - startTime}ms`)

            // 5. 비동기 군집 댓글 (Asynchronous Swarm Commentary) 트리거 - 백그라운드 구동
            IntradaySwarmAgent.getInstance().runSwarmCommentary(predId, predict, assembledRationale).catch(e => {
                console.error('[MCA-Intraday] 댓글 작성기 비동기 호출 에러:', e.message);
            });

            // 6. 누락된 과거 진입가 채우기 (백그라운드 자가 치유)
            this.syncMissingIntradayPrices().catch(e => {
                console.error('[MCA-Intraday] 누락 진입가 복구 에러:', e.message);
            });

            return result

        } catch (error: any) {
            console.error(`[MCA-Intraday] ${slot} \uc2e4\ud328:`, error.message)
            // \uc2e4\ud328\uc2dc HOLD\ub85c \uae30\ub85d
            const rawDb = (this.db as any).db
            rawDb.prepare(`
                INSERT OR IGNORE INTO intraday_predictions 
                (id, date, time_slot, predict, confidence, rationale, created_at)
                VALUES (?, ?, ?, 'HOLD', 0, ?, datetime('now', 'localtime'))
            `).run(predId, dateStr, slot, `\uc2e4\ud328: ${error.message}`)
        }
    }

    public getIntradayPredictions(date?: string): any[] {
        try {
            const rawDb = (this.db as any).db
            if (date) {
                return rawDb.prepare(`SELECT * FROM intraday_predictions WHERE date = ? ORDER BY time_slot DESC`).all(date)
            }
            return rawDb.prepare(`SELECT * FROM intraday_predictions ORDER BY date DESC, time_slot DESC LIMIT 30`).all()
        } catch {
            return []
        }
    }

    /**
     * 과거 기록 중 진입가(entry_price)가 누락된 데이터가 있다면
     * 해당하는 날짜의 과거 5분봉 데이터를 탐색하여 진입가를 자동 보완
     */
    public async syncMissingIntradayPrices() {
        console.log('[MCA-Intraday] 누락된 진입가(entry_price) 복구 검사 시작...');
        try {
            const rawDb = (this.db as any).db;
            const missings = rawDb.prepare(`
                SELECT id, date, time_slot, predict 
                FROM intraday_predictions 
                WHERE (entry_price IS NULL OR entry_price = 0)
                  AND predict IN ('UP', 'DOWN', 'LONG', 'SHORT') 
                  AND date >= date('now', '-3 days') -- 최근 3영업일만 대상
                ORDER BY date ASC
            `).all();

            if (missings.length === 0) {
                console.log('[MCA-Intraday] 누락된 진입가 없음. 완료.');
                return;
            }

            const { KiwoomService } = await import('../KiwoomService');
            const kiwoom = KiwoomService.getInstance();
            let updatedCount = 0;

            for (const row of missings) {
                const isUp = row.predict === 'UP' || row.predict === 'LONG';
                const code = isUp ? '069500' : '114800';
                const dateStr = `${row.date}T${row.time_slot}:00+09:00`; // KST
                const targetTimestamp = Math.floor(new Date(dateStr).getTime() / 1000);
                
                // 해당일 포함 과거 5분봉 데이터 요청 (넉넉히 최대 4일)
                const candles = await kiwoom.getOhlcv5m(code, 4);
                
                // 대상 시간과 정확히 일치하거나 가장 근접한 5분봉 검색 (10분 이내)
                let matchedPrice = 0;
                let minDiff = 86400; // 큰 값으로 초기화

                for (const candle of candles) {
                    const diff = Math.abs(candle.time - targetTimestamp);
                    if (diff <= 600 && diff < minDiff) { 
                        minDiff = diff;
                        matchedPrice = candle.close;
                    }
                }

                if (matchedPrice > 0) {
                    rawDb.prepare(`UPDATE intraday_predictions SET entry_price = ? WHERE id = ?`).run(matchedPrice, row.id);
                    console.log(`[MCA-Intraday] 복구 완료: ${row.id} -> 진입가 ${matchedPrice} 적용`);
                    updatedCount++;
                } else {
                    console.warn(`[MCA-Intraday] 복구 불가: ${row.id} (조건에 맞는 차트 데이터 캔들 없음)`);
                }

                // 키움 API 제한 방지용 딜레이
                await new Promise(r => setTimeout(r, 600));
            }

            if (updatedCount > 0) {
                eventBus.emit('INTRADAY_PREDICTION_UPDATED' as any, null);
            }
        } catch (e: any) {
            console.error('[MCA-Intraday] 진입가 복구 프로세스 에러:', e.message);
        }
    }
}

