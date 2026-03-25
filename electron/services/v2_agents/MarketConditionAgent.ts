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
import { DatabaseService } from '../DatabaseService'
import { eventBus, SystemEvent } from '../../utils/EventBus'
import { AgentCycle, AgentPrediction, DataContext, ParsedDecision, PipelineSlot } from './types/AgentTypes'
import { buildSystemPrompt, buildUserPrompt } from './prompts/market_condition'

// ═══ 유연한 파이프라인 레지스트리 ═══
// 새 파이프라인 추가 시 여기에 한 줄만 추가하면 자동 통합
const PIPELINE_REGISTRY: PipelineSlot[] = [
    { id: 'PL-Macro',       label: '글로벌 매크로',      required: true,  cycles: ['A', 'B'] },
    { id: 'PL-LocalFlow',   label: '국내 수급',          required: true,  cycles: ['A', 'B'] },
    { id: 'PL-NewsFlow',    label: '네이버 뉴스',        required: false, cycles: ['A', 'B'] },
    { id: 'PL-NewsKeyword', label: '뉴스 키워드',        required: false, cycles: ['A', 'B'] },
    // 미구현 파이프라인은 주석 처리. 구현 후 주석 해제만 하면 됨:
    // { id: 'PL-NXT',      label: 'NXT 프리마켓 수급', required: false, cycles: ['A'] },
]

export class MarketConditionAgent {
    private static instance: MarketConditionAgent
    private pipeline: V2PipelineManager
    private ai: AiService
    private db: DatabaseService

    private constructor() {
        this.pipeline = V2PipelineManager.getInstance()
        this.ai = AiService.getInstance()
        this.db = DatabaseService.getInstance()
    }

    public static getInstance(): MarketConditionAgent {
        if (!MarketConditionAgent.instance) {
            MarketConditionAgent.instance = new MarketConditionAgent()
        }
        return MarketConditionAgent.instance
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
            const systemPrompt = buildSystemPrompt(context.activeRules)
            const userPrompt = buildUserPrompt(context)

            console.log(`[MCA] 가용 데이터: ${context.available.map(a => a.id).join(', ')}`)
            if (context.missing.length > 0) {
                console.log(`[MCA] 누락 데이터: ${context.missing.join(', ')}`)
            }

            // 3. AI 판단 요청
            console.log('[MCA] Gemini 판단 요청 중...')
            const rawResponse = await this.ai.askGemini(userPrompt, systemPrompt)

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
                raw_context: context.available.map(a => `[${a.id}]\n${a.markdown}`).join('\n\n---\n\n')
            }

            this.savePrediction(prediction)

            // 6. 이벤트 발행 → UI 갱신
            eventBus.emit('MARKET_AGENT_PREDICTION_COMPLETE' as any, prediction)

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

        // Active Rules 로드
        const activeRules = this.getActiveRules()

        // 최근 히스토리 로드 (최대 10건)
        const recentHistory = this.getRecentPredictions(10)

        return { available, missing, cycle, activeRules, recentHistory }
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
            const predict = (['LONG', 'SHORT', 'HOLD'].includes(parsed.predict)) 
                ? parsed.predict : 'HOLD'
            
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
                key_sources: Array.isArray(parsed.key_sources) ? parsed.key_sources : []
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
            (id, date, cycle, predict, position, confidence, rationale, sources_json, indicators_json, pipelines_used, execution_time_ms, created_at, raw_context)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        stmt.run(
            p.id, p.date, p.cycle, p.predict, p.position, p.confidence,
            p.rationale,
            JSON.stringify(p.sources),
            JSON.stringify(p.indicators),
            JSON.stringify(p.pipelines_used),
            p.execution_time_ms,
            p.created_at,
            p.raw_context || ''
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
}
