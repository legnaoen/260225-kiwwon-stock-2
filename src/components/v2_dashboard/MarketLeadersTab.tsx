import React, { useEffect, useState, useCallback } from 'react'
import { TrendingUp, RefreshCw, BarChart2, Zap, Activity, Target } from 'lucide-react'
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { StockDetailModal } from '../common/StockDetailModal'

function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)) }

// ── Types ──
interface MarketLeaderItem {
    stockCode: string
    stockName: string
    totalChangeRate: number
    marketAlpha: number
    avgTradingValue: number
    score: number
    relatedThemes: string[]
}

interface ThemeRank {
    theme: string
    count: number
}

// ── 거래대금 포맷터 ──
function formatTradingValue(v: number): string {
    if (v >= 1_000_000_000_000) return `${(v / 1_000_000_000_000).toFixed(1)}조`
    if (v >= 100_000_000) return `${Math.round(v / 100_000_000)}억`
    if (v >= 10_000) return `${Math.round(v / 10_000)}만`
    return `${Math.round(v)}원`
}

// ── 순위 뱃지 ──
function RankBadge({ rank }: { rank: number }) {
    const style =
        rank === 1 ? 'text-amber-400 font-black text-base' :
        rank === 2 ? 'text-slate-300 font-black text-base' :
        rank === 3 ? 'text-orange-400 font-black text-base' :
        'text-muted-foreground font-bold text-sm'
    return <span className={cn('font-mono w-5 text-center', style)}>{rank}</span>
}

// ── 알파 수치 ──
function AlphaCell({ value }: { value: number }) {
    const isPos = value > 0
    return (
        <span className={cn(
            'font-mono font-bold text-sm',
            isPos ? 'text-rose-500' : 'text-blue-500'
        )}>
            {isPos ? '+' : ''}{value.toFixed(1)}%
        </span>
    )
}

// ── 테마 뱃지 ──
function ThemeBadge({ theme }: { theme: string }) {
    return (
        <span className="inline-flex items-center px-1.5 py-0.5 rounded border text-[10px] font-bold bg-indigo-500/10 text-indigo-400 border-indigo-500/30 whitespace-nowrap">
            {theme}
        </span>
    )
}

// ── 섹터 랭킹 카드 ──
function ThemeRankCard({ rank, theme, count, isSelected }: { rank: number; theme: string; count: number; isSelected?: boolean }) {
    const rankColor =
        rank === 1 ? 'border-amber-500/30 bg-amber-500/5' :
        rank === 2 ? 'border-slate-400/20 bg-slate-400/5' :
        rank === 3 ? 'border-orange-500/20 bg-orange-500/5' :
        'border-border/30'

    const numColor =
        rank === 1 ? 'text-amber-400' :
        rank === 2 ? 'text-slate-300' :
        rank === 3 ? 'text-orange-400' :
        'text-muted-foreground'

    const selectedStyle = isSelected ? 'ring-2 ring-primary bg-primary/10' : '';

    return (
        <div className={cn('flex items-center gap-3 px-3 py-2.5 rounded-lg border cursor-pointer hover:bg-muted/50 transition-all', rankColor, selectedStyle)}>
            <span className={cn('font-mono font-black text-lg w-5 text-center shrink-0', numColor)}>
                #{rank}
            </span>
            <span className="font-semibold text-sm text-foreground flex-1 truncate">{theme}</span>
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-muted/50 border border-border/40 text-muted-foreground whitespace-nowrap shrink-0">
                대장주 {count}종목
            </span>
        </div>
    )
}

