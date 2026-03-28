import React, { useState, useRef, useEffect, useCallback } from 'react'
import { Brain, X, ShieldAlert, Sparkles, Clock, Target, ArrowUpRight, ArrowDownRight, Minus, Activity, ChevronRight, Search, Settings } from 'lucide-react'
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)) }

// ── Layout persistence ──
const LAYOUT_KEY = 'market-agent-layout'
interface Layout { chartPct: number; topH: number }
const defaultLayout: Layout = { chartPct: 0.6, topH: 200 }
function loadLayout(): Layout { try { const r = localStorage.getItem(LAYOUT_KEY); return r ? JSON.parse(r) : defaultLayout } catch { return defaultLayout } }
function saveLayout(l: Layout) { localStorage.setItem(LAYOUT_KEY, JSON.stringify(l)) }

// ── Drag Handles ──
function DragH({ onDrag }: { onDrag: (dx: number) => void }) {
    const down = useCallback((e: React.MouseEvent) => {
        e.preventDefault(); let lx = e.clientX
        const mv = (ev: MouseEvent) => { onDrag(ev.clientX - lx); lx = ev.clientX }
        const up = () => { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); document.body.style.cursor = '' }
        document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up); document.body.style.cursor = 'col-resize'
    }, [onDrag])
    return <div onMouseDown={down} className="w-2 shrink-0 cursor-col-resize flex items-center justify-center group hover:bg-indigo-500/10 rounded transition-colors"><div className="w-[2px] h-8 bg-border/40 group-hover:bg-indigo-500/50 rounded-full transition-colors" /></div>
}

function DragV({ onDrag }: { onDrag: (dy: number) => void }) {
    const down = useCallback((e: React.MouseEvent) => {
        e.preventDefault(); let ly = e.clientY
        const mv = (ev: MouseEvent) => { onDrag(ev.clientY - ly); ly = ev.clientY }
        const up = () => { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); document.body.style.cursor = '' }
        document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up); document.body.style.cursor = 'row-resize'
    }, [onDrag])
    return <div onMouseDown={down} className="h-2 shrink-0 cursor-row-resize flex justify-center items-center group hover:bg-indigo-500/10 mx-4 rounded transition-colors"><div className="h-[2px] w-12 bg-border/40 group-hover:bg-indigo-500/50 rounded-full transition-colors" /></div>
}

import { ResponsiveContainer, ComposedChart, Line, XAxis, YAxis, Tooltip as RechartsTooltip, CartesianGrid, Area } from 'recharts'

// ── Chart ──
function PerformanceChart({ redrawKey, history }: { redrawKey: number, history: any[] }) {
    const [chartData, setChartData] = useState<any[]>([])

    useEffect(() => {
        const loadChart = async () => {
            try {
                const res = await window.electronAPI.getChartData({ stk_cd: '069500' });
                const d = res?.data || res;
                let pList = d?.stk_dt_pole_chart_qry || d?.output2 || d?.Body || d?.list || [];
                if (!Array.isArray(pList)) pList = [];
                pList = pList.slice(0, 30).reverse();

                // 1. 날짜와 가격 추출
                const mappedList = pList.map((item: any) => {
                    const dateStr = String(item.dt || item.stck_bsop_date || item.date || item.trd_dt);
                    const fmtDate = dateStr.length === 8 ? `${dateStr.substring(0, 4)}-${dateStr.substring(4, 6)}-${dateStr.substring(6, 8)}` : dateStr;
                    const curPrice = Math.abs(Number(item.cur_prc || item.clprc || item.close || 0));
                    return { fmtDate, curPrice };
                });

                // 2. 최초 예측일 탐색 및 비교 시작점(index) 결정
                let startIndex = 0;
                if (history && history.length > 0) {
                    const historyDates = history.map(h => h.date).sort();
                    const earliestDate = historyDates[0];
                    const foundIndex = mappedList.findIndex(m => m.fmtDate >= earliestDate);
                    // 시각적 흐름(기준선 100)을 명확히 주기 위해 예측시작일 직전 거래일을 100으로 시작 (가능할 경우)
                    if (foundIndex !== -1) {
                        startIndex = Math.max(0, foundIndex - 1);
                    }
                }

                const filteredList = mappedList.slice(startIndex);
                if (filteredList.length === 0) return;

                const basePrice = filteredList[0].curPrice || 1;
                let aBase = 100;
                const formattedData: any[] = [];

                for (let i = 0; i < filteredList.length; i++) {
                    const { fmtDate, curPrice } = filteredList[i];
                    
                    const kospiValue = 100 + ((curPrice - basePrice) / basePrice) * 100;

                    const matchedHistory = history.filter(h => h.date === fmtDate);
                    let dailyReturn = 0;
                    for (const mh of matchedHistory) {
                        if (mh && mh.t1_final !== null && mh.t1_final !== undefined) {
                            dailyReturn += mh.t1_final;
                        }
                    }
                    if (dailyReturn !== 0) {
                        aBase = aBase * (1 + dailyReturn / 100);
                    }
                    
                    formattedData.push({
                        date: fmtDate.substring(5), // MM-DD
                        fullDate: fmtDate,
                        kospi: Number(kospiValue.toFixed(2)),
                        agent: Number(aBase.toFixed(2))
                    });
                }

                setChartData(formattedData);
            } catch (err) {
                console.warn('Failed to fetch KODEX 200 chart', err);
            }
        }
        loadChart();
    }, [history, redrawKey])

    if (chartData.length === 0) {
        return <div className="w-full h-full flex items-center justify-center text-xs text-muted-foreground bg-muted/5 rounded animate-pulse">Loading Chart Data...</div>
    }

    const minV = Math.floor(Math.min(...chartData.map(d => Math.min(d.kospi, d.agent))) - 1);
    const maxV = Math.ceil(Math.max(...chartData.map(d => Math.max(d.kospi, d.agent))) + 1);
    const isDark = document.documentElement.classList.contains('dark');

    return (
        <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 5, right: 0, left: -25, bottom: 0 }}>
                <defs>
                    <linearGradient id="colorAgent" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={isDark ? '#818cf8' : '#4f46e5'} stopOpacity={0.3}/>
                        <stop offset="95%" stopColor={isDark ? '#818cf8' : '#4f46e5'} stopOpacity={0}/>
                    </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'} />
                <XAxis dataKey="date" tick={{fontSize: 10, fill: isDark ? '#94a3b8' : '#64748b'}} axisLine={false} tickLine={false} minTickGap={15} />
                <YAxis domain={[minV, maxV]} tick={{fontSize: 10, fill: isDark ? '#94a3b8' : '#64748b'}} axisLine={false} tickLine={false} tickFormatter={(val) => val.toFixed(1)} />
                <RechartsTooltip 
                    contentStyle={{ backgroundColor: isDark ? '#1e293b' : '#ffffff', borderColor: isDark ? '#334155' : '#e2e8f0', borderRadius: '6px', fontSize: '11px', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                    itemStyle={{ fontSize: '12px', fontWeight: 'bold' }}
                    labelStyle={{ color: isDark ? '#94a3b8' : '#64748b', marginBottom: '4px' }}
                    labelFormatter={(label, items) => items[0]?.payload?.fullDate || label}
                />
                <Line type="monotone" dataKey="kospi" name="KOSPI (KODEX 200)" stroke={isDark ? '#94a3b8' : '#64748b'} strokeWidth={1.5} strokeDasharray="4 4" dot={false} activeDot={{r: 4}} />
                <Area type="monotone" dataKey="agent" name="Agent (누적 수익)" stroke={isDark ? '#818cf8' : '#4f46e5'} strokeWidth={2} fillOpacity={1} fill="url(#colorAgent)" activeDot={{r: 4, strokeWidth: 0}} />
            </ComposedChart>
        </ResponsiveContainer>
    )
}

