import React, { useState, useEffect, useCallback } from 'react'
import { Brain, X, ChevronRight, Settings, Activity, Clock, Trash2, AlertTriangle, FlaskConical, Zap, Check, Copy, ExternalLink, Sparkles } from 'lucide-react'
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)) }

// ── Signal styling ──
const SIGNAL_STYLE: Record<string, string> = {
    HELD: 'text-rose-500 bg-rose-500/10 border-rose-500/30',
    WATCHING: 'text-indigo-400 bg-indigo-400/10 border-indigo-400/30',
    BUY: 'text-rose-500 bg-rose-500/10 border-rose-500/30',
    HOLD: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/30',
    SELL: 'text-slate-500 bg-slate-500/10 border-slate-500/30',
    DROP: 'text-slate-500 bg-slate-500/10 border-slate-500/30',
    DROPPED: 'text-muted-foreground bg-muted/20 border-border/40 opacity-60',
    HIT: 'text-emerald-500 bg-emerald-500/10 border-emerald-500/30',
    // Fallback for old data
    IMMEDIATE_BUY: 'text-rose-500 bg-rose-500/10 border-rose-500/30',
    WAIT_DIP: 'text-amber-500 bg-amber-500/10 border-amber-500/30',
    WATCHLIST: 'text-indigo-400 bg-indigo-400/10 border-indigo-400/30',
}

const STATUS_ICON: Record<string, string> = {
    HELD: '🟡',
    WATCHING: '👀',
    BUY: '🔴',
    HOLD: '🛡️',
    SELL: '🗑️',
    WATCHLIST: '🔵',
    IMMEDIATE_BUY: '🟡',
    WAIT_DIP: '🟠',
    DROPPED: '❌',
    HIT: '✅',
}

