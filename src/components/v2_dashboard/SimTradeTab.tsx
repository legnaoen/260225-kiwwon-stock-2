import React, { useEffect, useState, useMemo } from 'react'
import { TrendingUp, RefreshCw, Target, BarChart2, Award, Clock, ArrowUpRight, ArrowDownRight, Minus } from 'lucide-react'
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
}

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
export const SimTradeTab: React.FC = () => {
    const [picks, setPicks] = useState<SimTradePick[]>([])
    const [loading, setLoading] = useState(false)
    const [selectedStock, setSelectedStock] = useState<{ stockCode: string; stockName: string; aiReason?: string; aiRisk?: string } | null>(null)
    const [filterStatus, setFilterStatus] = useState<'all' | 'ACTIVE' | 'CLOSED'>('all')

    const fetchPicks = async () => {
        setLoading(true)
        try {
            const data = await (window as any).electronAPI.getSimTradePicks()
            if (data?.picks) {
                setPicks(data.picks)
            }
        } catch (err) {
            console.error('[SimTrade] fetch error:', err)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => { fetchPicks() }, [])

    // ── 필터 적용 ──
    const filteredPicks = useMemo(() => {
        if (filterStatus === 'all') return picks
        return picks.filter(p => p.status === filterStatus)
    }, [picks, filterStatus])

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
            // 날짜 내에서는 순위순
            datePicks.sort((a, b) => a.pick_rank - b.pick_rank)
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
                    <div className="flex items-center gap-2">
                        <Target className="w-4 h-4 text-amber-400" />
                        <span className="font-bold text-sm">모의매매 — AI 매수 추천 성과 추적</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 font-black border border-amber-500/30">
                            5영업일 · 목표 +15%
                        </span>
                    </div>
                    <div className="flex items-center gap-2">
                        {/* 필터 칩 */}
                        <div className="flex items-center gap-1 bg-muted/30 rounded p-0.5">
                            {([
                                { key: 'all', label: '전체' },
                                { key: 'ACTIVE', label: '보유중' },
                                { key: 'CLOSED', label: '완료' },
                            ] as const).map(f => (
                                <button
                                    key={f.key}
                                    onClick={() => setFilterStatus(f.key)}
                                    className={cn(
                                        'px-3 py-1 text-xs font-bold rounded transition-colors',
                                        filterStatus === f.key
                                            ? 'bg-background text-foreground shadow-sm'
                                            : 'text-muted-foreground hover:text-foreground'
                                    )}
                                >
                                    {f.label}
                                </button>
                            ))}
                        </div>
                        <button
                            onClick={async () => {
                                setLoading(true);
                                try {
                                    alert('모의매매 AI 선정을 시작합니다. 약 20~30초 소요됩니다.');
                                    await (window as any).electronAPI.runTrackBBuyAgent();
                                    alert('선정이 완료되었습니다.');
                                    await fetchPicks();
                                } catch(e: any) {
                                    alert('에러 발생: ' + e.message);
                                } finally {
                                    setLoading(false);
                                }
                            }}
                            disabled={loading}
                            className="text-xs font-bold text-white bg-indigo-500 hover:bg-indigo-600 px-3 py-1.5 rounded transition-colors shadow-sm"
                        >
                            🚀 AI 매수 추천 실행
                        </button>
                        <button
                            onClick={fetchPicks}
                            disabled={loading}
                            className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-muted/30 transition-colors flex items-center gap-1"
                        >
                            <RefreshCw className={cn('w-3 h-3', loading && 'animate-spin')} />
                            새로고침
                        </button>
                    </div>
                </div>

                {/* Stats Bar */}
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
            </div>

            {/* ── 메인 테이블 ── */}
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
                                <th className="py-2 px-3 font-bold text-center">카테고리</th>
                                <th className="py-2 px-3 font-bold text-center">AI점수</th>
                                <th className="py-2 px-3 font-bold text-right">진입가</th>
                                <th className="py-2 px-3 font-bold text-right">현재/청산가</th>
                                <th className="py-2 px-3 font-bold text-center">D-day</th>
                                <th className="py-2 px-3 font-bold text-right">피크</th>
                                <th className="py-2 px-3 font-bold text-right">현재수익</th>
                                <th className="py-2 px-3 font-bold text-center">상태</th>
                            </tr>
                        </thead>
                        <tbody>
                            {groupedByDate.map(({ date, picks: datePicks }) => (
                                <React.Fragment key={date}>
                                    {/* ── 날짜 구분 행 ── */}
                                    <tr className="bg-muted/30 border-y border-border/40">
                                        <td colSpan={10} className="py-2 px-3">
                                            <div className="flex items-center gap-3">
                                                <span className="font-black text-xs text-foreground">
                                                    📅 {date} ({getDateLabel(date)})
                                                </span>
                                                <span className="text-[10px] text-muted-foreground font-mono">
                                                    {getDateSummary(datePicks)}
                                                </span>
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
                                                key={pick.id}
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
                                            </tr>
                                        )
                                    })}
                                </React.Fragment>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>

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
        </div>
    )
}
