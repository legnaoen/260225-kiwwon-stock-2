import { useState, useEffect, useCallback } from 'react'
import { Bot, Clock, Zap, AlertCircle, CheckCircle2, XCircle, Timer, RefreshCw, Radio, Activity, ChevronRight, Copy, ScrollText } from 'lucide-react'

// ═══ 에이전트 레지스트리 (주도주 AI 단독 운용 체계) ═══
const AI_AGENTS = [
    {
        id: 'TRACK_A', name: 'Track A (진성 대장 AI)', fullName: 'True Leader Buy Agent',
        description: '당일 거래대금 및 등락률 최상위권의 절대적 시장 주도주를 선별하고 진입 타점을 심사합니다.',
        gemini: true, trigger: 'CRON' as const,
        schedules: [
            { time: '15:05', label: 'Track A 모의/실전매매 선발', description: '등락률 상위 15종목 중 절대 대장주 Gemma/Gemini 심사 및 매수' },
            { time: '15:41', label: 'Track A 성과 채점', description: '종가 기준 목표가 달성 및 손익 판독' },
        ],
    },
    {
        id: 'TRACK_B', name: 'Track B (신흥 급부상 AI)', fullName: 'Emerging Star Buy Agent',
        description: '5일/10일/20일/60일 다기간 교차 분석을 통해 시장 대비 강력한 알파 역상관을 보이는 신흥 주도주를 발굴합니다.',
        gemini: true, trigger: 'CRON' as const,
        schedules: [
            { time: '15:05', label: 'Track B 모의/실전매매 선발', description: '다기간 알파 역상관 신흥주 Gemma/Gemini 심사 및 매수' },
            { time: '15:41', label: 'Track B 성과 채점', description: '종가 기준 목표가 달성 및 손익 판독' },
        ],
    },
    {
        id: 'TRACK_C', name: 'Track C (눌림목/반등 AI)', fullName: 'Pullback Rebound Buy Agent',
        description: '강력한 수급이 유입된 주도 테마군 중 20일선 및 VWAP 부근의 안정적 눌림목 반등 타점을 스나이핑합니다.',
        gemini: true, trigger: 'CRON' as const,
        schedules: [
            { time: '15:05', label: 'Track C 모의/실전매매 선발', description: '주도주 수급선 지지 확인 후 눌림목 타점 매수' },
            { time: '15:41', label: 'Track C 성과 채점', description: '종가 기준 목표가 달성 및 손익 판독' },
        ],
    },
    {
        id: 'TRACK_D', name: 'Track D (당일 급등 AI)', fullName: 'Intraday Surge Buy Agent',
        description: '당일 거래대금 폭발 및 강력한 급등 탄력 모멘텀을 형성한 장중 주도주를 추종합니다.',
        gemini: true, trigger: 'CRON' as const,
        schedules: [
            { time: '15:05', label: 'Track D 모의/실전매매 선발', description: '당일 거래량 폭발 및 5% 이상 솟구친 종목 발굴' },
            { time: '15:41', label: 'Track D 성과 채점', description: '종가 기준 목표가 달성 및 손익 판독' },
        ],
    },
    {
        id: 'TRACK_E', name: 'Track E (단기 눌림 AI)', fullName: 'Short-term Consolidation Buy Agent',
        description: '3~5일간의 단기 숨고르기 조정을 거치며 2차 파동 직전의 안정적 구간에 진입한 종목을 포착합니다.',
        gemini: true, trigger: 'CRON' as const,
        schedules: [
            { time: '15:05', label: 'Track E 모의/실전매매 선발', description: '단기 숨고르기 구간 안정적 2차 파동 타점 매수' },
            { time: '15:41', label: 'Track E 성과 채점', description: '종가 기준 목표가 달성 및 손익 판독' },
        ],
    },
    {
        id: 'LIVE_TRADER', name: '실전 자동매매 엔진', fullName: 'Live Trade Execution Engine',
        description: '키움증권 OpenAPI와 직접 연동되어 동시호가 매수 집행, 장중 미체결 추적, 익절 감시, 보유기한 청산 및 일일 정산을 수행합니다.',
        gemini: false, trigger: 'CRON' as const,
        schedules: [
            { time: '08:50', label: '장전 계좌 잔고 동기화 (Sync Check)', description: '수동 주문 및 장외 체결분 사전 대조' },
            { time: '09:10', label: '보유기한 청산 예고 브리핑', description: '오늘 목표 보유일 도달 종목 텔레그램 안내' },
            { time: '15:00', label: '장 마감 기간청산 발송', description: '최대 보유일 만료 종목 15:20 동시호가 시장가 매도 집행' },
            { time: '15:32', label: '동시호가 확정 종가 진입가 갱신', description: '동시호가 확정 가격으로 체결가 최종 갱신' },
            { time: '15:35', label: '장 마감 실전 정산', description: '당일 매매 체결 결과 정산 및 잔고 대조' },
        ],
    },
    {
        id: 'SELF_LEARNING', name: '주도주 자가학습 엔진', fullName: 'Track Retrospective Agent',
        description: '주도주 AI 5대 트랙의 매매 타점 성적을 자동 복기하고 오답노트(SKILL.md 지침서)를 최적화 갱신합니다.',
        gemini: true, trigger: 'CRON' as const,
        schedules: [
            { time: '16:00', label: '주도주 AI 통합 정기 자가학습', description: 'Track A~E 성적 복기 및 지침서 증분 학습' },
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
    prompt?: string
    systemInstruction?: string
    result?: string
    modelName?: string
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
    const [selectedLog, setSelectedLog] = useState<ExecutionLogEntry | null>(null)

    const fetchData = useCallback(async () => {
        try {
            const api = window.electronAPI as any
            const [status, log] = await Promise.all([
                api.getAiQueueStatus?.() ?? null,
                api.getAiExecutionLog?.(200) ?? [],
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

    const handleCopyFullLog = () => {
        if (!selectedLog) return;
        const formattedLog = `📋 AI 관제센터 작업 상세 리포트\n────────────────────────────────────────\n[기본 정보]\n- 동작 에이전트 : ${selectedLog.agentName} (${selectedLog.agentId})\n- 실행 결과 상태: ${selectedLog.status}\n- 발생(실행)시각: ${selectedLog.startedAt || selectedLog.queuedAt}\n- 소요 시간     : ${selectedLog.durationMs ? (selectedLog.durationMs / 1000).toFixed(1) + 's' : '-'}\n- 요청(트리거)  : ${TRIGGER_BADGES[selectedLog.triggerType]?.label || selectedLog.triggerType}\n- 사용 AI 모델  : ${selectedLog.modelName || '기본 모델 (gemini-3.5-flash-lite)'}\n\n[시스템 프롬프트 (System)]\n${selectedLog.systemInstruction || '없음'}\n\n[입력 데이터 (Prompt)]\n${selectedLog.prompt || '없음'}\n${selectedLog.error ? `\n[오류 내용 (Error)]\n${selectedLog.error}\n` : ''}\n[출력 결과 (Result)]\n${selectedLog.result || '없음'}\n────────────────────────────────────────\nReport Generated: ${now.toLocaleString('ko-KR')}`;
        
        const fallbackCopy = () => {
            const textArea = document.createElement("textarea");
            textArea.value = formattedLog;
            textArea.style.position = "fixed";
            textArea.style.left = "-999999px";
            textArea.style.top = "-999999px";
            document.body.appendChild(textArea);
            textArea.focus();
            textArea.select();
            try {
                document.execCommand('copy');
                alert('전체 내용이 클립보드에 복사되었습니다.');
            } catch (err) {
                console.error('Fallback 복사 실패:', err);
                alert('보안 정책상 복사에 실패했습니다. 설정에서 권한을 확인해주세요.');
            }
            textArea.remove();
        };

        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(formattedLog).then(() => {
                alert('전체 내용이 클립보드에 복사되었습니다.');
            }).catch(err => {
                console.warn('Clipboard API 실패, Fallback 시도...', err);
                fallbackCopy();
            });
        } else {
            fallbackCopy();
        }
    }

    // 필터된 데이터
    const selectedAgent = AI_AGENTS.find(a => a.id === selectedAgentId) || null

    const filteredSchedules = selectedAgent
        ? selectedAgent.schedules.map(s => ({ ...s, agentId: selectedAgent.id, agentName: selectedAgent.name }))
        : AI_AGENTS.flatMap(agent =>
            agent.schedules.map(s => ({ ...s, agentId: agent.id, agentName: agent.name }))
        ).sort((a, b) => a.time.localeCompare(b.time))

    const filteredLog = selectedAgent
        ? executionLog.filter(e => e.agentId?.startsWith(selectedAgent.id))
        : executionLog // 'LOGS' 일 때도 전체 원본 사용
        
    // 마지막 실행 조회
    const getLastRun = (agentId: string) => executionLog.find(e => e.agentId?.startsWith(agentId))

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
                                전체 스케줄
                            </p>
                            <p className="text-sm text-muted-foreground mt-0.5">
                                {AI_AGENTS.length}개 에이전트
                            </p>
                        </div>
                        {selectedAgentId === null && <ChevronRight size={18} className="text-primary" />}
                    </button>

                    {/* AI LOGS 항목 */}
                    <button
                        onClick={() => setSelectedAgentId('LOGS')}
                        className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-colors font-medium border ${
                            selectedAgentId === 'LOGS'
                                ? 'bg-primary/10 border-primary/30 text-primary shadow-sm'
                                : 'bg-transparent border-transparent hover:bg-muted text-foreground'
                        }`}
                    >
                        <div className="flex-1 min-w-0">
                            <p className="text-base font-bold flex items-center gap-2">
                                AI 실행 로그
                            </p>
                            <p className="text-sm text-muted-foreground mt-0.5">
                                전체 실행 이력 및 에러
                            </p>
                        </div>
                        {selectedAgentId === 'LOGS' && <ChevronRight size={18} className="text-primary" />}
                    </button>

                    <div className="h-px bg-border my-2" />

                    {/* 개별 에이전트 항목 */}
                    {AI_AGENTS.map(agent => {
                        const isSelected = selectedAgentId === agent.id
                        const lastRun = getLastRun(agent.id)
                        const isRunning = queueStatus?.pendingJobs?.some(j => j.agentId?.startsWith(agent.id) && j.status === 'RUNNING')

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
                                {selectedAgent ? selectedAgent.name : selectedAgentId === 'LOGS' ? 'AI 연합 실행 로그' : '전체 AI 스케줄'}
                            </h3>
                            <p className="text-base text-muted-foreground mt-2">
                                {selectedAgent ? selectedAgent.description : selectedAgentId === 'LOGS' ? '모든 에이전트의 상세 작업 처리 및 통신 결과 내역' : `총 ${AI_AGENTS.length}개 에이전트의 분산 스케줄 관제`}
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
                                    .filter(j => !selectedAgent || j.agentId?.startsWith(selectedAgent.id))
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
                    {/* ═══ 예약 스케줄표 (로그 화면이 아닐 때만 표시) ═══ */}
                    {selectedAgentId !== 'LOGS' && (
                        <section className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
                            <div className="px-6 py-5 border-b border-border flex items-center justify-between bg-muted/30">
                                <h4 className="text-lg font-bold flex items-center gap-2 text-foreground">
                                    <Clock size={20} className="text-primary" />
                                    에이전트 크론(CRON) 스케줄 정보
                                </h4>
                                <span className="text-sm text-muted-foreground font-medium bg-background border border-border px-3 py-1 rounded-md">
                                    등록된 예약 {filteredSchedules.length}건
                                </span>
                            </div>

                            {filteredSchedules.length === 0 ? (
                                <div className="py-20 text-center text-muted-foreground">
                                    <Clock size={48} className="mx-auto mb-4 opacity-20" />
                                    <p className="text-base font-semibold text-foreground">등록된 스케줄이 없습니다</p>
                                </div>
                            ) : (
                                <div className="divide-y divide-border/50">
                                    {filteredSchedules.map((s, idx) => {
                                        const hrStr = s.time.split(':')[0]
                                        const minStr = s.time.split(':')[1]
                                        const isPast = (parseInt(hrStr) * 100 + parseInt(minStr)) < (now.getHours() * 100 + now.getMinutes())

                                        const nextScheduleIdx = filteredSchedules.findIndex(sched => {
                                            const h = parseInt(sched.time.split(':')[0])
                                            const m = parseInt(sched.time.split(':')[1])
                                            return (h * 100 + m) >= (now.getHours() * 100 + now.getMinutes())
                                        })
                                        const isNext = idx === nextScheduleIdx

                                        return (
                                            <div key={`${s.agentId}-${s.time}-${idx}`} className={`flex gap-6 p-6 transition-colors hover:bg-muted/30 ${isNext ? 'bg-primary/5' : ''}`}>
                                                <div className="shrink-0 w-24">
                                                    <span className={`font-mono text-xl font-bold flex items-center gap-2 ${isPast ? 'text-muted-foreground opacity-50' : 'text-foreground'}`}>
                                                        {s.time}
                                                    </span>
                                                    {!selectedAgent && (
                                                        <span className="block text-xs font-semibold text-muted-foreground mt-1 truncate">
                                                            {s.agentName}
                                                        </span>
                                                    )}
                                                </div>

                                                <div className="flex-1 mb-1">
                                                    <div className="flex items-center gap-3">
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
                    )}

                    {/* ═══ 실행 이력 섹션 (LOGS 메뉴이거나 특정 에이전트일 때만 표시) ═══ */}
                    {(selectedAgentId === 'LOGS' || (selectedAgentId !== null)) && (
                        <section className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-500 mt-10">
                            <div className="px-6 py-5 border-b border-border flex items-center justify-between bg-muted/30">
                                <h4 className="text-lg font-bold flex items-center gap-2 text-foreground">
                                    <Activity size={20} className="text-primary" />
                                    {selectedAgentId === 'LOGS' ? '통합 작업 실행 이력' : '해당 에이전트 작업 이력'}
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
                                                <th className="text-left py-4 font-semibold">동작 에이전트</th>
                                                <th className="text-left py-4 font-semibold w-24">요청 방식</th>
                                                <th className="text-right py-4 font-semibold w-28">소요 시간</th>
                                                <th className="text-center py-4 pr-8 font-semibold w-24">상태결과</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-border/50">
                                            {filteredLog.map(entry => (
                                                <tr key={entry.id} className="hover:bg-muted/30 transition-colors cursor-pointer" onClick={() => setSelectedLog(entry)}>
                                                    <td className="py-4 pl-8 font-mono text-muted-foreground whitespace-nowrap">
                                                        {entry.startedAt ? entry.startedAt.split(' ').pop()?.replace(/:\d{2}$/, '') : '-'}
                                                    </td>
                                                    <td className="py-4 font-semibold text-foreground">
                                                        <div className="flex items-center gap-2">
                                                            <span>{entry.agentName}</span>
                                                            {entry.modelName && (
                                                                <span className="px-1.5 py-0.5 bg-indigo-500/10 text-indigo-500 border border-indigo-500/20 text-[10px] rounded font-bold whitespace-nowrap">
                                                                    🌟 심층
                                                                </span>
                                                            )}
                                                        </div>
                                                    </td>
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
                    )}

                </div>
            </main>

            {/* ═══ 실행 내역 상세 팝업 ═══ */}
            {selectedLog && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm animate-in fade-in duration-200" onClick={() => setSelectedLog(null)}>
                    <div 
                        className="bg-card w-full max-w-3xl max-h-[85vh] rounded-2xl border border-border shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-200"
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="px-6 py-4 border-b border-border flex items-center justify-between bg-muted/30">
                            <h3 className="font-bold text-lg flex items-center gap-2">
                                <Bot size={20} className="text-primary" />
                                {selectedLog.agentName} 실행 상세
                            </h3>
                            <div className="flex items-center gap-2">
                                <button 
                                    onClick={handleCopyFullLog} 
                                    className="flex items-center gap-1 px-3 py-1.5 rounded-md hover:bg-muted text-muted-foreground text-xs font-semibold transition-colors border border-transparent hover:border-border"
                                >
                                    <Copy size={14} /> 복사
                                </button>
                                <button onClick={() => setSelectedLog(null)} className="p-1 rounded-md hover:bg-muted text-muted-foreground transition-colors">
                                    <XCircle size={20} />
                                </button>
                            </div>
                        </div>
                        <div className="flex-1 overflow-y-auto p-6 space-y-6 text-sm">
                            <div className="grid grid-cols-2 gap-4 bg-muted/30 p-4 rounded-xl border border-border">
                                <div>
                                    <p className="text-muted-foreground text-xs font-semibold mb-1">상태</p>
                                    <div className="flex items-center gap-2 font-bold">
                                        {selectedLog.status === 'SUCCESS' ? <CheckCircle2 size={16} className="text-emerald-500" /> : selectedLog.status === 'FAILED' ? <XCircle size={16} className="text-rose-500" /> : <RefreshCw size={16} className="text-primary animate-spin" />}
                                        {selectedLog.status}
                                    </div>
                                </div>
                                <div>
                                    <p className="text-muted-foreground text-xs font-semibold mb-1">실행 시각</p>
                                    <p className="font-mono font-bold">{selectedLog.startedAt || selectedLog.queuedAt}</p>
                                </div>
                                <div>
                                    <p className="text-muted-foreground text-xs font-semibold mb-1">트리거 방식</p>
                                    <span className={`px-2 py-0.5 rounded-md border text-xs font-bold ${TRIGGER_BADGES[selectedLog.triggerType]?.className || 'bg-muted text-muted-foreground border-border'}`}>
                                        {TRIGGER_BADGES[selectedLog.triggerType]?.label || selectedLog.triggerType}
                                    </span>
                                </div>
                                <div>
                                    <p className="text-muted-foreground text-xs font-semibold mb-1">소요 시간</p>
                                    <p className="font-mono font-bold">{selectedLog.durationMs ? `${(selectedLog.durationMs / 1000).toFixed(1)}s` : '-'}</p>
                                </div>
                                <div className="col-span-2 mt-2 pt-4 border-t border-border/50">
                                    <p className="text-muted-foreground text-xs font-semibold mb-1">사용 AI 모델</p>
                                    <p className="font-mono text-sm font-bold text-primary flex items-center gap-2">
                                        {selectedLog.modelName ? (
                                            <>
                                                🌟 {selectedLog.modelName} <span className="text-xs text-indigo-500 bg-indigo-500/10 px-1.5 py-0.5 rounded ml-1">심층 모델</span>
                                            </>
                                        ) : (
                                            '기본 모델 (gemini-3.5-flash-lite 등)'
                                        )}
                                    </p>
                                </div>
                            </div>
                            
                            {selectedLog.systemInstruction && (
                                <div>
                                    <h4 className="text-sm font-bold mb-2 flex items-center gap-2 text-primary">
                                        시스템 프롬프트 (System)
                                    </h4>
                                    <div className="bg-muted p-4 rounded-xl border border-border whitespace-pre-wrap font-mono text-xs text-foreground/80 max-h-40 overflow-y-auto">
                                        {selectedLog.systemInstruction}
                                    </div>
                                </div>
                            )}

                            {selectedLog.prompt && (
                                <div>
                                    <h4 className="text-sm font-bold mb-2 flex items-center gap-2 text-foreground">
                                        입력 데이터 (Prompt)
                                    </h4>
                                    <div className="bg-primary/5 p-4 rounded-xl border border-primary/20 whitespace-pre-wrap font-mono text-xs text-foreground max-h-60 overflow-y-auto">
                                        {selectedLog.prompt}
                                    </div>
                                </div>
                            )}

                            {selectedLog.error && (
                                <div>
                                    <h4 className="text-sm font-bold mb-2 flex items-center gap-2 text-destructive">
                                        <AlertCircle size={16} /> 오류 내용
                                    </h4>
                                    <div className="bg-destructive/10 p-4 rounded-xl border border-destructive/20 whitespace-pre-wrap font-mono text-xs text-destructive max-h-40 overflow-y-auto">
                                        {selectedLog.error}
                                    </div>
                                </div>
                            )}

                            {selectedLog.result && (
                                <div>
                                    <h4 className="text-sm font-bold mb-2 flex items-center gap-2 text-emerald-600">
                                        <CheckCircle2 size={16} /> 출력 결과 (Result)
                                    </h4>
                                    <div className="bg-emerald-500/5 p-4 rounded-xl border border-emerald-500/20 whitespace-pre-wrap font-mono text-xs text-foreground max-h-80 overflow-y-auto">
                                        {selectedLog.result}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