// 관심종목 탭용 한글 상태 레이블
const WATCH_LABEL: Record<string, { text: string; cls: string }> = {
    WAIT_DIP: { text: '눌림목 대기', cls: 'text-amber-500 bg-amber-500/10 border-amber-500/30' },
    HOLD: { text: '홀드', cls: 'text-slate-400 bg-slate-400/10 border-slate-400/30' },
    WATCHLIST: { text: '관심 대기', cls: 'text-blue-400 bg-blue-400/10 border-blue-400/30' },
    DROPPED: { text: '탈락', cls: 'text-muted-foreground bg-muted/20 border-border opacity-60' },
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
        THEME: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/30',
        MOMENTUM: 'bg-rose-500/10 text-rose-500 border-rose-500/30',
        REPORT: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30',
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

function PortfolioStockModal({ stock, watchlist, onClose, onUpdateStockPrice }: { stock: any; watchlist?: any[]; onClose: () => void; onUpdateStockPrice?: (code: string, price: number) => void }) {
    const [copied, setCopied] = useState(false);
    const [eventLogs, setEventLogs] = useState<any[]>([]);
    const [latestPrice, setLatestPrice] = useState<number | null>(null);
    const [stockNarrative, setStockNarrative] = useState<{ narrative: string, updated_at: string } | null>(null);

    let analysts: any[] = []
    try { analysts = typeof stock.analysts_json === 'string' ? JSON.parse(stock.analysts_json) : (stock.analysts_json || []) } catch { }

    useEffect(() => {
        if (latestPrice !== null && onUpdateStockPrice) {
            onUpdateStockPrice(stock.stock_code, latestPrice);
        }
    }, [latestPrice, stock.stock_code, onUpdateStockPrice]);

    useEffect(() => {
        if (stock.stock_code) {
            (window as any).electronAPI?.getPortfolioEventLogs(stock.stock_code)
                .then((res: any) => {
                    if (res?.success) setEventLogs(res.data || []);
                });

            if ((window as any).electronAPI?.getStockNarrative) {
                (window as any).electronAPI.getStockNarrative(stock.stock_code)
                    .then((res: any) => {
                        if (res?.success && res.data) {
                            setStockNarrative(res.data);
                        }
                    })
                    .catch((e: any) => console.error('Failed to load stock narrative in PM modal', e));
            }
        }
    }, [stock.stock_code]);

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
    // PM 관리 앱이므로 포트폴리오 탭, 성적표 탭 등에서 열린 모달은 모두 관리 대상으로 간주함.
    const isManaged = true;

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
                                <StockChart stockCode={stock.stock_code} stockName={stock.stock_name} onPriceUpdate={setLatestPrice} />
                            </div>
                        </div>

                        {/* Bottom: PM Info (Left Panel) */}
                        {isManaged && (
                            <div className="flex-1 overflow-y-auto custom-scrollbar bg-card">
                                <div className="p-5 md:px-6 space-y-6 max-w-full">

                                    {/* 1. Stats Grid */}
                                    {!['DROPPED', 'HIT', 'CLOSED'].includes(stock.status) && (
                                        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                                            {(() => {
                                                const ep = stock.entry_price || stock.actual_entry_price || stock.current_price;
                                                const displayPrice = latestPrice || stock.current_price;
                                                const pr = (ep && displayPrice) ? ((displayPrice - ep) / ep) * 100 : (stock.profit_rate != null ? Number(stock.profit_rate) : null);
                                                const hr = (stock.high_price && ep && stock.high_price > ep) ? ((stock.high_price - ep) / ep) * 100 : pr;

                                                return [
                                                    { label: '매력도 / 시그널', value: `${stock.conviction_score || 0}점 / ${stock.last_signal || '-'}` },
                                                    { label: '현재가 수익률', value: pr != null ? `${pr > 0 ? '+' : ''}${pr.toFixed(2)}%` : '-', color: pr && pr > 0 ? 'text-rose-500' : pr && pr < 0 ? 'text-blue-500' : '' },
                                                    {
                                                        label: '목표 보유일정', value: (stock.status === 'HELD' || stock.last_signal === 'IMMEDIATE_BUY')
                                                            ? `D+${stock.days_held ?? 0} / ${stock.lifespan_days ?? '-'}일`
                                                            : '- (관심 대기 중)'
                                                    },
                                                ].map(({ label, value, color }) => (
                                                    <div key={label} className="bg-muted/10 border border-border/30 rounded-lg p-3">
                                                        <div className="text-[10px] text-muted-foreground uppercase font-bold mb-1.5">{label}</div>
                                                        <div className={cn('text-xs font-mono font-bold', color)}>{value}</div>
                                                    </div>
                                                ));
                                            })()}
                                        </div>
                                    )}

                                    {/* 2. PM Rationale */}
                                    <div className="space-y-3">
                                        <div className="text-[11px] font-bold text-muted-foreground uppercase flex items-center gap-1.5 tracking-wider">
                                            <Brain className="w-3.5 h-3.5 text-indigo-400" /> 포트폴리오 매니저 판단
                                        </div>
                                        <div className="p-4 bg-primary/5 border border-primary/20 rounded-xl text-sm font-semibold text-foreground/90 leading-relaxed min-h-[80px]">
                                            {stock.last_signal_reason || stock.exit_reason || stock.entry_reason || '분석 내용이 없습니다.'}
                                        </div>
                                    </div>

                                    {/* 2.5 Narrative */}
                                    {stockNarrative && (
                                        <div className="bg-gradient-to-br from-indigo-500/5 to-purple-500/5 border border-indigo-500/10 rounded-xl p-4 shadow-inner">
                                            <h4 className="text-[11px] font-bold text-indigo-400 flex items-center gap-1.5 uppercase tracking-wider mb-2">
                                                <Sparkles size={13} className="text-indigo-500" /> Company Narrative
                                            </h4>
                                            <p className="text-[13px] leading-relaxed text-foreground/90 font-medium whitespace-pre-wrap">
                                                {stockNarrative.narrative}
                                            </p>
                                        </div>
                                    )}

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

                    {/* Right Panel: AI Reports & PM Event Logs Unified Timeline */}
                    {isManaged && (
                        <div className="flex-1 w-full lg:w-[55%] lg:h-full min-h-0 bg-card border-l border-border/50">
                            <div className="h-full flex flex-col">
                                <div className="p-4 bg-muted/10 border-b border-border/50 shrink-0">
                                    <div className="text-[11px] font-bold text-muted-foreground uppercase flex items-center gap-1.5 tracking-wider">
                                        <Brain className="w-4 h-4 text-blue-400" /> 종목 판단 & 리포트 타임라인
                                    </div>
                                </div>
                                <div className="flex-1 overflow-y-auto custom-scrollbar p-6">
                                    <StockAiReport symbol={stock.stock_code} name={stock.stock_name} hideTitle={true} pmEvents={eventLogs} />
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
    const [activeTab, setActiveTab] = useState<'portfolio' | 'watchlist2' | 'picks' | 'incubator' | 'history' | 'runner'>('portfolio')
    const [portfolio, setPortfolio] = useState<any[]>([])
    const [history, setHistory] = useState<any[]>([])
    const [watchlist, setWatchlist] = useState<any[]>([])
    const [incubatorList, setIncubatorList] = useState<any[]>([])
    const [selected, setSelected] = useState<any | null>(null)
    const [filterStatus, setFilterStatus] = useState('ALL')
    const [runLog, setRunLog] = useState<string[]>([])
    const [runningAction, setRunningAction] = useState<string | null>(null)
    const [chartTestRunning, setChartTestRunning] = useState(false)
    const [confirmModal, setConfirmModal] = useState<{ type: 'portfolio' | 'picks' | 'cleanup' } | null>(null)
    const [showSkillModal, setShowSkillModal] = useState(false)
    const [skillContent, setSkillContent] = useState('')
    const [incubatorScanRunning, setIncubatorScanRunning] = useState(false)
    // 성적표 AI 분석
    const [retroRunning, setRetroRunning] = useState(false)
    const [retroReport, setRetroReport] = useState<any | null>(null)
    const [retroError, setRetroError] = useState<string | null>(null)
    const [showRetroModal, setShowRetroModal] = useState(false)
    const [retroModalTab, setRetroModalTab] = useState<'summary' | 'pm1' | 'pm2' | 'patterns'>('summary')

    const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' }>(() => {
        const saved = localStorage.getItem('portfolio_sortConfig');
        if (saved) {
            try { return JSON.parse(saved); } catch (e) {}
        }
        return { key: 'created_at', direction: 'asc' }; // 가장 오래된 종목부터 상위 노출
    });

    const handleSort = (key: string) => {
        let direction: 'asc' | 'desc' = 'asc';
        if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
            direction = 'desc';
        }
        const newConfig = { key, direction };
        setSortConfig(newConfig);
        localStorage.setItem('portfolio_sortConfig', JSON.stringify(newConfig));
    };

    const SortableHeader = ({ title, sortKey, align = 'left', className = '' }: { title: string, sortKey: string, align?: 'left'|'center'|'right', className?: string }) => {
        const isActive = sortConfig.key === sortKey;
        const justifyCls = align === 'right' ? 'justify-end' : align === 'center' ? 'justify-center' : 'justify-start';
        return (
            <th className={cn(`py-2 font-bold cursor-pointer hover:text-foreground select-none group transition-colors`, className)} onClick={() => handleSort(sortKey)}>
                <div className={`flex items-center gap-1 ${justifyCls}`}>
                    {title}
                    <span className={cn('text-[10px]', isActive ? 'text-indigo-400' : 'text-transparent group-hover:text-muted-foreground/50')}>
                        {isActive && sortConfig.direction === 'desc' ? '▼' : '▲'}
                    </span>
                </div>
            </th>
        );
    }

    const handleShowSkill = async () => {
        setShowSkillModal(true);
        setSkillContent('문서를 불러오는 중입니다...');
        try {
            const allSkills = await window.electronAPI.skillsGetAll();
            const skillList = allSkills?.data || allSkills; // Handle both direct array or wrapped data depending on API
            const skill = Array.isArray(skillList) ? skillList.find((s: any) => s.name?.includes('Chart Risk') || s.name?.includes('차트 리스크') || (s.path && s.path.includes('chart_risk_analysis'))) : null;
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

            const histData = await (window.electronAPI as any).getPortfolioHistory()
            setHistory(Array.isArray(histData) ? histData : [])

            const picksData = await window.electronAPI.getAiPicks()
            setWatchlist(Array.isArray(picksData) ? picksData : [])

            const logsData = await (window.electronAPI as any).getAiRunLogs()
            if (Array.isArray(logsData) && logsData.length > 0) {
                setRunLog(logsData.reverse())
            }

            // P4: 인큐베이터 목록 로드
            const incResult = await (window.electronAPI as any).getIncubatorList()
            if (incResult?.success && Array.isArray(incResult.data)) {
                setIncubatorList(incResult.data)
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
            ; (window.electronAPI as any).saveAiRunLog(formatted)
    }

    const runAction = async (action: 'MOMENTUM' | 'FUNDAMENTAL' | 'MANAGER_P1' | 'MANAGER_P2' | 'MANAGER' | 'JUDGE') => {
        const labels: Record<string, string> = {
            MOMENTUM: '수급 AI (모멘텀)',
            FUNDAMENTAL: '리포트 AI (펀더멘털)',
            MANAGER_P1: 'PM 1차 (루키 오디션)',
            MANAGER_P2: 'PM 2차 (리밸런싱)',
            MANAGER: '포트폴리오 매니저',
            JUDGE: '장마감 채점',
        }
        setRunningAction(action)
        appendLog(`${labels[action]} 실행 시작...`)
        try {
            let result: any
            if (action === 'MOMENTUM') result = await window.electronAPI.runMomentumAnalyst()
            if (action === 'FUNDAMENTAL') result = await window.electronAPI.runFundamentalAnalyst()
            if (action === 'MANAGER_P1') result = await window.electronAPI.runPortfolioManagerPhase1()
            if (action === 'MANAGER_P2') result = await window.electronAPI.runPortfolioManagerPhase2()
            if (action === 'MANAGER') result = await window.electronAPI.runPortfolioManager()
            if (action === 'JUDGE') result = await window.electronAPI.runPortfolioJudge()

            if (result?.error) {
                appendLog(`❌ ${labels[action]} 실패: ${result.error}`)
            } else {
                const count = Array.isArray(result) ? result.length : (result?.success ? '완료' : '-')
                appendLog(`✅ ${labels[action]} 완료 → ${count}건 처리`)
                if (action === 'MANAGER' || action === 'MANAGER_P1' || action === 'MANAGER_P2' || action === 'JUDGE') fetchPortfolio()
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
                ? await (window.electronAPI as any).clearPortfolio()
                : await (window.electronAPI as any).clearAiPicks()
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

    const handleCleanupWatchlistPrices = async () => {
        setConfirmModal(null)
        appendLog(`🧹 관심종목 진입가·수익률 데이터 정합성 복구 중...`)
        try {
            const result = await (window.electronAPI as any).cleanupWatchlistPrices()
            if (!result?.success) {
                appendLog(`❌ 복구 실패: ${result?.error || '알 수 없는 오류'}`)
            } else {
                appendLog(`✅ 완료: ${result.fixed}개 관심종목의 진입가·수익률을 초기화했습니다.`)
                fetchPortfolio()
            }
        } catch (e: any) {
            appendLog(`❌ 오류: ${e.message}`)
        }
    }

    const [isRefreshingPrices, setIsRefreshingPrices] = useState(false)

    const handleRefreshHeldPrices = async () => {
        setIsRefreshingPrices(true)
        appendLog(`📡 보유 종목(HELD) 당일 현재가 수동 갱신 시작...`)
        try {
            const result = await (window.electronAPI as any).refreshHeldPrices()
            if (!result?.success) {
                appendLog(`❌ 갱신 실패: ${result?.error || result?.message || '알 수 없는 오류'}`)
            } else {
                appendLog(`✅ 갱신 완료: ${result.updated}개 성공, ${result.failed}개 실패`)
                // 성공한 종목 목록을 로그로 간략히 출력
                if (result.results && result.results.length > 0) {
                    const sample = result.results.slice(0, 3).map((r: any) => `${r.name}(${r.rate > 0 ? '+' : ''}${r.rate.toFixed(2)}%)`).join(', ');
                    const more = result.results.length > 3 ? ` 외 ${result.results.length - 3}개` : '';
                    appendLog(`  ↳ 갱신 내역: ${sample}${more}`);
                }
                fetchPortfolio()
            }
        } catch (e: any) {
            appendLog(`❌ 오류: ${e.message}`)
        } finally {
            setIsRefreshingPrices(false)
        }
    }

    // ── Derived stats ──
    const activeList = portfolio.filter(p => p.status !== 'DROPPED')

    // ── History Stats ──
    const aiStats = React.useMemo(() => {
        const stats: Record<string, { count: number, hit: number, sumReturn: number }> = {
            THEME: { count: 0, hit: 0, sumReturn: 0 },
            MOMENTUM: { count: 0, hit: 0, sumReturn: 0 },
            REPORT: { count: 0, hit: 0, sumReturn: 0 },
            UNKNOWN: { count: 0, hit: 0, sumReturn: 0 },
        };
        history.forEach(p => {
            let type = 'UNKNOWN';
            try {
                const tags = typeof p.analysts_json === 'string' ? JSON.parse(p.analysts_json) : (p.analysts_json || []);
                if (tags.includes('THEME')) type = 'THEME';
                else if (tags.includes('MOMENTUM')) type = 'MOMENTUM';
                else if (tags.includes('REPORT')) type = 'REPORT';
            } catch { }

            stats[type].count++;
            if (p.status === 'HIT') stats[type].hit++;
            const rt = Number(p.profit_rate);
            if (!isNaN(rt)) stats[type].sumReturn += rt;
        });
        return stats;
    }, [history]);

    // ── Filtered rows ──
    const SIGNAL_WEIGHT: Record<string, number> = {
        BUY: 10000,
        HELD: 7000,
        IMMEDIATE_BUY: 7000,
        WAIT_DIP: 5000,
        WATCHING: 4000,
        WATCHLIST: 4000,
        HOLD: 3000,
        SELL: 2000,
        DROP: 2000,
        HIT: -1000,
        DROPPED: -2000,
    }
    const getProfitRate = (p: any) => {
        const ep = p.entry_price || p.actual_entry_price || p.current_price;
        if (p.profit_rate != null) return Number(p.profit_rate);
        if (ep && p.current_price) return ((p.current_price - ep) / ep) * 100;
        return 0;
    };

    const getRemainingLifespan = (p: any) => {
        const daysHeld = p.days_held ?? 0;
        const lifespan = p.lifespan_days ?? 20;
        return lifespan - daysHeld;
    };

    const dynamicSort = (list: any[]) => {
        return list.sort((a, b) => {
            let valA: any = a[sortConfig.key];
            let valB: any = b[sortConfig.key];

            if (sortConfig.key === 'status') {
                const sigA = a.last_signal || a.status;
                const sigB = b.last_signal || b.status;
                valA = (SIGNAL_WEIGHT[sigA] || 0) + (a.conviction_score || 0);
                valB = (SIGNAL_WEIGHT[sigB] || 0) + (b.conviction_score || 0);
            } else if (sortConfig.key === 'profit') {
                valA = getProfitRate(a);
                valB = getProfitRate(b);
            } else if (sortConfig.key === 'lifespan') {
                valA = getRemainingLifespan(a);
                valB = getRemainingLifespan(b);
            } else if (sortConfig.key === 'created_at') {
                valA = new Date(a.entry_date || a.created_at || 0).getTime();
                valB = new Date(b.entry_date || b.created_at || 0).getTime();
            } else if (sortConfig.key === 'name') {
                valA = a.stock_name || '';
                valB = b.stock_name || '';
            } else if (sortConfig.key === 'strategy') {
                valA = a.strategy || '';
                valB = b.strategy || '';
            } else if (sortConfig.key === 'conviction') {
                valA = a.conviction_score || 0;
                valB = b.conviction_score || 0;
            }

            if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1;
            if (valA > valB) return sortConfig.direction === 'asc' ? 1 : -1;
            return 0;
        });
    };

    // 💰 매수 포지션: status === HELD + HIT/DROPPED 이력 (구 IMMEDIATE_BUY 포함)
    const buyRows = dynamicSort(portfolio.filter(p => {
        if (p.status !== 'HELD' && p.status !== 'IMMEDIATE_BUY') {
            return false;
        }

        if (filterStatus === 'ALL') return true;
        if (filterStatus === 'ACTIVE') return true;
        return p.last_signal === filterStatus || p.status === filterStatus;
    }))

    // 👀 관심종목: status === WATCHING (구 WATCHLIST 포함)
    const watchRows = dynamicSort(portfolio.filter(p => {
        return p.status === 'WATCHING' || p.status === 'WATCHLIST' || p.status === 'WAIT_DIP';
    }))

    const TABS = [
        { id: 'portfolio', label: '💰 매수 포지션' },
        { id: 'watchlist2', label: '👀 관심종목' },
        { id: 'picks', label: '⭐ 추천 종목' },
        { id: 'incubator', label: '🧪 인큐베이터' },
        { id: 'history', label: '🏆 성적표(History)' },
        { id: 'runner', label: '⚙ AI 수동실행' },
    ] as const

    const FILTERS = [
        { id: 'ALL', label: '전체' },
        { id: 'ACTIVE', label: '활성' },
        { id: 'BUY', label: '🔴 신규지시' },
        { id: 'HELD', label: '🟡 계속보유' },
    ]

    return (
        <div className="flex flex-col h-full overflow-hidden select-none">
            {/* ── Header ── */}
            <div className="shrink-0 px-4 py-3 border-b border-border/50 bg-muted/10">
                <div className="flex items-center justify-between mb-2.5">
                    <div className="flex items-center gap-2">
                        <Brain className="w-4 h-4 text-indigo-400" />
                        <span className="font-bold text-sm">AI 종목 매니저</span>
                        <span className="text-xs font-mono text-indigo-400/80 bg-indigo-500/10 border border-indigo-500/20 px-1.5 py-0.5 rounded">
                            {activeList.length} / 20
                        </span>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={handleRefreshHeldPrices}
                            disabled={isRefreshingPrices}
                            className={cn(
                                "flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded transition-colors font-semibold border",
                                isRefreshingPrices 
                                    ? "bg-muted text-muted-foreground border-transparent cursor-not-allowed" 
                                    : "bg-indigo-500/10 text-indigo-400 border-indigo-500/30 hover:bg-indigo-500/20"
                            )}
                        >
                            {isRefreshingPrices ? (
                                <>
                                    <div className="w-3 h-3 rounded-full border-2 border-indigo-400 border-t-transparent animate-spin" />
                                    갱신 중...
                                </>
                            ) : (
                                <>
                                    <Activity className="w-3.5 h-3.5" />
                                    보유종목 현재가 갱신
                                </>
                            )}
                        </button>
                        <button
                            onClick={fetchPortfolio}
                            className="text-xs text-muted-foreground hover:text-foreground px-2 py-1.5 rounded hover:bg-muted/30 transition-colors"
                        >
                            ⟳ 새로고침
                        </button>
                    </div>
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
                                <tr className="text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border/60">
                                    <SortableHeader title="상태" sortKey="status" className="pr-3 w-8" />
                                    <SortableHeader title="종목" sortKey="name" className="pr-4 w-36 min-w-[144px]" />
                                    <SortableHeader title="분류" sortKey="strategy" align="center" className="pr-4 w-16" />
                                    <SortableHeader title="시그널 / 매력도" sortKey="conviction" className="pr-4" />
                                    <th className="py-2 pr-4 font-bold text-center">추천 AI</th>
                                    <SortableHeader title="추가일" sortKey="created_at" align="center" className="pr-4" />
                                    <SortableHeader title="진입가 / 수익률" sortKey="profit" align="right" className="pr-4" />
                                    <SortableHeader title="수명" sortKey="lifespan" align="right" className="pr-4" />
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
                                    const signal = p.last_signal || p.status
                                    const ep = p.entry_price || p.actual_entry_price || p.current_price;
                                    let profitRate = p.profit_rate != null ? Number(p.profit_rate) : null;
                                    if (ep && p.current_price) {
                                        profitRate = ((p.current_price - ep) / ep) * 100;
                                    }

                                    // 고점 수익률 및 HIT 판단
                                    const highRate = (p.high_price && ep && p.high_price > ep) ? ((p.high_price - ep) / ep) * 100 : profitRate;
                                    const isMegaHit = highRate && highRate >= 30.0;
                                    const isHit = highRate && highRate >= 5.0;

                                    // 상태 아이콘 보정
                                    let statusIcon = STATUS_ICON[signal] || '⚪';
                                    if (p.status === 'DROPPED') statusIcon = '❌';
                                    else if (isMegaHit) statusIcon = '👑';
                                    else if (p.status === 'HIT' || isHit) statusIcon = '✅';

                                    // 수명 로직 보정
                                    const daysHeld = p.days_held ?? 0
                                    const lifespan = p.lifespan_days ?? 20
                                    const isDropped = p.status === 'DROPPED'

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
                                            <td className="py-2 pr-4 w-36 min-w-[144px]">
                                                <div className="font-semibold text-[13px] truncate max-w-[128px]" title={p.stock_name}>{p.stock_name}</div>
                                                <div className="text-[10px] font-mono text-muted-foreground">{p.stock_code}</div>
                                            </td>

                                            {/* 추천 AI 카테고리 (primary_category) */}
                                            <td className="py-2 pr-4 text-center">
                                                {(() => {
                                                    const cat = p.strategy || 'MOMENTUM';
                                                    if (cat === 'THEME') return (
                                                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-bold text-violet-400 bg-violet-500/10 border-violet-500/30 whitespace-nowrap">🎯 테마</span>
                                                    );
                                                    if (cat === 'MOMENTUM') return (
                                                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-bold text-rose-400 bg-rose-500/10 border-rose-500/30 whitespace-nowrap">🚀 모멘텀</span>
                                                    );
                                                    if (cat === 'PULLBACK') return (
                                                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-bold text-amber-400 bg-amber-500/10 border-amber-500/30 whitespace-nowrap">🔥 눌림목</span>
                                                    );
                                                    if (cat === 'REPORT') return (
                                                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-bold text-emerald-400 bg-emerald-500/10 border-emerald-500/30 whitespace-nowrap">📋 리포트</span>
                                                    );
                                                    return <span className="inline-flex items-center px-1.5 py-0.5 rounded border text-[9px] uppercase font-bold text-muted-foreground bg-muted/20 whitespace-nowrap">{cat}</span>;
                                                })()}
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

                                            {/* 포착/진입 시간 */}
                                            <td className="py-2 pr-4 text-center">
                                                <div className="font-mono">
                                                    <span className="text-xs text-muted-foreground">
                                                        {p.entry_date
                                                            ? p.entry_date.substring(5, 10).replace(/-/g, '.')
                                                            : p.created_at ? p.created_at.substring(5, 16).replace(/-/g, '.') : '-'}
                                                    </span>
                                                </div>
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

                                            {/* Arrow + Delete */}
                                            <td className="py-2">
                                                <div className="flex items-center gap-1.5">
                                                    <button
                                                        title="종목 삭제"
                                                        onClick={async (e) => {
                                                            e.stopPropagation();
                                                            if (!window.confirm(`'${p.stock_name}'을(를) 삭제하시겠습니까?\n\u26a0\ufe0f 이 작업은 되돌릴 수 없습니다.`)) return;
                                                            await (window.electronAPI as any).deletePortfolioItem(p.id);
                                                            fetchPortfolio();
                                                        }}
                                                        className="opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity text-muted-foreground hover:text-rose-400"
                                                    >
                                                        <Trash2 className="w-3.5 h-3.5" />
                                                    </button>
                                                    <ChevronRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-60 transition-opacity" />
                                                </div>
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
                                <tr className="text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border/60">
                                    <th className="py-2 pr-3 font-bold w-8">상태</th>
                                    <th className="py-2 pr-4 font-bold w-36 min-w-[144px]">종목</th>
                                    <th className="py-2 pr-4 font-bold text-center w-16">분류</th>
                                    <th className="py-2 pr-4 font-bold">시그널 / 매력도</th>
                                    <th className="py-2 pr-4 font-bold text-center">추천 AI</th>
                                    <th className="py-2 pr-4 font-bold text-center">추가일</th>
                                    <th className="py-2 w-6" />
                                </tr>
                            </thead>
                            <tbody>
                                {watchRows.length === 0 ? (
                                    <tr>
                                        <td colSpan={6} className="py-12 text-center text-muted-foreground text-xs">
                                            관심종목이 없습니다. 포트폴리오 매니저 AI를 실행하세요.
                                        </td>
                                    </tr>
                                ) : watchRows.map(p => {
                                    const signal = p.last_signal || p.status;
                                    return (
                                        <tr
                                            key={p.id || p.stock_code}
                                            onClick={() => setSelected(p)}
                                            className="border-b border-border/20 hover:bg-accent/30 cursor-pointer transition-colors group"
                                        >
                                            <td className="py-2 pr-3">
                                                {(() => {
                                                    const wl = WATCH_LABEL[signal];
                                                    return wl
                                                        ? <span className={cn('inline-flex items-center px-1.5 py-0.5 rounded border text-[10px] font-bold whitespace-nowrap', wl.cls)}>{wl.text}</span>
                                                        : <span className="text-base">{STATUS_ICON[signal] || '⚪'}</span>;
                                                })()}
                                            </td>
                                            <td className="py-2 pr-4 w-36 min-w-[144px]">
                                                <div className="font-semibold text-[13px] truncate max-w-[128px]" title={p.stock_name}>{p.stock_name}</div>
                                                <div className="text-[10px] font-mono text-muted-foreground">{p.stock_code}</div>
                                            </td>
                                            <td className="py-2 pr-4 text-center">
                                                {(() => {
                                                    const cat = p.strategy || 'MOMENTUM';
                                                    if (cat === 'THEME') return <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-bold text-violet-400 bg-violet-500/10 border-violet-500/30 whitespace-nowrap">🎯 테마</span>;
                                                    if (cat === 'MOMENTUM') return <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-bold text-rose-400 bg-rose-500/10 border-rose-500/30 whitespace-nowrap">🚀 모멘텀</span>;
                                                    if (cat === 'PULLBACK') return <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-bold text-amber-400 bg-amber-500/10 border-amber-500/30 whitespace-nowrap">🔥 눌림목</span>;
                                                    if (cat === 'REPORT') return <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-bold text-emerald-400 bg-emerald-500/10 border-emerald-500/30 whitespace-nowrap">📋 리포트</span>;
                                                    return <span className="inline-flex items-center px-1.5 py-0.5 rounded border text-[9px] uppercase font-bold text-muted-foreground bg-muted/20 whitespace-nowrap">{cat}</span>;
                                                })()}
                                            </td>
                                            <td className="py-2 pr-4">
                                                <ScoreBar score={p.conviction_score || 0} />
                                            </td>
                                            <td className="py-2 pr-4"><AnalystBadges json={p.analysts_json} /></td>
                                            <td className="py-2 pr-4 text-center">
                                                <div className="font-mono">
                                                    <span className="text-xs text-muted-foreground">
                                                        {p.entry_date
                                                            ? p.entry_date.substring(5, 10).replace(/-/g, '.')
                                                            : p.created_at ? p.created_at.substring(5, 16).replace(/-/g, '.') : '-'}
                                                    </span>
                                                </div>
                                            </td>
                                            <td className="py-2">
                                                <div className="flex items-center gap-1.5">
                                                    <button
                                                        title="관심종목 삭제"
                                                        onClick={async (e) => {
                                                            e.stopPropagation();
                                                            if (!window.confirm(`'${p.stock_name}'을(를) 관심종목에서 삭제하시겠습니까?`)) return;
                                                            await (window.electronAPI as any).deletePortfolioItem(p.id);
                                                            fetchPortfolio();
                                                        }}
                                                        className="opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity text-muted-foreground hover:text-rose-400"
                                                    >
                                                        <Trash2 className="w-3.5 h-3.5" />
                                                    </button>
                                                    <ChevronRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-60 transition-opacity" />
                                                </div>
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
                            <br />이 목록에서 포트폴리오 매니저 AI가 최종 종목을 선정합니다.
                        </div>
                    </div>
                    <div className="flex-1 overflow-auto px-4">
                        <table className="w-full text-sm text-left">
                            <thead className="sticky top-0 z-10 bg-background">
                                <tr className="text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border/60">
                                    <th className="py-2 pr-4 font-bold w-[72px]">추가일</th>
                                    <th className="py-2 pr-4 font-bold w-36 min-w-[144px]">종목</th>
                                    <th className="py-2 pr-4 font-bold">추천 AI</th>
                                    <th className="py-2 pr-4 font-bold text-right w-[72px]">매력도</th>
                                    <th className="py-2 pr-4 font-bold text-right w-[72px]">만기</th>
                                    <th className="py-2 pr-4 font-bold text-right w-[100px]">기준가 / 수익률</th>
                                    <th className="py-2 pr-4 font-bold text-center w-[72px]">결과</th>
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
                                ) : watchlist.slice().sort((a, b) => b.confidence - a.confidence).map(w => {
                                    // w.evaluation_status: PENDING | SUCCESS | HOLD | FAIL
                                    const evalStatus = w.evaluation_status || 'PENDING';
                                    const statusBadge = {
                                        'PENDING': <span className="px-2 py-1 flex items-center justify-center rounded bg-muted text-muted-foreground text-[10px] w-full">대기</span>,
                                        'SUCCESS': <span className="px-2 py-1 flex items-center justify-center rounded bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 text-[10px] font-bold w-full">✅ 적중</span>,
                                        'HOLD': <span className="px-2 py-1 flex items-center justify-center rounded bg-amber-500/10 text-amber-500 border border-amber-500/20 text-[10px] font-bold w-full">🟡 보류</span>,
                                        'FAIL': <span className="px-2 py-1 flex items-center justify-center rounded bg-rose-500/10 text-rose-500 border border-rose-500/20 text-[10px] font-bold w-full">❌ 실패</span>
                                    }[evalStatus as 'PENDING' | 'SUCCESS' | 'HOLD' | 'FAIL'];

                                    // 만기까지 남은 일수 계산
                                    const pickedDate = w.date ? new Date(w.date) : new Date();
                                    const diffDays = Math.ceil((Date.now() - pickedDate.getTime()) / 86400000);
                                    const remaining = (w.lifespan_days || 5) - diffDays;
                                    const lifespanText = w.evaluation_status !== 'PENDING'
                                        ? '채점완료'
                                        : remaining > 0 ? `D-${remaining}` : '만기';
                                    const lifespanColor = w.evaluation_status !== 'PENDING'
                                        ? 'text-muted-foreground/50'
                                        : remaining <= 0 ? 'text-amber-400 font-bold'
                                            : remaining <= 2 ? 'text-rose-400'
                                                : 'text-muted-foreground';

                                    return (
                                        <tr key={`${w.agent_type}-${w.stock_code}-${w.date}`} className="border-b border-border/20 hover:bg-accent/30">
                                            <td className="py-2 pr-4">
                                                <div className="flex flex-col font-mono">
                                                    <span className="text-[11px] text-muted-foreground">{w.date ? w.date.substring(5, 10).replace(/-/g, '.') : '-'}</span>
                                                </div>
                                            </td>
                                            <td className="py-2 pr-4 w-36 min-w-[144px]">
                                                <div className="font-semibold text-[13px] truncate max-w-[128px]" title={w.stock_name}>{w.stock_name}</div>
                                                <div className="text-[10px] font-mono text-muted-foreground">{w.stock_code}</div>
                                            </td>
                                            <td className="py-2 pr-4">
                                                <AnalystBadges json={JSON.stringify([w.agent_type])} />
                                            </td>
                                            <td className="py-2 pr-4 text-right">
                                                <div className="font-mono font-bold text-indigo-400 text-[13px]">{w.confidence || 0}점</div>
                                            </td>
                                            <td className="py-2 pr-4 text-right">
                                                <span className={cn('text-[11px] font-mono', lifespanColor)}>{lifespanText}</span>
                                            </td>
                                            <td className="py-2 pr-4 text-right">
                                                {w.entry_price ? (
                                                    <div className="flex flex-col items-end gap-0.5">
                                                        <span className="font-mono text-[11px] text-muted-foreground">{w.entry_price.toLocaleString()}원</span>
                                                        {w.max_profit_rate != null ? (
                                                            <span className={cn("font-mono text-[12px] font-bold", w.max_profit_rate >= 0 ? "text-rose-500" : "text-blue-500")}>
                                                                {w.max_profit_rate >= 0 ? '+' : ''}{w.max_profit_rate.toFixed(1)}%
                                                            </span>
                                                        ) : (
                                                            <span className="font-mono text-[11px] text-muted-foreground">─</span>
                                                        )}
                                                    </div>
                                                ) : (
                                                    <span className="text-[11px] text-muted-foreground">─</span>
                                                )}
                                            </td>
                                            <td className="py-2 pr-4 text-center">
                                                {statusBadge}
                                            </td>
                                            <td className="py-2 pl-4 text-[11px] text-muted-foreground whitespace-normal min-w-[280px] leading-relaxed">
                                                {w.reason || '-'}
                                            </td>
                                            <td className="py-2 pl-2">
                                                <button
                                                    title="이 추천 종목 삭제"
                                                    onClick={async (e) => {
                                                        e.stopPropagation();
                                                        if (!window.confirm(`'${w.stock_name}' 추천을 삭제하시겠습니까?`)) return;
                                                        await (window.electronAPI as any).deleteAnalystPick(w.id);
                                                        fetchPortfolio();
                                                    }}
                                                    className="opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity text-muted-foreground hover:text-rose-400"
                                                >
                                                    <Trash2 className="w-3.5 h-3.5" />
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* ── 🧪 인큐베이터 Tab (Pool B) ── */}
            {activeTab === 'incubator' && (
                <div className="flex flex-col flex-1 overflow-hidden">
                    {/* Header */}
                    <div className="shrink-0 px-4 py-2 border-b border-border/30 flex items-center gap-3">
                        <div className="flex-1 text-xs text-muted-foreground">
                            🧪 <span className="font-bold text-amber-400">Pool B — 인큐베이터</span>: 테마가 살아있으나 단기 소외된 종목 감시 풀입니다.
                            neglect_score 80+ 달성 시 IGNITE → PM AI 재심사 대상으로 자동 승격됩니다.
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="text-xs font-mono text-amber-400 font-bold">{incubatorList.length}종목 감시 중</span>
                            <button
                                onClick={async () => {
                                    setIncubatorScanRunning(true)
                                    appendLog('🧪 인큐베이터 스캔 시작...')
                                    try {
                                        const r = await (window.electronAPI as any).runIncubatorScan()
                                        if (r?.success) {
                                            appendLog('✅ 인큐베이터 스캔 완료 — neglect_score 갱신됨')
                                            await fetchPortfolio()
                                        } else {
                                            appendLog(`❌ 스캔 실패: ${r?.error}`)
                                        }
                                    } catch (e: any) {
                                        appendLog(`❌ 오류: ${e.message}`)
                                    } finally {
                                        setIncubatorScanRunning(false)
                                    }
                                }}
                                disabled={incubatorScanRunning}
                                className={cn(
                                    'text-xs px-2 py-1 rounded border transition-all',
                                    incubatorScanRunning
                                        ? 'bg-amber-500/10 border-amber-500/40 text-amber-400 animate-pulse'
                                        : 'bg-muted/20 border-border/40 hover:bg-amber-500/10 hover:border-amber-500/40 hover:text-amber-400'
                                )}
                            >
                                {incubatorScanRunning ? '⚙ 스캔 중...' : '⟳ 스캔 실행'}
                            </button>
                        </div>
                    </div>

                    {/* Table */}
                    <div className="flex-1 overflow-auto px-4">
                        <table className="w-full text-sm text-left whitespace-nowrap">
                            <thead className="sticky top-0 z-10 bg-background">
                                <tr className="text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border/60">
                                    <th className="py-2 pr-2 font-bold w-6">상태</th>
                                    <th className="py-2 pr-4 font-bold w-36 min-w-[144px]">종목</th>
                                    <th className="py-2 pr-4 font-bold text-center">추천 AI</th>
                                    <th className="py-2 pr-4 font-bold text-center w-28">방치 점수</th>
                                    <th className="py-2 pr-4 font-bold text-right">거래량 비율</th>
                                    <th className="py-2 pr-4 font-bold text-right">MA60 이격</th>
                                    <th className="py-2 pr-4 font-bold text-right">감시일</th>
                                    <th className="py-2 pr-4 font-bold text-right">강등횟수</th>
                                    <th className="py-2 pr-2 font-bold">액션</th>
                                </tr>
                            </thead>
                            <tbody>
                                {incubatorList.length === 0 ? (
                                    <tr>
                                        <td colSpan={9} className="py-16 text-center">
                                            <div className="flex flex-col items-center gap-3 text-muted-foreground">
                                                <span className="text-4xl">🧪</span>
                                                <div className="text-sm font-bold">인큐베이터가 비어 있습니다</div>
                                                <div className="text-xs max-w-xs text-center leading-relaxed">
                                                    장마감 채점(⚖) 실행 시 테마가 살아있는 DROPPED 종목이<br />
                                                    자동으로 이곳으로 이관됩니다.
                                                </div>
                                            </div>
                                        </td>
                                    </tr>
                                ) : incubatorList.map(inc => {
                                    const status = inc.status || 'WATCHING'
                                    const statusConf: Record<string, { label: string; cls: string; icon: string }> = {
                                        WATCHING: { label: '감시중', cls: 'text-blue-400 bg-blue-400/10 border-blue-400/30', icon: '👁' },
                                        READY_TO_IGNITE: { label: '🔥 IGNITE', cls: 'text-amber-400 bg-amber-400/10 border-amber-400/30', icon: '🔥' },
                                        GRADUATED: { label: '졸업', cls: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/30', icon: '✅' },
                                        DROPPED: { label: '탈락', cls: 'text-muted-foreground bg-muted/20 border-border/30', icon: '❌' },
                                    }
                                    const sc = statusConf[status] || statusConf['WATCHING']
                                    const score = inc.neglect_score || 0
                                    const scoreColor = score >= 80 ? 'bg-amber-400' : score >= 50 ? 'bg-indigo-400' : 'bg-muted-foreground/40'
                                    const volRatio = inc.volume_ratio ?? 1
                                    const ma60 = inc.ma60_disparity ?? 0

                                    const SOURCE_LABEL: Record<string, string> = {
                                        PORTFOLIO_DEMOTED: '포폴 강등',
                                        THEME_AI: '테마 AI',
                                        FUNDAMENTAL: '펀더멘털',
                                        MARKET_LEADER: '알파',
                                        MANUAL: '수동',
                                    }

                                    return (
                                        <tr
                                            key={inc.stock_code}
                                            className="border-b border-border/20 hover:bg-accent/20 transition-colors group"
                                        >
                                            <td className="py-2 pr-2">
                                                <span className="text-base">{sc.icon}</span>
                                            </td>
                                            <td className="py-2 pr-4 w-36 min-w-[144px]">
                                                <div className="font-semibold text-[13px] truncate max-w-[128px]" title={inc.stock_name}>{inc.stock_name}</div>
                                                <div className="text-[10px] font-mono text-muted-foreground">{inc.stock_code}</div>
                                            </td>
                                            <td className="py-2 pr-4 text-center">
                                                <span className="text-[10px] px-1.5 py-0.5 rounded border bg-muted/20 text-muted-foreground border-border font-bold">
                                                    {SOURCE_LABEL[inc.source] || inc.source}
                                                </span>
                                            </td>
                                            <td className="py-2 pr-4">
                                                <div className="flex items-center gap-2">
                                                    <span className={cn('text-xs font-mono font-bold w-7 text-right', score >= 80 ? 'text-amber-400' : score >= 50 ? 'text-indigo-400' : 'text-muted-foreground')}>{score}</span>
                                                    <div className="flex-1 h-1.5 bg-muted/40 rounded-full overflow-hidden">
                                                        <div className={cn('h-full rounded-full transition-all', scoreColor)} style={{ width: `${score}%` }} />
                                                    </div>
                                                    <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded border whitespace-nowrap', sc.cls)}>{sc.label}</span>
                                                </div>
                                                {inc.source_context && (
                                                    <div className="text-[10px] text-muted-foreground mt-1 truncate max-w-[200px]" title={inc.source_context}>
                                                        {inc.source_context}
                                                    </div>
                                                )}
                                            </td>
                                            <td className="py-2 pr-4 text-right">
                                                <span className={cn('font-mono text-xs', volRatio < 0.5 ? 'text-amber-400 font-bold' : 'text-muted-foreground')}>
                                                    {volRatio.toFixed(2)}x
                                                </span>
                                            </td>
                                            <td className="py-2 pr-4 text-right">
                                                <span className={cn('font-mono text-xs', ma60 >= -2 && ma60 <= 5 ? 'text-emerald-400 font-bold' : 'text-muted-foreground')}>
                                                    {ma60 > 0 ? '+' : ''}{ma60.toFixed(1)}%
                                                </span>
                                            </td>
                                            <td className="py-2 pr-4 text-right">
                                                <span className="font-mono text-xs text-muted-foreground">D+{inc.days_watched || 0}</span>
                                            </td>
                                            <td className="py-2 pr-4 text-right">
                                                {(inc.demotion_count || 0) > 0 ? (
                                                    <span className="font-mono text-xs text-rose-400">{inc.demotion_count}회</span>
                                                ) : (
                                                    <span className="font-mono text-xs text-muted-foreground">-</span>
                                                )}
                                            </td>
                                            <td className="py-2 pr-2">
                                                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                    {status === 'WATCHING' && (
                                                        <button
                                                            title="수동 IGNITE 승격"
                                                            onClick={async (e) => {
                                                                e.stopPropagation()
                                                                await (window.electronAPI as any).updateIncubatorStatus(inc.stock_code, 'READY_TO_IGNITE', '수동 IGNITE 승격')
                                                                fetchPortfolio()
                                                            }}
                                                            className="text-[10px] px-1.5 py-1 rounded border bg-amber-500/10 text-amber-400 border-amber-500/30 hover:bg-amber-500/20"
                                                        >🔥</button>
                                                    )}
                                                    <button
                                                        title="탈락 처리"
                                                        onClick={async (e) => {
                                                            e.stopPropagation()
                                                            await (window.electronAPI as any).updateIncubatorStatus(inc.stock_code, 'DROPPED', '수동 탈락 처리')
                                                            fetchPortfolio()
                                                        }}
                                                        className="text-[10px] px-1.5 py-1 rounded border bg-rose-500/10 text-rose-400 border-rose-500/30 hover:bg-rose-500/20"
                                                    >✕</button>
                                                    <button
                                                        title="인큐베이터에서 완전 삭제"
                                                        onClick={async (e) => {
                                                            e.stopPropagation();
                                                            if (!window.confirm(`'${inc.stock_name}'을(를) 인큐베이터에서 삭제하시겠습니까?`)) return;
                                                            await (window.electronAPI as any).deleteIncubatorItem(inc.stock_code);
                                                            fetchPortfolio();
                                                        }}
                                                        className="text-[10px] px-1.5 py-1 rounded border bg-muted/20 text-muted-foreground border-border hover:bg-rose-500/10 hover:text-rose-400 hover:border-rose-500/30"
                                                    >
                                                        <Trash2 className="w-3 h-3" />
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    )
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* ── 성적표(History) Tab ── */}
            {activeTab === 'history' && (
                <div className="flex flex-col flex-1 overflow-hidden">
                    {/* Stats Dashboard */}
                    <div className="shrink-0 p-4 border-b border-border/30 bg-muted/5">
                        <div className="flex items-center justify-between mb-3">
                            <div className="text-xs font-bold text-muted-foreground uppercase flex items-center gap-1.5">
                                <Activity className="w-3.5 h-3.5 text-indigo-400" /> 부서별 AI 누적 실적 (Win Rate &amp; Return)
                            </div>
                            <div className="flex items-center gap-2">
                                {retroReport && (
                                    <span className="text-[10px] text-muted-foreground/70">
                                        최근 분석: {retroReport.created_date || retroReport.created_at?.substring(0, 10)}
                                    </span>
                                )}
                                <button
                                    onClick={() => setShowRetroModal(true)}
                                    disabled={history.length < 5}
                                    title={history.length < 5 ? '성적표 항목이 5건 이상 필요합니다' : 'AI 매매 성적 분석 및 PM 개선안 보기'}
                                    className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-bold border transition-all bg-indigo-500/10 border-indigo-500/30 text-indigo-400 hover:bg-indigo-500/20 disabled:opacity-40 disabled:cursor-not-allowed"
                                >
                                    🧠 AI 분석
                                </button>
                            </div>
                        </div>
                        <div className="grid grid-cols-4 gap-3">
                            {[
                                { k: 'THEME', label: '테마 AI', icon: '🌊', color: 'text-indigo-400' },
                                { k: 'MOMENTUM', label: '수급/모멘텀 AI', icon: '📈', color: 'text-rose-400' },
                                { k: 'REPORT', label: '리포트 AI', icon: '📄', color: 'text-emerald-400' },
                                { k: 'ALL', label: '전체 요약', icon: '🏆', color: 'text-amber-400' },
                            ].map(({ k, label, icon, color }) => {
                                let total = 0, hits = 0, sums = 0;
                                if (k === 'ALL') {
                                    Object.values(aiStats).forEach(s => { total += s.count; hits += s.hit; sums += s.sumReturn; });
                                } else {
                                    total = aiStats[k].count; hits = aiStats[k].hit; sums = aiStats[k].sumReturn;
                                }
                                const winRate = total > 0 ? ((hits / total) * 100).toFixed(1) : '0.0';
                                const avgRet = total > 0 ? (sums / total).toFixed(2) : '0.00';
                                return (
                                    <div key={k} className="bg-background border border-border/50 rounded-lg p-3 flex flex-col gap-1.5 shadow-sm">
                                        <div className="text-xs font-bold text-muted-foreground">{icon} {label}</div>
                                        <div className="flex items-end justify-between">
                                            <div className="flex flex-col">
                                                <span className="text-[10px] text-muted-foreground/60 uppercase">승률</span>
                                                <span className={cn("text-lg font-bold font-mono", color)}>{winRate}%</span>
                                            </div>
                                            <div className="flex flex-col items-end">
                                                <span className="text-[10px] text-muted-foreground/60 uppercase">평균 수익</span>
                                                <span className={cn("font-bold font-mono text-sm", Number(avgRet) > 0 ? 'text-rose-500' : Number(avgRet) < 0 ? 'text-blue-500' : 'text-muted-foreground')}>
                                                    {Number(avgRet) > 0 ? '+' : ''}{avgRet}%
                                                </span>
                                            </div>
                                        </div>
                                        <div className="text-[10px] text-right font-mono text-muted-foreground px-1 bg-muted/20 border-t border-border/30 mt-1">총 {total}건 추천 / {hits}건 성공</div>
                                    </div>
                                )
                            })}
                        </div>
                    </div>

                    {/* Table */}
                    <div className="flex-1 overflow-auto px-4">
                        <table className="w-full text-sm text-left whitespace-nowrap">
                            <thead className="sticky top-0 z-10 bg-background">
                                <tr className="text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border/60">
                                    <th className="py-2 pr-3 font-bold w-16 text-center">결과</th>
                                    <th className="py-2 pr-4 font-bold w-36 min-w-[144px]">종목</th>
                                    <th className="py-2 pr-4 font-bold text-center w-[60px]">분류</th>
                                    <th className="py-2 pr-4 font-bold text-right w-[90px]">진입가</th>
                                    <th className="py-2 pr-4 font-bold text-right w-[90px]">청산가</th>
                                    <th className="py-2 pr-4 font-bold text-right">피크 수익률</th>
                                    <th className="py-2 pr-4 font-bold text-right">종료 수익률</th>
                                    <th className="py-2 pr-4 font-bold text-center w-[60px]">시작일</th>
                                    <th className="py-2 pr-4 font-bold text-center w-[60px]">종료일</th>
                                </tr>
                            </thead>
                            <tbody>
                                {history.length === 0 ? (
                                    <tr>
                                        <td colSpan={8} className="py-12 text-center text-muted-foreground text-xs">
                                            종료된 포트폴리오(성적) 내역이 없습니다.
                                        </td>
                                    </tr>
                                ) : history.map(p => {
                                    const prof = Number(p.profit_rate);
                                    let rateColor = 'text-muted-foreground';
                                    if (p.status === 'HIT') rateColor = 'text-emerald-500 font-bold';
                                    else if (prof > 0) rateColor = 'text-rose-500';
                                    else if (prof < 0) rateColor = 'text-blue-500';

                                    // 피크 수익률
                                    const peakProf = Number(p.peak_profit_rate ?? 0);
                                    const peakColor = peakProf > 0 ? 'text-amber-400' : peakProf < 0 ? 'text-blue-400' : 'text-muted-foreground';

                                    // 시작일: entry_date -> created_at 순 폴백
                                    let entryRaw = p.entry_date || p.created_at || '';
                                    if (entryRaw.includes('T')) entryRaw = entryRaw.split('T')[0];
                                    const displayEntryDate = entryRaw.length >= 10 ? entryRaw.substring(5, 10).replace(/-/g, '.') : entryRaw || '-';

                                    // 종료일: exit_date -> updated_at 폴백
                                    let closeRaw = p.exit_date || p.updated_at || '';
                                    if (closeRaw.includes('T')) closeRaw = closeRaw.split('T')[0];
                                    const displayCloseDate = closeRaw.length >= 10 ? closeRaw.substring(5, 10).replace(/-/g, '.') : closeRaw || '-';

                                    return (
                                        <tr
                                            key={p.id || p.stock_code}
                                            onClick={() => setSelected(p)}
                                            className="border-b border-border/20 hover:bg-accent/30 cursor-pointer transition-colors group"
                                        >
                                            <td className="py-2.5 pr-3 text-center">
                                                <span className={cn('text-[10px] px-2 py-0.5 rounded font-bold border', p.status === 'HIT' ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30' : 'bg-rose-500/10 text-rose-500 border-rose-500/30')}>
                                                    {p.status === 'HIT' ? 'HIT ✅' : 'DROP ❌'}
                                                </span>
                                            </td>
                                            {/* 종목 */}
                                            <td className="py-2 pr-4 w-36 min-w-[144px]">
                                                <div className="font-semibold text-[13px] truncate max-w-[128px]" title={p.stock_name}>{p.stock_name}</div>
                                                <div className="text-[10px] font-mono text-muted-foreground">{p.stock_code}</div>
                                            </td>
                                            {/* 분류 */}
                                            <td className="py-2 pr-4 text-center">
                                                {(() => {
                                                    const cat = p.strategy || 'MOMENTUM';
                                                    if (cat === 'THEME') return (
                                                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-bold text-violet-400 bg-violet-500/10 border-violet-500/30 whitespace-nowrap">🎯 테마</span>
                                                    );
                                                    if (cat === 'MOMENTUM') return (
                                                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-bold text-rose-400 bg-rose-500/10 border-rose-500/30 whitespace-nowrap">🚀 모멘텀</span>
                                                    );
                                                    if (cat === 'PULLBACK') return (
                                                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-bold text-amber-400 bg-amber-500/10 border-amber-500/30 whitespace-nowrap">🔥 눌림목</span>
                                                    );
                                                    if (cat === 'REPORT') return (
                                                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-bold text-emerald-400 bg-emerald-500/10 border-emerald-500/30 whitespace-nowrap">📋 리포트</span>
                                                    );
                                                    return <span className="inline-flex items-center px-1.5 py-0.5 rounded border text-[9px] uppercase font-bold text-muted-foreground bg-muted/20 whitespace-nowrap">{cat}</span>;
                                                })()}
                                            </td>
                                            {/* 진입가 */}
                                            <td className="py-2 pr-4 text-right">
                                                <div className="font-mono text-[12px] text-muted-foreground">
                                                    {p.entry_price ? p.entry_price.toLocaleString() : '─'}
                                                </div>
                                                <div className="text-[10px] text-muted-foreground/60">원</div>
                                            </td>
                                            {/* 청산가 */}
                                            <td className="py-2 pr-4 text-right">
                                                <div className="font-mono text-[12px] text-muted-foreground">
                                                    {p.exit_price ? p.exit_price.toLocaleString() : (p.current_price ? p.current_price.toLocaleString() : '─')}
                                                </div>
                                                <div className="text-[10px] text-muted-foreground/60">원</div>
                                            </td>
                                            {/* 피크 수익률 */}
                                            <td className="py-2 pr-4 text-right">
                                                {p.peak_profit_rate != null ? (
                                                    <span className={cn('text-xs font-bold font-mono', peakColor)}>
                                                        {peakProf > 0 ? '+' : ''}{peakProf.toFixed(2)}%
                                                    </span>
                                                ) : (
                                                    <span className="text-xs text-muted-foreground/50 font-mono">─</span>
                                                )}
                                            </td>
                                            {/* 종료 수익률 */}
                                            <td className="py-2 pr-4 text-right">
                                                <span className={cn("text-sm font-bold font-mono", rateColor)}>
                                                    {prof > 0 ? '+' : ''}{!isNaN(prof) ? prof.toFixed(2) : '-'}%
                                                </span>
                                            </td>
                                            {/* 시작일 */}
                                            <td className="py-2 pr-4 text-center font-mono text-xs text-muted-foreground">{displayEntryDate}</td>
                                            {/* 종료일 */}
                                            <td className="py-2 pr-4 text-center font-mono text-xs text-muted-foreground">{displayCloseDate}</td>
                                            <td className="py-2 pl-2">
                                                <button
                                                    title="성적 항목 삭제"
                                                    onClick={async (e) => {
                                                        e.stopPropagation();
                                                        if (!window.confirm(`'${p.stock_name}' 성적 항목을 삭제하시겠습니까?\n실제 매매는 영향없습니다.`)) return;
                                                        await (window.electronAPI as any).deleteTradeHistoryItem(p.trade_id || p.id);
                                                        fetchPortfolio();
                                                    }}
                                                    className="opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity text-muted-foreground hover:text-rose-400"
                                                >
                                                    <Trash2 className="w-3.5 h-3.5" />
                                                </button>
                                            </td>
                                        </tr>
                                    )
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* ══ PM 성적표 AI 분석 모달 ══ */}
            {showRetroModal && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
                    onClick={(e) => { if (e.target === e.currentTarget) setShowRetroModal(false) }}
                >
                    <div className="bg-background border border-border rounded-xl shadow-2xl w-[700px] max-h-[85vh] flex flex-col overflow-hidden">

                        {/* 모달 헤더 */}
                        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border/50 bg-muted/10 shrink-0">
                            <div className="flex items-center gap-2.5">
                                <span className="text-lg">🧠</span>
                                <div>
                                    <div className="font-bold text-sm">PM 성적 분석 &amp; 개선안</div>
                                    <div className="text-[10px] text-muted-foreground">매매 {history.length}건 기준 · AI 3-Step 자동 분석</div>
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                {retroReport && (
                                    <span className="text-[10px] text-muted-foreground bg-muted/30 px-2 py-0.5 rounded">
                                        마지막 분석: {retroReport.created_date || retroReport.created_at?.substring(0, 10)}
                                    </span>
                                )}
                                <button
                                    onClick={() => setShowRetroModal(false)}
                                    className="p-1.5 rounded hover:bg-muted/40 text-muted-foreground hover:text-foreground transition-colors text-sm"
                                >
                                    ✕
                                </button>
                            </div>
                        </div>

                        {/* 모달 툴바 */}
                        <div className="flex items-center gap-1 px-5 py-2.5 border-b border-border/30 bg-muted/5 shrink-0">
                            {(['summary', 'pm1', 'pm2', 'patterns'] as const).map(tab => (
                                <button
                                    key={tab}
                                    onClick={() => setRetroModalTab(tab)}
                                    className={cn(
                                        'px-3 py-1 text-xs font-bold rounded transition-colors',
                                        retroModalTab === tab
                                            ? 'bg-indigo-500/15 text-indigo-400 border border-indigo-500/30'
                                            : 'text-muted-foreground hover:bg-muted/30'
                                    )}
                                >
                                    {({ summary: '📊 통계 요약', pm1: '📌 PM1 개선안', pm2: '💼 PM2 개선안', patterns: '⚠️ 패턴 분석' } as Record<string, string>)[tab]}
                                </button>
                            ))}
                            <div className="ml-auto flex items-center gap-2">
                                {!retroReport && !retroRunning && (
                                    <button
                                        onClick={async () => {
                                            try {
                                                const report = await (window.electronAPI as any).getLatestPortfolioRetrospective()
                                                if (report) setRetroReport(report)
                                            } catch {}
                                        }}
                                        className="text-[10px] text-muted-foreground hover:text-foreground px-2 py-1 rounded border border-border/40"
                                    >
                                        이전 결과 불러오기
                                    </button>
                                )}
                                <button
                                    onClick={async () => {
                                        setRetroRunning(true)
                                        setRetroError(null)
                                        try {
                                            const res = await (window.electronAPI as any).runPortfolioRetrospective()
                                            if (res?.success) {
                                                const report = await (window.electronAPI as any).getLatestPortfolioRetrospective()
                                                setRetroReport(report)
                                                setRetroModalTab('summary')
                                            } else {
                                                setRetroError(res?.error || '분석 실패')
                                            }
                                        } catch (e: any) {
                                            setRetroError(e.message)
                                        } finally {
                                            setRetroRunning(false)
                                        }
                                    }}
                                    disabled={retroRunning}
                                    className="flex items-center gap-1.5 px-3 py-1 rounded text-xs font-bold border transition-all bg-indigo-500/10 border-indigo-500/30 text-indigo-400 hover:bg-indigo-500/20 disabled:opacity-50"
                                >
                                    {retroRunning
                                        ? <><span className="animate-spin inline-block w-3 h-3 border-2 border-indigo-400/30 border-t-indigo-400 rounded-full" /> 분석 중...</>
                                        : '🧠 AI 분석 실행'}
                                </button>
                            </div>
                        </div>

                        {/* 모달 콘텐츠 */}
                        <div className="flex-1 overflow-auto p-5">

                            {/* 로딩 */}
                            {retroRunning && (
                                <div className="flex flex-col items-center justify-center py-20 gap-4 text-muted-foreground">
                                    <div className="animate-spin w-10 h-10 border-2 border-indigo-400/30 border-t-indigo-400 rounded-full" />
                                    <div className="text-sm font-medium">AI가 매매 이력을 분석 중입니다...</div>
                                    <div className="text-xs text-muted-foreground/60">3단계 분석 실행, 약 1~2분 소요됩니다</div>
                                </div>
                            )}

                            {/* 에러 */}
                            {retroError && !retroRunning && (
                                <div className="flex items-start gap-2 text-rose-400 bg-rose-500/5 border border-rose-500/20 rounded-lg p-3 mb-4 text-xs">
                                    ⚠️ {retroError}
                                </div>
                            )}

                            {/* 초기 상태 */}
                            {!retroRunning && !retroReport && (
                                <div className="flex flex-col items-center justify-center py-20 gap-3 text-muted-foreground/50">
                                    <div className="text-5xl">🧠</div>
                                    <div className="text-sm font-medium">AI 분석을 실행하면 PM1/PM2 개선안이 생성됩니다</div>
                                    <div className="text-xs">현재 성적표 {history.length}건 기준 분석 (최소 5건 필요)</div>
                                </div>
                            )}

                            {/* 결과 */}
                            {!retroRunning && retroReport && (
                                <div>

                                    {/* ── 통계 요약 탭 ── */}
                                    {retroModalTab === 'summary' && (
                                        <div className="space-y-4">
                                            <div className="grid grid-cols-3 gap-3">
                                                {[
                                                    { label: '총 분석 건수', value: `${retroReport.total_trades}건`, color: 'text-foreground' },
                                                    { label: '승률', value: `${Number(retroReport.win_rate).toFixed(1)}%`, color: Number(retroReport.win_rate) >= 50 ? 'text-rose-500' : 'text-blue-500' },
                                                    { label: '평균 수익률', value: `${Number(retroReport.avg_return) > 0 ? '+' : ''}${Number(retroReport.avg_return).toFixed(2)}%`, color: Number(retroReport.avg_return) >= 0 ? 'text-rose-500' : 'text-blue-500' },
                                                ].map((item: any) => (
                                                    <div key={item.label} className="bg-muted/20 border border-border/50 rounded-lg p-4 text-center">
                                                        <div className="text-[10px] text-muted-foreground mb-1">{item.label}</div>
                                                        <div className={`font-bold font-mono text-2xl ${item.color}`}>{item.value}</div>
                                                    </div>
                                                ))}
                                            </div>

                                            {/* 성과 분포 */}
                                            {(() => {
                                                try {
                                                    const stats = JSON.parse(retroReport.aggregated_stats_json || '{}')
                                                    const dist = stats.outcome_distribution as Record<string, number>
                                                    if (!dist) return null
                                                    return (
                                                        <div className="bg-muted/10 border border-border/40 rounded-lg p-4">
                                                            <div className="text-xs font-bold text-muted-foreground uppercase mb-3">성과 분포</div>
                                                            <div className="grid grid-cols-5 gap-2 text-center">
                                                                {[
                                                                    { k: 'BIG_WIN', label: '크게 성공', color: 'text-rose-400 bg-rose-500/10 border-rose-500/20' },
                                                                    { k: 'SMALL_WIN', label: '소폭 성공', color: 'text-rose-300/70 bg-rose-500/5 border-rose-500/10' },
                                                                    { k: 'BREAKEVEN', label: '보합', color: 'text-muted-foreground bg-muted/20 border-border/30' },
                                                                    { k: 'SMALL_LOSS', label: '소폭 손실', color: 'text-blue-400 bg-blue-500/5 border-blue-500/10' },
                                                                    { k: 'BIG_LOSS', label: '크게 실패', color: 'text-blue-500 bg-blue-500/10 border-blue-500/20' },
                                                                ].map(({ k, label, color }) => (
                                                                    <div key={k} className={`rounded-lg p-2 border ${color}`}>
                                                                        <div className="font-bold font-mono text-xl">{dist[k] || 0}</div>
                                                                        <div className="text-[10px] mt-0.5">{label}</div>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    )
                                                } catch { return null }
                                            })()}

                                            {/* AI별 공헌 */}
                                            {(() => {
                                                try {
                                                    const stats = JSON.parse(retroReport.aggregated_stats_json || '{}')
                                                    const byA = stats.by_analyst as Record<string, any>
                                                    if (!byA || !Object.keys(byA).length) return null
                                                    return (
                                                        <div className="bg-muted/10 border border-border/40 rounded-lg p-4">
                                                            <div className="text-xs font-bold text-muted-foreground uppercase mb-3">피치 AI별 실적</div>
                                                            <div className="space-y-2">
                                                                {Object.entries(byA).map(([analyst, v]: [string, any]) => (
                                                                    <div key={analyst} className="flex items-center gap-3 text-xs">
                                                                        <span className="w-32 shrink-0 font-semibold text-indigo-300">{analyst}</span>
                                                                        <span className="text-muted-foreground">{v.count}건</span>
                                                                        <span className={v.win_rate >= 50 ? 'text-rose-400' : 'text-blue-400'}>승률 {Number(v.win_rate).toFixed(1)}%</span>
                                                                        <span className={`ml-auto ${Number(v.avg_return) >= 0 ? 'text-rose-400' : 'text-blue-400'}`}>평균 {Number(v.avg_return) > 0 ? '+' : ''}{Number(v.avg_return).toFixed(2)}%</span>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    )
                                                } catch { return null }
                                            })()}
                                        </div>
                                    )}

                                    {/* ── PM1 개선안 탭 ── */}
                                    {retroModalTab === 'pm1' && (() => {
                                        try {
                                            const pm1 = JSON.parse(retroReport.pm1_improvements_json || '[]')
                                            if (!pm1.length) return <div className="py-10 text-center text-xs text-muted-foreground">제안이 없습니다.</div>
                                            return (
                                                <div className="space-y-3">
                                                    <div className="text-xs text-muted-foreground mb-2">PM1 스크리닝 카테고리 선별 로직에 대한 AI 개선 제안</div>
                                                    {pm1.map((item: any, i: number) => (
                                                        <div key={i} className="bg-amber-500/5 border border-amber-500/20 rounded-lg p-4">
                                                            <div className="flex items-center gap-2 mb-2">
                                                                <span className={cn('text-[10px] px-2 py-0.5 rounded font-bold',
                                                                    item.priority === 'HIGH' ? 'bg-rose-500/20 text-rose-400' :
                                                                    item.priority === 'MEDIUM' ? 'bg-amber-500/20 text-amber-400' :
                                                                    'bg-muted/40 text-muted-foreground'
                                                                )}>{item.priority}</span>
                                                                <span className="text-xs font-bold text-amber-300">{item.target}</span>
                                                            </div>
                                                            <div className="text-xs text-muted-foreground mb-2"><span className="text-rose-400/80">문제: </span>{item.problem}</div>
                                                            <div className="text-xs text-foreground/80 bg-amber-500/5 border border-amber-500/15 rounded p-2.5"><span className="text-amber-400">개선: </span>{item.proposed_change}</div>
                                                            {item.expected_impact && <div className="text-[10px] text-emerald-400/70 mt-1.5">→ 기대 효과: {item.expected_impact}</div>}
                                                        </div>
                                                    ))}
                                                </div>
                                            )
                                        } catch { return <div className="py-10 text-center text-xs text-muted-foreground">데이터를 불러올 수 없습니다.</div> }
                                    })()}

                                    {/* ── PM2 개선안 탭 ── */}
                                    {retroModalTab === 'pm2' && (() => {
                                        try {
                                            const pm2 = JSON.parse(retroReport.pm2_improvements_json || '[]')
                                            const sell = (() => { try { return JSON.parse(retroReport.sell_improvements_json || '[]') } catch { return [] } })()
                                            return (
                                                <div className="space-y-5">
                                                    {pm2.length > 0 && (
                                                        <div className="space-y-3">
                                                            <div className="text-xs font-bold text-indigo-400 uppercase">PM2 프롬프트 개선안</div>
                                                            {pm2.map((item: any, i: number) => (
                                                                <div key={i} className="bg-indigo-500/5 border border-indigo-500/20 rounded-lg p-4">
                                                                    <div className="flex items-center gap-2 mb-2">
                                                                        <span className={cn('text-[10px] px-2 py-0.5 rounded font-bold',
                                                                            item.priority === 'HIGH' ? 'bg-rose-500/20 text-rose-400' :
                                                                            item.priority === 'MEDIUM' ? 'bg-amber-500/20 text-amber-400' :
                                                                            'bg-muted/40 text-muted-foreground'
                                                                        )}>{item.priority}</span>
                                                                        <span className="text-xs font-bold text-indigo-300">{item.target}</span>
                                                                    </div>
                                                                    <div className="text-xs text-muted-foreground mb-2"><span className="text-rose-400/80">문제: </span>{item.problem}</div>
                                                                    <div className="text-xs text-foreground/80 bg-indigo-500/5 border border-indigo-500/15 rounded p-2.5"><span className="text-indigo-400">추가할 지침: </span>{item.proposed_addition}</div>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    )}
                                                    {sell.length > 0 && (
                                                        <div className="space-y-3">
                                                            <div className="text-xs font-bold text-emerald-400 uppercase">매도 로직 개선안</div>
                                                            {sell.map((item: any, i: number) => (
                                                                <div key={i} className="bg-emerald-500/5 border border-emerald-500/20 rounded-lg p-4">
                                                                    <div className="flex items-center gap-2 mb-2">
                                                                        <span className={cn('text-[10px] px-2 py-0.5 rounded font-bold',
                                                                            item.priority === 'HIGH' ? 'bg-rose-500/20 text-rose-400' :
                                                                            item.priority === 'MEDIUM' ? 'bg-amber-500/20 text-amber-400' :
                                                                            'bg-muted/40 text-muted-foreground'
                                                                        )}>{item.priority}</span>
                                                                    </div>
                                                                    <div className="text-xs text-muted-foreground mb-2"><span className="text-rose-400/80">문제: </span>{item.problem}</div>
                                                                    <div className="text-xs text-foreground/80 bg-emerald-500/5 border border-emerald-500/15 rounded p-2.5"><span className="text-emerald-400">개선: </span>{item.proposed_change}</div>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    )}
                                                    {pm2.length === 0 && sell.length === 0 && (
                                                        <div className="py-10 text-center text-xs text-muted-foreground">제안이 없습니다.</div>
                                                    )}
                                                </div>
                                            )
                                        } catch { return <div className="py-10 text-center text-xs text-muted-foreground">데이터를 불러올 수 없습니다.</div> }
                                    })()}

                                    {/* ── 패턴 분석 탭 ── */}
                                    {retroModalTab === 'patterns' && (() => {
                                        try {
                                            const failures = JSON.parse(retroReport.failure_patterns_json || '[]')
                                            const successes = JSON.parse(retroReport.success_patterns_json || '[]')
                                            return (
                                                <div className="space-y-5">
                                                    {failures.length > 0 && (
                                                        <div className="space-y-2">
                                                            <div className="text-xs font-bold text-rose-400 uppercase">⚠️ 반복 실패 패턴</div>
                                                            {failures.map((item: any, i: number) => (
                                                                <div key={i} className="flex items-start gap-3 bg-rose-500/5 border border-rose-500/20 rounded-lg p-3.5">
                                                                    <span className={cn('shrink-0 text-[10px] px-1.5 py-0.5 rounded font-bold mt-0.5',
                                                                        item.severity === 'HIGH' ? 'bg-rose-500/30 text-rose-400' : 'bg-amber-500/20 text-amber-400'
                                                                    )}>{item.severity}</span>
                                                                    <div>
                                                                        <div className="text-xs font-bold text-rose-300 mb-1">{item.pattern_name} <span className="font-normal text-muted-foreground">({item.frequency})</span></div>
                                                                        <div className="text-xs text-muted-foreground">{item.description}</div>
                                                                    </div>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    )}
                                                    {successes.length > 0 && (
                                                        <div className="space-y-2">
                                                            <div className="text-xs font-bold text-emerald-400 uppercase">✅ 성공 패턴</div>
                                                            {successes.map((item: any, i: number) => (
                                                                <div key={i} className="flex items-start gap-3 bg-emerald-500/5 border border-emerald-500/20 rounded-lg p-3.5">
                                                                    <div>
                                                                        <div className="text-xs font-bold text-emerald-300 mb-1">{item.pattern_name} <span className="font-normal text-muted-foreground">({item.frequency})</span></div>
                                                                        <div className="text-xs text-muted-foreground">{item.description}</div>
                                                                    </div>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    )}
                                                    {failures.length === 0 && successes.length === 0 && (
                                                        <div className="py-10 text-center text-xs text-muted-foreground">패턴이 없습니다.</div>
                                                    )}
                                                </div>
                                            )
                                        } catch { return <div className="py-10 text-center text-xs text-muted-foreground">데이터를 불러올 수 없습니다.</div> }
                                    })()}

                                </div>
                            )}
                        </div>
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
                                    { id: 'MOMENTUM', icon: '📈', label: '1. 수급 AI 실행', sub: '급등주·거래대금 분석' },
                                    { id: 'FUNDAMENTAL', icon: '📄', label: '2. 리포트 AI 실행', sub: '증권사 리포트 분석' },
                                    { id: 'MANAGER_P1', icon: '🧑‍💼', label: '3-A. PM 1차 실행', sub: '루키 오디션 (관심종목)' },
                                    { id: 'MANAGER_P2', icon: '💼', label: '3-B. PM 2차 실행', sub: '본심사 및 리밸런싱' },
                                    { id: 'MANAGER', icon: '✅', label: '3-C. PM 1+2 전체', sub: '1차/2차 연속 실행' },
                                    { id: 'JUDGE', icon: '⚖️', label: '4. 장마감 채점', sub: '수익률 · 수명 심사' },
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
                            {/* ── 선택적 정합성 복구 (안전) ── */}
                            <button
                                onClick={() => setConfirmModal({ type: 'cleanup' })}
                                disabled={!!runningAction}
                                className="w-full flex items-start gap-3 p-3 mb-3 rounded-lg border text-left transition-all bg-indigo-500/5 border-indigo-500/20 hover:bg-indigo-500/10 hover:border-indigo-500/40 disabled:opacity-40"
                            >
                                <span className="text-xl leading-none">🧹</span>
                                <div>
                                    <div className="text-sm font-bold text-indigo-400">관심종목 진입가 정합성 복구 <span className="text-[10px] font-normal bg-indigo-500/20 px-1.5 py-0.5 rounded ml-1">안전</span></div>
                                    <div className="text-xs text-muted-foreground mt-0.5">WAIT_DIP / HOLD / WATCHLIST 종목에 잘못 기록된 entry_price·profit_rate만 0으로 초기화 (종목 삭제 아님)</div>
                                </div>
                            </button>
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
                                    { label: '수급 AI', time: '09:40', enabled: true },
                                    { label: '리포트 AI', time: '09:45', enabled: true },
                                    { label: '매니저 AI', time: '09:50', enabled: true },
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
            {selected && (
                <PortfolioStockModal
                    stock={selected}
                    watchlist={watchlist}
                    onClose={() => setSelected(null)}
                    onUpdateStockPrice={(code: string, price: number) => {
                        setPortfolio(prev => prev.map(p => {
                            if (p.stock_code === code) {
                                return { ...p, current_price: price };
                            }
                            return p;
                        }));
                    }}
                />
            )}

            {/* ── Confirm Modal ── */}
            {confirmModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center">
                    <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setConfirmModal(null)} />
                    <div className="relative bg-background border border-border rounded-xl p-6 w-80 shadow-2xl">
                        <div className="flex items-center gap-2 mb-3">
                            <AlertTriangle className={`w-5 h-5 ${confirmModal.type === 'cleanup' ? 'text-indigo-400' : 'text-rose-400'}`} />
                            <span className="font-bold text-sm">
                                {confirmModal.type === 'cleanup'
                                    ? '관심종목 진입가 정합성 복구'
                                    : `${confirmModal.type === 'portfolio' ? '포트폴리오' : '관심종목'} DB 초기화`}
                            </span>
                        </div>
                        <p className="text-xs text-muted-foreground mb-5 leading-relaxed">
                            {confirmModal.type === 'cleanup'
                                ? 'WAIT_DIP / HOLD / WATCHLIST 종목의 entry_price와 profit_rate를 0으로 초기화합니다. 종목 자체는 삭제되지 않습니다.'
                                : confirmModal.type === 'portfolio'
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
                                onClick={() => confirmModal.type === 'cleanup'
                                    ? handleCleanupWatchlistPrices()
                                    : handleClear(confirmModal.type as 'portfolio' | 'picks')}
                                className={`flex-1 px-3 py-2 rounded-lg text-white text-sm font-bold transition-colors ${confirmModal.type === 'cleanup'
                                        ? 'bg-indigo-500 hover:bg-indigo-600'
                                        : 'bg-rose-500 hover:bg-rose-600'
                                    }`}
                            >
                                {confirmModal.type === 'cleanup' ? '복구 실행' : '삭제 확인'}
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
