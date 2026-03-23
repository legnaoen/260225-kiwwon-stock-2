/**
 * PipelineLogger
 * 
 * 파이프라인 실행 기록을 SQLite DB에 영구 저장.
 * SchedulerService에서 각 파이프라인(PRE_MARKET, MORNING, INTRADAY, EVENING, CLOSING, AM_EXECUTION)
 * 실행 시 phase별 결과를 기록하고, 프론트엔드에서 조회할 수 있도록 한다.
 */

import { DatabaseService } from './DatabaseService'

export type PipelineType = 'PRE_MARKET' | 'MORNING' | 'INTRADAY' | 'EVENING' | 'CLOSING' | 'AM_EXECUTION'
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

    private constructor() {
        this.ensureTable()
        this.loadFromDb()
    }

    public static getInstance(): PipelineLogger {
        if (!PipelineLogger.instance) {
            PipelineLogger.instance = new PipelineLogger()
        }
        return PipelineLogger.instance
    }

    /** DB 테이블 생성 */
    private ensureTable(): void {
        try {
            const db = DatabaseService.getInstance().getDb()
            db.exec(`
                CREATE TABLE IF NOT EXISTS pipeline_runs (
                    id TEXT PRIMARY KEY,
                    pipeline TEXT NOT NULL,
                    date TEXT NOT NULL,
                    started_at TEXT NOT NULL,
                    finished_at TEXT,
                    status TEXT NOT NULL DEFAULT 'RUNNING',
                    duration_ms INTEGER,
                    phases_json TEXT DEFAULT '[]',
                    created_at TEXT DEFAULT (datetime('now'))
                )
            `)
            db.exec(`CREATE INDEX IF NOT EXISTS idx_pipeline_runs_date ON pipeline_runs(date)`)
            db.exec(`CREATE INDEX IF NOT EXISTS idx_pipeline_runs_pipeline ON pipeline_runs(pipeline)`)
        } catch (e) {
            console.error('[PipelineLogger] Failed to ensure table:', e)
        }
    }

    /** 앱 시작 시 DB에서 최근 기록 복원 */
    private loadFromDb(): void {
        try {
            const db = DatabaseService.getInstance().getDb()
            const rows = db.prepare(`
                SELECT id, pipeline, date, started_at, finished_at, status, duration_ms, phases_json
                FROM pipeline_runs
                ORDER BY started_at DESC
                LIMIT 100
            `).all() as any[]

            for (const row of rows) {
                let phases: PipelinePhase[] = []
                try { phases = JSON.parse(row.phases_json || '[]') } catch {}
                
                this.runs.set(row.id, {
                    id: row.id,
                    pipeline: row.pipeline,
                    date: row.date,
                    startedAt: row.started_at,
                    finishedAt: row.finished_at || undefined,
                    status: row.status,
                    durationMs: row.duration_ms || undefined,
                    phases,
                })
            }
            console.log(`[PipelineLogger] Loaded ${rows.length} pipeline runs from DB`)
        } catch (e) {
            console.error('[PipelineLogger] Failed to load from DB:', e)
        }
    }

    /** DB에 실행 기록 저장/업데이트 */
    private saveToDb(run: PipelineRun): void {
        try {
            const db = DatabaseService.getInstance().getDb()
            db.prepare(`
                INSERT INTO pipeline_runs (id, pipeline, date, started_at, finished_at, status, duration_ms, phases_json)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    finished_at = excluded.finished_at,
                    status = excluded.status,
                    duration_ms = excluded.duration_ms,
                    phases_json = excluded.phases_json
            `).run(
                run.id,
                run.pipeline,
                run.date,
                run.startedAt,
                run.finishedAt || null,
                run.status,
                run.durationMs || null,
                JSON.stringify(run.phases)
            )
        } catch (e) {
            console.error('[PipelineLogger] Failed to save to DB:', e)
        }
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
        this.saveToDb(run)
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

    /** 파이프라인 전체 완료 기록 → DB에 영구 저장 */
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

        // DB에 최종 결과 저장
        this.saveToDb(run)
    }

    /** 파이프라인별 가장 최근 실행 반환 (헤더 한줄 표시용) */
    public getLatestRuns(): Record<string, PipelineRun | null> {
        const types: PipelineType[] = ['PRE_MARKET', 'AM_EXECUTION', 'MORNING', 'INTRADAY', 'EVENING', 'CLOSING']
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

    /** 오래된 실행 기록 정리 (인메모리 + DB) */
    private pruneOldRuns(type: PipelineType): void {
        const runsOfType = Array.from(this.runs.entries())
            .filter(([_, r]) => r.pipeline === type)
            .sort((a, b) => new Date(b[1].startedAt).getTime() - new Date(a[1].startedAt).getTime())

        if (runsOfType.length > this.MAX_RUNS_PER_TYPE) {
            const toRemove = runsOfType.slice(this.MAX_RUNS_PER_TYPE)
            for (const [key] of toRemove) {
                this.runs.delete(key)
                try {
                    DatabaseService.getInstance().getDb().prepare('DELETE FROM pipeline_runs WHERE id = ?').run(key)
                } catch {}
            }
        }
    }
}