// ══════════════════════════════════════════
export default function MarketAgentTab() {
    const [selectedTrade, setSelectedTrade] = useState<any | null>(null)
    const [showKnowledgeBase, setShowKnowledgeBase] = useState(false)
    const [showSettings, setShowSettings] = useState(false)
    const [telegramEnabled, setTelegramEnabled] = useState(true)
    const [layout, setLayout] = useState<Layout>(loadLayout)
    const [chartRedraw, setChartRedraw] = useState(0)
    const [knowledgeTab, setKnowledgeTab] = useState<'RULES'|'WEEKLY'|'MONTHLY'>('RULES')
    const [retrospectives, setRetrospectives] = useState<any[]>([])
    const [isRetroRunning, setIsRetroRunning] = useState(false)
    const [autoWeeklyReview, setAutoWeeklyReview] = useState(true)
    const [autoMonthlyReview, setAutoMonthlyReview] = useState(true)

    const topRef = useRef<HTMLDivElement>(null)

    const loadRetrospectives = useCallback(async (type: 'WEEKLY'|'MONTHLY') => {
        try {
            const res = await window.electronAPI.getMarketRetrospectives(type, 10)
            if (res.success && res.data) setRetrospectives(res.data)
        } catch (e) {
            console.error('Failed to load retrospectives', e)
        }
    }, [])

    useEffect(() => {
        if (showKnowledgeBase) {
            if (knowledgeTab === 'WEEKLY' || knowledgeTab === 'MONTHLY') {
                loadRetrospectives(knowledgeTab)
            }
        }
    }, [showKnowledgeBase, knowledgeTab, loadRetrospectives])

    const handleRunRetrospective = async (type: 'WEEKLY'|'MONTHLY') => {
        setIsRetroRunning(true)
        try {
            await window.electronAPI.runMarketRetrospective(type)
            await loadRetrospectives(type)
        } finally {
            setIsRetroRunning(false)
        }
    }


    // Save layout on change (debounced via ref)
    const saveTimer = useRef<any>(null)
    const persistLayout = useCallback((next: Layout) => {
        setLayout(next)
        if (saveTimer.current) clearTimeout(saveTimer.current)
        saveTimer.current = setTimeout(() => saveLayout(next), 300)
    }, [])

    // Horizontal drag: chart ↔ report width ratio
    const onDragH = useCallback((dx: number) => {
        if (!topRef.current) return
        const containerW = topRef.current.clientWidth
        setLayout(prev => {
            const next = { ...prev, chartPct: Math.max(0.25, Math.min(0.85, prev.chartPct + dx / containerW)) }
            if (saveTimer.current) clearTimeout(saveTimer.current)
            saveTimer.current = setTimeout(() => saveLayout(next), 300)
            return next
        })
        setChartRedraw(p => p + 1)
    }, [])

    // Vertical drag: top section height
    const onDragV = useCallback((dy: number) => {
        setLayout(prev => {
            const next = { ...prev, topH: Math.max(100, Math.min(500, prev.topH + dy)) }
            if (saveTimer.current) clearTimeout(saveTimer.current)
            saveTimer.current = setTimeout(() => saveLayout(next), 300)
            return next
        })
        setChartRedraw(p => p + 1)
    }, [])

    const [history, setHistory] = useState<any[]>([])
    const [latest, setLatest] = useState<any | null>(null)
    const [stats, setStats] = useState({ total: 0, wins: 0, winRate: 0, totalReturn: 0 })
    const [activeRules, setActiveRules] = useState<string[]>([])
    const [isRunning, setIsRunning] = useState(false)
    const [decisionTab, setDecisionTab] = useState<'classic' | 'intraday'>('classic')
    const [intradayData, setIntradayData] = useState<any[]>([])
    const [selectedIntraday, setSelectedIntraday] = useState<any | null>(null)

    const fetchData = async () => {
        try {
            const [histRes, latRes, statRes, rulesRes, setRes] = await Promise.all([
                window.electronAPI.getMarketConditionHistory(30),
                window.electronAPI.getMarketConditionLatest(),
                window.electronAPI.getMarketConditionStats(),
                window.electronAPI.getMarketConditionRules(),
                window.electronAPI.getMarketConditionSettings()
            ])
            if (histRes.success && histRes.data) setHistory(histRes.data)
            if (latRes.success && latRes.data) setLatest(latRes.data)
            if (statRes.success && statRes.data) setStats(statRes.data)
            if (rulesRes.success && rulesRes.data) setActiveRules(rulesRes.data)
            if (setRes.success && setRes.data) {
                setTelegramEnabled(setRes.data.telegramEnabled !== false)
                setAutoWeeklyReview(setRes.data.autoWeeklyReview !== false)
                setAutoMonthlyReview(setRes.data.autoMonthlyReview !== false)
            }
        } catch(e) { console.error('Failed to fetch MCA data', e) }

        // 장중 예측 데이터 로드
        try {
            const intradayRes = await window.electronAPI.getIntradayPredictions()
            if (intradayRes?.success && intradayRes.data) setIntradayData(intradayRes.data)
        } catch(e) { console.error('Failed to fetch intraday data', e) }
    }

    useEffect(() => {
        fetchData()
        const unsubComplete = window.electronAPI.onMarketConditionComplete(() => {
            setIsRunning(false)
            fetchData()
        })
        const unsubPerf = window.electronAPI.onMarketConditionPerformanceUpdated(() => {
            fetchData() // Refresh chart / table when performance updates (like entry_price)
        })
        return () => {
            unsubComplete()
            unsubPerf()
        }
    }, [])

    const handleRunCycleA = async () => {
        setIsRunning(true)
        await window.electronAPI.runMarketConditionAgent('A')
    }

    const handleRunCycleB = async () => {
        setIsRunning(true)
        await window.electronAPI.runMarketConditionAgent('B')
    }

    const getPredictIcon = (p: string) => {
        if (p === '상승' || p === 'LONG') return <ArrowUpRight className="text-rose-500 w-3.5 h-3.5" />
        if (p === '하락' || p === 'SHORT') return <ArrowDownRight className="text-blue-500 w-3.5 h-3.5" />
        return <Minus className="text-muted-foreground w-3.5 h-3.5" />
    }
    const getPositionStyle = (pos: string) => {
        if (pos.includes('200')) return 'text-rose-500 bg-rose-500/10 border-rose-500/20'
        if (pos.includes('인버스')) return 'text-blue-500 bg-blue-500/10 border-blue-500/20'
        return 'text-muted-foreground bg-muted/50 border-border'
    }

    return (
        <div className="flex flex-col h-full bg-background overflow-hidden">
            {/* ── Header Row ── */}
            <div className="flex items-center justify-between px-4 py-2 border-b border-border/50">
                <div className="flex items-center gap-2">
                    <Sparkles className="text-indigo-400 w-4 h-4" />
                    <span className="text-sm font-bold tracking-tight">Market AI</span>
                    <span className="text-xs text-muted-foreground ml-1">KOSPI Directional Agent</span>
                </div>
                <div className="flex items-center gap-3 text-xs">
                    <div className="flex items-center gap-4 px-3 py-1 bg-muted/30 rounded border border-border/50">
                        <div><span className="text-muted-foreground uppercase font-bold mr-1.5">Win</span><span className="font-mono font-bold">{(stats.winRate * 100).toFixed(1)}%</span> <span className="opacity-50">({stats.wins}/{stats.total})</span></div>
                        <div className="w-px h-3 bg-border/60" />
                        <div><span className="text-muted-foreground uppercase font-bold mr-1.5">Return</span><span className={cn("font-mono font-bold", stats.totalReturn > 0 ? "text-rose-500" : stats.totalReturn < 0 ? "text-blue-500" : "")}>{stats.totalReturn > 0 ? '+' : ''}{stats.totalReturn.toFixed(2)}%</span></div>
                    </div>
                    <div className="flex items-center gap-1">
                        <button disabled={isRunning} onClick={handleRunCycleA} className="px-3 py-1 bg-rose-500/10 hover:bg-rose-500/20 text-rose-500 border border-rose-500/30 rounded text-xs font-bold transition-colors disabled:opacity-50">
                            Run A
                        </button>
                        <button disabled={isRunning} onClick={handleRunCycleB} className="px-3 py-1 bg-blue-500/10 hover:bg-blue-500/20 text-blue-500 border border-blue-500/30 rounded text-xs font-bold transition-colors disabled:opacity-50">
                            Run B
                        </button>
                        <button onClick={async () => { await window.electronAPI.runTracker(); await new Promise(r => setTimeout(r, 300)); await fetchData() }} className="px-3 py-1 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-500 border border-emerald-500/30 rounded text-xs font-bold transition-colors">
                            📊 Eval
                        </button>
                        <button onClick={async () => { await window.electronAPI.runIntradayPrediction('09:30'); await new Promise(r => setTimeout(r, 300)); await fetchData() }} className="px-2 py-1 bg-amber-500/10 hover:bg-amber-500/20 text-amber-500 border border-amber-500/30 rounded text-xs font-bold transition-colors">
                            ⚡
                        </button>
                    </div>
                        <button onClick={() => setShowKnowledgeBase(true)} className="flex items-center gap-1.5 px-3 py-1 bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/30 text-indigo-400 rounded text-xs font-semibold transition-colors">
                            <Brain className="w-3.5 h-3.5" /> Knowledge
                        </button>
                        <button onClick={() => setShowSettings(true)} className="flex flex-shrink-0 items-center justify-center w-7 h-7 bg-muted/30 hover:bg-muted/50 border border-border/50 text-muted-foreground rounded transition-colors ml-1">
                            <Settings className="w-4 h-4" />
                        </button>
                    </div>
            </div>

            {/* ── Top: Chart + Report (horizontally draggable) ── */}
            <div ref={topRef} className="flex px-4 pt-3" style={{ height: layout.topH }}>
                {/* Left: Chart */}
                <div className="flex flex-col min-w-0 overflow-hidden" style={{ width: `${layout.chartPct * 100}%` }}>
                    <div className="flex items-center gap-4 mb-1.5">
                        <span className="text-xs text-muted-foreground uppercase font-bold tracking-wider">Cumulative Performance (30D)</span>
                        <div className="flex items-center gap-3 text-xs ml-auto">
                            <div className="flex items-center gap-1.5"><div className="w-5 h-0 border-t-[1.5px] border-dashed border-slate-400/50" /><span className="text-muted-foreground">KOSPI</span></div>
                            <div className="flex items-center gap-1.5"><div className="w-5 h-[2px] bg-indigo-500 rounded" /><span className="text-indigo-400 font-bold">Agent</span></div>
                        </div>
                    </div>
                    <div className="flex-1 min-h-0">
                        <PerformanceChart redrawKey={chartRedraw} history={history} />
                    </div>
                </div>

                {/* Horizontal Drag Handle */}
                <DragH onDrag={onDragH} />

                {/* Right: Latest Report */}
                <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
                    <div className="flex items-center gap-2 mb-1.5">
                        <span className="text-xs text-muted-foreground uppercase font-bold tracking-wider">Latest Report</span>
                        <span className="text-xs text-muted-foreground opacity-50 ml-auto">{latest ? `${latest.date} · Cycle ${latest.cycle === 'A' ? '장전(A)' : '마감(B)'}` : 'No Data'}</span>
                    </div>
                    {latest ? (
                    <div className="flex-1 min-h-0 overflow-y-auto p-3 bg-muted/20 border border-border/40 rounded-lg text-sm leading-relaxed space-y-2">
                        <div className="flex items-center gap-2 flex-wrap">
                            <span className={cn("px-1.5 py-0.5 rounded border text-xs font-bold", getPositionStyle(latest.position || ''))}>
                                {getPredictIcon(latest.predict === 'LONG' ? '상승' : latest.predict === 'SHORT' ? '하락' : '대기')}
                                {latest.position || latest.predict} {latest.predict !== 'HOLD' && '매수'}
                            </span>
                            <span className="text-xs text-muted-foreground ml-auto font-mono">신뢰도 {((latest.confidence || 0) * 100).toFixed(0)}%</span>
                            {/* 단기/중장기 프로젝션 표시 */}
                            {(latest.t5_predict || latest.t1_target_return) && (
                                <div className="w-full flex items-center gap-2 mt-1 mb-0.5 whitespace-nowrap overflow-x-auto">
                                    <span className="text-[10px] uppercase font-bold text-muted-foreground">T+1 목표</span>
                                    <span className={cn("text-[11px] font-bold", latest.predict === 'LONG' ? 'text-rose-500' : latest.predict === 'SHORT' ? 'text-blue-500' : 'text-slate-400')}>{latest.t1_target_return ? `${latest.t1_target_return>0?'+':''}${latest.t1_target_return}%` : '-'}</span>
                                    <div className="w-px h-3 bg-border/50 mx-0.5" />
                                    <span className="text-[10px] uppercase font-bold text-muted-foreground">T+5 목표</span>
                                    <span className={cn("text-[11px] font-bold", latest.t5_predict === 'LONG' ? 'text-rose-500' : latest.t5_predict === 'SHORT' ? 'text-blue-500' : 'text-slate-400')}>{latest.t5_target_return ? `${latest.t5_target_return>0?'+':''}${latest.t5_target_return}%` : '-'}</span>
                                    <div className="w-px h-3 bg-border/50 mx-0.5" />
                                    <span className="text-[10px] uppercase font-bold text-muted-foreground">T+20 목표</span>
                                    <span className={cn("text-[11px] font-bold", latest.t20_predict === 'LONG' ? 'text-rose-500' : latest.t20_predict === 'SHORT' ? 'text-blue-500' : 'text-slate-400')}>{latest.t20_target_return ? `${latest.t20_target_return>0?'+':''}${latest.t20_target_return}%` : '-'}</span>
                                </div>
                            )}
                        </div>
                        <div className="border-b border-border/30" />
                        <div className="text-sm text-foreground/90 leading-relaxed max-w-none prose prose-sm dark:prose-invert">
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>{latest.rationale}</ReactMarkdown>
                        </div>
                        <div className="flex flex-wrap gap-1 pt-1">
                            {latest.indicators_json && (() => {
                                try {
                                    const inds = JSON.parse(latest.indicators_json);
                                    return inds.map((ind: string, i: number) => (
                                        <span key={i} className="px-1.5 py-0.5 bg-indigo-500/10 border border-indigo-500/20 rounded text-xs text-indigo-400">{ind}</span>
                                    ));
                                } catch { return null; }
                            })()}
                        </div>
                    </div>
                    ) : (
                        <div className="flex-1 flex items-center justify-center border border-border/40 rounded-lg text-sm text-muted-foreground bg-muted/20">
                            {isRunning ? 'AI 판단 중...' : '보고서가 없습니다.'}
                        </div>
                    )}
                </div>
            </div>

            {/* Vertical Drag Handle (top ↔ table) */}
            <DragV onDrag={onDragV} />

            {/* ── Decision Log Table (with Tab) ── */}
            <div className="flex-1 flex flex-col overflow-hidden select-none">
                <div className="flex items-center justify-between px-4 py-2">
                    {/* Tab Switcher */}
                    <div className="flex items-center gap-1 bg-muted/30 rounded p-0.5">
                        <button
                            onClick={() => setDecisionTab('classic')}
                            className={cn(
                                "px-3 py-1 text-xs font-bold rounded transition-colors",
                                decisionTab === 'classic'
                                    ? "bg-background text-foreground shadow-sm"
                                    : "text-muted-foreground hover:text-foreground"
                            )}
                        >
                            📊 장전·마감 예측
                        </button>
                        <button
                            onClick={() => setDecisionTab('intraday')}
                            className={cn(
                                "px-3 py-1 text-xs font-bold rounded transition-colors",
                                decisionTab === 'intraday'
                                    ? "bg-background text-foreground shadow-sm"
                                    : "text-muted-foreground hover:text-foreground"
                            )}
                        >
                            ⚡ 장중 타이밍
                        </button>
                    </div>
                    <span className="text-xs text-muted-foreground opacity-60">Click row for details</span>
                </div>
                <div className="flex-1 overflow-auto px-4">
                    {decisionTab === 'classic' ? (
                    <table className="w-full text-sm text-left whitespace-nowrap">
                        <thead className="sticky top-0 z-10 bg-background">
                            <tr className="text-xs uppercase text-muted-foreground border-b border-border/60">
                                <th className="py-2 pr-4 font-bold">Date</th>
                                <th className="py-2 pr-4 font-bold text-center w-16">Cycle</th>
                                <th className="py-2 pr-4 font-bold">Position</th>
                                <th className="py-2 pr-4 font-bold text-right">T+1 Peak</th>
                                <th className="py-2 pr-4 font-bold text-right">T+1</th>
                                <th className="py-2 pr-4 font-bold text-right">T+5 Peak</th>
                                <th className="py-2 pr-4 font-bold text-right">T+5</th>
                                <th className="py-2 pr-4 font-bold text-right">T+20 Peak</th>
                                <th className="py-2 pr-4 font-bold text-right">T+20</th>
                                <th className="py-2 font-bold">Indicators</th>
                                <th className="py-2 w-8"></th>
                            </tr>
                        </thead>
                        <tbody>
                            {history.map((t) => (
                                <tr key={t.id} onClick={() => setSelectedTrade(t)} className="border-b border-border/20 hover:bg-accent/30 cursor-pointer transition-colors group">
                                    <td className="py-2 pr-4 font-mono text-muted-foreground">{t.date}</td>
                                    <td className="py-2 pr-4 text-center text-xs font-medium">{t.cycle === 'A' ? '장전(A)' : '마감(B)'}</td>
                                    <td className="py-2 pr-4">
                                        <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded border text-xs font-bold", getPositionStyle(t.position || ''))}>
                                            {getPredictIcon(t.predict)} {t.position || (t.predict === 'LONG' ? '상승' : t.predict === 'SHORT' ? '하락' : '대기')}
                                        </span>
                                    </td>
                                    <td className="py-2 pr-4 font-mono text-right opacity-60">
                                        {t.t1_peak === null ? '-' : `${t.t1_peak > 0 ? '+' : ''}${t.t1_peak?.toFixed(1)}%`}
                                    </td>
                                    <td className="py-2 pr-4 font-mono text-right font-bold">
                                        {t.t1_final === null ? <span className="text-xs text-indigo-400 animate-pulse">⏳</span> : (
                                            <span className={t.t1_final > 0 ? "text-rose-500" : "text-blue-500"}>{t.t1_final > 0 ? '+' : ''}{t.t1_final?.toFixed(2)}%</span>
                                        )}
                                    </td>
                                    <td className="py-2 pr-4 font-mono text-right opacity-60">
                                        {t.t5_peak === null ? '-' : `${t.t5_peak > 0 ? '+' : ''}${t.t5_peak?.toFixed(1)}%`}
                                    </td>
                                    <td className="py-2 pr-4 font-mono text-right font-bold">
                                        {t.t5_final === null ? '-' : <span className={t.t5_final > 0 ? "text-rose-500" : "text-blue-500"}>{t.t5_final > 0 ? '+' : ''}{t.t5_final?.toFixed(1)}%</span>}
                                    </td>
                                    <td className="py-2 pr-4 font-mono text-right opacity-60">
                                        {t.t20_peak === null ? '-' : `${t.t20_peak > 0 ? '+' : ''}${t.t20_peak?.toFixed(1)}%`}
                                    </td>
                                    <td className="py-2 pr-4 font-mono text-right font-bold">
                                        {t.t20_final === null ? '-' : <span className={t.t20_final > 0 ? "text-rose-500" : "text-blue-500"}>{t.t20_final > 0 ? '+' : ''}{t.t20_final?.toFixed(1)}%</span>}
                                    </td>
                                    <td className="py-2">
                                        <div className="flex gap-1 overflow-hidden" style={{ maxWidth: 150 }}>
                                            {(()=>{
                                                try {
                                                    const inds = JSON.parse(t.indicators_json || '[]');
                                                    return inds.map((ind: string, i: number) => <span key={i} className="px-1.5 py-0.5 bg-muted/50 border border-border/40 rounded text-xs text-muted-foreground whitespace-nowrap">{ind}</span>);
                                                } catch { return null; }
                                            })()}
                                        </div>
                                    </td>
                                    <td className="py-2"><ChevronRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-60 transition-opacity" /></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    ) : (
                    /* ── 장중 인트라데이 예측 테이블 (장전·마감과 동일 형식) ── */
                    <table className="w-full text-sm text-left whitespace-nowrap">
                        <thead className="sticky top-0 z-10 bg-background">
                            <tr className="text-xs uppercase text-muted-foreground border-b border-border/60">
                                <th className="py-2 pr-4 font-bold">Date</th>
                                <th className="py-2 pr-4 font-bold text-center">Time</th>
                                <th className="py-2 pr-4 font-bold">Position</th>
                                <th className="py-2 pr-4 font-bold text-right">Entry Price</th>
                                <th className="py-2 pr-4 font-bold text-right">Return</th>
                                <th className="py-2 pr-4 font-bold text-center">Result</th>
                                <th className="py-2 pr-4 font-bold">Confidence</th>
                                <th className="py-2"></th>
                            </tr>
                        </thead>
                        <tbody>
                            {intradayData.length === 0 ? (
                                <tr><td colSpan={8} className="py-8 text-center text-muted-foreground text-xs">장중 예측 데이터가 없습니다. (09:30, 11:00, 13:00 자동 실행)</td></tr>
                            ) : intradayData.map((row) => {
                                const posLabel = row.position || (row.predict === 'UP' ? 'KODEX 200' : row.predict === 'DOWN' ? 'KODEX 인버스' : 'HOLD')
                                const posStyle = posLabel.includes('200')
                                    ? 'text-rose-500 bg-rose-500/10 border-rose-500/20'
                                    : posLabel.includes('인버스')
                                    ? 'text-blue-500 bg-blue-500/10 border-blue-500/20'
                                    : 'text-muted-foreground bg-muted/50 border-border'
                                const posIcon = posLabel.includes('200') ? '↗' : posLabel.includes('인버스') ? '↘' : '—'
                                const returnVal = row.return_pct
                                const resultBadge = row.result === 'HIT'
                                    ? <span className="px-2 py-0.5 bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 rounded text-xs font-bold">✅ HIT</span>
                                    : row.result === 'MISS'
                                    ? <span className="px-2 py-0.5 bg-rose-500/10 border border-rose-500/20 text-rose-500 rounded text-xs font-bold">❌ MISS</span>
                                    : row.result === 'HOLD'
                                    ? <span className="px-2 py-0.5 bg-muted/50 border border-border text-muted-foreground rounded text-xs font-bold">— HOLD</span>
                                    : <span className="text-xs text-indigo-400 animate-pulse">⏳</span>
                                return (
                                    <tr key={row.id} onClick={() => setSelectedIntraday(row)} className="border-b border-border/20 hover:bg-accent/30 cursor-pointer transition-colors group">
                                        <td className="py-2 pr-4 font-mono text-muted-foreground">{row.date}</td>
                                        <td className="py-2 pr-4 text-center font-mono text-xs font-bold">{row.time_slot}</td>
                                        <td className="py-2 pr-4">
                                            <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded border text-xs font-bold', posStyle)}>
                                                {posIcon} {posLabel}
                                            </span>
                                        </td>
                                        <td className="py-2 pr-4 font-mono text-right text-muted-foreground">{row.entry_price ? row.entry_price.toLocaleString() : '-'}</td>
                                        <td className={cn("py-2 pr-4 font-mono text-right font-bold", returnVal > 0 ? "text-rose-500" : returnVal < 0 ? "text-blue-500" : "")}>
                                            {returnVal != null ? `${returnVal > 0 ? '+' : ''}${Number(returnVal).toFixed(2)}%` : '⏳'}
                                        </td>
                                        <td className="py-2 pr-4 text-center">{resultBadge}</td>
                                        <td className="py-2 pr-4 font-mono text-xs text-muted-foreground">{row.confidence ?? '-'}%</td>
                                        <td className="py-2"><ChevronRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-60 transition-opacity" /></td>
                                    </tr>
                                )
                            })}
                        </tbody>
                    </table>
                    )}
                </div>
            </div>

            {/* ── Modal: Trade Detail ── */}
            {selectedTrade && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setSelectedTrade(null)} />
                    <div className="relative bg-background border border-border/50 rounded-xl w-full max-w-2xl shadow-2xl flex flex-col max-h-[80vh] ring-1 ring-white/5 animate-in zoom-in-95 duration-150">
                        <div className="flex justify-between items-center px-4 py-3 border-b border-border/40 bg-muted/30 rounded-t-xl">
                            <div className="flex items-center gap-2">
                                <Search className="w-4 h-4 text-indigo-400" />
                                <span className="text-sm font-bold">Trade Intel</span>
                                <span className="text-xs text-muted-foreground px-2 py-0.5 bg-background rounded border border-border/50">{selectedTrade.date} · {selectedTrade.id}</span>
                            </div>
                            <button onClick={() => setSelectedTrade(null)} className="p-1 hover:bg-muted rounded text-muted-foreground"><X className="w-4 h-4" /></button>
                        </div>
                        <div className="p-5 overflow-y-auto space-y-4">
                            <div className="flex gap-4 p-3 bg-muted/20 rounded-lg border border-border/40 text-sm">
                                <div className="flex-1">
                                    <div className="text-xs text-muted-foreground uppercase font-bold mb-1">Position</div>
                                    <span className={cn("inline-flex px-2 py-0.5 rounded font-bold border text-xs", getPositionStyle(selectedTrade.position || ''))}>{selectedTrade.position || selectedTrade.predict} ({selectedTrade.predict === 'LONG' ? '상승' : selectedTrade.predict === 'SHORT' ? '하락' : '대기'})</span>
                                </div>
                                <div className="w-px bg-border/40" />
                                <div><div className="text-xs text-muted-foreground uppercase font-bold mb-1">Entry Price</div><div className="font-mono">{selectedTrade.entry_price ? selectedTrade.entry_price.toLocaleString() : '-'}</div></div>
                                <div className="w-px bg-border/40" />
                                <div><div className="text-xs text-muted-foreground uppercase font-bold mb-1">T+1 Peak</div><div className="font-mono">{selectedTrade.t1_peak === null ? '-' : `${Number(selectedTrade.t1_peak).toFixed(2)}%`}</div></div>
                                <div className="w-px bg-border/40" />
                                <div><div className="text-xs text-muted-foreground uppercase font-bold mb-1">T+1 Final</div><div className="font-mono font-bold">{selectedTrade.t1_final === null ? 'Running' : `${Number(selectedTrade.t1_final).toFixed(2)}%`}</div></div>
                                {selectedTrade.t5_final !== null && (<><div className="w-px bg-border/40" /><div><div className="text-xs text-muted-foreground uppercase font-bold mb-1">T+5</div><div className="font-mono"><span className="opacity-50">{selectedTrade.t5_peak > 0 ? '+' : ''}{Number(selectedTrade.t5_peak).toFixed(2)}%</span> / <span className="font-bold">{selectedTrade.t5_final > 0 ? '+' : ''}{Number(selectedTrade.t5_final).toFixed(2)}%</span></div></div></>)}
                                {selectedTrade.t20_final !== null && (<><div className="w-px bg-border/40" /><div><div className="text-xs text-muted-foreground uppercase font-bold mb-1">T+20</div><div className="font-mono"><span className="opacity-50">{selectedTrade.t20_peak > 0 ? '+' : ''}{Number(selectedTrade.t20_peak).toFixed(2)}%</span> / <span className="font-bold">{selectedTrade.t20_final > 0 ? '+' : ''}{Number(selectedTrade.t20_final).toFixed(2)}%</span></div></div></>)}
                            </div>
                            <div>
                                <div className="text-xs font-bold text-muted-foreground uppercase mb-1.5 flex items-center gap-1.5"><Brain className="w-3.5 h-3.5" /> Rationale</div>
                                <div className="p-3 bg-primary/5 border border-primary/10 rounded-lg text-sm text-foreground/90 leading-relaxed max-w-none prose prose-sm dark:prose-invert">
                                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{selectedTrade.rationale}</ReactMarkdown>
                                </div>
                            </div>
                            <div>
                                <div className="text-xs font-bold text-muted-foreground uppercase mb-1.5 flex items-center gap-1.5"><Activity className="w-3.5 h-3.5" /> Source Data Summaries</div>
                                <div className="p-3 bg-[#0d0d0d] border border-black/50 rounded-lg font-mono text-xs text-gray-400 space-y-1 mb-3">
                                    {(()=>{
                                        try {
                                            const srcs = JSON.parse(selectedTrade.sources_json || '[]');
                                            if (srcs.length === 0) return <span className="opacity-50">No source data</span>;
                                            return srcs.map((s: string, i: number) => <div key={i}><span className="text-indigo-500/60 mr-1.5">&gt;</span>{s}</div>);
                                        } catch { return <span className="opacity-50">Parse error</span>; }
                                    })()}
                                </div>
                                <div className="text-xs font-bold text-muted-foreground uppercase mb-1.5 flex items-center gap-1.5"><Activity className="w-3.5 h-3.5" /> Raw Pipeline Markdown</div>
                                <pre className="p-3 bg-[#0d0d0d] border border-black/50 rounded-lg font-mono text-[10px] text-gray-400 whitespace-pre-wrap overflow-y-auto max-h-[300px] leading-relaxed">
                                    {selectedTrade.raw_context || '저장된 Raw 데이터가 없습니다 (이전 버전 데이터).'}
                                </pre>
                            </div>
                            {selectedTrade.feedback && (
                                <div className="pt-3 border-t border-border/30">
                                    <div className="text-xs font-bold text-rose-500 uppercase mb-1.5 flex items-center gap-1.5"><ShieldAlert className="w-3.5 h-3.5" /> Self-Review</div>
                                    <div className="p-3 bg-rose-500/5 border border-rose-500/15 rounded-lg text-sm text-rose-400 leading-relaxed">{selectedTrade.feedback}</div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* ── Modal: Intraday Detail ── */}
            {selectedIntraday && (() => {
                const posLabel = selectedIntraday.position || (selectedIntraday.predict === 'UP' ? 'KODEX 200' : selectedIntraday.predict === 'DOWN' ? 'KODEX 인버스' : 'HOLD')
                const posStyle = posLabel.includes('200') ? 'text-rose-500 bg-rose-500/10 border-rose-500/20'
                    : posLabel.includes('인버스') ? 'text-blue-500 bg-blue-500/10 border-blue-500/20'
                    : 'text-muted-foreground bg-muted/50 border-border'
                const posIcon = posLabel.includes('200') ? '↗' : posLabel.includes('인버스') ? '↘' : '—'
                const retVal = selectedIntraday.return_pct
                return (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setSelectedIntraday(null)} />
                    <div className="relative bg-background border border-border/50 rounded-xl w-full max-w-2xl shadow-2xl flex flex-col max-h-[80vh] ring-1 ring-white/5 animate-in zoom-in-95 duration-150">
                        <div className="flex justify-between items-center px-4 py-3 border-b border-border/40 bg-muted/30 rounded-t-xl">
                            <div className="flex items-center gap-2">
                                <Sparkles className="w-4 h-4 text-amber-400" />
                                <span className="text-sm font-bold">장중 예측 상세</span>
                                <span className="text-xs text-muted-foreground px-2 py-0.5 bg-background rounded border border-border/50">{selectedIntraday.date} · {selectedIntraday.time_slot}</span>
                            </div>
                            <button onClick={() => setSelectedIntraday(null)} className="p-1 hover:bg-muted rounded text-muted-foreground"><X className="w-4 h-4" /></button>
                        </div>
                        <div className="p-5 overflow-y-auto space-y-4">
                            <div className="flex gap-4 p-3 bg-muted/20 rounded-lg border border-border/40 text-sm">
                                <div className="flex-1">
                                    <div className="text-xs text-muted-foreground uppercase font-bold mb-1">Position</div>
                                    <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded border text-xs font-bold', posStyle)}>
                                        {posIcon} {posLabel} ({selectedIntraday.predict === 'UP' ? '상승' : selectedIntraday.predict === 'DOWN' ? '하락' : '대기'})
                                    </span>
                                </div>
                                <div className="w-px bg-border/40" />
                                <div><div className="text-xs text-muted-foreground uppercase font-bold mb-1">Entry Price</div><div className="font-mono">{selectedIntraday.entry_price ? selectedIntraday.entry_price.toLocaleString() : '-'}</div></div>
                                <div className="w-px bg-border/40" />
                                <div><div className="text-xs text-muted-foreground uppercase font-bold mb-1">Close Price</div><div className="font-mono">{selectedIntraday.close_price ? selectedIntraday.close_price.toLocaleString() : '-'}</div></div>
                                <div className="w-px bg-border/40" />
                                <div>
                                    <div className="text-xs text-muted-foreground uppercase font-bold mb-1">Return</div>
                                    <div className={cn("font-mono font-bold", retVal > 0 ? "text-rose-500" : retVal < 0 ? "text-blue-500" : "")}>
                                        {retVal != null ? `${retVal > 0 ? '+' : ''}${Number(retVal).toFixed(2)}%` : '⏳'}
                                    </div>
                                </div>
                                <div className="w-px bg-border/40" />
                                <div>
                                    <div className="text-xs text-muted-foreground uppercase font-bold mb-1">Result</div>
                                    <div className="font-mono font-bold">
                                        {selectedIntraday.result === 'HIT' ? <span className="text-emerald-500">✅ HIT</span>
                                        : selectedIntraday.result === 'MISS' ? <span className="text-rose-500">❌ MISS</span>
                                        : selectedIntraday.result === 'HOLD' ? <span className="text-muted-foreground">— HOLD</span>
                                        : <span className="text-indigo-400">⏳ Pending</span>}
                                    </div>
                                </div>
                            </div>
                            <div>
                                <div className="text-xs font-bold text-muted-foreground uppercase mb-1.5 flex items-center gap-1.5"><Brain className="w-3.5 h-3.5" /> Rationale</div>
                                <div className="p-3 bg-primary/5 border border-primary/10 rounded-lg text-sm text-foreground/90 leading-relaxed max-w-none prose prose-sm dark:prose-invert">
                                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{selectedIntraday.rationale || '분석 내용 없음'}</ReactMarkdown>
                                </div>
                            </div>
                            <div>
                                <div className="text-xs font-bold text-muted-foreground uppercase mb-1.5 flex items-center gap-1.5"><Activity className="w-3.5 h-3.5" /> Source Data</div>
                                <div className="p-3 bg-[#0d0d0d] border border-black/50 rounded-lg font-mono text-xs text-gray-400 space-y-1">
                                    {(() => {
                                        try {
                                            const srcs = JSON.parse(selectedIntraday.sources_json || '[]');
                                            if (srcs.length === 0) return <span className="opacity-50">No source data</span>;
                                            return srcs.map((s: string, i: number) => <div key={i}><span className="text-indigo-500/60 mr-1.5">&gt;</span>{s}</div>);
                                        } catch { return <span className="opacity-50">No source data</span>; }
                                    })()}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                )
            })()}

            {/* ── Drawer: Knowledge Base ── */}
            {showKnowledgeBase && (
                <div className="fixed inset-0 z-50 flex justify-end">
                    <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowKnowledgeBase(false)} />
                    <div className="relative w-full max-w-md h-full bg-background border-l border-border flex flex-col shadow-2xl animate-in slide-in-from-right-full duration-200">
                        <div className="flex items-center px-4 py-3 border-b border-border/50 bg-indigo-500/5">
                            <Brain className="w-4 h-4 text-indigo-500 mr-2" />
                            <span className="font-bold text-sm text-indigo-500 flex-1">Knowledge Hub</span>
                            <button onClick={() => setShowKnowledgeBase(false)} className="p-1 hover:bg-muted rounded text-muted-foreground"><X className="w-4 h-4" /></button>
                        </div>
                        <div className="flex bg-muted/20 border-b border-border/50">
                            <button onClick={() => setKnowledgeTab('RULES')} className={cn("flex-1 py-2 text-xs font-bold uppercase transition-colors", knowledgeTab === 'RULES' ? "text-indigo-400 border-b-2 border-indigo-500" : "text-muted-foreground hover:bg-muted/30")}>지표 & 룰</button>
                            <button onClick={() => setKnowledgeTab('WEEKLY')} className={cn("flex-1 py-2 text-xs font-bold uppercase transition-colors", knowledgeTab === 'WEEKLY' ? "text-indigo-400 border-b-2 border-indigo-500" : "text-muted-foreground hover:bg-muted/30")}>주간 리캡</button>
                            <button onClick={() => setKnowledgeTab('MONTHLY')} className={cn("flex-1 py-2 text-xs font-bold uppercase transition-colors", knowledgeTab === 'MONTHLY' ? "text-indigo-400 border-b-2 border-indigo-500" : "text-muted-foreground hover:bg-muted/30")}>월간 리캡</button>
                        </div>
                        <div className="p-5 flex-1 overflow-y-auto space-y-6">
                            {knowledgeTab === 'RULES' && (
                                <>
                                    <section>
                                        <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2.5 flex items-center gap-1.5"><Target className="w-3.5 h-3.5" /> Indicator Effectiveness</div>
                                        <div className="space-y-1.5">
                                            {[
                                                { rank: 1, name: 'PL-NXT (수급)', score: '82.0%', color: 'bg-indigo-500', highlight: true },
                                                { rank: 2, name: 'PL-Macro (금리)', score: '75.5%', color: 'bg-slate-500', highlight: false },
                                                { rank: 3, name: 'PL-News (속보)', score: '48.2%', color: '', highlight: false }
                                            ].map(item => (
                                                <div key={item.rank} className={cn("flex items-center justify-between p-2.5 rounded border border-border/40 bg-muted/20", item.rank === 3 && "opacity-50")}>
                                                    <div className="flex gap-2 items-center">
                                                        <span className={cn("w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold text-white", item.color || "border border-border bg-transparent text-muted-foreground")}>{item.rank}</span>
                                                        <span className={cn("text-sm", item.rank === 3 && "line-through")}>{item.name}</span>
                                                    </div>
                                                    <span className={cn("text-sm font-mono font-bold", item.highlight && "text-indigo-400")}>{item.score}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </section>
                                    <div className="border-b border-border/40" />
                                    <section>
                                        <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2.5 flex items-center gap-1.5"><Sparkles className="w-3.5 h-3.5" /> Active System Rules</div>
                                        <div className="space-y-1.5">
                                            {activeRules.length > 0 ? (
                                                activeRules.map((s, i) => <div key={i} className="text-sm p-2.5 bg-primary/5 border border-primary/10 rounded-lg leading-snug text-primary/80">• {s}</div>)
                                            ) : (
                                                <div className="text-sm text-muted-foreground p-2.5 bg-muted/30 border border-border/40 rounded-lg text-center">아직 학습된 규칙이 없습니다.</div>
                                            )}
                                        </div>
                                    </section>
                                    <div className="border-b border-border/40" />
                                    <section>
                                        <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2.5 flex items-center gap-1.5"><Clock className="w-3.5 h-3.5" /> Self-Learning Commits</div>
                                        <div className="relative pl-4 border-l-2 border-border/40 space-y-4">
                                            <div className="relative">
                                                <div className="absolute -left-[21px] top-1 w-2 h-2 bg-indigo-500 rounded-full ring-2 ring-background" />
                                                <div className="text-xs font-mono text-muted-foreground">03.24 16:00</div>
                                                <div className="text-sm font-bold mt-0.5">[FIX] 뉴스 헤드라인 신뢰도 하향</div>
                                                <div className="text-sm text-muted-foreground leading-snug mt-1">외인 수급 역행 시 뉴스 가중치 무시 로직 적용.</div>
                                            </div>
                                            <div className="relative opacity-50">
                                                <div className="absolute -left-[21px] top-1 w-2 h-2 bg-muted-foreground rounded-full ring-2 ring-background" />
                                                <div className="text-xs font-mono text-muted-foreground">03.20 16:00</div>
                                                <div className="text-sm font-bold mt-0.5">[FEAT] VIX 힛율 보정 알고리즘</div>
                                            </div>
                                        </div>
                                    </section>
                                </>
                            )}
                            {(knowledgeTab === 'WEEKLY' || knowledgeTab === 'MONTHLY') && (
                                <div className="space-y-4">
                                    <div className="p-3 bg-muted/20 border border-border/40 rounded-lg flex flex-col gap-3">
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-2">
                                                <Clock className="w-4 h-4 text-indigo-400" />
                                                <span className="text-sm font-bold">{knowledgeTab === 'WEEKLY' ? '주간' : '월간'} 회고 스케줄러</span>
                                            </div>
                                            <label className="relative inline-flex items-center cursor-pointer">
                                                <input type="checkbox" className="sr-only peer" checked={knowledgeTab === 'WEEKLY' ? autoWeeklyReview : autoMonthlyReview} onChange={async (e) => {
                                                    const next = e.target.checked
                                                    if (knowledgeTab === 'WEEKLY') {
                                                        setAutoWeeklyReview(next)
                                                        await window.electronAPI.saveMarketConditionSettings({ autoWeeklyReview: next })
                                                    } else {
                                                        setAutoMonthlyReview(next)
                                                        await window.electronAPI.saveMarketConditionSettings({ autoMonthlyReview: next })
                                                    }
                                                }} />
                                                <div className="w-7 h-4 bg-muted/50 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-indigo-500"></div>
                                            </label>
                                        </div>
                                        <div className="text-xs text-muted-foreground flex justify-between items-center border-t border-border/40 pt-2">
                                            <span>실행: {knowledgeTab === 'WEEKLY' ? '매주 금요일 15:40' : '매월 마지막 금요일 15:50'}</span>
                                            <button disabled={isRetroRunning} onClick={() => handleRunRetrospective(knowledgeTab)} className="px-2 py-1 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 rounded text-xs transition-colors disabled:opacity-50">
                                                {isRetroRunning ? '생성 중...' : '지금 강제 실행'}
                                            </button>
                                        </div>
                                    </div>
                                    
                                    <div className="space-y-3">
                                        <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
                                            <Target className="w-3.5 h-3.5" /> {knowledgeTab === 'WEEKLY' ? '주간' : '월간'} 리포트 목록
                                        </div>
                                        {retrospectives.length === 0 ? (
                                            <div className="p-4 text-center text-xs text-muted-foreground border border-border/30 rounded-lg bg-muted/10">작성된 회고가 없습니다.</div>
                                        ) : (
                                            retrospectives.map(r => (
                                                <div key={r.id} className="border border-border/40 rounded-lg bg-muted/10 overflow-hidden">
                                                    <div className="px-3 py-2 bg-muted/30 font-mono text-xs font-bold flex justify-between items-center">
                                                        <span className="text-indigo-400">{r.target_period}</span>
                                                        <span className="text-muted-foreground opacity-50 font-normal">{r.created_at.substring(5,16)}</span>
                                                    </div>
                                                    <div className="p-3 text-sm text-foreground/80 leading-relaxed max-w-none prose prose-sm dark:prose-invert">
                                                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{r.content}</ReactMarkdown>
                                                    </div>
                                                </div>
                                            ))
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* ── Settings Modal ── */}
            {showSettings && (
                <div className="absolute inset-0 z-[100] flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowSettings(false)} />
                    <div className="relative bg-background border border-border/50 rounded-xl w-full max-w-[340px] shadow-2xl flex flex-col ring-1 ring-white/5 animate-in zoom-in-95 duration-150">
                        <div className="flex justify-between items-center px-4 py-3 border-b border-border/40 bg-muted/30 rounded-t-xl">
                            <div className="flex items-center gap-2">
                                <Settings className="w-4 h-4 text-indigo-400" />
                                <span className="text-sm font-bold">Agent Settings</span>
                            </div>
                            <button onClick={() => setShowSettings(false)} className="p-1 hover:bg-muted rounded text-muted-foreground"><X className="w-4 h-4" /></button>
                        </div>
                        <div className="p-5 space-y-4">
                            <label className="flex items-center justify-between cursor-pointer p-3 bg-muted/10 border border-border/30 rounded-lg hover:bg-muted/20 transition-colors">
                                <div className="flex flex-col gap-1 pr-4">
                                    <span className="text-sm font-bold flex items-center gap-2">📱 Telegram Alert</span>
                                    <span className="text-xs text-muted-foreground leading-snug">시황 판단이 완료되면 즉시 텔레그램으로 분석 요약본을 전송합니다.</span>
                                </div>
                                <div className={cn("relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none", telegramEnabled ? 'bg-indigo-500' : 'bg-muted/50')} onClick={async (e) => {
                                    e.preventDefault()
                                    const next = !telegramEnabled
                                    setTelegramEnabled(next)
                                    await window.electronAPI.saveMarketConditionSettings({ telegramEnabled: next })
                                }}>
                                    <span className={cn("pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out", telegramEnabled ? 'translate-x-4' : 'translate-x-0')} />
                                </div>
                            </label>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
