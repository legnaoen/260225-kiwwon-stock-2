// V2 Agent Swarm — 공용 타입 정의
import { AgentRetrospective } from '../MarketReviewAgent'

export type AgentCycle = 'A' | 'B' | 'P'
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
    t1_target_return?: number
    t5_predict?: PredictDirection
    t5_target_return?: number
    t20_predict?: PredictDirection
    t20_target_return?: number
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
    dailyReview?: AgentRetrospective
    weeklyReview?: AgentRetrospective
    monthlyReview?: AgentRetrospective
    todayCycleA?: AgentPrediction
    trackerBriefingBlock?: string
    sectorListStr?: string
    themeListStr?: string
}

export interface ParsedDecision {
    predict: PredictDirection
    position: string
    confidence: number
    rationale: string
    indicators: string[]
    key_sources: string[]
    morning_feedback?: string
    t1_target_return?: number
    t5_predict?: PredictDirection
    t5_target_return?: number
    t20_predict?: PredictDirection
    t20_target_return?: number
    issue_feedbacks?: { issue_id: string; is_veto: boolean; comment: string }[]
    // 통합 이슈 관리 출력 (Cycle A 전용)
    briefing?: {
        risk_score: number
        summary_markdown: string
        macro_vix: string
        macro_krw: string
        macro_tnx: string
        macro_oil: string
    }
    issue_actions?: {
        action: 'CREATE' | 'UPDATE' | 'RESOLVE'
        issue_id: string
        name: string
        current_stance?: string
        severity: string
        status: string
        impactDirection: string
        market_bias: number
        dominant_regime: string
        summary: string
        goodSectors: { name: string; reason: string }[]
        badSectors: { name: string; reason: string }[]
        timelineDetails?: {
            summary: string
            ai_analysis?: string
            market_reaction?: string
            status_snapshot?: string
        }
    }[]
}

export interface PipelineSlot {
    id: string
    label: string
    required: boolean
    cycles: AgentCycle[]
}