// ─────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────
export const MarketLeadersTab: React.FC = () => {
    const [leaders, setLeaders]     = useState<MarketLeaderItem[]>([])
    const [themes, setThemes]       = useState<ThemeRank[]>([])
    const [days, setDays]           = useState(10)
    const [loading, setLoading]     = useState(false)
    const [ontologyLoading, setOntologyLoading] = useState(false)
    const [lastUpdated, setLastUpdated] = useState<string | null>(null)
    const [marketIndexChange, setMarketIndexChange] = useState<number>(0)
    
    // UI States
    const [selectedTheme, setSelectedTheme] = useState<string | null>(null)
    const [selectedStock, setSelectedStock] = useState<{ stockCode: string; stockName: string } | null>(null)

    const fetchLeaders = useCallback(async () => {
        setLoading(true)
        try {
            const data = await (window as any).electronAPI.getMarketLeaders(days, 30)
            if (data?.success) {
                setLeaders(data.leaders || [])
                setThemes(data.themes || [])
                setMarketIndexChange(data.marketIndexChange || 0)
                setLastUpdated(new Date().toLocaleTimeString('ko-KR', { hour12: false }))
            }
        } catch (err) {
            console.error('[MarketLeaders] fetch error:', err)
        } finally {
            setLoading(false)
        }
    }, [days])

    const runOntologyMapping = async () => {
        setOntologyLoading(true)
        try {
            const res = await (window as any).electronAPI.runThemeOntology()
            if (res.success) {
                alert(`테마 통합 완료! (분석 태그: ${res.result.totalTagsAnalyzed}개 / 신규 및 업데이트 매핑: ${res.result.newMappedKeys}개)`)
                fetchLeaders() // 리렌더링
            } else {
                alert(`테마 통합 중 오류 발생: ${res.error}`)
            }
        } catch (err) {
            console.error('[OntologyMapping] error:', err)
        } finally {
            setOntologyLoading(false)
        }
    }

    useEffect(() => { fetchLeaders() }, [fetchLeaders])

    // ── Derived stats ──
    const filteredLeaders = selectedTheme ? leaders.filter(l => l.relatedThemes.includes(selectedTheme)) : leaders
    const topAlpha     = filteredLeaders.length > 0 ? filteredLeaders[0]?.marketAlpha ?? 0 : 0
    const avgAlpha     = filteredLeaders.length > 0
        ? filteredLeaders.reduce((s, l) => s + l.marketAlpha, 0) / filteredLeaders.length
        : 0
    const mainTheme    = themes.length > 0 ? (selectedTheme || themes[0]?.theme) : '-'
    const totalLeaders = filteredLeaders.length

    const PERIOD_OPTIONS = [
        { label: '1주 (5일)', value: 5 },
        { label: '2주 (10일)', value: 10 },
        { label: '1달 (20일)', value: 20 },
        { label: '3달 (60일)', value: 60 },
    ]

    return (
        <div className="flex flex-col h-full overflow-hidden select-none">

            {/* ── Header ── */}
            <div className="shrink-0 px-4 py-3 border-b border-border/50 bg-muted/10">
                <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                        <TrendingUp className="w-4 h-4 text-amber-400" />
                        <span className="font-bold text-sm">주도주 AI</span>
                        {lastUpdated && (
                            <span className="text-[10px] text-muted-foreground font-mono">
                                최종 업데이트: {lastUpdated}
                            </span>
                        )}
                    </div>
                    <div className="flex items-center gap-2">
                        {/* 기간 선택 토글 탭 */}
                        <div className="flex items-center gap-1 bg-muted/30 rounded p-0.5">
                            {PERIOD_OPTIONS.map(o => (
                                <button
                                    key={o.value}
                                    onClick={() => setDays(o.value)}
                                    className={cn(
                                        'px-3 py-1 text-xs font-bold rounded transition-colors',
                                        days === o.value
                                            ? 'bg-background text-foreground shadow-sm'
                                            : 'text-muted-foreground hover:text-foreground'
                                    )}
                                >
                                    {o.label}
                                </button>
                            ))}
                        </div>
                        <button
                            onClick={runOntologyMapping}
                            disabled={ontologyLoading || loading}
                            className={cn(
                                "text-xs px-2 py-1 rounded transition-colors flex items-center gap-1",
                                ontologyLoading ? "bg-amber-500/20 text-amber-500" : "bg-indigo-500/10 text-indigo-400 hover:bg-indigo-500/20 border border-indigo-500/20"
                            )}
                            title="전체 태그를 읽어 대분류(Macro) 테마로 정규화합니다."
                        >
                            <Zap className={cn('w-3 h-3', ontologyLoading && 'animate-spin text-amber-500')} />
                            {ontologyLoading ? "AI 통합 중..." : "테마 파편화 정리 (AI)"}
                        </button>
                        <button
                            onClick={fetchLeaders}
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
                        { icon: <BarChart2 className="w-3.5 h-3.5 text-indigo-400" />, label: '포착 종목', value: `${totalLeaders}종목` },
                        { icon: <Activity  className="w-3.5 h-3.5 text-blue-400" />,   label: 'KOSPI 수익률', value: `${marketIndexChange > 0 ? '+' : ''}${marketIndexChange.toFixed(1)}%`, color: marketIndexChange > 0 ? 'text-rose-500' : 'text-blue-500' },
                        { icon: <Target    className="w-3.5 h-3.5 text-amber-400" />,  label: '1위 주도 테마', value: mainTheme, truncate: true },
                        { icon: <TrendingUp className="w-3.5 h-3.5 text-rose-500" />,  label: '최고 알파(α)', value: `+${topAlpha.toFixed(1)}%`, color: 'text-rose-500' },
                        { icon: <Zap       className="w-3.5 h-3.5 text-emerald-500" />, label: '평균 알파(α)', value: `${avgAlpha > 0 ? '+' : ''}${avgAlpha.toFixed(1)}%`, color: avgAlpha > 0 ? 'text-rose-500' : 'text-blue-500' },
                    ].map(({ icon, label, value, color, truncate }) => (
                        <div key={label} className="flex items-center gap-2 px-3 py-2 bg-muted/20 border border-border/40 rounded-lg">
                            {icon}
                            <div className="min-w-0">
                                <div className="text-[10px] text-muted-foreground uppercase font-bold">{label}</div>
                                <div className={cn('text-sm font-mono font-bold', color, truncate && 'truncate')}>{value}</div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* ── Body: Left + Right ── */}
            <div className="flex flex-1 overflow-hidden min-h-0">

                {/* ── 좌: 주도 테마 패널 ── */}
                <div className="w-[260px] shrink-0 flex flex-col border-r border-border/50 overflow-hidden">
                    {/* Section: 테마 Top N */}
                    <div className="shrink-0 px-3 py-2.5 border-b border-border/30 bg-muted/10">
                        <div className="flex items-center gap-1.5">
                            <Activity className="w-3.5 h-3.5 text-amber-400" />
                            <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">주도 섹터 랭킹</span>
                        </div>
                        <p className="text-[10px] text-muted-foreground/60 mt-1 leading-relaxed">
                            대장주 군집에서 역산출한 시장 주도 테마
                        </p>
                    </div>
                    <div className="flex-1 overflow-y-auto custom-scrollbar px-3 py-3 space-y-2">
                        {loading ? (
                            <div className="text-center text-muted-foreground text-xs py-8">분석 중...</div>
                        ) : themes.length === 0 ? (
                            <div className="text-center text-muted-foreground text-xs py-8">데이터 없음</div>
                        ) : themes.slice(0, 8).map((t, idx) => (
                            <div key={t.theme} onClick={() => setSelectedTheme(prev => prev === t.theme ? null : t.theme)}>
                                <ThemeRankCard rank={idx + 1} theme={t.theme} count={t.count} isSelected={selectedTheme === t.theme} />
                            </div>
                        ))}
                    </div>

                    {/* Section: AI 브리핑 자리 */}
                    <div className="shrink-0 border-t border-border/30">
                        <div className="px-3 py-2.5 bg-muted/10 border-b border-border/20">
                            <div className="flex items-center gap-1.5">
                                <Zap className="w-3.5 h-3.5 text-yellow-400" />
                                <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">AI 시황 브리핑</span>
                            </div>
                        </div>
                        <div className="px-3 py-3 min-h-[80px]">
                            <div className="p-3 bg-primary/5 border border-primary/15 rounded-xl text-[11px] text-muted-foreground leading-relaxed">
                                (준비 중) 주도 테마와 이슈 레저 데이터를 결합하여 현 시황의 핵심 키워드를 보여주는 자리입니다.
                            </div>
                        </div>
                    </div>
                </div>

                {/* ── 우: 대장주 랭킹 테이블 ── */}
                <div className="flex flex-col flex-1 overflow-hidden min-h-0">
                    {/* Table Header */}
                    <div className="shrink-0 px-4 py-2 border-b border-border/30 bg-muted/5 flex items-center gap-2">
                        <TrendingUp className="w-3.5 h-3.5 text-amber-400" />
                        <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
                            Market Leaders — 대장주 랭킹 {selectedTheme && <span className="text-primary ml-1">[{selectedTheme} 필터됨]</span>}
                        </span>
                        <span className="ml-auto text-[10px] font-mono text-indigo-400 font-bold">{filteredLeaders.length}종목</span>
                    </div>

                    {/* Table */}
                    <div className="flex-1 overflow-auto custom-scrollbar px-4">
                        <table className="w-full text-sm text-left whitespace-nowrap">
                            <thead className="sticky top-0 z-10 bg-background">
                                <tr className="text-xs uppercase text-muted-foreground border-b border-border/60">
                                    <th className="py-2 pr-3 font-bold w-8 text-center">순위</th>
                                    <th className="py-2 pr-4 font-bold">종목명</th>
                                    <th className="py-2 pr-4 font-bold text-right">누적수익률</th>
                                    <th className="py-2 pr-4 font-bold text-right text-rose-400">시장대비 알파 (α)</th>
                                    <th className="py-2 pr-4 font-bold text-right">거래대금 가중치</th>
                                    <th className="py-2 font-bold">핵심 테마</th>
                                </tr>
                            </thead>
                            <tbody>
                                {loading ? (
                                    <tr>
                                        <td colSpan={6} className="py-12 text-center text-muted-foreground text-xs">
                                            <RefreshCw className="w-4 h-4 animate-spin inline mr-2" />
                                            데이터를 분석하고 있습니다...
                                        </td>
                                    </tr>
                                ) : filteredLeaders.length === 0 ? (
                                    <tr>
                                        <td colSpan={6} className="py-12 text-center text-muted-foreground text-xs">
                                            조회된 대장주가 없습니다.
                                        </td>
                                    </tr>
                                ) : filteredLeaders.map((item, idx) => (
                                    <tr
                                        key={item.stockCode}
                                        onClick={() => setSelectedStock({ stockCode: item.stockCode, stockName: item.stockName })}
                                        className="border-b border-border/20 hover:bg-accent/30 transition-colors group cursor-pointer"
                                    >
                                        {/* 순위 */}
                                        <td className="py-2.5 pr-3 text-center">
                                            <RankBadge rank={idx + 1} />
                                        </td>

                                        {/* 종목명 */}
                                        <td className="py-2.5 pr-4">
                                            <div className="font-semibold text-sm text-foreground">{item.stockName}</div>
                                            <div className="text-xs font-mono text-muted-foreground">{item.stockCode}</div>
                                        </td>

                                        {/* 누적수익률 */}
                                        <td className="py-2.5 pr-4 text-right">
                                            <span className={cn(
                                                'font-mono text-sm',
                                                item.totalChangeRate > 0 ? 'text-rose-500' : 'text-blue-500'
                                            )}>
                                                {item.totalChangeRate > 0 ? '+' : ''}{item.totalChangeRate.toFixed(1)}%
                                            </span>
                                        </td>

                                        {/* 알파 */}
                                        <td className="py-2.5 pr-4 text-right">
                                            <AlphaCell value={item.marketAlpha} />
                                        </td>

                                        {/* 거래대금 */}
                                        <td className="py-2.5 pr-4 text-right">
                                            <span className="font-mono text-xs text-muted-foreground">
                                                {formatTradingValue(item.avgTradingValue)}
                                            </span>
                                        </td>

                                        {/* 핵심 테마 */}
                                        <td className="py-2.5">
                                            <div className="flex flex-wrap gap-1">
                                                {item.relatedThemes.slice(0, 2).map(t => (
                                                    <ThemeBadge key={t} theme={t} />
                                                ))}
                                                {item.relatedThemes.length > 2 && (
                                                    <span className="text-[10px] text-muted-foreground self-center">
                                                        +{item.relatedThemes.length - 2}
                                                    </span>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            {selectedStock && (
                <StockDetailModal 
                    stockCode={selectedStock.stockCode} 
                    stockName={selectedStock.stockName} 
                    onClose={() => setSelectedStock(null)} 
                />
            )}
        </div>
    )
}
