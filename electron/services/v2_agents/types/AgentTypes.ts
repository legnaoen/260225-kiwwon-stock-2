// V2 Agent Swarm — 공용 타입 정의

export type AgentCycle = 'A' | 'B'
export type PredictDirection = 'LONG' | 'SHORT' | 'HOLD'

export interface AgentPrediction {
    id: string                  // 'mca_20260325_A'
    date: string                // '2026-03-25'
    cycle: AgentCycle
    predict: PredictDirection
    position: string            // 'KODEX 200' | 'KODEX 인버스' | '관망(현금)'
    confidence: number          // 0.0 ~ 1.0
    rationale: string           // AI가 작성한 판단 근거
    sources: string[]           // 사용된 핵심 소스 데이터 요약
    indicators: string[]        // 사용된 지표 목록
    entry_price?: number
    t1_peak?: number
    t1_final?: number
    t5_peak?: number
    t5_final?: number
    t20_peak?: number
    t20_final?: number
    feedback?: string
    pipelines_used: string[]
    execution_time_ms: number
    created_at: string
    raw_context?: string
}

export interface DataContext {
    available: { id: string; markdown: string }[]
    missing: string[]
    cycle: AgentCycle
    activeRules: string[]
    recentHistory: AgentPrediction[]
}

export interface ParsedDecision {
    predict: PredictDirection
    position: string
    confidence: number
    rationale: string
    indicators: string[]
    key_sources: string[]
}

export interface PipelineSlot {
    id: string
    label: string
    required: boolean
    cycles: AgentCycle[]
}
