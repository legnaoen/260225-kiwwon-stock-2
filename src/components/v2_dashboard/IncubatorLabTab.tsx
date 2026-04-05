import React, { useState, useEffect, useCallback } from 'react'
import { Telescope, Brain, X, TrendingDown, Clock, AlertTriangle, Flame, Eye, BarChart2, Activity, Zap } from 'lucide-react'
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)) }

const appendLog = (msg: string) => {
    console.log(msg)
}

// ── 소외 지수 등급 스타일 ──
const NEGLECT_STYLE = (score: number): string => {
    if (score >= 90) return 'text-rose-400 bg-rose-500/10 border-rose-500/30'
    if (score >= 70) return 'text-amber-400 bg-amber-500/10 border-amber-500/30'
    if (score >= 50) return 'text-indigo-400 bg-indigo-500/10 border-indigo-500/30'
    return 'text-muted-foreground bg-muted/20 border-border/40'
}

// ── 소외 지수 레이블 ──
const NEGLECT_LABEL = (score: number): string => {
    if (score >= 90) return '🔥 매수 타점'
    if (score >= 70) return '👀 소외 진입'
    if (score >= 50) return '⏳ 관망 중'
    return '💤 관심 식음'
}

// ── 펀더멘탈 색상 ──
const FUNDAMENTAL_STYLE: Record<string, string> = {
    SOLID:   'text-emerald-500 bg-emerald-500/10 border-emerald-500/30',
    AVERAGE: 'text-amber-400 bg-amber-500/10 border-amber-500/30',
    WEAK:    'text-muted-foreground bg-muted/20 border-border/40',
}

interface IncubatorStock {
    stock_code: string
    stock_name: string
    theme_name: string
    reason: string
    incubated_days: number
    neglect_score: number
    fundamental_status: 'SOLID' | 'AVERAGE' | 'WEAK'
    peak_date: string
    peak_volume: number
    current_volume: number
    status: 'WATCHING' | 'READY_TO_IGNITE' | 'IGNITED'
}

// ── Detail Drawer ──
function IncubatorDrawer({ stock, onClose }: { stock: any; onClose: () => void }) {
    const volRatio = Math.round((stock.volume_ratio || 1.0) * 100);
    const fundamentalStatus = stock.source === 'FUNDAMENTAL' ? 'SOLID' : 'AVERAGE';
    return (
        <div className="fixed inset-0 z-50 flex justify-end">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
            <div className="relative w-full max-w-sm h-full bg-background border-l border-border flex flex-col shadow-2xl animate-in slide-in-from-right-full duration-200">
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-border/50 bg-muted/20 shrink-0">
                    <div className="flex items-center gap-2">
                        <Telescope className="w-4 h-4 text-indigo-400" />
                        <span className="font-bold text-sm">{stock.stock_name}</span>
                        <span className="text-xs text-muted-foreground font-mono">{stock.stock_code}</span>
                    </div>
                    <button onClick={onClose} className="p-1 hover:bg-muted rounded text-muted-foreground transition-colors">
                        <X className="w-4 h-4" />
                    </button>
                </div>

                {/* Stats Grid */}
                <div className="grid grid-cols-2 gap-3 p-4 border-b border-border/30 shrink-0">
                    {[
                        { label: '소외 지수', value: `${stock.neglect_score || 0} / 100`, color: (stock.neglect_score || 0) >= 90 ? 'text-rose-400' : (stock.neglect_score || 0) >= 70 ? 'text-amber-400' : 'text-indigo-400' },
                        { label: '펀더멘탈 (추정)', value: fundamentalStatus, color: fundamentalStatus === 'SOLID' ? 'text-emerald-500' : '' },
                        { label: '잠복 기간', value: `${stock.days_watched || 0}일`, color: '' },
                        { label: '거래량 소진율', value: `피크 대비 ${volRatio}%`, color: volRatio < 20 ? 'text-rose-400' : '' },
                        { label: '관찰 시작일', value: stock.entry_date || '-', color: '' },
                        { label: 'MA60 이격', value: `${stock.ma60_disparity ? stock.ma60_disparity.toFixed(1) : 0}%`, color: '' },
                    ].map(({ label, value, color }) => (
                        <div key={label} className="bg-muted/10 border border-border/30 rounded-lg p-2.5">
                            <div className="text-[10px] text-muted-foreground uppercase font-bold mb-1">{label}</div>
                            <div className={cn('text-sm font-mono font-bold', color)}>{value}</div>
                        </div>
                    ))}
                </div>

                {/* Theme & Reason */}
                <div className="px-4 pt-4 flex-1 overflow-y-auto">
                    <div className="text-xs font-bold text-muted-foreground uppercase mb-2 flex items-center gap-1.5">
                        <Activity className="w-3.5 h-3.5" /> 분석 근거
                    </div>
                    <div className="mb-3">
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded border bg-indigo-500/10 text-indigo-400 border-indigo-500/30">
                            {stock.source}
                        </span>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">내용: {stock.source_context || '-'}</p>
                    <p className="text-xs text-muted-foreground leading-relaxed mt-2">AI 평가: {stock.ai_evaluation || '-'}</p>

                    {/* AI Logic Note */}
                    <div className="mt-4 p-3 bg-muted/10 border border-border/40 rounded-lg">
                        <div className="flex items-center gap-1.5 mb-2 text-xs font-bold text-amber-400">
                            <AlertTriangle className="w-3.5 h-3.5" /> AI 진입 대기 조건
                        </div>
                        <p className="text-xs text-muted-foreground leading-relaxed">
                            소외 지수가 90점 초과인 상태에서 거래량이 피크 대비 20% 이하로 수렴 중입니다.
                            외국인/기관 순매수 신호 또는 거래대금이 피크 대비 30% 이상 회복 시,
                            포트폴리오 매니저에게 <strong className="text-indigo-400">강력 매수 신호</strong>를 자동 전달합니다.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    )
}

