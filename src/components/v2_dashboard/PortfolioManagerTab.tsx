import React, { useState, useEffect, useCallback } from 'react'
import { Brain, X, ChevronRight, Settings, Activity, Target, TrendingUp, BarChart2, Zap, Clock, Trash2, AlertTriangle, FlaskConical } from 'lucide-react'
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)) }

// ── Signal styling ──
const SIGNAL_STYLE: Record<string, string> = {
    IMMEDIATE_BUY: 'text-rose-500 bg-rose-500/10 border-rose-500/30',
    WAIT_DIP:      'text-amber-500 bg-amber-500/10 border-amber-500/30',
    HOLD:          'text-muted-foreground bg-muted/30 border-border',
    DROP:          'text-blue-500 bg-blue-500/10 border-blue-500/30',
    DROPPED:       'text-muted-foreground bg-muted/20 border-border/40 opacity-60',
    HIT:           'text-emerald-500 bg-emerald-500/10 border-emerald-500/30',
}

const STATUS_ICON: Record<string, string> = {
    WATCHLIST:    '🔵',
    IMMEDIATE_BUY:'🟡',
    WAIT_DIP:     '🟠',
    HOLD:         '⚪',
    DROPPED:      '❌',
    HIT:          '✅',
}

// ── Score bar ──
function ScoreBar({ score }: { score: number }) {
    const color = score >= 85 ? 'bg-rose-500' : score >= 70 ? 'bg-amber-500' : 'bg-muted-foreground/40'
    return (
        <div className="flex items-center gap-2">
            <span className="font-mono font-bold text-sm w-7">{score}</span>
            <div className="w-16 h-1.5 bg-muted/40 rounded-full overflow-hidden">
                <div className={cn('h-full rounded-full', color)} style={{ width: `${score}%` }} />
            </div>
        </div>
    )
}

function AnalystBadges({ json }: { json?: string }) {
    let tags: string[] = []
    try { tags = typeof json === 'string' ? JSON.parse(json) : (json || []) } catch { }
    const color: Record<string, string> = {
        THEME:    'bg-indigo-500/10 text-indigo-400 border-indigo-500/30',
        MOMENTUM: 'bg-rose-500/10 text-rose-500 border-rose-500/30',
        REPORT:   'bg-emerald-500/10 text-emerald-500 border-emerald-500/30',
    }
    
    if (tags.length === 0) {
        return <div className="text-center text-muted-foreground/40 text-[10px]">-</div>
    }

    return (
        <div className="flex items-center gap-1 justify-center">
            {tags.map((t, i) => (
                <span key={i} className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded border whitespace-nowrap', color[t] || 'bg-muted/30 text-muted-foreground border-border')}>
                    {t === 'THEME' ? '테마' : t === 'MOMENTUM' ? '수급' : t === 'REPORT' ? '리포트' : t}
                </span>
            ))}
        </div>
    )
}

// ── Detail Modal (대체된 StockDrawer) ──
import { StockChart } from '../../components/StockChart'
import { StockAiReport } from '../../components/StockAiReport'
import { ExternalLink, Copy, Check } from 'lucide-react'

