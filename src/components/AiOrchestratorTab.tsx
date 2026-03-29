import { useState, useEffect, useCallback } from 'react'
import { Bot, Clock, Zap, AlertCircle, CheckCircle2, XCircle, Timer, RefreshCw, Radio, Activity, ChevronRight } from 'lucide-react'

// ═══ 에이전트 레지스트리 (프론트엔드 상수) ═══
const AI_AGENTS = [
    {
        id: 'MCA', name: '시황 AI (하이브리드)', fullName: 'Market Condition Agent',
        description: '매일 장전/장후 시장 상황을 분석하고, 장중 인트라데이 방향을 Gemini 마스터가 종합 예측합니다.',
        gemini: true, trigger: 'CRON' as const,
        schedules: [
            { time: '08:50', label: 'Cycle A — 장전 분석', description: '글로벌 매크로, 뉴스, 수급 종합 판단' },
            { time: '09:30', label: 'Intraday 하이브리드 #1', description: '개장 직후 수급/모멘텀 분석 종합' },
            { time: '13:00', label: 'Intraday 하이브리드 #2', description: '오후장 추세 반전 감지 결론 도출' },
            { time: '15:10', label: 'Cycle B — 장마감', description: '종가 기준 최종 판단 및 기록' },
        ],
    },
    {
        id: 'SWARM', name: '장중 스웜 AI', fullName: 'Intraday Swarm Agent',
        description: '로컬 AI 4인방(모멘텀, 역발상, 퀀트, 딜러)이 장중 다수결 평가를 진행합니다.',
        gemini: false, trigger: 'CRON' as const,
        schedules: [
            { time: '09:45', label: '스웜 A/B 테스트 (1회차)', description: '로컬 군집 4인 개별투표 및 합의' },
            { time: '10:15', label: '스웜 A/B 테스트 (2회차)', description: '로컬 군집 4인 개별투표 및 합의' },
            { time: '10:45', label: '스웜 A/B 테스트 (3회차)', description: '로컬 군집 4인 개별투표 및 합의' },
            { time: '11:15', label: '스웜 A/B 테스트 (4회차)', description: '로컬 군집 4인 개별투표 및 합의' },
            { time: '11:45', label: '스웜 A/B 테스트 (5회차)', description: '로컬 군집 4인 개별투표 및 합의' },
            { time: '12:15', label: '스웜 A/B 테스트 (6회차)', description: '로컬 군집 4인 개별투표 및 합의' },
            { time: '12:45', label: '스웜 A/B 테스트 (7회차)', description: '로컬 군집 4인 개별투표 및 합의' },
            { time: '13:15', label: '스웜 A/B 테스트 (8회차)', description: '로컬 군집 4인 개별투표 및 합의' },
            { time: '13:45', label: '스웜 A/B 테스트 (최종)', description: '마지막 로컬 예측 스나이핑' },
        ],
    },
    {
        id: 'IMA', name: '이슈 AI (편집장)', fullName: 'Issue Management Agent',
        description: '글로벌 매크로 이슈를 스캔하고 이슈 장부(Ledger)에 생명주기를 기록합니다.',
        gemini: true, trigger: 'MANUAL' as const,
        schedules: [],
    },
    {
        id: 'ITA', name: '이슈 트래커 (전담 기자)', fullName: 'Issue Tracker Agent',
        description: '08:30 매일 아침 로컬 뉴스를 긁어와 이슈 타임라인을 업데이트하고 군집을 소집합니다.',
        gemini: false, trigger: 'CRON' as const,
        schedules: [
            { time: '08:30', label: '개장 전 이슈 점검', description: '밤사이 뉴스 정독 및 타임라인 요약' },
        ],
    },
    {
        id: 'COPILOT', name: '코파일럿', fullName: 'Co-Pilot Agent',
        description: '사용자 채팅 기반 AI 어시스턴트. 실시간 데이터를 수집하여 답변합니다.',
        gemini: false, trigger: 'CHAT' as const,
        schedules: [],
    },
    {
        id: 'MRA', name: '회고 AI', fullName: 'Market Review Agent',
        description: '메인 예측 결과를 로컬 스웜이 매일 피드백(평가)하며, 메인 AI가 주/월 단위로 시스템 룰을 생성합니다.',
        gemini: true, trigger: 'CRON' as const,
        schedules: [
            { time: '15:00', label: '단기 피드백 (Pre-Close)', description: '아침 시황 비판 (Local Swarm)' },
            { time: '15:40', label: '일간 회고 (Post-Market)', description: '오늘 모든 예측의 결산 로그 (Local Swarm)' },
            { time: '16:00', label: '주간 회고 (금요일)', description: '반복되는 실패 감지 및 룰 추출 (Master)' },
            { time: '16:30', label: '월간 회고 (말일)', description: '4주간 매매내역 거시 분석 체화 (Master)' },
        ],
    },
    {
        id: 'PERF', name: '성과 추적', fullName: 'Performance Tracker',
        description: '일일 예측 vs 실제 결과를 비교 기록합니다. (AI 미사용)',
        gemini: false, trigger: 'CRON' as const,
        schedules: [
            { time: '15:35', label: '일일 성과 기록', description: '오전 예측 대비 실제 종가 비교' },
        ],
    },
] as const