export function IncubatorLabTab() {
    const [selected, setSelected] = useState<any | null>(null)
    const [filterStatus, setFilterStatus] = useState<'ALL' | 'READY_TO_IGNITE' | 'WATCHING'>('ALL')
    const [incubatorList, setIncubatorList] = useState<any[]>([])
    const [isScanning, setIsScanning] = useState(false)

    const fetchIncubator = useCallback(async () => {
        try {
            const incResult = await (window.electronAPI as any).getIncubatorList()
            if (incResult?.success && Array.isArray(incResult.data)) {
                setIncubatorList(incResult.data)
            }
        } catch (e: any) {
            console.error('인큐베이터 로드 실패', e)
        }
    }, [])

    useEffect(() => {
        fetchIncubator()
    }, [fetchIncubator])

    const handleScan = async () => {
        setIsScanning(true)
        try {
            const r = await (window.electronAPI as any).runIncubatorScan()
            if (r?.success) {
                await fetchIncubator()
            } else {
                alert(`스캔 실패: ${r?.error}`)
            }
        } catch (e: any) {
            alert(`오류: ${e.message}`)
        } finally {
            setIsScanning(false)
        }
    }

    const stats = {
        total: incubatorList.length,
        readyCount: incubatorList.filter(s => s.status === 'READY_TO_IGNITE').length,
        avgNeglect: incubatorList.length > 0 ? Math.round(incubatorList.reduce((a, s) => a + (s.neglect_score || 0), 0) / incubatorList.length) : 0,
        solidCount: incubatorList.filter(s => s.source === 'FUNDAMENTAL').length,
    }

    const filteredRows = incubatorList.filter(s => {
        if (filterStatus === 'ALL') return true
        return s.status === filterStatus
    }).sort((a, b) => b.neglect_score - a.neglect_score)

    const FILTERS = [
        { id: 'ALL' as const,           label: '전체' },
        { id: 'READY_TO_IGNITE' as const, label: '🔥 타점 임박' },
        { id: 'WATCHING' as const,      label: '👀 감시 중' },
    ]

    return (
        <div className="flex flex-col h-full overflow-hidden select-none">

            {/* ── Header ── */}
            <div className="shrink-0 px-4 py-3 border-b border-border/50 bg-muted/10">
                <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                        <Telescope className="w-4 h-4 text-indigo-400" />
                        <span className="font-bold text-sm">인큐베이터 랩 (Discovery Lab)</span>
                        <span className="text-[10px] text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 px-1.5 py-0.5 rounded font-bold">Phase 2 Experimental</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <button 
                            onClick={handleScan}
                            disabled={isScanning}
                            className={cn(
                                "flex items-center gap-1.5 text-xs px-3 py-1.5 rounded transition-colors font-bold",
                                isScanning ? "bg-amber-500/10 text-amber-500 border border-amber-500/30 animate-pulse" : "bg-indigo-500/10 text-indigo-400 border border-indigo-500/30 hover:bg-indigo-500/20"
                            )}>
                            <Zap className="w-3.5 h-3.5" />
                            {isScanning ? '스캔 중...' : '지표 스캔 실행'}
                        </button>
                        <button onClick={fetchIncubator} className="text-xs text-muted-foreground hover:text-foreground px-2 py-1.5 rounded hover:bg-muted/30 transition-colors">
                            ⟳ 새로고침
                        </button>
                    </div>
                </div>

                {/* Stats Bar */}
                <div className="grid grid-cols-4 gap-3 mb-3">
                    {[
                        { icon: <Eye className="w-3.5 h-3.5 text-indigo-400" />,      label: '감시 종목', value: `${stats.total}개` },
                        { icon: <Flame className="w-3.5 h-3.5 text-rose-400" />,      label: '타점 임박', value: `${stats.readyCount}개`, color: 'text-rose-400' },
                        { icon: <BarChart2 className="w-3.5 h-3.5 text-amber-400" />, label: '평균 소외지수', value: `${stats.avgNeglect}점` },
                        { icon: <Zap className="w-3.5 h-3.5 text-emerald-500" />,     label: '펀더멘탈 SOLID', value: `${stats.solidCount}개`, color: 'text-emerald-500' },
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

                {/* Filter Tabs */}
                <div className="flex items-center gap-1 bg-muted/30 rounded p-0.5 w-fit">
                    {FILTERS.map(f => (
                        <button
                            key={f.id}
                            onClick={() => setFilterStatus(f.id)}
                            className={cn(
                                'px-3 py-1 rounded text-xs font-medium transition-all',
                                filterStatus === f.id
                                    ? 'bg-background text-foreground shadow-sm'
                                    : 'text-muted-foreground hover:text-foreground'
                            )}
                        >
                            {f.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* ── Table ── */}
            <div className="flex-1 overflow-auto px-4">
                <table className="w-full text-sm text-left whitespace-nowrap">
                    <thead className="sticky top-0 z-10 bg-background">
                        <tr className="text-xs uppercase text-muted-foreground border-b border-border/60">
                            <th className="py-2 pr-3 font-bold w-8">상태</th>
                            <th className="py-2 pr-4 font-bold">종목</th>
                            <th className="py-2 pr-4 font-bold">관련 테마</th>
                            <th className="py-2 pr-4 font-bold text-center">소외 지수</th>
                            <th className="py-2 pr-4 font-bold text-center">펀더멘탈</th>
                            <th className="py-2 pr-4 font-bold text-center">잠복 기간</th>
                            <th className="py-2 pr-4 font-bold text-right">거래량 소진율</th>
                            <th className="py-2 w-6" />
                        </tr>
                    </thead>
                    <tbody>
                        {filteredRows.length === 0 ? (
                            <tr>
                                <td colSpan={8} className="py-12 text-center text-muted-foreground text-xs">
                                    감시 중인 종목이 없습니다.
                                </td>
                            </tr>
                        ) : filteredRows.map(s => {
                            const volRatio = Math.round((s.volume_ratio || 1.0) * 100)
                            const isReady = s.status === 'READY_TO_IGNITE'

                            return (
                                <tr
                                    key={s.stock_code}
                                    onClick={() => setSelected(s)}
                                    className={cn(
                                        'border-b border-border/20 hover:bg-accent/30 cursor-pointer transition-colors group',
                                    )}
                                >
                                    {/* 상태 아이콘 */}
                                    <td className="py-2.5 pr-3 text-base">
                                        {isReady ? (
                                            <span className="animate-pulse">🔥</span>
                                        ) : '👀'}
                                    </td>

                                    {/* 종목 */}
                                    <td className="py-2.5 pr-4">
                                        <div className="font-semibold text-sm">{s.stock_name}</div>
                                        <div className="text-xs font-mono text-muted-foreground">{s.stock_code}</div>
                                    </td>

                                    {/* 테마 */}
                                    <td className="py-2.5 pr-4">
                                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded border bg-indigo-500/10 text-indigo-400 border-indigo-500/30">
                                            {s.source}
                                        </span>
                                    </td>

                                    {/* 소외 지수 */}
                                    <td className="py-2.5 pr-4 text-center">
                                        <div className="flex flex-col items-center gap-1">
                                            <span className={cn(
                                                'text-[10px] font-bold px-1.5 py-0.5 rounded border whitespace-nowrap',
                                                NEGLECT_STYLE(s.neglect_score || 0)
                                            )}>
                                                {NEGLECT_LABEL(s.neglect_score || 0)}
                                            </span>
                                            {/* 점수 바 */}
                                            <div className="flex items-center gap-1.5">
                                                <span className="text-[11px] font-mono font-bold">{s.neglect_score || 0}</span>
                                                <div className="w-14 h-1.5 bg-muted/40 rounded-full overflow-hidden">
                                                    <div
                                                        className={cn('h-full rounded-full', (s.neglect_score||0) >= 90 ? 'bg-rose-500' : (s.neglect_score||0) >= 70 ? 'bg-amber-500' : 'bg-indigo-500')}
                                                        style={{ width: `${s.neglect_score || 0}%` }}
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    </td>

                                    {/* 펀더멘탈 */}
                                    <td className="py-2.5 pr-4 text-center">
                                        <span className={cn(
                                            'text-[10px] font-bold px-1.5 py-0.5 rounded border',
                                            FUNDAMENTAL_STYLE[s.source === 'FUNDAMENTAL' ? 'SOLID' : 'AVERAGE']
                                        )}>
                                            {s.source === 'FUNDAMENTAL' ? 'SOLID' : 'AVERAGE'}
                                        </span>
                                    </td>

                                    {/* 잠복 기간 */}
                                    <td className="py-2.5 pr-4 text-center">
                                        <div className="flex items-center justify-center gap-1 text-[11px] font-mono">
                                            <Clock className="w-3 h-3 text-muted-foreground" />
                                            <span className={cn((s.days_watched || 0) >= 30 ? 'text-amber-400 font-bold' : 'text-muted-foreground')}>
                                                {s.days_watched || 0}일
                                            </span>
                                        </div>
                                    </td>

                                    {/* 거래량 소진율 */}
                                    <td className="py-2.5 pr-4 text-right">
                                        <div className={cn(
                                            'text-[13px] font-bold font-mono',
                                            volRatio <= 10 ? 'text-rose-400' : volRatio <= 20 ? 'text-amber-400' : 'text-muted-foreground'
                                        )}>
                                            피크 대비 {volRatio}%
                                        </div>
                                        <div className="text-[10px] text-muted-foreground mt-0.5">
                                            {volRatio <= 50 ? '🔴 수급 고갈' : volRatio <= 100 ? '🟠 감소 중' : '🟡 활성화'}
                                        </div>
                                    </td>

                                    {/* Arrow */}
                                    <td className="py-2.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity text-right">
                                        ›
                                    </td>
                                </tr>
                            )
                        })}
                    </tbody>
                </table>
            </div>

            {/* ── Drawer ── */}
            {selected && <IncubatorDrawer stock={selected} onClose={() => setSelected(null)} />}
        </div>
    )
}
