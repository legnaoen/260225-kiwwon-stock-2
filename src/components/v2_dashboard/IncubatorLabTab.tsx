import React, { useState } from 'react'
import { Telescope, Brain, X, TrendingDown, Clock, AlertTriangle, Flame, Eye, BarChart2, Activity, Zap } from 'lucide-react'
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)) }

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
function IncubatorDrawer({ stock, onClose }: { stock: IncubatorStock; onClose: () => void }) {
    const volRatio = Math.round((stock.current_volume / stock.peak_volume) * 100)
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
                        { label: '소외 지수', value: `${stock.neglect_score} / 100`, color: stock.neglect_score >= 90 ? 'text-rose-400' : stock.neglect_score >= 70 ? 'text-amber-400' : 'text-indigo-400' },
                        { label: '펀더멘탈', value: stock.fundamental_status, color: stock.fundamental_status === 'SOLID' ? 'text-emerald-500' : '' },
                        { label: '잠복 기간', value: `${stock.incubated_days}일`, color: '' },
                        { label: '거래량 소진율', value: `피크 대비 ${volRatio}%`, color: volRatio < 20 ? 'text-rose-400' : '' },
                        { label: '피크 날짜', value: stock.peak_date, color: '' },
                        { label: '현재 거래량', value: `${(stock.current_volume / 10000).toFixed(0)}만주`, color: '' },
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
                            {stock.theme_name}
                        </span>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">{stock.reason}</p>

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

// ── Mock Data (TODO: DB 연동 후 제거) ──
const MOCK_DATA: IncubatorStock[] = [
    {
        stock_code: '005930', stock_name: '테스트전자', theme_name: '유리 기판',
        reason: '내년 북미 데이터센터 독점 공급 계약 임박 찌라시. 증권사 영업이익 추정치 20% 상향 조정 완료.',
        incubated_days: 14, neglect_score: 95, fundamental_status: 'SOLID',
        peak_date: '2026-03-15', peak_volume: 15400000, current_volume: 320000, status: 'READY_TO_IGNITE'
    },
    {
        stock_code: '000660', stock_name: '하이반도체', theme_name: 'HBM 장비',
        reason: '피크아웃 우려로 주가 25% 하락했으나, 3분기 실적 컨센서스 상회 확실시. 외국인 5일 연속 순매수.',
        incubated_days: 28, neglect_score: 80, fundamental_status: 'SOLID',
        peak_date: '2026-02-28', peak_volume: 8500000, current_volume: 1200000, status: 'WATCHING'
    },
    {
        stock_code: '003550', stock_name: '조선중공', theme_name: '조선 슈퍼사이클',
        reason: 'LNG 운반선 수주잔고 사상 최대치이나 현재 시장의 시선은 AI 반도체로 쏠림. 대형 블록딜 이후 조용히 반등 시작.',
        incubated_days: 45, neglect_score: 72, fundamental_status: 'SOLID',
        peak_date: '2026-01-20', peak_volume: 6200000, current_volume: 980000, status: 'WATCHING'
    },
    {
        stock_code: '028260', stock_name: '삼성물산', theme_name: '데이터센터 건설',
        reason: '미국 빅테크 데이터센터 EPC 계약 보도 있었으나, 시장 피로감으로 뚝 떨어진 상태. 재무구조 최상위급.',
        incubated_days: 7, neglect_score: 58, fundamental_status: 'AVERAGE',
        peak_date: '2026-03-22', peak_volume: 3100000, current_volume: 750000, status: 'WATCHING'
    },
]

export function IncubatorLabTab() {
    const [selected, setSelected] = useState<IncubatorStock | null>(null)
    const [filterStatus, setFilterStatus] = useState<'ALL' | 'READY_TO_IGNITE' | 'WATCHING'>('ALL')

    const stats = {
        total: MOCK_DATA.length,
        readyCount: MOCK_DATA.filter(s => s.status === 'READY_TO_IGNITE').length,
        avgNeglect: Math.round(MOCK_DATA.reduce((a, s) => a + s.neglect_score, 0) / MOCK_DATA.length),
        solidCount: MOCK_DATA.filter(s => s.fundamental_status === 'SOLID').length,
    }

    const filteredRows = MOCK_DATA.filter(s => {
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
                    <button className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-muted/30 transition-colors">
                        ⟳ 새로고침
                    </button>
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
                            const volRatio = Math.round((s.current_volume / s.peak_volume) * 100)
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
                                            {s.theme_name}
                                        </span>
                                    </td>

                                    {/* 소외 지수 */}
                                    <td className="py-2.5 pr-4 text-center">
                                        <div className="flex flex-col items-center gap-1">
                                            <span className={cn(
                                                'text-[10px] font-bold px-1.5 py-0.5 rounded border whitespace-nowrap',
                                                NEGLECT_STYLE(s.neglect_score)
                                            )}>
                                                {NEGLECT_LABEL(s.neglect_score)}
                                            </span>
                                            {/* 점수 바 */}
                                            <div className="flex items-center gap-1.5">
                                                <span className="text-[11px] font-mono font-bold">{s.neglect_score}</span>
                                                <div className="w-14 h-1.5 bg-muted/40 rounded-full overflow-hidden">
                                                    <div
                                                        className={cn('h-full rounded-full', s.neglect_score >= 90 ? 'bg-rose-500' : s.neglect_score >= 70 ? 'bg-amber-500' : 'bg-indigo-500')}
                                                        style={{ width: `${s.neglect_score}%` }}
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    </td>

                                    {/* 펀더멘탈 */}
                                    <td className="py-2.5 pr-4 text-center">
                                        <span className={cn(
                                            'text-[10px] font-bold px-1.5 py-0.5 rounded border',
                                            FUNDAMENTAL_STYLE[s.fundamental_status]
                                        )}>
                                            {s.fundamental_status}
                                        </span>
                                    </td>

                                    {/* 잠복 기간 */}
                                    <td className="py-2.5 pr-4 text-center">
                                        <div className="flex items-center justify-center gap-1 text-[11px] font-mono">
                                            <Clock className="w-3 h-3 text-muted-foreground" />
                                            <span className={cn(s.incubated_days >= 30 ? 'text-amber-400 font-bold' : 'text-muted-foreground')}>
                                                {s.incubated_days}일
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
                                            {volRatio <= 20 ? '🔴 수급 고갈' : volRatio <= 40 ? '🟠 감소 중' : '🟡 소진 중'}
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