interface QueueStatus {
    queueLength: number
    isProcessing: boolean
    pendingJobs: Array<{
        id: string
        agentId: string
        agentName: string
        triggerType: string
        status: string
        waitingMs: number
    }>
}

interface ExecutionLogEntry {
    id: string
    agentId: string
    agentName: string
    triggerType: string
    status: string
    queuedAt: string
    startedAt?: string
    finishedAt?: string
    durationMs?: number
    error?: string
}

const TRIGGER_BADGES: Record<string, { label: string; className: string }> = {
    CRON: { label: '자동', className: 'bg-primary/10 text-primary border-primary/20' },
    MANUAL: { label: '수동', className: 'bg-secondary text-secondary-foreground border-border' },
    CHAT: { label: '채팅', className: 'bg-muted text-foreground border-border' },
}

export default function AiOrchestratorTab() {
    const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null) // null = All
    const [queueStatus, setQueueStatus] = useState<QueueStatus | null>(null)
    const [executionLog, setExecutionLog] = useState<ExecutionLogEntry[]>([])

    const fetchData = useCallback(async () => {
        try {
            const api = window.electronAPI as any
            const [status, log] = await Promise.all([
                api.getAiQueueStatus?.() ?? null,
                api.getAiExecutionLog?.(50) ?? [],
            ])
            if (status) setQueueStatus(status)
            if (Array.isArray(log)) setExecutionLog(log)
        } catch { /* IPC 미연결 시 무시 */ }
    }, [])

    useEffect(() => {
        fetchData()
        const interval = setInterval(fetchData, 5000)
        return () => clearInterval(interval)
    }, [fetchData])

    // 로컬 AI 테스트 송신
    const handleTestLocalAi = async () => {
        try {
            const api = window.electronAPI as any;
            await api.testLocalAi('안녕 로컬 AI! 서버와 잘 연결되었는지 1~2문장으로 씩씩하게 인사해! 한국어로 대답.');
        } catch (error) {
            console.error('로컬 AI 테스트 실패:', error);
        }
    }

    // 현재 시각 (KST)
    const [now, setNow] = useState(new Date())
    useEffect(() => {
        const t = setInterval(() => setNow(new Date()), 1000)
        return () => clearInterval(t)
    }, [])
    const currentTimeStr = now.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })
    const dayOfWeek = now.getDay() // 0=일, 6=토
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6
    const dayLabel = ['일', '월', '화', '수', '목', '금', '토'][dayOfWeek]

    // 필터된 데이터
    const selectedAgent = AI_AGENTS.find(a => a.id === selectedAgentId) || null

    const filteredSchedules = selectedAgent
        ? selectedAgent.schedules.map(s => ({ ...s, agentId: selectedAgent.id, agentName: selectedAgent.name }))
        : AI_AGENTS.flatMap(agent =>
            agent.schedules.map(s => ({ ...s, agentId: agent.id, agentName: agent.name }))
        ).sort((a, b) => a.time.localeCompare(b.time))

    const filteredLog = selectedAgent
        ? executionLog.filter(e => e.agentId.startsWith(selectedAgent.id))
        : executionLog

    // 마지막 실행 조회
    const getLastRun = (agentId: string) => executionLog.find(e => e.agentId.startsWith(agentId))

    return (
        <div className="flex h-full bg-background text-foreground">

            {/* ═══ 왼쪽: 에이전트 목록 ═══ */}
            <aside className="w-80 border-r border-border bg-muted/30 flex flex-col">
                {/* 헤더 부분 */}
                <div className="p-6 border-b border-border">
                    <h2 className="text-2xl font-extrabold tracking-tight flex items-center gap-2">
                        <Bot className="text-primary" size={28} />
                        AI 관제
                    </h2>
                    <p className="text-sm text-muted-foreground mt-2">에이전트 및 실행 큐 모니터링</p>

                    {/* 큐 실시간 상태 패널 */}
                    <div className="mt-6 flex flex-col gap-3 p-4 rounded-xl border border-border bg-card shadow-sm">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2 font-semibold text-sm">
                                <Radio size={16} className={queueStatus?.isProcessing ? 'animate-pulse text-primary' : 'text-muted-foreground'} />
                                <span className={queueStatus?.isProcessing ? 'text-primary' : ''}>
                                    {queueStatus?.isProcessing ? 'AI 처리 중' : 'AI 시스템 대기 중'}
                                </span>
                            </div>
                            <span className="font-mono text-xs text-muted-foreground">{currentTimeStr}</span>
                        </div>
                        
                        {(queueStatus?.queueLength ?? 0) > 0 && (
                            <div className="px-3 py-1.5 bg-primary/10 text-primary rounded-md text-xs font-bold w-fit">
                                대기열: {queueStatus?.queueLength}건
                            </div>
                        )}

                        <button 
                            onClick={handleTestLocalAi} 
                            className="mt-2 w-full flex items-center justify-center gap-2 py-2.5 bg-primary/10 text-primary hover:bg-primary/20 hover:text-primary border border-primary/20 rounded-md transition-colors text-sm font-bold"
                        >
                            <Zap size={16} />
                            로컬 AI 통신 테스트
                        </button>
                    </div>
                </div>

                {/* 에이전트 네비게이션 */}
                <nav className="flex-1 overflow-y-auto p-4 space-y-2">
                    {/* ALL 항목 */}
                    <button
                        onClick={() => setSelectedAgentId(null)}
                        className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-colors font-medium border ${
                            selectedAgentId === null
                                ? 'bg-primary/10 border-primary/30 text-primary shadow-sm'
                                : 'bg-transparent border-transparent hover:bg-muted text-foreground'
                        }`}
                    >
                        <div className="flex-1 min-w-0">
                            <p className="text-base font-bold">
                                전체 보기
                            </p>
                            <p className="text-sm text-muted-foreground mt-0.5">
                                {AI_AGENTS.length}개 에이전트 · {AI_AGENTS.flatMap(a => a.schedules).length}개 스케줄
                            </p>
                        </div>
                        {selectedAgentId === null && <ChevronRight size={18} className="text-primary" />}
                    </button>

                    <div className="h-px bg-border my-2" />

                    {/* 개별 에이전트 항목 */}
                    {AI_AGENTS.map(agent => {
                        const isSelected = selectedAgentId === agent.id
                        const lastRun = getLastRun(agent.id)
                        const isRunning = queueStatus?.pendingJobs?.some(j => j.agentId.startsWith(agent.id) && j.status === 'RUNNING')

                        return (
                            <button
                                key={agent.id}
                                onClick={() => setSelectedAgentId(agent.id)}
                                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-colors border ${
                                    isSelected
                                        ? 'bg-primary/10 border-primary/30 shadow-sm'
                                        : 'bg-transparent border-transparent hover:bg-muted'
                                }`}
                            >
                                {/* 아이콘 영역 */}
                                <div className={`relative flex items-center justify-center p-2 rounded-lg ${isSelected ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground'}`}>
                                    <Bot size={20} />
                                    {isRunning && (
                                        <div className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-primary animate-pulse border-2 border-background" />
                                    )}
                                </div>

                                {/* 라벨 영역 */}
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                        <p className={`text-base font-bold ${isSelected ? 'text-primary' : 'text-foreground'}`}>
                                            {agent.name}
                                        </p>
                                        {agent.gemini && (
                                            <span className="text-xs px-1.5 py-0.5 rounded-md bg-secondary text-secondary-foreground font-semibold border border-border">
                                                G
                                            </span>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-2 mt-1">
                                        <span className={`text-xs px-2 py-0.5 rounded-md border font-semibold ${TRIGGER_BADGES[agent.trigger]?.className}`}>
                                            {TRIGGER_BADGES[agent.trigger]?.label}
                                        </span>
                                    </div>
                                </div>

                                {/* 실행 결과 표시 */}
                                <div className="shrink-0">
                                    {lastRun ? (
                                        lastRun.status === 'SUCCESS' ? (
                                            <CheckCircle2 size={18} className="text-emerald-500" />
                                        ) : (
                                            <XCircle size={18} className="text-rose-500" />
                                        )
                                    ) : (
                                        <div className="w-2.5 h-2.5 rounded-full bg-muted-foreground/30" />
                                    )}
                                </div>
                            </button>
                        )
                    })}
                </nav>
            </aside>

            {/* ═══ 오른쪽: 상세 패널 ═══ */}
            <main className="flex-1 overflow-y-auto p-10 bg-background">
                <div className="max-w-5xl mx-auto space-y-10 animate-in fade-in duration-300">

                    {/* 상단 제목 헤더 */}
                    <div className="flex items-center justify-between">
                        <div>
                            <h3 className="text-3xl font-extrabold tracking-tight text-foreground">
                                {selectedAgent ? selectedAgent.name : '전체 AI 에이전트'}
                            </h3>
                            <p className="text-base text-muted-foreground mt-2">
                                {selectedAgent ? selectedAgent.description : `총 ${AI_AGENTS.length}개 에이전트의 크론 스케줄 및 실행 이력`}
                            </p>
                        </div>
                        {selectedAgent && (
                            <div className="flex items-center gap-3">
                                <span className={`text-sm px-3 py-1 rounded-md border font-bold ${TRIGGER_BADGES[selectedAgent.trigger]?.className}`}>
                                    {TRIGGER_BADGES[selectedAgent.trigger]?.label} 트리거
                                </span>
                            </div>
                        )}
                    </div>

                    {/* 실행 중인 큐 상태가 있을 경우 */}
                    {queueStatus && queueStatus.pendingJobs.length > 0 && (
                        <div className="rounded-2xl bg-primary/5 border border-primary/20 p-6 shadow-sm">
                            <h4 className="text-sm font-bold text-primary flex items-center gap-2 mb-4">
                                <Timer size={18} />
                                현재 실행 대기열 ({queueStatus.queueLength}건 대기)
                            </h4>
                            <div className="space-y-3">
                                {queueStatus.pendingJobs
                                    .filter(j => !selectedAgent || j.agentId.startsWith(selectedAgent.id))
                                    .map(job => (
                                    <div key={job.id} className="flex items-center gap-4 bg-background px-4 py-3 rounded-xl border border-border shadow-sm">
                                        <RefreshCw size={16} className={job.status === 'RUNNING' ? 'animate-spin text-primary' : 'text-muted-foreground'} />
                                        <span className="font-bold text-sm text-foreground">{job.agentName}</span>
                                        <span className={`px-2 py-1 rounded-md border text-xs font-bold ${TRIGGER_BADGES[job.triggerType]?.className}`}>
                                            {TRIGGER_BADGES[job.triggerType]?.label}
                                        </span>
                                        <span className="text-sm text-muted-foreground ml-auto font-medium">
                                            {job.status === 'RUNNING' ? `${Math.round(job.waitingMs / 1000)}초 경과` : '대기 중'}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* ═══ 크론 스케줄 섹션 ═══ */}
                    <section className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
                        <div className="px-6 py-5 border-b border-border flex items-center justify-between bg-muted/30">
                            <h4 className="text-lg font-bold flex items-center gap-2 text-foreground">
                                <Clock size={20} className="text-primary" />
                                정규 크론 스케줄
                            </h4>
                            <div className="flex items-center gap-3">
                                {isWeekend && (
                                    <span className="text-xs px-3 py-1 rounded-md bg-destructive/10 text-destructive font-bold border border-destructive/20">
                                        {dayLabel}요일 (비활성)
                                    </span>
                                )}
                                <span className="text-sm text-muted-foreground font-medium border border-border px-3 py-1 bg-background rounded-md">
                                    총 {filteredSchedules.length}건
                                </span>
                            </div>
                        </div>

                        {/* 주말 휴장 배너 */}
                        {isWeekend && filteredSchedules.length > 0 && (
                            <div className="mx-6 mt-6 p-4 rounded-xl bg-muted border border-border">
                                <p className="text-sm font-bold text-foreground flex items-center gap-2">
                                    <AlertCircle size={16} className="text-muted-foreground" />
                                    주말 휴장으로 인한 스케줄 비활성 상태
                                </p>
                                <p className="text-sm text-muted-foreground mt-1">
                                    모든 자동 예측 스케줄은 정규장이 열리는 평일(월~금)에만 동작합니다. 아래는 평일 기준 스케줄표입니다.
                                </p>
                            </div>
                        )}

                        {filteredSchedules.length === 0 ? (
                            <div className="py-16 text-center text-muted-foreground">
                                <Clock size={48} className="mx-auto mb-4 opacity-20" />
                                <p className="text-base font-semibold text-foreground">등록된 스케줄이 없습니다</p>
                                <p className="text-sm mt-2">해당 에이전트는 이벤트 또는 채팅 기반으로 동작합니다.</p>
                            </div>
                        ) : (
                            <div className="divide-y divide-border">
                                {filteredSchedules.map((s, i) => {
                                    const isPast = !isWeekend && currentTimeStr > s.time
                                    const isNext = !isWeekend && !isPast && (i === 0 || currentTimeStr > filteredSchedules[i - 1].time)

                                    return (
                                        <div
                                            key={`${s.agentId}-${s.time}`}
                                            className={`flex items-start gap-6 px-8 py-5 transition-colors ${
                                                isWeekend ? 'opacity-50 grayscale' :
                                                isNext ? 'bg-primary/5' : isPast ? 'opacity-60' : ''
                                            }`}
                                        >
                                            <span className={`font-mono text-lg font-extrabold w-20 pt-0.5 ${
                                                isNext ? 'text-primary' : isPast ? 'text-muted-foreground' : 'text-foreground'
                                            }`}>
                                                {s.time}
                                            </span>

                                            <div className="flex-1 min-w-0 flex flex-col justify-center">
                                                <div className="flex items-center gap-3">
                                                    {!selectedAgent && (
                                                        <span className="text-sm font-bold text-primary bg-primary/10 px-2 py-0.5 rounded-md border border-primary/20">{s.agentName}</span>
                                                    )}
                                                    <span className={`text-base font-bold ${selectedAgent ? 'text-foreground' : 'text-muted-foreground'}`}>
                                                        {s.label}
                                                    </span>
                                                    {isNext && (
                                                        <span className="text-xs font-bold text-primary bg-primary/20 px-2 py-0.5 rounded-full uppercase tracking-wider">
                                                            Next Target
                                                        </span>
                                                    )}
                                                </div>
                                                {s.description && (
                                                    <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">{s.description}</p>
                                                )}
                                            </div>

                                            <div className="shrink-0 pt-2">
                                                {isPast ? (
                                                    <CheckCircle2 size={24} className="text-emerald-500" />
                                                ) : isNext ? (
                                                    <Timer size={24} className="text-primary animate-pulse" />
                                                ) : (
                                                    <div className="w-3 h-3 rounded-full bg-border" />
                                                )}
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>
                        )}
                    </section>

                    {/* ═══ 실행 이력 섹션 ═══ */}
                    <section className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
                        <div className="px-6 py-5 border-b border-border flex items-center justify-between bg-muted/30">
                            <h4 className="text-lg font-bold flex items-center gap-2 text-foreground">
                                <Activity size={20} className="text-primary" />
                                작업 실행 이력
                            </h4>
                            <span className="text-sm text-muted-foreground font-medium bg-background border border-border px-3 py-1 rounded-md">
                                기록 {filteredLog.length}건
                            </span>
                        </div>

                        {filteredLog.length === 0 ? (
                            <div className="py-20 text-center text-muted-foreground">
                                <Activity size={48} className="mx-auto mb-4 opacity-20" />
                                <p className="text-base font-semibold text-foreground">실행 기록이 없습니다</p>
                                <p className="text-sm mt-2 opacity-80">AI 작업이 발생하면 이곳에 로깅됩니다.</p>
                            </div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="border-b border-border bg-muted/50 text-muted-foreground">
                                            <th className="text-left py-4 pl-8 font-semibold w-32">실행 시각</th>
                                            {!selectedAgent && <th className="text-left py-4 font-semibold">동작 에이전트</th>}
                                            <th className="text-left py-4 font-semibold w-24">요청 방식</th>
                                            <th className="text-right py-4 font-semibold w-28">소요 시간</th>
                                            <th className="text-center py-4 pr-8 font-semibold w-24">상태결과</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-border/50">
                                        {filteredLog.map(entry => (
                                            <tr key={entry.id} className="hover:bg-muted/30 transition-colors">
                                                <td className="py-4 pl-8 font-mono text-muted-foreground whitespace-nowrap">
                                                    {entry.startedAt ? entry.startedAt.split(' ').pop()?.replace(/:\d{2}$/, '') : '-'}
                                                </td>
                                                {!selectedAgent && (
                                                    <td className="py-4 font-semibold text-foreground">{entry.agentName}</td>
                                                )}
                                                <td className="py-4">
                                                    <span className={`px-2 py-1 rounded-md border text-xs font-bold ${TRIGGER_BADGES[entry.triggerType]?.className || 'bg-muted text-muted-foreground border-border'}`}>
                                                        {TRIGGER_BADGES[entry.triggerType]?.label || entry.triggerType}
                                                    </span>
                                                </td>
                                                <td className="py-4 text-right font-mono text-muted-foreground">
                                                    {entry.durationMs ? `${(entry.durationMs / 1000).toFixed(1)}s` : '-'}
                                                </td>
                                                <td className="py-4 text-center pr-8">
                                                    {entry.status === 'SUCCESS' ? (
                                                        <CheckCircle2 size={18} className="text-emerald-500 mx-auto" />
                                                    ) : entry.status === 'FAILED' ? (
                                                        <div title={entry.error}>
                                                            <XCircle size={18} className="text-rose-500 mx-auto" />
                                                        </div>
                                                    ) : (
                                                        <RefreshCw size={18} className="text-primary animate-spin mx-auto" />
                                                    )}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}

                        {/* 최근 에러 안내 패널 */}
                        {filteredLog.find(e => e.status === 'FAILED') && (
                            <div className="m-6 p-4 rounded-xl bg-destructive/10 border border-destructive/20">
                                <div className="flex items-center gap-2 text-destructive font-bold text-sm mb-2">
                                    <AlertCircle size={16} />
                                    가장 최근 발생한 오류
                                </div>
                                <p className="text-sm font-mono text-destructive/80 break-all leading-relaxed">
                                    {filteredLog.find(e => e.status === 'FAILED')?.error || '알 수 없는 시스템 오류'}
                                </p>
                            </div>
                        )}
                    </section>
                </div>
            </main>
        </div>
    )
}