function PortfolioStockModal({ stock, watchlist, onClose }: { stock: any; watchlist?: any[]; onClose: () => void }) {
    const [copied, setCopied] = useState(false);
    let analysts: any[] = []
    try { analysts = typeof stock.analysts_json === 'string' ? JSON.parse(stock.analysts_json) : (stock.analysts_json || []) } catch { }

    useEffect(() => {
        const originalStyle = window.getComputedStyle(document.body).overflow;  
        document.body.style.overflow = 'hidden';
        const handleKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', handleKeyDown);
        return () => {
            document.body.style.overflow = originalStyle;
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [onClose]);

    // 매력도나 시그널 정보가 있다면 관리 대상 종목으로 판단 (없으면 차트만 표시)
    const isManaged = stock.conviction_score != null || stock.last_signal != null || stock.raw_context != null;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6 md:p-12 animate-in fade-in duration-200 bg-background/80 backdrop-blur-sm">
            {/* Backdrop */}
            <div className="absolute inset-0" onClick={onClose} />
            
            {/* Modal Container */}
            <div className="relative flex flex-col w-full max-w-6xl h-full max-h-[90vh] bg-card border shadow-2xl rounded-2xl overflow-hidden shadow-glow">
                
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b bg-muted/20 shrink-0">
                    <div className="flex items-center gap-3">
                        <Brain className="w-5 h-5 text-indigo-400" />
                        <h2 className="text-xl font-black text-foreground">{stock.stock_name}</h2>
                        <span className="px-2 py-0.5 mt-0.5 text-xs font-mono font-bold text-muted-foreground bg-muted border rounded">
                            {stock.stock_code}
                        </span>
                        <a 
                            href={`https://finance.naver.com/item/main.naver?code=${(stock.stock_code || '').replace(/[^0-9]/g, '')}`} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="text-muted-foreground hover:text-primary transition-colors flex items-center gap-1 text-xs font-bold ml-1"
                            title="네이버 증권 열기"
                        >
                            <ExternalLink size={14} />
                        </a>
                    </div>
                    <button onClick={onClose} className="p-2 text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-full transition-colors">
                        <X size={20} />
                    </button>
                </div>

                {/* Body Content - Horizontal Layout */}
                <div className="flex flex-col lg:flex-row flex-1 overflow-hidden min-h-0">
                    
                    {/* Left Panel: Chart + PM Info */}
                    <div className={cn("flex flex-col shrink-0 min-h-0", isManaged ? "w-full lg:w-[45%] border-b lg:border-b-0 lg:border-r border-border bg-background" : "flex-1 w-full")}>
                        
                        {/* Top: Chart Area (Fixed 250px height when managed) */}
                        <div className={cn("w-full border-border bg-background/50 flex flex-col shrink-0", isManaged ? "h-[250px] border-b" : "flex-1")}>
                            <div className="p-2.5 bg-muted/10 border-b border-border/50 flex flex-col shrink-0">
                                <span className="text-xs font-bold text-muted-foreground tracking-wider uppercase">일봉 차트 (Daily)</span>
                            </div>
                            <div className="flex-1 min-h-0 relative p-1 pb-4">
                                <StockChart stockCode={stock.stock_code} stockName={stock.stock_name} />
                            </div>
                        </div>

                        {/* Bottom: PM Info (Left Panel) */}
                        {isManaged && (
                            <div className="flex-1 overflow-y-auto custom-scrollbar bg-card">
                                <div className="p-5 md:px-6 space-y-6 max-w-full">
                                    
                                    {/* 1. Stats Grid */}
                                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                                        {(() => {
                                            const ep = stock.entry_price || stock.actual_entry_price || stock.current_price;
                                            const pr = stock.profit_rate != null ? Number(stock.profit_rate) : null;
                                            const hr = (stock.high_price && ep && stock.high_price > ep) ? ((stock.high_price - ep) / ep) * 100 : pr;
                                            
                                            return [
                                                { label: '매력도 / 시그널', value: `${stock.conviction_score || 0}점 / ${stock.last_signal || '-'}` },
                                                { label: '현재가 수익률', value: pr != null ? `${pr > 0 ? '+' : ''}${pr.toFixed(2)}%` : '-', color: pr && pr > 0 ? 'text-rose-500' : pr && pr < 0 ? 'text-blue-500' : '' },
                                                { label: '목표 보유일정', value: `D+${stock.days_held ?? 0} / ${stock.lifespan_days ?? 20}일` },
                                            ].map(({ label, value, color }) => (
                                                <div key={label} className="bg-muted/10 border border-border/30 rounded-lg p-3">
                                                    <div className="text-[10px] text-muted-foreground uppercase font-bold mb-1.5">{label}</div>
                                                    <div className={cn('text-xs font-mono font-bold', color)}>{value}</div>
                                                </div>
                                            ));
                                        })()}
                                    </div>

                                    {/* 2. PM Rationale */}
                                    <div className="space-y-3">
                                        <div className="text-[11px] font-bold text-muted-foreground uppercase flex items-center gap-1.5 tracking-wider">
                                            <Brain className="w-3.5 h-3.5 text-indigo-400" /> 포트폴리오 매니저 판단
                                        </div>
                                        <div className="p-4 bg-primary/5 border border-primary/20 rounded-xl text-sm font-semibold text-foreground/90 leading-relaxed min-h-[80px]">
                                            {stock.last_signal_reason || '분석 내용이 없습니다.'}
                                        </div>
                                    </div>

                                    {/* 3. Raw Context */}
                                    {stock.raw_context && (
                                        <div className="pt-2">
                                            <details className="group border border-border/40 rounded-xl bg-muted/5 overflow-hidden relative">
                                                <summary className="text-[11px] h-10 px-4 font-bold text-muted-foreground uppercase cursor-pointer flex items-center justify-between list-none hover:bg-muted/10 transition-colors">
                                                    <div className="flex items-center gap-2">
                                                        <FlaskConical className="w-3.5 h-3.5 text-violet-400" />
                                                        <span>해당 종목 AI 판단 원문 컨텍스트</span>
                                                    </div>
                                                    <div className="flex items-center gap-3">
                                                        <button 
                                                            onClick={(e) => {
                                                                e.preventDefault();
                                                                navigator.clipboard.writeText(stock.raw_context);
                                                                setCopied(true);
                                                                setTimeout(() => setCopied(false), 2000);
                                                            }}
                                                            className="text-muted-foreground hover:text-foreground transition-colors p-1"
                                                            title="컨텍스트 내용 복사하기"
                                                        >
                                                            {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                                                        </button>
                                                        <ChevronRight className="w-4 h-4 transition-transform group-open:rotate-90" />
                                                    </div>
                                                </summary>
                                                <div className="p-4 border-t border-border/40 bg-background/50">
                                                    <div className="text-[10px] text-muted-foreground whitespace-pre-wrap leading-relaxed font-mono bg-background border border-border/50 p-3 rounded-lg overflow-x-auto max-h-[300px] overflow-y-auto custom-scrollbar">
                                                        {stock.raw_context}
                                                    </div>
                                                </div>
                                            </details>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Right Panel: AI Reports Timeline */}
                    {isManaged && (
                        <div className="flex-1 w-full lg:w-[55%] lg:h-full min-h-0 bg-card">
                            <div className="h-full flex flex-col">
                                <div className="p-4 bg-muted/10 border-b border-border/50 shrink-0">
                                    <div className="text-[11px] font-bold text-muted-foreground uppercase flex items-center gap-1.5 tracking-wider">
                                        <Activity className="w-4 h-4 text-blue-400" /> 개별 AI 리포트 전송 기록 (타임라인)
                                    </div>
                                </div>
                                <div className="flex-1 overflow-y-auto custom-scrollbar p-6">
                                    <StockAiReport symbol={stock.stock_code} name={stock.stock_name} hideTitle={true} />
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}

// ─────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────
export const PortfolioManagerTab: React.FC = () => {
    const [activeTab, setActiveTab]       = useState<'portfolio' | 'watchlist2' | 'picks' | 'runner'>('portfolio')
    const [portfolio, setPortfolio]         = useState<any[]>([])
    const [watchlist, setWatchlist]         = useState<any[]>([])
    const [selected, setSelected]           = useState<any | null>(null)
    const [filterStatus, setFilterStatus]   = useState('ALL')
    const [runLog, setRunLog]               = useState<string[]>([])
    const [runningAction, setRunningAction] = useState<string | null>(null)
    const [chartTestRunning, setChartTestRunning] = useState(false)
    const [confirmModal, setConfirmModal]   = useState<{ type: 'portfolio' | 'picks' } | null>(null)
    const [showSkillModal, setShowSkillModal] = useState(false)
    const [skillContent, setSkillContent] = useState('')

    const handleShowSkill = async () => {
        setShowSkillModal(true);
        setSkillContent('문서를 불러오는 중입니다...');
        try {
            const allSkills = await window.electronAPI.skillsGetAll();
            const skill = allSkills.find((s: any) => s.name?.includes('Chart Risk') || s.name?.includes('차트 리스크') || (s.path && s.path.includes('chart_risk_analysis')));
            if (skill && skill.content) {
                setSkillContent(skill.content);
            } else {
                setSkillContent('스킬 문서를 찾을 수 없습니다.');
            }
        } catch (e: any) {
            setSkillContent(`가져오기 실패:\n${e.message}`);
        }
    }

    const fetchPortfolio = useCallback(async () => {
        try {
            const data = await window.electronAPI.getActivePortfolio()
            setPortfolio(Array.isArray(data) ? data : [])
            
            const picksData = await window.electronAPI.getAiPicks()
            setWatchlist(Array.isArray(picksData) ? picksData : [])

            const logsData = await (window.electronAPI as any).getAiRunLogs()
            if (Array.isArray(logsData) && logsData.length > 0) {
                setRunLog(logsData.reverse())
            }
        } catch (e: any) {
            appendLog(`[ERROR] 로드 실패: ${e.message}`)
        }
    }, [])

    useEffect(() => { fetchPortfolio() }, [fetchPortfolio])

    const appendLog = (msg: string) => {
        const time = new Date().toLocaleTimeString('ko-KR', { hour12: false })
        const formatted = `[${time}] ${msg}`
        setRunLog(prev => [formatted, ...prev].slice(0, 100))
        ;(window.electronAPI as any).saveAiRunLog(formatted)
    }

    const runAction = async (action: 'MOMENTUM' | 'FUNDAMENTAL' | 'MANAGER' | 'JUDGE') => {
        const labels: Record<string, string> = {
            MOMENTUM:   '수급 AI (모멘텀)',
            FUNDAMENTAL:'리포트 AI (펀더멘털)',
            MANAGER:    '포트폴리오 매니저',
            JUDGE:      '장마감 채점',
        }
        setRunningAction(action)
        appendLog(`${labels[action]} 실행 시작...`)
        try {
            let result: any
            if (action === 'MOMENTUM')    result = await window.electronAPI.runMomentumAnalyst()
            if (action === 'FUNDAMENTAL') result = await window.electronAPI.runFundamentalAnalyst()
            if (action === 'MANAGER')     result = await window.electronAPI.runPortfolioManager()
            if (action === 'JUDGE')       result = await window.electronAPI.runPortfolioJudge()

            if (result?.error) {
                appendLog(`❌ ${labels[action]} 실패: ${result.error}`)
            } else {
                const count = Array.isArray(result) ? result.length : (result?.success ? '완료' : '-')
                appendLog(`✅ ${labels[action]} 완료 → ${count}건 처리`)
                if (action === 'MANAGER' || action === 'JUDGE') fetchPortfolio()
            }
        } catch (e: any) {
            appendLog(`❌ ${labels[action]} 오류: ${e.message}`)
        } finally {
            setRunningAction(null)
        }
    }

    // [TEST] 삼성전자 차트 다이제스트 기능 테스트
    const runChartDigestTest = async (code = '005930', name = '삼성전자') => {
        setChartTestRunning(true)
        appendLog(`🔬 [테스트] ${name}(${code}) 차트 다이제스트 요청 중...`)
        try {
            const result = await (window.electronAPI as any).testChartDigest(code, name)
            if (result?.error) {
                appendLog(`❌ [테스트] 실패: ${result.error}`)
            } else {
                // 결과를 줄 단위로 로그에 출력
                const lines = (result.digest as string).split('\n')
                lines.forEach((line: string) => appendLog(`  ${line}`))
                appendLog(`✅ [테스트] 차트 다이제스트 수신 완료`)
            }
        } catch (e: any) {
            appendLog(`❌ [테스트] 오류: ${e.message}`)
        } finally {
            setChartTestRunning(false)
        }
    }

    const handleRunRetrospectiveManual = async () => {
        setRunningAction('JUDGE') // UI 블로킹 재사용용
        appendLog(`🤖 애널리스트 성과 회고 및 오답노트 작성 시작...`)
        try {
            const result = await (window.electronAPI as any).runRetrospectiveManual()
            if (result?.error) {
                appendLog(`❌ 성과 회고 실패: ${result.error}`)
            } else {
                appendLog(`✅ 성과 회고 일체 완료 (${result.count || 0}건 채점 및 오답노트 추가됨)`)
            }
        } catch (e: any) {
            appendLog(`❌ 오류: ${e.message}`)
        } finally {
            setRunningAction(null)
        }
    }

    const handleClear = async (type: 'portfolio' | 'picks') => {
        setConfirmModal(null)
        const label = type === 'portfolio' ? '포트폴리오 DB' : 'AI 픽스(관심종목) DB'
        appendLog(`🗑 ${label} 초기화 중...`)
        try {
            const result = type === 'portfolio'
                ? await window.electronAPI.clearPortfolio()
                : await window.electronAPI.clearAiPicks()
            if (result?.error) {
                appendLog(`❌ 초기화 실패: ${result.error}`)
            } else {
                appendLog(`✅ ${label} 초기화 완료 (${result.deleted}건 삭제)`)
                fetchPortfolio()
            }
        } catch (e: any) {
            appendLog(`❌ 초기화 오류: ${e.message}`)
        }
    }

    // ── Derived stats ──
    const activeList    = portfolio.filter(p => p.status !== 'DROPPED')
    const hitCount      = portfolio.filter(p => p.status === 'HIT').length
    const droppedCount  = portfolio.filter(p => p.status === 'DROPPED').length
    const avgScore      = activeList.length ? Math.round(activeList.reduce((s, p) => s + (p.conviction_score || 0), 0) / activeList.length) : 0
    const withReturn    = activeList.filter(p => p.profit_rate != null)
    const avgReturn     = withReturn.length ? (withReturn.reduce((s, p) => s + Number(p.profit_rate), 0) / withReturn.length) : 0

    // ── Filtered rows ──
    const SIGNAL_WEIGHT: Record<string, number> = {
        IMMEDIATE_BUY: 10000,
        WAIT_DIP:      5000,
        WATCHLIST:     4000,
        HOLD:          3000,
        DROP:          2000,
        HIT:           -1000,
        DROPPED:       -2000,
    }

    const sortBySignal = (list: any[]) => list.sort((a, b) => {
        const sigA = a.last_signal || a.status;
        const sigB = b.last_signal || b.status;
        const weightA = (SIGNAL_WEIGHT[sigA] || 0) + (a.conviction_score || 0);
        const weightB = (SIGNAL_WEIGHT[sigB] || 0) + (b.conviction_score || 0);
        return weightB - weightA;
    })

    // 💰 매수 포지션: IMMEDIATE_BUY 신호 + HIT/DROPPED 이력
    const buyRows = sortBySignal(portfolio.filter(p => {
        const sig = p.last_signal || p.status;
        if (filterStatus === 'ALL') return sig === 'IMMEDIATE_BUY' || p.status === 'HIT' || p.status === 'DROPPED';
        if (filterStatus === 'ACTIVE') return sig === 'IMMEDIATE_BUY';
        return p.status === filterStatus || sig === filterStatus;
    }))

    // 👀 관심종목: WAIT_DIP / HOLD / WATCHLIST (매수 비지정 종목)
    const watchRows = sortBySignal(portfolio.filter(p => {
        const sig = p.last_signal || p.status;
        return sig === 'WAIT_DIP' || sig === 'HOLD' || sig === 'WATCHLIST';
    }))

    const TABS = [
        { id: 'portfolio',  label: '💰 매수 포지션' },
        { id: 'watchlist2', label: '👀 관심종목' },
        { id: 'picks',      label: '⭐ 추천 종목' },
        { id: 'runner',     label: '⚙ AI 수동실행' },
    ] as const

    const FILTERS = [
        { id: 'ALL',           label: '전체' },
        { id: 'ACTIVE',        label: '활성' },
        { id: 'IMMEDIATE_BUY', label: '🟡 즉시매수' },
        { id: 'HIT',           label: '✅ HIT' },
        { id: 'DROPPED',       label: '❌ 만료' },
    ]

    return (
        <div className="flex flex-col h-full overflow-hidden select-none">
            {/* ── Header ── */}
            <div className="shrink-0 px-4 py-3 border-b border-border/50 bg-muted/10">
                <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                        <Brain className="w-4 h-4 text-indigo-400" />
                        <span className="font-bold text-sm">AI 종목 매니저</span>
                    </div>
                    <button
                        onClick={fetchPortfolio}
                        className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-muted/30 transition-colors"
                    >
                        ⟳ 새로고침
                    </button>
                </div>

                {/* Stats Bar */}
                <div className="grid grid-cols-4 gap-3 mb-3">
                    {[
                        { icon: <BarChart2 className="w-3.5 h-3.5 text-indigo-400" />, label: '활성 종목', value: `${activeList.length} / 20` },
                        { icon: <Target className="w-3.5 h-3.5 text-emerald-500" />,   label: 'HIT / DROP', value: `${hitCount} / ${droppedCount}` },
                        { icon: <TrendingUp className="w-3.5 h-3.5 text-rose-500" />,  label: '평균 수익률', value: `${avgReturn > 0 ? '+' : ''}${avgReturn.toFixed(1)}%`, color: avgReturn > 0 ? 'text-rose-500' : avgReturn < 0 ? 'text-blue-500' : '' },
                        { icon: <Zap className="w-3.5 h-3.5 text-amber-500" />,        label: '평균 점수',   value: `${avgScore}점` },
                    ].map(({ icon, label, value, color }) => (
                        <div key={label} className="flex items-center gap-2 px-3 py-2 bg-muted/20 border border-border/40 rounded-lg">
                            {icon}
                            <div>
                                <div className="text-[10px] text-muted-foreground uppercase font-bold">{label}</div>
                                <div className={cn('text-sm font-mono font-bold', color)}>{value}</div>
                            </div>
                        </div>
                    ))}
                </div>

                {/* Tab Switcher */}
                <div className="flex items-center gap-1 bg-muted/30 rounded p-0.5 w-fit">
                    {TABS.map(t => (
                        <button
                            key={t.id}
                            onClick={() => setActiveTab(t.id)}
                            className={cn(
                                'px-3 py-1 text-xs font-bold rounded transition-colors',
                                activeTab === t.id
                                    ? 'bg-background text-foreground shadow-sm'
                                    : 'text-muted-foreground hover:text-foreground'
                            )}
                        >
                            {t.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* ── Portfolio Tab ── */}
            {activeTab === 'portfolio' && (
                <div className="flex flex-col flex-1 overflow-hidden">
                    {/* Filter Bar */}
                    <div className="shrink-0 px-4 py-2 border-b border-border/30 flex items-center gap-2">
                        {FILTERS.map(f => (
                            <button
                                key={f.id}
                                onClick={() => setFilterStatus(f.id)}
                                className={cn(
                                    'px-2.5 py-1 text-xs font-bold rounded transition-colors',
                                    filterStatus === f.id
                                        ? 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/30'
                                        : 'text-muted-foreground hover:bg-muted/30 border border-transparent'
                                )}
                            >
                                {f.label}
                            </button>
                        ))}
                        <span className="ml-auto text-xs text-muted-foreground opacity-50">행 클릭 → 상세</span>
                    </div>

                    {/* Table */}
                    <div className="flex-1 overflow-auto px-4">
                        <table className="w-full text-sm text-left whitespace-nowrap">
                            <thead className="sticky top-0 z-10 bg-background">
                                <tr className="text-xs uppercase text-muted-foreground border-b border-border/60">
                                    <th className="py-2 pr-3 font-bold w-8">상태</th>
                                    <th className="py-2 pr-4 font-bold">종목</th>
                                    <th className="py-2 pr-4 font-bold">시그널 (매수매력도)</th>
                                    <th className="py-2 pr-4 font-bold text-center">추천 AI</th>
                                    <th className="py-2 pr-4 font-bold text-center">추가일</th>
                                    <th className="py-2 pr-4 font-bold text-right">단가 / 수익률</th>
                                    <th className="py-2 pr-4 font-bold text-right">수명</th>
                                    <th className="py-2 w-6" />
                                </tr>
                            </thead>
                            <tbody>
                                {buyRows.length === 0 ? (
                                    <tr>
                                        <td colSpan={8} className="py-12 text-center text-muted-foreground text-xs">
                                            종목이 없습니다. 우측 상단 [AI 수동실행] 탭에서 AI를 실행하세요.
                                        </td>
                                    </tr>
                                ) : buyRows.map(p => {
                                    const signal      = p.last_signal || p.status
                                    const profitRate  = p.profit_rate != null ? Number(p.profit_rate) : null
                                    
                                    // 고점 수익률 및 HIT 판단
                                    const ep = p.entry_price || p.actual_entry_price || p.current_price;
                                    const highRate = (p.high_price && ep && p.high_price > ep) ? ((p.high_price - ep) / ep) * 100 : profitRate;
                                    const isMegaHit = highRate && highRate >= 30.0;
                                    const isHit = highRate && highRate >= 5.0; 
                                    
                                    // 상태 아이콘 보정
                                    let statusIcon = STATUS_ICON[signal] || '⚪';
                                    if (p.status === 'DROPPED') statusIcon = '❌';
                                    else if (isMegaHit) statusIcon = '👑';
                                    else if (p.status === 'HIT' || isHit) statusIcon = '✅';

                                    // 수명 로직 보정
                                    const daysHeld    = p.days_held ?? 0
                                    const lifespan    = p.lifespan_days ?? 20
                                    const isDropped   = p.status === 'DROPPED'
                                    
                                    let remainingDaysStr = `D+${daysHeld}`;
                                    if (!isDropped) {
                                        if (daysHeld > lifespan) remainingDaysStr = `연장 D+${daysHeld}`;
                                        else if (lifespan - daysHeld <= 3 && lifespan - daysHeld > 0) remainingDaysStr = `마감 D-${lifespan - daysHeld}`;
                                        else if (lifespan > 30) remainingDaysStr = `[전략상향] D+${daysHeld}`;
                                    }

                                    return (
                                        <tr
                                            key={p.id || p.stock_code}
                                            onClick={() => setSelected(p)}
                                            className={cn(
                                                'border-b border-border/20 hover:bg-accent/30 cursor-pointer transition-colors group',
                                                isDropped && 'opacity-50'
                                            )}
                                        >
                                            {/* 상태 */}
                                            <td className="py-2 pr-3 text-base">{statusIcon}</td>

                                            {/* 종목명 */}
                                            <td className="py-2 pr-4">
                                                <div className="font-semibold text-sm">{p.stock_name}</div>
                                                <div className="text-xs font-mono text-muted-foreground">{p.stock_code}</div>
                                            </td>

                                            {/* 시그널 + 매수 매력도 점수 */}
                                            <td className="py-2 pr-4">
                                                <div className="flex flex-col gap-1.5 align-start">
                                                    <span className={cn(
                                                        'inline-flex items-center px-1.5 py-0.5 rounded border text-[10px] uppercase font-bold w-fit',
                                                        SIGNAL_STYLE[signal] || SIGNAL_STYLE['HOLD']
                                                    )}>
                                                        {signal}
                                                    </span>
                                                    <ScoreBar score={p.conviction_score || 0} />
                                                </div>
                                            </td>

                                            {/* 추천 AI 뱃지 */}
                                            <td className="py-2 pr-4">
                                                <AnalystBadges json={p.analysts_json} />
                                            </td>

                                            {/* 추가일 */}
                                            <td className="py-2 pr-4 text-center">
                                                <span className="text-[11px] font-mono text-muted-foreground">
                                                    {p.entry_date ? p.entry_date.substring(0, 10).replace(/-/g, '.') : '-'}
                                                </span>
                                            </td>

                                            {/* 단가 및 수익률 */}
                                            <td className="py-2 pr-4 font-mono text-right">
                                                <div className="flex justify-end items-baseline gap-1 mb-0.5">
                                                    <span className="text-[10px] text-muted-foreground/70">진입가</span>
                                                    <span className="text-[11.5px] text-muted-foreground font-medium">{ep ? ep.toLocaleString() : '─'}</span>
                                                </div>
                                                <div className={cn("text-[13px] font-bold", profitRate != null && profitRate > 0 ? 'text-rose-500' : profitRate != null && profitRate < 0 ? 'text-blue-500' : 'text-muted-foreground')}>
                                                    현재: {profitRate != null ? `${profitRate > 0 ? '+' : ''}${profitRate.toFixed(2)}%` : '─'}
                                                </div>
                                                <div className="text-[10.5px] text-muted-foreground mt-0.5">
                                                    고점: {highRate != null ? `${highRate > 0 ? '+' : ''}${highRate.toFixed(2)}%` : '─'}
                                                </div>
                                            </td>

                                            {/* 수명 */}
                                            <td className="py-2 pr-4 text-right">
                                                <div className={cn("text-[11px] font-mono font-bold whitespace-nowrap", 
                                                    (lifespan - daysHeld <= 3 && !isDropped) ? 'text-rose-500 animate-pulse' : 
                                                    (lifespan > 30 && !isDropped) ? 'text-indigo-400' : 'text-muted-foreground'
                                                )}>
                                                    {remainingDaysStr}
                                                </div>
                                                <div className="w-12 h-1 bg-muted/40 rounded-full overflow-hidden ml-auto mt-1">
                                                    <div
                                                        className={cn('h-full rounded-full', daysHeld / lifespan > 0.8 ? 'bg-rose-500' : 'bg-indigo-500/60')}
                                                        style={{ width: `${Math.min((daysHeld / lifespan) * 100, 100)}%` }}
                                                    />
                                                </div>
                                            </td>

                                            {/* Arrow */}
                                            <td className="py-2">
                                                <ChevronRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-60 transition-opacity" />
                                            </td>
                                        </tr>
                                    )
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* ── 관심종목 Tab (WAIT_DIP / HOLD / WATCHLIST) ── */}
            {activeTab === 'watchlist2' && (
                <div className="flex flex-col flex-1 overflow-hidden">
                    <div className="shrink-0 px-4 py-2 border-b border-border/30 flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">
                            👀 매수 신호 미발동 종목. WAIT_DIP · HOLD · WATCHLIST 상태의 PM AI 편입 종목입니다.
                        </span>
                        <span className="ml-auto text-xs font-mono text-indigo-400 font-bold">{watchRows.length}종목</span>
                    </div>
                    <div className="flex-1 overflow-auto px-4">
                        <table className="w-full text-sm text-left whitespace-nowrap">
                            <thead className="sticky top-0 z-10 bg-background">
                                <tr className="text-xs uppercase text-muted-foreground border-b border-border/60">
                                    <th className="py-2 pr-3 font-bold w-8">상태</th>
                                    <th className="py-2 pr-4 font-bold">종목</th>
                                    <th className="py-2 pr-4 font-bold">시그널</th>
                                    <th className="py-2 pr-4 font-bold text-center">추천 AI</th>
                                    <th className="py-2 pr-4 font-bold text-center">추가일</th>
                                    <th className="py-2 pr-4 font-bold text-right">수명</th>
                                    <th className="py-2 w-6" />
                                </tr>
                            </thead>
                            <tbody>
                                {watchRows.length === 0 ? (
                                    <tr>
                                        <td colSpan={7} className="py-12 text-center text-muted-foreground text-xs">
                                            관심종목이 없습니다. 포트폴리오 매니저 AI를 실행하세요.
                                        </td>
                                    </tr>
                                ) : watchRows.map(p => {
                                    const signal = p.last_signal || p.status;
                                    const daysHeld = p.days_held ?? 0;
                                    const lifespan = p.lifespan_days ?? 20;
                                    return (
                                        <tr
                                            key={p.id || p.stock_code}
                                            onClick={() => setSelected(p)}
                                            className="border-b border-border/20 hover:bg-accent/30 cursor-pointer transition-colors group"
                                        >
                                            <td className="py-2 pr-3 text-base">{STATUS_ICON[signal] || '⚪'}</td>
                                            <td className="py-2 pr-4">
                                                <div className="font-semibold text-sm">{p.stock_name}</div>
                                                <div className="text-xs font-mono text-muted-foreground">{p.stock_code}</div>
                                            </td>
                                            <td className="py-2 pr-4">
                                                <div className="flex flex-col gap-1">
                                                    <span className={cn('inline-flex items-center px-1.5 py-0.5 rounded border text-[10px] uppercase font-bold w-fit', SIGNAL_STYLE[signal] || SIGNAL_STYLE['HOLD'])}>
                                                        {signal}
                                                    </span>
                                                    <ScoreBar score={p.conviction_score || 0} />
                                                </div>
                                            </td>
                                            <td className="py-2 pr-4"><AnalystBadges json={p.analysts_json} /></td>
                                            <td className="py-2 pr-4 text-center">
                                                <span className="text-[11px] font-mono text-muted-foreground">
                                                    {p.entry_date ? p.entry_date.substring(0, 10).replace(/-/g, '.') : '-'}
                                                </span>
                                            </td>
                                            <td className="py-2 pr-4 text-right">
                                                <div className="text-[11px] font-mono text-muted-foreground">D+{daysHeld} / {lifespan}일</div>
                                                <div className="w-12 h-1 bg-muted/40 rounded-full overflow-hidden ml-auto mt-1">
                                                    <div className="h-full rounded-full bg-amber-500/60" style={{ width: `${Math.min((daysHeld / lifespan) * 100, 100)}%` }} />
                                                </div>
                                            </td>
                                            <td className="py-2">
                                                <ChevronRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-60 transition-opacity" />
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* ── 추천 종목 Tab (ai_analyst_picks) ── */}
            {activeTab === 'picks' && (
                <div className="flex flex-col flex-1 overflow-hidden">
                    <div className="shrink-0 px-4 py-3 border-b border-border/30">
                        <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                            <Brain className="w-3.5 h-3.5" />
                            AI 애널리스트(모멘텀, 펀더멘털 등)가 일차적으로 발굴한 추천 종목 풀입니다.
                            <br/>이 목록에서 포트폴리오 매니저 AI가 최종 종목을 선정합니다.
                        </div>
                    </div>
                    <div className="flex-1 overflow-auto px-4">
                        <table className="w-full text-sm text-left">
                            <thead className="sticky top-0 z-10 bg-background">
                                <tr className="text-xs uppercase text-muted-foreground border-b border-border/60">
                                    <th className="py-2 pr-4 font-bold w-[100px]">날짜</th>
                                    <th className="py-2 pr-4 font-bold">종목</th>
                                    <th className="py-2 pr-4 font-bold">추천 출처</th>
                                    <th className="py-2 pr-4 font-bold text-right">매수 매력도</th>
                                    <th className="py-2 pr-4 font-bold text-right w-[80px]">예상 수명</th>
                                    <th className="py-2 pr-4 font-bold text-right w-[100px]">기준가/수익률</th>
                                    <th className="py-2 pr-4 font-bold text-center w-[80px]">결과</th>
                                    <th className="py-2 pl-4 font-bold">추천 사유</th>
                                </tr>
                            </thead>
                            <tbody>
                                {watchlist.length === 0 ? (
                                    <tr>
                                        <td colSpan={8} className="py-12 text-center text-muted-foreground text-xs">
                                            관심종목 풀이 비어있습니다. 수급 AI 또는 리포트 AI를 실행하세요.
                                        </td>
                                    </tr>
                                ) : watchlist.slice().sort((a,b) => b.confidence - a.confidence).map(w => {
                                    // w.evaluation_status: PENDING | SUCCESS | HOLD | FAIL
                                    const evalStatus = w.evaluation_status || 'PENDING';
                                    const statusBadge = {
                                        'PENDING': <span className="px-2 py-1 flex items-center justify-center rounded bg-muted text-muted-foreground text-[10px] w-full">대기</span>,
                                        'SUCCESS': <span className="px-2 py-1 flex items-center justify-center rounded bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 text-[10px] font-bold w-full">✅ 적중</span>,
                                        'HOLD': <span className="px-2 py-1 flex items-center justify-center rounded bg-amber-500/10 text-amber-500 border border-amber-500/20 text-[10px] font-bold w-full">🟡 보류</span>,
                                        'FAIL': <span className="px-2 py-1 flex items-center justify-center rounded bg-rose-500/10 text-rose-500 border border-rose-500/20 text-[10px] font-bold w-full">❌ 실패</span>
                                    }[evalStatus];

                                    return (
                                        <tr key={`${w.agent_type}-${w.stock_code}-${w.date}`} className="border-b border-border/20 hover:bg-accent/30">
                                            <td className="py-3 pr-4 text-xs font-mono text-muted-foreground">
                                                <span>{w.date ? w.date.substring(5) : '-'}</span>
                                            </td>
                                            <td className="py-3 pr-4">
                                                <div className="font-semibold text-sm">{w.stock_name}</div>
                                                <div className="text-xs font-mono text-muted-foreground">{w.stock_code}</div>
                                            </td>
                                            <td className="py-3 pr-4">
                                                <AnalystBadges json={JSON.stringify([w.agent_type])} />
                                            </td>
                                            <td className="py-3 pr-4 text-right">
                                                <div className="font-mono font-bold text-indigo-400">{w.confidence || 0}점</div>
                                            </td>
                                            <td className="py-3 pr-4 text-right">
                                                <span className="text-xs font-mono bg-muted/30 px-2 py-0.5 rounded border border-border">
                                                    {w.lifespan_days}일
                                                </span>
                                            </td>
                                            <td className="py-3 pr-4 text-right">
                                                {w.entry_price ? (
                                                    <div className="flex flex-col items-end gap-0.5">
                                                        <span className="font-mono text-xs">{w.entry_price.toLocaleString()}원</span>
                                                        {w.max_profit_rate != null ? (
                                                            <span className={cn("font-mono text-[11px] font-bold", w.max_profit_rate >= 0 ? "text-rose-500" : "text-blue-500")}>
                                                                {w.max_profit_rate >= 0 ? '+' : ''}{w.max_profit_rate.toFixed(1)}%
                                                            </span>
                                                        ) : (
                                                            <span className="font-mono text-[11px] text-muted-foreground">-</span>
                                                        )}
                                                    </div>
                                                ) : (
                                                    <span className="text-xs text-muted-foreground">-</span>
                                                )}
                                            </td>
                                            <td className="py-3 pr-4 text-center">
                                                {statusBadge}
                                            </td>
                                            <td className="py-3 pl-4 text-xs text-muted-foreground whitespace-normal min-w-[300px] leading-relaxed">
                                                {w.reason || '-'}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* ── AI 수동실행 Tab ── */}
            {activeTab === 'runner' && (
                <div className="flex flex-col flex-1 overflow-hidden">
                    <div className="flex-1 overflow-auto px-4 py-4 space-y-6">
                        {/* Run Buttons */}
                        <div>
                            <div className="text-xs font-bold text-muted-foreground uppercase mb-3 flex items-center gap-1.5">
                                <Zap className="w-3.5 h-3.5" /> 파이프라인 실행 (순서: 1 → 2 → 3, 장마감 후 4)
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                {([
                                    { id: 'MOMENTUM',    icon: '📈', label: '1. 수급 AI 실행',      sub: '급등주·거래대금 분석' },
                                    { id: 'FUNDAMENTAL', icon: '📄', label: '2. 리포트 AI 실행',    sub: '증권사 리포트 분석' },
                                    { id: 'MANAGER',     icon: '🧑‍💼', label: '3. 매니저 리뷰',      sub: '교차검증 · 종목 풀 갱신' },
                                    { id: 'JUDGE',       icon: '⚖️', label: '4. 장마감 채점',      sub: '수익률 · 수명 심사' },
                                ] as const).map(({ id, icon, label, sub }) => (
                                    <button
                                        key={id}
                                        onClick={() => runAction(id)}
                                        disabled={!!runningAction}
                                        className={cn(
                                            'flex items-start gap-3 p-3 rounded-lg border text-left transition-all',
                                            runningAction === id
                                                ? 'bg-indigo-500/10 border-indigo-500/40 text-indigo-400'
                                                : 'bg-muted/10 border-border/40 hover:bg-muted/20 hover:border-border',
                                            !!runningAction && runningAction !== id && 'opacity-40'
                                        )}
                                    >
                                        <span className="text-xl leading-none">{runningAction === id ? '⚙' : icon}</span>
                                        <div>
                                            <div className={cn('text-sm font-bold', runningAction === id && 'animate-pulse')}>
                                                {runningAction === id ? '실행 중...' : label}
                                            </div>
                                            <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>
                                        </div>
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* ── [TEST] 차트 다이제스트 테스트 ── */}
                        <div>
                            <div className="text-xs font-bold text-muted-foreground uppercase mb-3 flex items-center gap-1.5">
                                <FlaskConical className="w-3.5 h-3.5 text-violet-400" />
                                차트 분석 테스트 <span className="text-violet-400 normal-case font-normal">(삼성전자 005930 기준)</span>
                            </div>
                            <button
                                onClick={() => runChartDigestTest()}
                                disabled={chartTestRunning || !!runningAction}
                                className={cn(
                                    'w-full flex items-center gap-3 p-3 rounded-lg border text-left transition-all',
                                    chartTestRunning
                                        ? 'bg-violet-500/10 border-violet-500/40 text-violet-400 animate-pulse'
                                        : 'bg-muted/10 border-border/40 hover:bg-violet-500/5 hover:border-violet-500/30',
                                    (!!runningAction && !chartTestRunning) && 'opacity-40'
                                )}
                            >
                                <span className="text-xl leading-none">{chartTestRunning ? '⚙' : '📊'}</span>
                                <div>
                                    <div className="text-sm font-bold">{chartTestRunning ? '차트 데이터 수신 중...' : '삼성전자 차트 다이제스트 테스트'}</div>
                                    <div className="text-xs text-muted-foreground mt-0.5">200봉 기준 MA20/60/120/200 + 고저점 이격 확인 → 하단 로그 출력</div>
                                </div>
                            </button>
                        </div>

                        {/* ── AI 룰 및 매매 정책 (Skills) ── */}
                        <div>
                            <div className="text-xs font-bold text-muted-foreground uppercase mb-3 flex items-center gap-1.5">
                                <Brain className="w-3.5 h-3.5 text-indigo-400" /> 차트 분석 룰 (Skill) <span className="text-indigo-400 normal-case font-normal">(AI에 즉시 반영됨)</span>
                            </div>
                            <div className="flex flex-col gap-2">
                                <button
                                    onClick={handleShowSkill}
                                    className="w-full flex items-center gap-3 p-3 rounded-lg border text-left transition-all bg-indigo-500/5 border-indigo-500/20 hover:bg-indigo-500/10 hover:border-indigo-500/40"
                                >
                                    <span className="text-xl leading-none">📖</span>
                                    <div>
                                        <div className="text-sm font-bold text-indigo-400">차트 분석 리스크 평가 가이드북</div>
                                        <div className="text-xs text-muted-foreground mt-0.5">MA 이격도, 단기 모멘텀에 따른 과열 리스크 회피 지침 문서 열람</div>
                                    </div>
                                </button>
                                <button
                                    onClick={handleRunRetrospectiveManual}
                                    disabled={!!runningAction}
                                    className={cn(
                                        "w-full flex items-center gap-3 p-3 rounded-lg border text-left transition-all",
                                        runningAction === 'JUDGE' ? "bg-amber-500/10 border-amber-500/40 text-amber-500 animate-pulse" : "bg-amber-500/5 border-amber-500/20 hover:bg-amber-500/10 hover:border-amber-500/40",
                                        (!!runningAction && runningAction !== 'JUDGE') && "opacity-40"
                                    )}
                                >
                                    <span className="text-xl leading-none">{runningAction === 'JUDGE' ? '⚙' : '🤖'}</span>
                                    <div>
                                        <div className="text-sm font-bold text-amber-500">애널리스트 성과 회고 및 오답노트 작성 (수동)</div>
                                        <div className="text-xs text-muted-foreground mt-0.5">만기가 도래한 종목의 성적을 평가하고 각 서브 AI 스킬에 교훈을 보강합니다.</div>
                                    </div>
                                </button>
                            </div>
                        </div>

                        {/* ── DB 초기화 ── */}
                        <div>
                            <div className="text-xs font-bold text-muted-foreground uppercase mb-3 flex items-center gap-1.5">
                                <Trash2 className="w-3.5 h-3.5" /> DB 초기화 <span className="text-rose-400 normal-case font-normal">(주의: 되돌릴 수 없음)</span>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <button
                                    onClick={() => setConfirmModal({ type: 'portfolio' })}
                                    disabled={!!runningAction}
                                    className="flex items-start gap-3 p-3 rounded-lg border text-left transition-all bg-rose-500/5 border-rose-500/20 hover:bg-rose-500/10 hover:border-rose-500/40 disabled:opacity-40"
                                >
                                    <span className="text-xl leading-none">🗑</span>
                                    <div>
                                        <div className="text-sm font-bold text-rose-400">포트폴리오 초기화</div>
                                        <div className="text-xs text-muted-foreground mt-0.5">maiis_portfolio 전체 삭제</div>
                                    </div>
                                </button>
                                <button
                                    onClick={() => setConfirmModal({ type: 'picks' })}
                                    disabled={!!runningAction}
                                    className="flex items-start gap-3 p-3 rounded-lg border text-left transition-all bg-amber-500/5 border-amber-500/20 hover:bg-amber-500/10 hover:border-amber-500/40 disabled:opacity-40"
                                >
                                    <span className="text-xl leading-none">🗑</span>
                                    <div>
                                        <div className="text-sm font-bold text-amber-400">관심종목 초기화</div>
                                        <div className="text-xs text-muted-foreground mt-0.5">ai_analyst_picks 전체 삭제</div>
                                    </div>
                                </button>
                            </div>
                        </div>

                        {/* Cron Settings (UI Only - future) */}
                        <div>
                            <div className="text-xs font-bold text-muted-foreground uppercase mb-3 flex items-center gap-1.5">
                                <Clock className="w-3.5 h-3.5" /> 크론 자동실행 설정 <span className="text-indigo-400 normal-case font-normal">(coming soon)</span>
                            </div>
                            <div className="border border-border/40 rounded-lg overflow-hidden">
                                {[
                                    { label: '수급 AI',    time: '09:40', enabled: true },
                                    { label: '리포트 AI',  time: '09:45', enabled: true },
                                    { label: '매니저 AI',  time: '09:50', enabled: true },
                                    { label: '장마감 채점', time: '15:40', enabled: true },
                                ].map(({ label, time, enabled }, idx, arr) => (
                                    <div key={label} className={cn('flex items-center justify-between px-3 py-2.5 text-sm', idx < arr.length - 1 && 'border-b border-border/30')}>
                                        <span className="font-medium">{label}</span>
                                        <div className="flex items-center gap-3">
                                            <span className="font-mono text-xs text-muted-foreground">{time} (평일)</span>
                                            <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded', enabled ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/30' : 'bg-muted/30 text-muted-foreground border border-border')}>
                                                {enabled ? 'ON' : 'OFF'}
                                            </span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Execution Log */}
                        <div>
                            <div className="flex items-center justify-between mb-2">
                                <div className="text-xs font-bold text-muted-foreground uppercase flex items-center gap-1.5">
                                    <Activity className="w-3.5 h-3.5" /> 실행 로그
                                </div>
                                {runLog.length > 0 && (
                                    <button onClick={() => {
                                        setRunLog([]);
                                        (window.electronAPI as any).clearAiRunLogs();
                                    }} className="text-[10px] text-muted-foreground hover:text-foreground transition-colors">
                                        초기화
                                    </button>
                                )}
                            </div>
                            <div className="bg-[#0d0d0d] border border-black/50 rounded-lg p-3 font-mono text-xs text-gray-400 space-y-1 max-h-60 overflow-y-auto">
                                {runLog.length === 0 ? (
                                    <span className="opacity-50">실행 로그가 여기에 표시됩니다.</span>
                                ) : runLog.map((line, i) => (
                                    <div key={i} className={cn(line.includes('✅') ? 'text-emerald-400' : line.includes('❌') ? 'text-rose-400' : '')}>
                                        <span className="text-indigo-500/60 mr-1.5">&gt;</span>{line}
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Detail Modal ── */}
            {selected && <PortfolioStockModal stock={selected} watchlist={watchlist} onClose={() => setSelected(null)} />}

            {/* ── Confirm Modal ── */}
            {confirmModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center">
                    <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setConfirmModal(null)} />
                    <div className="relative bg-background border border-border rounded-xl p-6 w-80 shadow-2xl">
                        <div className="flex items-center gap-2 mb-3">
                            <AlertTriangle className="w-5 h-5 text-rose-400" />
                            <span className="font-bold text-sm">
                                {confirmModal.type === 'portfolio' ? '포트폴리오' : '관심종목'} DB 초기화
                            </span>
                        </div>
                        <p className="text-xs text-muted-foreground mb-5 leading-relaxed">
                            {confirmModal.type === 'portfolio'
                                ? 'maiis_portfolio 테이블의 모든 데이터가 삭제됩니다. 되돌릴 수 없습니다.'
                                : 'ai_analyst_picks 테이블의 모든 데이터가 삭제됩니다. 되돌릴 수 없습니다.'}
                        </p>
                        <div className="flex gap-2">
                            <button
                                onClick={() => setConfirmModal(null)}
                                className="flex-1 px-3 py-2 rounded-lg border border-border text-sm hover:bg-muted/30 transition-colors"
                            >
                                취소
                            </button>
                            <button
                                onClick={() => handleClear(confirmModal.type)}
                                className="flex-1 px-3 py-2 rounded-lg bg-rose-500 text-white text-sm font-bold hover:bg-rose-600 transition-colors"
                            >
                                삭제 확인
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Skill Document Modal ── */}
            {showSkillModal && (
                <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 sm:p-6 md:p-12 animate-in fade-in duration-200 bg-background/80 backdrop-blur-sm">
                    <div className="absolute inset-0" onClick={() => setShowSkillModal(false)} />
                    <div className="relative flex flex-col w-full max-w-4xl h-full max-h-[85vh] bg-card border shadow-2xl rounded-2xl overflow-hidden shadow-glow">
                        <div className="flex items-center justify-between px-6 py-4 border-b bg-muted/20 shrink-0">
                            <div className="flex items-center gap-2">
                                <Brain className="w-5 h-5 text-indigo-400" />
                                <h2 className="text-lg font-bold text-foreground">AI 차트 리스크 분석 지침 (Skill)</h2>
                            </div>
                            <button onClick={() => setShowSkillModal(false)} className="p-2 text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-full transition-colors">
                                <X size={20} />
                            </button>
                        </div>
                        <div className="flex-1 overflow-auto p-6 bg-background">
                            <pre className="text-sm text-foreground/90 font-mono whitespace-pre-wrap leading-relaxed">
                                {skillContent}
                            </pre>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
