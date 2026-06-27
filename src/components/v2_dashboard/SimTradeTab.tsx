import React, { useEffect, useState, useMemo } from 'react'
import { TrendingUp, RefreshCw, Target, BarChart2, Award, Clock, ArrowUpRight, ArrowDownRight, Minus, Trash2, Settings, X, Save, MoreHorizontal, Database, Play, Zap, Bot, ChevronDown, ChevronUp, Sparkles } from 'lucide-react'
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { StockDetailModal } from '../common/StockDetailModal'

function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)) }

// ── Types ──
interface SimTradePick {
    id: number
    pick_date: string
    pick_rank: number
    stock_code: string
    stock_name: string
    category: string
    signals_json: string | null
    buy_score: number
    reason: string | null
    risk: string | null
    related_themes_json: string | null
    theme_lifespan: string | null
    entry_price: number
    exit_price: number
    current_price: number
    holding_days: number
    target_days: number
    target_return_pct: number
    peak_return: number | null
    peak_date: string | null
    final_return: number | null
    status: 'PENDING' | 'ACTIVE' | 'CLOSED'
    result: string | null
    entry_date: string | null
    exit_date: string | null
}

// ── 카테고리 메타 ──
const CATEGORY_META: Record<string, { icon: string; label: string; color: string }> = {
    EMERGING_STAR:     { icon: '🔥', label: '신흥 급부상', color: 'text-red-500 bg-red-500/10 border-red-500/30' },
    PULLBACK_REBOUND:  { icon: '🔥', label: '눌림 반등',   color: 'text-red-500 bg-red-500/10 border-red-500/30' },
    PULLBACK_DIP:      { icon: '📉', label: '눌림목',      color: 'text-amber-500 bg-amber-500/10 border-amber-500/30' },
    TRUE_LEADER:       { icon: '👑', label: '진성 대장',   color: 'text-orange-500 bg-orange-500/10 border-orange-500/30' },
    INTRADAY_SURGE:    { icon: '🔺', label: '당일 급등',      color: 'text-rose-500 bg-rose-500/10 border-rose-500/30' },
    SHORT_TERM_CONSOLIDATION: { icon: '🎯', label: '단기 눌림', color: 'text-green-500 bg-green-500/10 border-green-500/30' },
}

// ── 카테고리 필터 드롭다운 옵션 (현재 운용 중인 6개 Track 카테고리 전체) ──
const CATEGORY_FILTER_OPTIONS: { key: string; label: string }[] = [
    { key: 'all',                       label: '📋 전략: 전체 보기' },
    { key: 'TRUE_LEADER',               label: '👑 진성 대장 (Track A)' },
    { key: 'EMERGING_STAR',             label: '🔥 신흥 급부상 (Track B)' },
    { key: 'PULLBACK_REBOUND',          label: '🔥 눌림 반등 (Track C)' },
    { key: 'PULLBACK_DIP',              label: '📉 눌림목 (Track C)' },
    { key: 'INTRADAY_SURGE',            label: '🔺 당일 급등 (Track D)' },
    { key: 'SHORT_TERM_CONSOLIDATION',  label: '🎯 단기 눌림 (Track E)' },
]

const STATUS_FILTER_OPTIONS: { key: string; label: string }[] = [
    { key: 'all',    label: '📊 상태: 전체' },
    { key: 'ACTIVE', label: '🟢 보유중' },
    { key: 'CLOSED', label: '✅ 완료' },
]

// ── 상태 배지 ──
function StatusBadge({ status, result, currentReturn }: { status: string; result: string | null; currentReturn: number | null }) {
    if (status === 'PENDING') {
        return <span className="text-[10px] px-1.5 py-0.5 rounded font-bold bg-slate-500/15 text-slate-400 border border-slate-500/30">⏳ 대기</span>
    }
    if (status === 'CLOSED') {
        if (result === 'HIT') return <span className="text-[10px] px-1.5 py-0.5 rounded font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">🎯 HIT</span>
        if (result === 'PARTIAL') return <span className="text-[10px] px-1.5 py-0.5 rounded font-bold bg-yellow-500/15 text-yellow-500 border border-yellow-500/30">🟡 일부달성</span>
        return <span className="text-[10px] px-1.5 py-0.5 rounded font-bold bg-red-500/15 text-red-400 border border-red-500/30">❌ 손실</span>
    }
    // ACTIVE
    const isUp = (currentReturn ?? 0) > 0
    return (
        <span className={cn(
            "text-[10px] px-1.5 py-0.5 rounded font-bold border",
            isUp ? "bg-rose-500/10 text-rose-500 border-rose-500/30" : "bg-blue-500/10 text-blue-500 border-blue-500/30"
        )}>
            {isUp ? '🟢 보유중' : '🔴 보유중'}
        </span>
    )
}

// ── 수익률 셀 ──
function ReturnCell({ value, placeholder }: { value: number | null | undefined; placeholder?: string }) {
    if (value === null || value === undefined) {
        return <span className="text-[10px] text-muted-foreground">{placeholder || '—'}</span>
    }
    const isPos = value > 0
    return (
        <span className={cn('font-mono font-bold text-sm', isPos ? 'text-rose-500' : value < 0 ? 'text-blue-500' : 'text-muted-foreground')}>
            {isPos ? '+' : ''}{value.toFixed(1)}%
        </span>
    )
}

// ── 카테고리 배지 ──
function CategoryBadge({ category }: { category: string }) {
    const meta = CATEGORY_META[category] || { icon: '❓', label: category, color: 'text-muted-foreground bg-muted/20 border-border/30' }
    return (
        <span className={cn('inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold border whitespace-nowrap', meta.color)}>
            {meta.icon} {meta.label}
        </span>
    )
}

// ── 가격 포맷 ──
function formatPrice(price: number): string {
    if (!price || price <= 0) return '—'
    return price.toLocaleString('ko-KR')
}

