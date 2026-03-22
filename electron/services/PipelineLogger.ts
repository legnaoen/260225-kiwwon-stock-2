/**
 * PipelineLogger
 * 
 * 파이프라인 실행 기록을 인메모리로 관리.
 * SchedulerService에서 각 파이프라인(PRE_MARKET, MORNING, INTRADAY, EVENING, CLOSING) 
 * 실행 시 phase별 결과를 기록하고, 프론트엔드에서 조회할 수 있도록 한다.
 */

export type PipelineType = 'PRE_MARKET' | 'MORNING' | 'INTRADAY' | 'EVENING' | 'CLOSING'
export type PhaseStatus = 'RUNNING' | 'SUCCESS' | 'FAILED' | 'SKIPPED'
export type RunStatus = 'RUNNING' | 'SUCCESS' | 'PARTIAL' | 'FAILED'

export interface PipelinePhase {
    name: string
    service: string
    method: string
    startedAt: string
    finishedAt?: string
    status: PhaseStatus
    durationMs?: number
    result?: string
    error?: string
}

export interface PipelineRun {
    id: string
    pipeline: PipelineType
    date: string
    startedAt: string
    finishedAt?: string
    status: RunStatus
    durationMs?: number
    phases: PipelinePhase[]
}

export class PipelineLogger {
    private static instance: PipelineLogger
    private runs: Map<string, PipelineRun> = new Map()
    private readonly MAX_RUNS_PER_TYPE = 30

    private constructor() {}

    public static getInstance(): PipelineLogger {
        if (!PipelineLogger.instance) {
            PipelineLogger.instance = new PipelineLogger()
        }
        return PipelineLogger.instance
    }

    /** 파이프라인 실행 시작 → runId 반환 */
    public startPipeline(type: PipelineType): string {
        const now = new Date()
        const dateStr = now.toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })
        const timeStr = now.toLocaleTimeString('en-US', { timeZone: 'Asia/Seoul', hour12: false, hour: '2-digit', minute: '2-digit' }).replace(':', '')
        const id = `${type}_${dateStr.replace(/-/g, '')}_${timeStr}`

        const run: PipelineRun = {
            id,
            pipeline: type,
            date: dateStr,
            startedAt: now.toISOString(),
            status: 'RUNNING',
            phases: [],
        }

        this.runs.set(id, run)
        this.pruneOldRuns(type)
        return id
    }

    /** Phase 시작 기록 → phase index 반환 */
    public startPhase(runId: string, name: string, service: string, method: string): number {
        const run = this.runs.get(runId)
        if (!run) return -1

        const phase: PipelinePhase = {
            name,
            service,
            method,
            startedAt: new Date().toISOString(),
            status: 'RUNNING',
        }
        run.phases.push(phase)
        return run.phases.length - 1
    }

    /** Phase 완료 기록 */
    public endPhase(runId: string, phaseIndex: number, status: PhaseStatus, result?: string, error?: string): void {
        const run = this.runs.get(runId)
        if (!run || phaseIndex < 0 || phaseIndex >= run.phases.length) return

        const phase = run.phases[phaseIndex]
        phase.finishedAt = new Date().toISOString()
        phase.status = status
        phase.durationMs = new Date(phase.finishedAt).getTime() - new Date(phase.startedAt).getTime()
        if (result) phase.result = result
        if (error) phase.error = error
    }

    /** 파이프라인 전체 완료 기록 */
    public endPipeline(runId: string, status?: RunStatus): void {
        const run = this.runs.get(runId)
        if (!run) return

        run.finishedAt = new Date().toISOString()
        run.durationMs = new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime()

        // 자동 상태 결정
        if (status) {
            run.status = status
        } else {
            const hasFailure = run.phases.some(p => p.status === 'FAILED')
            const allSuccess = run.phases.every(p => p.status === 'SUCCESS' || p.status === 'SKIPPED')
            run.status = allSuccess ? 'SUCCESS' : hasFailure ? 'PARTIAL' : 'SUCCESS'
        }
    }

    /** 파이프라인별 가장 최근 실행 반환 (헤더 한줄 표시용) */
    public getLatestRuns(): Record<string, PipelineRun | null> {
        const types: PipelineType[] = ['PRE_MARKET', 'MORNING', 'INTRADAY', 'EVENING', 'CLOSING']
        const result: Record<string, PipelineRun | null> = {}

        for (const type of types) {
            const runsOfType = Array.from(this.runs.values())
                .filter(r => r.pipeline === type)
                .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
            result[type] = runsOfType[0] || null
        }
        return result
    }

    /** 특정 실행의 상세 */
    public getRunDetail(runId: string): PipelineRun | null {
        return this.runs.get(runId) || null
    }

    /** 날짜별 전체 실행 이력 */
    public getAllRuns(date?: string): PipelineRun[] {
        const all = Array.from(this.runs.values())
            .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())

        if (date) {
            return all.filter(r => r.date === date)
        }
        return all
    }

    /** 오래된 실행 기록 정리 */
    private pruneOldRuns(type: PipelineType): void {
        const runsOfType = Array.from(this.runs.entries())
            .filter(([_, r]) => r.pipeline === type)
            .sort((a, b) => new Date(b[1].startedAt).getTime() - new Date(a[1].startedAt).getTime())

        if (runsOfType.length > this.MAX_RUNS_PER_TYPE) {
            const toRemove = runsOfType.slice(this.MAX_RUNS_PER_TYPE)
            for (const [key] of toRemove) {
                this.runs.delete(key)
            }
        }
    }
}