// ── 날짜를 한국어 상대 표현으로 ──
function getDateLabel(dateStr: string): string {
    const today = new Date()
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
    
    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)
    const yesterdayStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`

    if (dateStr === todayStr) return '오늘'
    if (dateStr === yesterdayStr) return '어제'
    
    const d = new Date(dateStr + 'T00:00:00')
    const dayNames = ['일', '월', '화', '수', '목', '금', '토']
    return `${d.getMonth() + 1}/${d.getDate()} (${dayNames[d.getDay()]})`
}

// ─────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────
import { PerformanceModal } from './PerformanceModal'

export const SimTradeTab: React.FC = () => {
    const [activeView, setActiveView] = useState<'list' | 'settings'>('list')
    const [picks, setPicks] = useState<SimTradePick[]>([])
    const [loading, setLoading] = useState(false)
    const [selectedStock, setSelectedStock] = useState<{ stockCode: string; stockName: string; aiReason?: string; aiRisk?: string } | null>(null)
    const [filterStatus, setFilterStatus] = useState<'all' | 'ACTIVE' | 'CLOSED'>('all')
    const [filterCategory, setFilterCategory] = useState<string>('all')
    const [isAiMenuOpen, setIsAiMenuOpen] = useState(false)
    const [showGuidelineModal, setShowGuidelineModal] = useState(false)
    const [guidelineContent, setGuidelineContent] = useState('')
    const [activeGuidelineTab, setActiveGuidelineTab] = useState<'phase1' | 'phase2'>('phase1')
    const [isPerformanceModalOpen, setIsPerformanceModalOpen] = useState(false)
    const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false)
    const fetchPicks = async () => {
        setLoading(true)
        try {
            const data = await (window as any).electronAPI.getSimTradePicks()
            if (data?.picks) {
                // ── Source-level dedup ──
                // UNION ALL SQL로 같은 종목이 여러 Track 테이블에 중복 저장될 수 있음.
                // SQL ORDER BY가 TRUE_LEADER(1) → INTRADAY_SURGE(2) → ... 순으로 정렬하므로
                // 첫 번째 등장 레코드(최우선 카테고리)만 남기고 이후 중복은 제거.
                // 키: stock_code + pick_date (카테고리 무관 — 같은 날 같은 종목은 1개만)
                const seen = new Set<string>()
                const deduped = (data.picks as SimTradePick[]).filter(p => {
                    const key = `${p.stock_code}_${p.pick_date}`
                    if (seen.has(key)) return false
                    seen.add(key)
                    return true
                })
                setPicks(deduped)
            }
        } catch (err) {
            console.error('[SimTrade] fetch error:', err)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => { fetchPicks() }, [])

    const loadGuidelineFile = async (tab: 'phase1' | 'phase2') => {
        try {
            const fileName = tab === 'phase1' ? 'track_b_phase1.md' : 'track_b_phase2.md';
            const res = await (window as any).electronAPI.getTrackBGuideline(fileName);
            if (res.success) {
                setGuidelineContent(res.content);
                setActiveGuidelineTab(tab);
            }
        } catch (e) {
            console.error('Failed to load guideline:', e);
        }
    }

    const openGuideline = async () => {
        await loadGuidelineFile('phase1');
        setShowGuidelineModal(true);
    }

    const saveGuideline = async () => {
        try {
            const fileName = activeGuidelineTab === 'phase1' ? 'track_b_phase1.md' : 'track_b_phase2.md';
            const res = await (window as any).electronAPI.saveTrackBGuideline(fileName, guidelineContent);
            if (res.success) {
                alert('가이드라인이 저장되었습니다.');
            }
        } catch (e) {
            alert('저장 실패: ' + e);
        }
    }

    // ── 필터 적용 (dedup은 fetchPicks에서 이미 처리됨) ──
    console.log('[SimTrade] Render picks length:', picks.length, 'TRUE_LEADERS:', picks.filter(p=>p.category==='TRUE_LEADER').length);
    const filteredPicks = useMemo(() => {
        let result = picks
        if (filterStatus !== 'all') {
            result = result.filter(p => p.status === filterStatus)
        }
        if (filterCategory !== 'all') {
            result = result.filter(p => p.category === filterCategory)
        }
        return result
    }, [picks, filterStatus, filterCategory])

    // ── 날짜별 그룹핑 (최신 날짜가 상단) ──
    const groupedByDate = useMemo(() => {
        const groups: { date: string; picks: SimTradePick[] }[] = []
        const dateMap = new Map<string, SimTradePick[]>()

        for (const p of filteredPicks) {
            const existing = dateMap.get(p.pick_date)
            if (existing) {
                existing.push(p)
            } else {
                dateMap.set(p.pick_date, [p])
            }
        }

        // 날짜 내림차순 정렬
        const sortedDates = Array.from(dateMap.keys()).sort((a, b) => b.localeCompare(a))
        for (const date of sortedDates) {
            const datePicks = dateMap.get(date)!
            // 날짜 내에서는 카테고리(대장 > 급등 > 신흥 > 눌림)를 먼저, 그다음 순위순으로 정렬
            const catOrder: Record<string, number> = {
                'TRUE_LEADER': 1,
                'INTRADAY_SURGE': 2,
                'SHORT_TERM_CONSOLIDATION': 3,
                'EMERGING_STAR': 4,
                'PULLBACK_REBOUND': 5,
                'PULLBACK_DIP': 6
            }
            datePicks.sort((a, b) => {
                const aCat = catOrder[a.category] || 99
                const bCat = catOrder[b.category] || 99
                if (aCat !== bCat) return aCat - bCat
                return a.pick_rank - b.pick_rank
            })
            groups.push({ date, picks: datePicks })
        }

        return groups
    }, [filteredPicks])

    // ── 전체 통계 ──
    const stats = useMemo(() => {
        const total = picks.length
        const closed = picks.filter(p => p.status === 'CLOSED')
        const active = picks.filter(p => p.status === 'ACTIVE')
        const hits = closed.filter(p => p.result === 'HIT').length
        const hitRate = closed.length > 0 ? (hits / closed.length * 100) : 0
        const avgFinalReturn = closed.length > 0
            ? closed.reduce((s, p) => s + (p.final_return ?? 0), 0) / closed.length
            : 0
        const avgPeakReturn = [...closed, ...active].filter(p => p.peak_return !== null).length > 0
            ? [...closed, ...active].filter(p => p.peak_return !== null).reduce((s, p) => s + (p.peak_return ?? 0), 0) / [...closed, ...active].filter(p => p.peak_return !== null).length
            : 0

        return { total, closedCount: closed.length, activeCount: active.length, hits, hitRate, avgFinalReturn, avgPeakReturn }
    }, [picks])

    // ── 날짜별 요약 계산 ──
    function getDateSummary(datePicks: SimTradePick[]) {
        const count = datePicks.length
        const avgScore = datePicks.reduce((s, p) => s + p.buy_score, 0) / count
        const closed = datePicks.filter(p => p.status === 'CLOSED')
        const active = datePicks.filter(p => p.status === 'ACTIVE')
        const pending = datePicks.filter(p => p.status === 'PENDING')
        const hits = closed.filter(p => p.result === 'HIT').length
        const partials = closed.filter(p => p.result === 'PARTIAL').length
        const losses = closed.filter(p => p.result === 'LOSS').length

        if (closed.length === count) {
            const avgReturn = closed.reduce((s, p) => s + (p.final_return ?? 0), 0) / closed.length
            return `HIT ${hits} / 일부 ${partials} / 손실 ${losses} | 평균 ${avgReturn > 0 ? '+' : ''}${avgReturn.toFixed(1)}%`
        }
        if (active.length > 0) {
            const avgCurrent = active.reduce((s, p) => {
                const ret = p.entry_price > 0 ? ((p.current_price - p.entry_price) / p.entry_price) * 100 : 0
                return s + ret
            }, 0) / active.length
            return `보유중 ${active.length}개 | 현재평균 ${avgCurrent > 0 ? '+' : ''}${avgCurrent.toFixed(1)}%`
        }
        return `종목 ${count}개 | 평균점수 ${avgScore.toFixed(0)}점`
    }

    return (
        <div className="flex flex-col h-full overflow-hidden select-none">

            {/* ── 상단 요약 바 ── */}
            <div className="shrink-0 px-4 py-3 border-b border-border/50 bg-muted/10">
                <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-0 border-b border-border/40 mr-4">
                        <button
                            onClick={() => setActiveView('list')}
                            className={cn(
                                'px-4 py-2 text-xs font-bold border-b-2 transition-colors flex items-center gap-1.5',
                                activeView === 'list'
                                    ? 'border-amber-500 text-amber-500 font-extrabold'
                                    : 'border-transparent text-muted-foreground hover:text-foreground'
                            )}
                        >
                            <Target className="w-3.5 h-3.5" />
                            모의매매 종목
                        </button>
                        <button
                            onClick={() => setActiveView('settings')}
                            className={cn(
                                'px-4 py-2 text-xs font-bold border-b-2 transition-colors flex items-center gap-1.5',
                                activeView === 'settings'
                                    ? 'border-indigo-500 text-indigo-500 font-extrabold'
                                    : 'border-transparent text-muted-foreground hover:text-foreground'
                            )}
                        >
                            <Settings className="w-3.5 h-3.5" />
                            설정 및 자가학습
                        </button>
                    </div>
                    
                    {activeView === 'list' ? (
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => setIsPerformanceModalOpen(true)}
                                className="text-xs font-bold text-foreground bg-accent border border-border hover:bg-accent/80 px-2.5 py-1.5 rounded transition-colors shadow-sm mr-2 flex items-center gap-1"
                            >
                                📉 성과 측정
                            </button>
                        {/* ── 카테고리 드롭다운 필터 ── */}
                        <select
                            value={filterCategory}
                            onChange={e => setFilterCategory(e.target.value)}
                            className={cn(
                                'text-xs font-bold rounded px-2 py-1.5 cursor-pointer transition-colors',
                                'focus:outline-none focus:ring-1 focus:ring-primary/50',
                                filterCategory !== 'all'
                                    ? 'bg-indigo-500/10 border border-indigo-500/50 text-indigo-400'
                                    : 'bg-muted/40 border border-border/50 text-foreground hover:border-border'
                            )}
                        >
                            {CATEGORY_FILTER_OPTIONS.map(opt => (
                                <option key={opt.key} value={opt.key}>{opt.label}</option>
                            ))}
                        </select>

                        {/* ── 보유 상태 드롭다운 필터 ── */}
                        <select
                            value={filterStatus}
                            onChange={e => setFilterStatus(e.target.value as 'all' | 'ACTIVE' | 'CLOSED')}
                            className={cn(
                                'text-xs font-bold rounded px-2 py-1.5 cursor-pointer transition-colors',
                                'focus:outline-none focus:ring-1 focus:ring-primary/50',
                                filterStatus !== 'all'
                                    ? 'bg-amber-500/10 border border-amber-500/50 text-amber-400'
                                    : 'bg-muted/40 border border-border/50 text-foreground hover:border-border'
                            )}
                        >
                            {STATUS_FILTER_OPTIONS.map(opt => (
                                <option key={opt.key} value={opt.key}>{opt.label}</option>
                            ))}
                        </select>
                        
                        {/* 다중 전략 테스트 메뉴 */}
                        <div className="relative">
                            <button
                                onClick={() => setIsAiMenuOpen(!isAiMenuOpen)}
                                disabled={loading}
                                className="text-xs font-bold text-white bg-indigo-500 hover:bg-indigo-600 px-3 py-1.5 rounded transition-colors shadow-sm flex items-center gap-1"
                            >
                                🚀 수동 테스트 ▾
                            </button>
                            {isAiMenuOpen && (
                                <>
                                    <div className="fixed inset-0 z-40" onClick={() => setIsAiMenuOpen(false)} />
                                    <div className="absolute right-0 top-full mt-1 w-52 bg-background border border-border/50 rounded-md shadow-xl z-50 py-1 overflow-hidden">
                                        <button 
                                            onClick={async () => {
                                                setIsAiMenuOpen(false);
                                                setLoading(true);
                                                try {
                                                    alert('전 트랙(A~E) AI 종목 선정을 순차적으로 시작합니다. 약 1~2분 소요됩니다.');
                                                    await (window as any).electronAPI.runTrackABuyAgent();
                                                    await (window as any).electronAPI.runTrackBBuyAgent();
                                                    await (window as any).electronAPI.runTrackCBuyAgent();
                                                    await (window as any).electronAPI.runTrackDBuyAgent();
                                                    await (window as any).electronAPI.runTrackEBuyAgent();
                                                    alert('전 트랙 종목 선정이 완료되었습니다.');
                                                    await fetchPicks();
                                                } catch(e: any) {
                                                    alert('에러 발생: ' + e.message);
                                                } finally {
                                                    setLoading(false);
                                                }
                                            }}
                                            className="w-full text-left px-4 py-2.5 text-xs font-bold hover:bg-muted transition-colors border-b border-border/30 text-indigo-400 flex items-center gap-2"
                                        >
                                            <Play className="w-3.5 h-3.5" />
                                            전체 트랙 일괄 선정 (A~E)
                                        </button>
                                        <button 
                                            onClick={async () => {
                                                setIsAiMenuOpen(false);
                                                setLoading(true);
                                                try {
                                                    alert('대장주 전용 파이프라인 (Track A)을 시작합니다. 약 10~20초 소요됩니다.');
                                                    await (window as any).electronAPI.runTrackABuyAgent();
                                                    alert('대장주 선정이 완료되었습니다.');
                                                    await fetchPicks();
                                                } catch(e: any) {
                                                    alert('에러 발생: ' + e.message);
                                                } finally {
                                                    setLoading(false);
                                                }
                                            }}
                                            className="w-full text-left px-4 py-2 text-xs font-medium hover:bg-muted transition-colors"
                                        >
                                            👑 대장주 모멘텀 추종 (A)
                                        </button>
                                        <button 
                                            onClick={async () => {
                                                setIsAiMenuOpen(false);
                                                setLoading(true);
                                                try {
                                                    alert('신흥 성장주 전용 파이프라인 (Track B)을 시작합니다. 약 10~20초 소요됩니다.');
                                                    await (window as any).electronAPI.runTrackBBuyAgent();
                                                    alert('신흥 성장주 선정이 완료되었습니다.');
                                                    await fetchPicks();
                                                } catch(e: any) {
                                                    alert('에러 발생: ' + e.message);
                                                } finally {
                                                    setLoading(false);
                                                }
                                            }}
                                            className="w-full text-left px-4 py-2 text-xs font-medium hover:bg-muted transition-colors"
                                        >
                                            🚀 신흥 성장주 발굴 (B)
                                        </button>
                                        <button 
                                            onClick={async () => {
                                                setIsAiMenuOpen(false);
                                                setLoading(true);
                                                try {
                                                    alert('눌림목 스나이핑 전용 파이프라인 (Track C)을 시작합니다. 약 10~20초 소요됩니다.');
                                                    await (window as any).electronAPI.runTrackCBuyAgent();
                                                    alert('눌림목 스나이핑 선정이 완료되었습니다.');
                                                    await fetchPicks();
                                                } catch(e: any) {
                                                    alert('에러 발생: ' + e.message);
                                                } finally {
                                                    setLoading(false);
                                                }
                                            }}
                                            className="w-full text-left px-4 py-2 text-xs font-medium hover:bg-muted transition-colors"
                                        >
                                            🎣 전술적 눌림목 스나이핑 (C)
                                        </button>
                                        <button 
                                            onClick={async () => {
                                                setIsAiMenuOpen(false);
                                                setLoading(true);
                                                try {
                                                    alert('당일 급등주 종가베팅 파이프라인 (Track D)을 시작합니다. 약 10~20초 소요됩니다.');
                                                    await (window as any).electronAPI.runTrackDBuyAgent();
                                                    alert('당일 급등주 종가베팅 선정이 완료되었습니다.');
                                                    await fetchPicks();
                                                } catch(e: any) {
                                                    alert('에러 발생: ' + e.message);
                                                } finally {
                                                    setLoading(false);
                                                }
                                            }}
                                            className="w-full text-left px-4 py-2 text-xs font-medium hover:bg-muted transition-colors text-orange-400"
                                        >
                                            🔥 당일 급등주 종가베팅 (D)
                                        </button>
                                        <button 
                                            onClick={async () => {
                                                setIsAiMenuOpen(false);
                                                setLoading(true);
                                                try {
                                                    alert('단기 눌림목 종가베팅 파이프라인 (Track E)을 시작합니다. 약 10~20초 소요됩니다.');
                                                    await (window as any).electronAPI.runTrackEBuyAgent();
                                                    alert('단기 눌림목 선정이 완료되었습니다.');
                                                    await fetchPicks();
                                                } catch(e: any) {
                                                    alert('에러 발생: ' + e.message);
                                                } finally {
                                                    setLoading(false);
                                                }
                                            }}
                                            className="w-full text-left px-4 py-2 text-xs font-medium hover:bg-muted transition-colors text-green-500"
                                        >
                                            🎯 단기 눌림목 탐색 (E)
                                        </button>
                                    </div>
                                </>
                            )}
                        </div>
                        <button
                            onClick={openGuideline}
                            className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-muted/30 transition-colors flex items-center gap-1"
                        >
                            <Settings className="w-3.5 h-3.5" />
                            옵션
                        </button>
                        {/* 더보기 (More Options) 컨텍스트 메뉴 */}
                        <div className="relative">
                            <button
                                onClick={() => setIsMoreMenuOpen(!isMoreMenuOpen)}
                                className="text-xs text-muted-foreground hover:text-foreground px-2 py-1.5 rounded hover:bg-muted/30 transition-colors flex items-center justify-center border border-transparent hover:border-border/50"
                                title="더보기"
                            >
                                <MoreHorizontal className="w-4 h-4" />
                            </button>
                            {isMoreMenuOpen && (
                                <>
                                    <div className="fixed inset-0 z-40" onClick={() => setIsMoreMenuOpen(false)} />
                                    <div className="absolute right-0 top-full mt-1 w-52 bg-background border border-border/50 rounded-md shadow-xl z-50 py-1 overflow-hidden">
                                        <button
                                            onClick={async () => {
                                                setIsMoreMenuOpen(false);
                                                if (!confirm('OHLCV 전체 수집 완료 후 자동으로 종목 선정 파이프라인까지 연속 실행하시겠습니까?\n(약 15~25분 소요)')) return;
                                                setLoading(true);
                                                try {
                                                    // 1. OHLCV 수집
                                                    const ohlcvRes = await (window as any).electronAPI.runOhlcvCollection();
                                                    if(!ohlcvRes.success) {
                                                        alert('OHLCV 수집 중단: ' + ohlcvRes.error);
                                                        return;
                                                    }
                                                    // 2. 종목 선정 파이프라인 (Track A~E)
                                                    alert('OHLCV 수집 완료! 이제 각 트랙별 AI 종목 선정을 시작합니다.');
                                                    await (window as any).electronAPI.runTrackEBuyAgent();
                                                    await (window as any).electronAPI.runTrackDBuyAgent();
                                                    await (window as any).electronAPI.runTrackCBuyAgent();
                                                    await (window as any).electronAPI.runTrackBBuyAgent();
                                                    await (window as any).electronAPI.runTrackABuyAgent();

                                                    // 3. 후속 파이프라인 실행
                                                    const pipelineRes = await (window as any).electronAPI.resumePostMarketPipeline();
                                                    if (pipelineRes.success) alert('OHLCV 수집 및 파이프라인 연속 실행이 완료되었습니다.');
                                                    else alert('OHLCV 수집은 완료되었으나, 파이프라인 실행 중 오류가 발생했습니다: ' + pipelineRes.error);
                                                    
                                                    await fetchPicks();
                                                } catch(e: any) {
                                                    alert('에러 발생: ' + e.message);
                                                } finally {
                                                    setLoading(false);
                                                }
                                            }}
                                            className="w-full text-left px-4 py-2.5 text-xs font-bold hover:bg-muted transition-colors flex items-center gap-2 text-indigo-400 border-b border-border/30"
                                        >
                                            <Database className="w-3.5 h-3.5" />
                                            🌟 수집 + 파이프라인 원클릭 실행
                                        </button>
                                        <button
                                            onClick={async () => {
                                                setIsMoreMenuOpen(false);
                                                setLoading(true);
                                                try {
                                                    alert('전 종목 OHLCV 수집을 시작합니다. 약 15~25분 소요될 수 있습니다.');
                                                    const res = await (window as any).electronAPI.runOhlcvCollection();
                                                    if(res.success) {
                                                        alert('수집이 완료되었습니다.');
                                                    } else {
                                                        alert('OHLCV 수집 실패: ' + res.error);
                                                    }
                                                } catch(e: any) {
                                                    alert('에러 발생: ' + e.message);
                                                } finally {
                                                    setLoading(false);
                                                }
                                            }}
                                            className="w-full text-left px-4 py-2.5 text-xs font-medium hover:bg-muted transition-colors flex items-center gap-2 text-amber-400 border-b border-border/30"
                                        >
                                            <Database className="w-3.5 h-3.5" />
                                            OHLCV 전체 수동 수집
                                        </button>
                                        <button
                                            onClick={async () => {
                                                setIsMoreMenuOpen(false);
                                                if (!confirm('정말 장 마감 후속 파이프라인(진입가 확정, 채점, 인큐베이터 등)을 지금 실행하시겠습니까?')) return;
                                                setLoading(true);
                                                try {
                                                    const res = await (window as any).electronAPI.resumePostMarketPipeline();
                                                    if (res.success) alert('수동 복구 파이프라인이 완료되었습니다.');
                                                    else alert('오류: ' + res.error);
                                                    await fetchPicks();
                                                } finally {
                                                    setLoading(false);
                                                }
                                            }}
                                            className="w-full text-left px-4 py-2.5 text-xs font-medium hover:bg-muted transition-colors flex items-center gap-2 text-rose-400 border-b border-border/30"
                                        >
                                            <Play className="w-3.5 h-3.5" />
                                            ▶ 장 마감 후속 파이프라인 일괄 실행
                                        </button>
                                        <button
                                            onClick={async () => {
                                                setIsMoreMenuOpen(false);
                                                if (!confirm('⚠️ 실전 매매입니다! 오늘 추천된 종목들을 지금 즉시 매수 실행하시겠습니까? (미체결 방지를 위해 시장가 또는 호가 조작이 필요할 수 있습니다)')) return;
                                                setLoading(true);
                                                try {
                                                    const res = await (window as any).electronAPI.executeLiveTradesManual();
                                                    if (res.success) alert(`매수 연동 완료: ${res.count}건\n상세 로그: ${res.log}`);
                                                    else alert('매수 연동 실패: ' + res.error);
                                                } finally {
                                                    setLoading(false);
                                                }
                                            }}
                                            className="w-full text-left px-4 py-2.5 text-xs font-medium hover:bg-muted transition-colors flex items-center gap-2 text-emerald-400 border-b border-border/30"
                                        >
                                            <Zap className="w-3.5 h-3.5" />
                                            ⚡ 오늘 추천 종목 실전 매수 수동 발동
                                        </button>
                                        <button
                                            onClick={async () => {
                                                setIsMoreMenuOpen(false);
                                                setLoading(true);
                                                try {
                                                    const res = await (window as any).electronAPI.forceRefreshSimTradePrices();
                                                    if(res.success) {
                                                        await fetchPicks();
                                                    } else {
                                                        alert('원격 갱신 실패: ' + res.error);
                                                    }
                                                } finally { setLoading(false); }
                                            }}
                                            disabled={loading}
                                            className="w-full text-left px-4 py-2 text-xs font-medium hover:bg-muted transition-colors flex items-center gap-2 text-indigo-400 disabled:opacity-50"
                                        >
                                            <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
                                            현재가 즉시 수동 갱신
                                        </button>
                                        <button
                                            onClick={() => {
                                                setIsMoreMenuOpen(false);
                                                fetchPicks();
                                            }}
                                            disabled={loading}
                                            className="w-full text-left px-4 py-2 text-xs font-medium hover:bg-muted transition-colors flex items-center gap-2 disabled:opacity-50 text-foreground"
                                        >
                                            <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
                                            새로고침
                                        </button>
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                    ) : null}
                </div>

                {/* Stats Bar */}
                {activeView === 'list' && (
                <div className="grid grid-cols-5 gap-3">
                    {[
                        {
                            icon: <BarChart2 className="w-3.5 h-3.5 text-indigo-400" />,
                            label: '총 추천',
                            value: `${stats.total}건`,
                        },
                        {
                            icon: <Award className="w-3.5 h-3.5 text-emerald-400" />,
                            label: 'HIT (목표달성)',
                            value: `${stats.hits}건 (${stats.hitRate.toFixed(1)}%)`,
                            color: stats.hitRate >= 30 ? 'text-emerald-400' : stats.hitRate > 0 ? 'text-amber-400' : undefined,
                        },
                        {
                            icon: <TrendingUp className="w-3.5 h-3.5 text-rose-500" />,
                            label: '평균 수익률',
                            value: `${stats.avgFinalReturn > 0 ? '+' : ''}${stats.avgFinalReturn.toFixed(1)}%`,
                            color: stats.avgFinalReturn > 0 ? 'text-rose-500' : stats.avgFinalReturn < 0 ? 'text-blue-500' : undefined,
                        },
                        {
                            icon: <ArrowUpRight className="w-3.5 h-3.5 text-amber-400" />,
                            label: '평균 피크',
                            value: `+${stats.avgPeakReturn.toFixed(1)}%`,
                            color: 'text-amber-400',
                        },
                        {
                            icon: <Clock className="w-3.5 h-3.5 text-blue-400" />,
                            label: '현재 보유',
                            value: `${stats.activeCount}종목`,
                        },
                    ].map(({ icon, label, value, color }) => (
                        <div key={label} className="flex items-center gap-2 px-3 py-2 bg-muted/20 border border-border/40 rounded-lg">
                            {icon}
                            <div className="min-w-0">
                                <div className="text-[10px] text-muted-foreground uppercase font-bold">{label}</div>
                                <div className={cn('text-sm font-mono font-bold', color)}>{value}</div>
                            </div>
                        </div>
                    ))}
                </div>
                )}
            </div>

            {/* ── 메인 테이블 또는 설정 뷰 ── */}
            {activeView === 'list' ? (
            <div className="flex-1 overflow-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">

                {loading ? (
                    <div className="flex items-center justify-center h-full">
                        <div className="text-center text-muted-foreground text-xs">
                            <RefreshCw className="w-5 h-5 animate-spin inline mr-2" />
                            데이터를 불러오고 있습니다...
                        </div>
                    </div>
                ) : picks.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
                        <Target className="w-8 h-8 text-muted-foreground/30" />
                        <div className="text-sm font-bold">아직 모의매매 데이터가 없습니다</div>
                        <div className="text-xs">장 마감 후(15:50) AI가 자동으로 매수 후보를 선정하면 여기에 표시됩니다.</div>
                    </div>
                ) : (
                    <table className="w-full text-sm text-left whitespace-nowrap">
                        <thead className="sticky top-0 z-10 bg-background">
                            <tr className="text-xs uppercase text-muted-foreground border-b border-border/60">
                                <th className="py-2 px-3 font-bold w-10 text-center">순위</th>
                                <th className="py-2 px-3 font-bold">종목명</th>
                                <th className="py-2 px-3 font-bold">테마</th>
                                <th className="py-2 px-3 font-bold text-center">카테고리</th>
                                <th className="py-2 px-3 font-bold text-center">AI점수</th>
                                <th className="py-2 px-3 font-bold text-right">진입가</th>
                                <th className="py-2 px-3 font-bold text-right">현재/청산가</th>
                                <th className="py-2 px-3 font-bold text-center">D-day</th>
                                <th className="py-2 px-3 font-bold text-right">피크</th>
                                <th className="py-2 px-3 font-bold text-right">현재수익</th>
                                <th className="py-2 px-3 font-bold text-center">상태</th>
                                <th className="py-2 px-3 font-bold text-center w-8"></th>
                            </tr>
                        </thead>
                        <tbody>
                            {groupedByDate.map(({ date, picks: datePicks }) => (
                                <React.Fragment key={date}>
                                    {/* ── 날짜 구분 행 ── */}
                                    <tr className="bg-muted/30 border-y border-border/40 hover:bg-muted/40 transition-colors group/header">
                                        <td colSpan={12} className="py-2 px-3">
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-3">
                                                    <span className="font-black text-xs text-foreground">
                                                        📅 {date} ({getDateLabel(date)})
                                                    </span>
                                                    <span className="text-[10px] text-muted-foreground font-mono">
                                                        {getDateSummary(datePicks)}
                                                    </span>
                                                </div>
                                                
                                                <button
                                                    onClick={async (e) => {
                                                        e.stopPropagation();
                                                        if (window.confirm(`${date} 일자의 모든 추천 기록과 개별 종목 AI 리포트를 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`)) {
                                                            setLoading(true);
                                                            try {
                                                                await (window as any).electronAPI.deleteTrackBPicksByDate(date);
                                                                await fetchPicks();
                                                            } catch (err: any) {
                                                                alert('삭제 중 오류가 발생했습니다: ' + err.message);
                                                            } finally {
                                                                setLoading(false);
                                                            }
                                                        }
                                                    }}
                                                    className="opacity-0 group-hover/header:opacity-100 flex items-center gap-1 text-[10px] font-bold text-red-500/70 hover:text-red-500 hover:bg-red-500/10 px-2 py-1 rounded transition-all"
                                                    title="해당 일자의 추천 기록 전체 삭제"
                                                >
                                                    <Trash2 size={12} />
                                                    일자 삭제
                                                </button>
                                            </div>
                                        </td>
                                    </tr>

                                    {/* ── 종목 행 ── */}
                                    {datePicks.map((pick) => {
                                        const currentReturn = pick.status === 'CLOSED'
                                            ? pick.final_return
                                            : pick.entry_price > 0 && pick.current_price > 0
                                                ? ((pick.current_price - pick.entry_price) / pick.entry_price) * 100
                                                : null
                                        const displayPrice = pick.status === 'CLOSED' ? pick.exit_price : pick.current_price
                                        const remainingDays = pick.target_days - pick.holding_days

                                        return (
                                            <tr
                                                key={`${pick.category}_${pick.id}`}
                                                onClick={() => setSelectedStock({ 
                                                    stockCode: pick.stock_code, 
                                                    stockName: pick.stock_name,
                                                    aiReason: pick.reason || undefined,
                                                    aiRisk: pick.risk || undefined
                                                })}
                                                className="border-b border-border/20 hover:bg-accent/30 transition-colors cursor-pointer group"
                                            >
                                                {/* 순위 */}
                                                <td className="py-2.5 px-3 text-center">
                                                    <span className={cn(
                                                        'font-mono font-bold text-sm',
                                                        pick.pick_rank === 1 ? 'text-amber-400' :
                                                        pick.pick_rank === 2 ? 'text-slate-300' :
                                                        pick.pick_rank === 3 ? 'text-orange-400' :
                                                        'text-muted-foreground'
                                                    )}>
                                                        {pick.pick_rank}
                                                    </span>
                                                </td>

                                                {/* 종목명 */}
                                                <td className="py-2.5 px-3">
                                                    <div className="font-semibold text-sm text-foreground group-hover:text-primary transition-colors">
                                                        {pick.stock_name}
                                                    </div>
                                                    <div className="text-[10px] font-mono text-muted-foreground">{pick.stock_code}</div>
                                                </td>

                                                {/* 테마 */}
                                                <td className="py-2.5 px-3">
                                                    <div className="text-xs text-muted-foreground truncate max-w-[120px] sm:max-w-[160px]" title={
                                                        pick.related_themes_json 
                                                            ? (() => {
                                                                try {
                                                                    return JSON.parse(pick.related_themes_json).join(', ');
                                                                } catch {
                                                                    return '알 수 없음';
                                                                }
                                                            })()
                                                            : ''
                                                    }>
                                                        {pick.related_themes_json 
                                                            ? (() => {
                                                                try {
                                                                    return JSON.parse(pick.related_themes_json).join(', ');
                                                                } catch {
                                                                    return '-';
                                                                }
                                                            })()
                                                            : '-'}
                                                    </div>
                                                </td>

                                                {/* 카테고리 */}
                                                <td className="py-2.5 px-3 text-center">
                                                    <CategoryBadge category={pick.category} />
                                                </td>

                                                {/* AI 점수 */}
                                                <td className="py-2.5 px-3 text-center">
                                                    <span className={cn(
                                                        'font-mono font-bold text-sm',
                                                        pick.buy_score >= 90 ? 'text-emerald-400' :
                                                        pick.buy_score >= 70 ? 'text-amber-400' :
                                                        'text-muted-foreground'
                                                    )}>
                                                        {pick.buy_score}
                                                    </span>
                                                </td>

                                                {/* 진입가 */}
                                                <td className="py-2.5 px-3 text-right">
                                                    <span className="font-mono text-sm text-muted-foreground">
                                                        {pick.status === 'PENDING' ? '대기중' : formatPrice(pick.entry_price)}
                                                    </span>
                                                </td>

                                                {/* 현재가 / 청산가 */}
                                                <td className="py-2.5 px-3 text-right">
                                                    <span className={cn(
                                                        'font-mono text-sm',
                                                        pick.status === 'PENDING' ? 'text-muted-foreground' :
                                                        (currentReturn ?? 0) > 0 ? 'text-rose-500 font-bold' :
                                                        (currentReturn ?? 0) < 0 ? 'text-blue-500 font-bold' :
                                                        'text-muted-foreground'
                                                    )}>
                                                        {pick.status === 'PENDING' ? '—' : formatPrice(displayPrice)}
                                                    </span>
                                                </td>

                                                {/* D-day */}
                                                <td className="py-2.5 px-3 text-center">
                                                    {pick.status === 'PENDING' ? (
                                                        <span className="text-xs text-muted-foreground">D-{pick.target_days}</span>
                                                    ) : pick.status === 'ACTIVE' ? (
                                                        <span className={cn(
                                                            'text-xs font-bold',
                                                            remainingDays <= 1 ? 'text-red-400' : 'text-foreground'
                                                        )}>
                                                            D-{remainingDays}
                                                        </span>
                                                    ) : (
                                                        <span className="text-xs text-muted-foreground">완료</span>
                                                    )}
                                                </td>

                                                {/* 피크 */}
                                                <td className="py-2.5 px-3 text-right">
                                                    <ReturnCell value={pick.peak_return} />
                                                </td>

                                                {/* 현재 수익 / 최종 수익 */}
                                                <td className="py-2.5 px-3 text-right">
                                                    <ReturnCell value={currentReturn} />
                                                </td>

                                                {/* 상태 */}
                                                <td className="py-2.5 px-3 text-center">
                                                    <StatusBadge status={pick.status} result={pick.result} currentReturn={currentReturn} />
                                                </td>

                                                {/* 개별 삭제 버튼 */}
                                                <td className="py-2.5 px-3 text-center">
                                                    <button
                                                        onClick={async (e) => {
                                                            e.stopPropagation()
                                                            if (window.confirm(`'${pick.stock_name}' 종목을 삭제하시겠습니까?`)) {
                                                                try {
                                                                    await (window as any).electronAPI.deleteSimTradePickById(pick.id, pick.category)
                                                                    await fetchPicks()
                                                                } catch (err: any) {
                                                                    alert('삭제 중 오류가 발생했습니다: ' + err.message)
                                                                }
                                                            }
                                                        }}
                                                        className="text-muted-foreground/30 hover:text-red-500 hover:bg-red-500/10 p-1 rounded transition-colors opacity-0 group-hover:opacity-100"
                                                        title="종목 삭제"
                                                    >
                                                        <Trash2 size={14} />
                                                    </button>
                                                </td>
                                            </tr>
                                        )
                                    })}
                                </React.Fragment>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
            ) : (
                <div className="flex-1 overflow-auto p-5">
                    <TrackSelfLearningSettingsView />
                </div>
            )}

            {/* ── 종목 상세 모달 ── */}
            {selectedStock && (
                <StockDetailModal
                    stockCode={selectedStock.stockCode}
                    stockName={selectedStock.stockName}
                    aiReason={selectedStock.aiReason}
                    aiRisk={selectedStock.aiRisk}
                    onClose={() => setSelectedStock(null)}
                />
            )}

            {/* ── 트랙B 1차 가이드라인 모달 ── */}
            {showGuidelineModal && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
                    <div className="w-[800px] h-[80vh] bg-background border border-border/50 rounded-xl shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                        <div className="shrink-0 h-14 px-5 border-b border-border flex items-center justify-between bg-muted/20">
                            <div>
                                <h3 className="font-bold text-lg flex items-center gap-2">
                                    <Settings className="w-5 h-5 text-indigo-400" />
                                    트랙B 1차 가이드라인 (에디터)
                                </h3>
                                <p className="text-xs text-muted-foreground mt-0.5">로컬 AI (Phase 3)의 종목 분류 및 비판적 평가 기준으로 즉시 적용됩니다.</p>
                            </div>
                            <button
                                onClick={() => setShowGuidelineModal(false)}
                                className="p-1 hover:bg-muted rounded transition-colors text-muted-foreground hover:text-foreground"
                            >
                                <X size={20} />
                            </button>
                        </div>
                        
                        <div className="flex border-b border-border bg-muted/10">
                            <button
                                className={cn(
                                    "flex-1 px-4 py-2.5 text-sm font-bold border-b-2 transition-colors",
                                    activeGuidelineTab === 'phase1' ? "border-indigo-500 text-indigo-400" : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/20"
                                )}
                                onClick={() => loadGuidelineFile('phase1')}
                            >
                                1차 분석 가이드 (Gemma 4b)
                            </button>
                            <button
                                className={cn(
                                    "flex-1 px-4 py-2.5 text-sm font-bold border-b-2 transition-colors",
                                    activeGuidelineTab === 'phase2' ? "border-indigo-500 text-indigo-400" : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/20"
                                )}
                                onClick={() => loadGuidelineFile('phase2')}
                            >
                                2차 최종심사 가이드 (Gemini)
                            </button>
                        </div>
                        <div className="flex-1 p-0 overflow-hidden bg-[#1e1e1e]">
                            <textarea
                                value={guidelineContent}
                                onChange={(e) => setGuidelineContent(e.target.value)}
                                className="w-full h-full bg-transparent text-[#d4d4d4] font-mono text-sm p-5 focus:outline-none resize-none leading-relaxed"
                                spellCheck={false}
                            />
                        </div>
                        <div className="shrink-0 h-16 border-t border-border bg-muted/20 flex items-center justify-end px-5 gap-3">
                            <button
                                onClick={() => setShowGuidelineModal(false)}
                                className="px-4 py-2 text-sm font-medium rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                            >
                                취소
                            </button>
                            <button
                                onClick={saveGuideline}
                                className="px-4 py-2 text-sm font-bold rounded bg-indigo-500 hover:bg-indigo-600 text-white transition-colors flex items-center gap-1.5 shadow-sm"
                            >
                                <Save size={16} />
                                저장 및 적용
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {/* 성과 측정 팝업 모달 */}
            <PerformanceModal 
                isOpen={isPerformanceModalOpen} 
                onClose={() => setIsPerformanceModalOpen(false)} 
                picks={picks} 
            />
        </div>
    )
}

// ─── 주도주 AI 통합 자가학습 및 설정 뷰 ───────────────────
const TrackSelfLearningSettingsView: React.FC = () => {
    const [aiSettings, setAiSettings] = useState<any>(null);
    const [isSaving, setIsSaving] = useState(false);
    
    // 수동 자가학습 상태
    const [selectedRange, setSelectedRange] = useState<number>(30);
    const [isManualRunning, setIsManualRunning] = useState(false);
    const [manualLog, setManualLog] = useState<string>('');

    useEffect(() => {
        loadSettings();
    }, []);

    const loadSettings = async () => {
        try {
            const api = window.electronAPI as any;
            if (api.getAiSettings) {
                const res = await api.getAiSettings();
                if (res) {
                    // 레거시 5개 트랙 오브젝트 또는 누락 시 단일 통합 오브젝트로 보정
                    if (!res.trackLearningSettings || res.trackLearningSettings.trackA !== undefined) {
                        res.trackLearningSettings = {
                            enabled: false,
                            interval: 'WEEKLY',
                            dayOfWeek: [5],
                            dayOfMonth: 1,
                            time: '16:00',
                            holidayOption: 'NEXT_OPEN'
                        };
                    }
                    setAiSettings(res);
                }
            }
        } catch (e) {
            console.error('설정 로드 실패:', e);
        }
    };

    const handleSaveSettings = async () => {
        if (!aiSettings) return;
        setIsSaving(true);
        try {
            const api = window.electronAPI as any;
            if (api.saveAiSettings) {
                const res = await api.saveAiSettings(aiSettings);
                if (res.success) {
                    alert('주도주 AI 통합 자가학습 설정이 성공적으로 저장되었습니다.');
                } else {
                    alert('설정 저장 실패: ' + res.error);
                }
            }
        } catch (e: any) {
            alert('오류 발생: ' + e.message);
        } finally {
            setIsSaving(false);
        }
    };

    const handleRunManual = async () => {
        setIsManualRunning(true);
        setManualLog('⏳ 주도주 AI 전체 트랙(Track A~E) 일괄 자가학습 가동 중...\n각 트랙별 매매 타점 성적 복기 및 지침서 오답노트 갱신을 순차 진행합니다. (약 1분~2분 소요)');
        try {
            const api = window.electronAPI as any;
            if (api.runTrackSelfLearning) {
                const res = await api.runTrackSelfLearning('ALL', selectedRange);
                if (res.success && res.isAll) {
                    let logResult = `✅ [일괄 자가학습 완료]\n${res.summary}\n\n상세 내역:\n`;
                    res.results.forEach((r: any) => {
                        if (r.skipped) {
                            logResult += `- Track ${r.track}: 학습 유보 (사유: ${r.reason})\n`;
                        } else if (r.success) {
                            logResult += `- Track ${r.track}: 성공 (지침서 guidelines/track_${r.track.toLowerCase()}_phase2.md 갱신 완료)\n`;
                        } else {
                            logResult += `- Track ${r.track}: 실패 (오류: ${r.error || '알 수 없는 오류'})\n`;
                        }
                    });
                    setManualLog(logResult);
                } else {
                    setManualLog(`❌ [자가학습 실패]\n오류: ${res.error || '일괄 실행 중 에러가 발생했습니다.'}`);
                }
            } else {
                setManualLog('❌ [오류] 백엔드 자가학습 API 연결이 지원되지 않습니다.');
            }
        } catch (e: any) {
            setManualLog(`❌ [시스템 에러]\n오류: ${e.message}`);
        } finally {
            setIsManualRunning(false);
        }
    };

    const updateSetting = (field: string, value: any) => {
        setAiSettings((prev: any) => {
            if (!prev) return prev;
            const currentSettings = prev.trackLearningSettings || {};
            return {
                ...prev,
                trackLearningSettings: {
                    ...currentSettings,
                    [field]: value
                }
            };
        });
    };

    if (!aiSettings) {
        return (
            <div className="flex items-center justify-center p-12 text-muted-foreground text-xs">
                설정을 불러오는 중입니다...
            </div>
        );
    }

    const config = aiSettings.trackLearningSettings || {
        enabled: false,
        interval: 'WEEKLY',
        dayOfWeek: [5],
        dayOfMonth: 1,
        time: '16:00',
        holidayOption: 'NEXT_OPEN'
    };

    return (
        <div className="space-y-6 max-w-4xl mx-auto pb-10">
            {/* 1. 수동 자가학습 섹션 */}
            <div className="p-6 bg-indigo-500/5 border border-indigo-500/20 rounded-2xl space-y-4 shadow-sm">
                <div className="flex items-center gap-2 text-indigo-600">
                    <Bot size={18} />
                    <h3 className="text-sm font-bold">주도주 AI 수동(메뉴얼) 자가학습 실행기</h3>
                </div>
                <p className="text-[11px] text-muted-foreground">
                    성과가 종료된 모의매매 종목들의 타점 성적을 복기하여, 지침서 오답노트(절대 규칙)를 일괄 순차 업데이트합니다.
                </p>

                <div className="grid grid-cols-2 gap-6 pt-2">
                    {/* 컨트롤러 */}
                    <div className="space-y-4 flex flex-col justify-between">
                        <div className="space-y-3">
                            <div className="space-y-1.5">
                                <label className="text-[11px] font-bold text-muted-foreground">대상 파이프라인</label>
                                <div className="p-2 border rounded-lg bg-background text-xs font-semibold text-foreground/80">
                                    주도주 AI 전체 (Track A ~ E) 일괄 순차 실행
                                </div>
                            </div>

                            <div className="space-y-1.5">
                                <label className="text-[11px] font-bold text-muted-foreground">학습 데이터 분석 범위</label>
                                <select
                                    value={selectedRange}
                                    onChange={(e) => setSelectedRange(parseInt(e.target.value, 10))}
                                    className="w-full text-xs bg-background border border-border/50 rounded-lg p-2 focus:border-indigo-500 outline-none font-medium"
                                >
                                    <option value={7}>최근 7일 간 청산 완료된 종목</option>
                                    <option value={15}>최근 15일 간 청산 완료된 종목</option>
                                    <option value={30}>최근 30일 간 청산 완료된 종목 (권장)</option>
                                    <option value={90}>최근 90일 간 청산 완료된 종목</option>
                                </select>
                            </div>
                        </div>

                        <button
                            onClick={handleRunManual}
                            disabled={isManualRunning}
                            className="w-full py-2.5 bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white text-xs font-bold rounded-lg transition-colors shadow-sm disabled:opacity-50 flex items-center justify-center gap-2"
                        >
                            {isManualRunning ? (
                                <>
                                    <RefreshCw size={13} className="animate-spin" />
                                    일괄 자가학습 진행 중...
                                </>
                            ) : (
                                <>
                                    <Sparkles className="w-3.5 h-3.5" />
                                    전체 Track 일괄 자가학습 즉시 실행
                                </>
                            )}
                        </button>
                    </div>

                    {/* 로그 모니터 */}
                    <div className="flex flex-col border rounded-lg bg-black/40 p-4 h-[190px] overflow-hidden">
                        <div className="text-[9px] text-muted-foreground font-mono mb-2 shrink-0">EXECUTION LOG CONSOLE</div>
                        <pre className="flex-1 text-[11px] font-mono whitespace-pre-wrap break-all overflow-y-auto text-indigo-200">
                            {manualLog || '대기 중...'}
                        </pre>
                    </div>
                </div>
            </div>

            {/* 2. 통합 정기 스케줄 섹션 */}
            <div className="p-6 bg-card border border-border/50 rounded-2xl space-y-4 shadow-sm">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-foreground">
                        <Settings size={18} className="text-muted-foreground" />
                        <h3 className="text-sm font-bold">주도주 AI 통합 정기 자가학습 스케줄</h3>
                    </div>
                    <button
                        onClick={handleSaveSettings}
                        disabled={isSaving}
                        className="flex items-center gap-2 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg transition-colors disabled:opacity-50 shadow-sm"
                    >
                        <Save size={13} />
                        설정 저장
                    </button>
                </div>

                <div className="border rounded-xl bg-muted/5 p-5 space-y-5">
                    <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                            <span className="text-xs font-bold text-foreground">통합 정기 자가학습 활성화</span>
                            <p className="text-[10px] text-muted-foreground">지정된 스케줄 시간에 AI가 5개 트랙(Track A~E)의 매매 성적을 순차적으로 자동 학습합니다.</p>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer">
                            <input
                                type="checkbox"
                                className="sr-only peer"
                                checked={config.enabled}
                                onChange={(e) => updateSetting('enabled', e.target.checked)}
                            />
                            <div className="w-9 h-5 bg-muted rounded-full peer peer-focus:ring-2 peer-focus:ring-indigo-300 dark:peer-focus:ring-indigo-800 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-600"></div>
                        </label>
                    </div>

                    {config.enabled && (
                        <div className="space-y-4 pt-4 border-t border-border/30 animate-in fade-in duration-200">
                            {/* 주기 */}
                            <div className="space-y-1.5">
                                <label className="text-[10px] font-bold text-muted-foreground">자가학습 실행 주기</label>
                                <div className="grid grid-cols-3 gap-2">
                                    {(['DAILY', 'WEEKLY', 'MONTHLY'] as const).map(interval => (
                                        <button
                                            key={interval}
                                            type="button"
                                            onClick={() => updateSetting('interval', interval)}
                                            className={cn(
                                                'py-1.5 text-xs font-bold rounded-lg border transition-all',
                                                config.interval === interval
                                                    ? 'bg-indigo-600 border-indigo-600 text-white shadow-sm'
                                                    : 'border-border bg-background text-muted-foreground hover:bg-muted/50'
                                            )}
                                        >
                                            {interval === 'DAILY' && '매일 (장마감 후)'}
                                            {interval === 'WEEKLY' && '매주 (지정 요일)'}
                                            {interval === 'MONTHLY' && '매월 (지정 일자)'}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* 요일 (WEEKLY) */}
                            {config.interval === 'WEEKLY' && (
                                <div className="space-y-1.5">
                                    <label className="text-[10px] font-bold text-muted-foreground">실행 요일 (복수 선택 가능)</label>
                                    <div className="grid grid-cols-5 gap-2">
                                        {[
                                            { value: 1, label: '월' },
                                            { value: 2, label: '화' },
                                            { value: 3, label: '수' },
                                            { value: 4, label: '목' },
                                            { value: 5, label: '금' }
                                        ].map(day => {
                                            const days = config.dayOfWeek || [];
                                            const isSelected = days.includes(day.value);
                                            return (
                                                <button
                                                    key={day.value}
                                                    type="button"
                                                    onClick={() => {
                                                        const newDays = isSelected
                                                            ? days.filter((d: number) => d !== day.value)
                                                            : [...days, day.value].sort();
                                                        updateSetting('dayOfWeek', newDays.length > 0 ? newDays : [5]);
                                                    }}
                                                    className={cn(
                                                        'py-1 px-2 text-xs font-medium rounded-md border transition-all',
                                                        isSelected
                                                            ? 'bg-indigo-500/10 border-indigo-500 text-indigo-600 font-bold'
                                                            : 'border-border bg-background text-muted-foreground hover:bg-muted'
                                                    )}
                                                >
                                                    {day.label}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}

                            {/* 일자 (MONTHLY) */}
                            {config.interval === 'MONTHLY' && (
                                <div className="space-y-1.5">
                                    <label className="text-[10px] font-bold text-muted-foreground">실행 일자 지정 (1 ~ 31일)</label>
                                    <div className="flex items-center gap-2">
                                        <input
                                            type="number"
                                            min="1"
                                            max="31"
                                            value={config.dayOfMonth || 1}
                                            onChange={(e) => {
                                                const val = Math.max(1, Math.min(31, parseInt(e.target.value, 10) || 1));
                                                updateSetting('dayOfMonth', val);
                                            }}
                                            className="flex h-8 w-20 rounded-md border border-input bg-background px-3 text-xs outline-none"
                                        />
                                        <span className="text-[11px] text-muted-foreground">일에 자가학습을 수행합니다.</span>
                                    </div>
                                </div>
                            )}

                            {/* 시간 & 휴장일 */}
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-1.5">
                                    <label className="text-[10px] font-bold text-muted-foreground">실행 시간 설정</label>
                                    <input
                                        type="time"
                                        value={config.time || '16:00'}
                                        onChange={(e) => updateSetting('time', e.target.value)}
                                        className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-xs outline-none"
                                    />
                                    <span className="text-[9px] text-muted-foreground block">※ 15:30 이후 장외 시간 지정을 권장합니다.</span>
                                </div>

                                <div className="space-y-1.5">
                                    <label className="text-[10px] font-bold text-muted-foreground">휴장일(주말/공휴일) 동작</label>
                                    <select
                                        value={config.holidayOption || 'NEXT_OPEN'}
                                        onChange={(e) => updateSetting('holidayOption', e.target.value)}
                                        className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-xs outline-none"
                                    >
                                        <option value="SKIP">해당 스케줄 건너뛰기 (SKIP)</option>
                                        <option value="NEXT_OPEN">다음 개장일 장마감 후 소급 실행 (NEXT_OPEN)</option>
                                    </select>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
