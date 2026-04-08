import React, { useEffect, useState, useCallback } from 'react'
import { TrendingUp, RefreshCw, BarChart2, Zap, Activity, Target, Layers, GitMerge, Thermometer, Volume2, AlertTriangle, Info, Shield } from 'lucide-react'
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { StockDetailModal } from '../common/StockDetailModal'
import { StockChart } from '../StockChart'
import { StockAiReport } from '../StockAiReport'

function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)) }

// ── Types ──
interface PeakoutSettings {
    p1BuyingClimax: boolean
    p2ShootingStar: boolean
    p3GapReversal: boolean
    p4ConsecBearish: boolean
    p5Divergence: boolean
    drawdownThreshold: number
    alertThreshold: number
    confirmedThreshold: number
}

const DEFAULT_PEAKOUT_SETTINGS: PeakoutSettings = {
    p1BuyingClimax: true,
    p2ShootingStar: true,
    p3GapReversal: true,
    p4ConsecBearish: true,
    p5Divergence: false,
    drawdownThreshold: 10,
    alertThreshold: 2,
    confirmedThreshold: 5,
}

const STORAGE_KEY_PEAKOUT = 'trackb_peakout_settings_v4'

function loadPeakoutSettings(): PeakoutSettings {
    try {
        const saved = localStorage.getItem(STORAGE_KEY_PEAKOUT)
        if (saved) return { ...DEFAULT_PEAKOUT_SETTINGS, ...JSON.parse(saved) }
    } catch {}
    return { ...DEFAULT_PEAKOUT_SETTINGS }
}

interface MarketLeaderItem {
    stockCode: string
    stockName: string
    totalChangeRate: number
    marketAlpha: number
    avgTradingValue: number
    score: number
    relatedThemes: string[]
    alphaTimeline?: (boolean | null)[]
    inverseRiseCount?: number
    phase?: 'LEADER' | 'CANDIDATE' | null
    peakoutWarning?: boolean
    peakoutScore?: number
    peakoutLevel?: 'NONE' | 'ALERT' | 'CONFIRMED'
    drawdownFromPeak?: number
    recentTrend?: 'UP' | 'DOWN' | 'FLAT'
    validAlphaDays?: number
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

    // 피크아웃 설정 (localStorage 지속)
    const [peakoutSettings, setPeakoutSettings] = useState<PeakoutSettings>(loadPeakoutSettings)
    const [showPeakoutPanel, setShowPeakoutPanel] = useState(false)

    // UI States
    const [activeTrack, setActiveTrack] = useState<string>('track-a-theme')
    const [selectedTheme, setSelectedTheme] = useState<string | null>(null)
    const [selectedStock, setSelectedStock] = useState<{ stockCode: string; stockName: string } | null>(null)
    const [showPhaseInfo, setShowPhaseInfo] = useState(false)

    const fetchLeaders = useCallback(async () => {
        setLoading(true)
        try {
            const data = await (window as any).electronAPI.getMarketLeaders(days, 30, peakoutSettings)
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
    }, [days, peakoutSettings])

    const updatePeakoutSetting = (key: keyof PeakoutSettings, value: boolean | number) => {
        const next = { ...peakoutSettings, [key]: value }
        setPeakoutSettings(next)
        localStorage.setItem(STORAGE_KEY_PEAKOUT, JSON.stringify(next))
    }

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

    // 팝업 외부 클릭 시 닫기
    useEffect(() => {
        if (!showPeakoutPanel) return
        const handler = (e: MouseEvent) => {
            const target = e.target as HTMLElement
            if (!target.closest('[data-peakout-panel]')) setShowPeakoutPanel(false)
        }
        document.addEventListener('mousedown', handler)
        return () => document.removeEventListener('mousedown', handler)
    }, [showPeakoutPanel])

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

            {/* ── 최상단 트랙 탭 ── */}
            <div className="shrink-0 flex items-center gap-1 px-3 pt-2.5 pb-0 border-b border-border/50 bg-muted/5">
                {([
                    { id: 'track-a-theme', label: 'Track A — 대장 테마',  icon: Activity,   badge: 'NEW' },
                    { id: 'track-a-stock', label: 'Track A — 대장 종목',  icon: Target,     badge: '예정' },
                    { id: 'track-b-new',   label: 'Track B — 알파 역상관', icon: Shield,     badge: '알파' },
                    { id: 'track-b',       label: '주도주 (기존)',        icon: TrendingUp, badge: null },
                ] as const).map(tab => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTrack(tab.id)}
                        className={cn(
                            'relative flex items-center gap-1.5 px-3 py-2 text-xs font-bold rounded-t-md transition-all border-b-2 -mb-px',
                            activeTrack === tab.id
                                ? 'border-primary text-primary bg-background'
                                : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/30'
                        )}
                    >
                        <tab.icon className="w-3.5 h-3.5" />
                        {tab.label}
                        {tab.badge && (
                            <span className={cn(
                                'px-1 py-0.5 rounded text-[9px] font-black leading-none',
                                tab.badge === 'NEW' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-muted text-muted-foreground'
                            )}>
                                {tab.badge}
                            </span>
                        )}
                    </button>
                ))}
            </div>

            {/* ── Track A: 대장 테마 ── */}
            {activeTrack === 'track-a-theme' && (
                <TrackAPanel />
            )}

            {/* ── Track A: 대장 종목 ── */}
            {activeTrack === 'track-a-stock' && (
                <TrackAStockPanel />
            )}

            {/* ── Track B: 주도주 (기존 화면) & Track B New ── */}
            {(activeTrack === 'track-b' || activeTrack === 'track-b-new') && (<>
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
                        {/* ⚙️ 피크아웃 설정 버튼 — Track B에서만 표시 */}
                        {activeTrack === 'track-b-new' && (
                            <div className="relative" data-peakout-panel>
                                <button
                                    onClick={() => setShowPeakoutPanel(p => !p)}
                                    className={cn(
                                        "text-xs px-2 py-1 rounded flex items-center gap-1 border transition-colors",
                                        showPeakoutPanel
                                            ? "bg-violet-500/20 text-violet-300 border-violet-500/40"
                                            : "bg-muted/20 text-muted-foreground hover:text-foreground border-border/40 hover:border-border"
                                    )}
                                    title="피크아웃 감지 패턴 설정"
                                >
                                    ⚙️ 피크아웃 설정
                                </button>

                                {/* ─── 팝업 드롭다운 패널 ─── */}
                                {showPeakoutPanel && (
                                    <div className="absolute right-0 top-full mt-1 z-50 w-80 bg-card border border-border rounded-xl shadow-2xl overflow-hidden">

                                        {/* 헤더 */}
                                        <div className="flex items-center justify-between px-4 py-3 bg-violet-500/10 border-b border-border/50">
                                            <span className="text-sm font-black text-violet-300 tracking-wide">⚙️ 피크아웃 감지 설정</span>
                                            <button
                                                onClick={() => { setPeakoutSettings({ ...DEFAULT_PEAKOUT_SETTINGS }); localStorage.removeItem(STORAGE_KEY_PEAKOUT) }}
                                                className="text-xs text-muted-foreground hover:text-foreground px-2 py-0.5 rounded hover:bg-muted/40 transition-colors border border-border/40"
                                            >
                                                초기화
                                            </button>
                                        </div>

                                        {/* 패턴 토글 목록 */}
                                        <div className="px-4 py-3 space-y-2.5">
                                            <p className="text-xs text-muted-foreground/60 mb-1">활성화된 패턴의 점수를 합산해 경보/확정 레벨을 결정합니다.</p>
                                            {([
                                                {
                                                    key: 'p1BuyingClimax',
                                                    label: 'P1. 바이잉 클라이맥스',
                                                    score: '+3',
                                                    desc: '거래대금 3배 폭증 + 고점 근처 음봉',
                                                    tooltip: '세력·기관이 마지막으로 대물량을 쏟아내며 개인에게 매도하는 패턴.\n"가장 많은 돈이 들어온 날에 음봉" = 주로 천장 신호.\n광전자처럼 급등 후 폭발적 거래량과 함께 음봉이 출현하면 강하게 감지됩니다.'
                                                },
                                                {
                                                    key: 'p2ShootingStar',
                                                    label: 'P2. 위꼬리 장대봉',
                                                    score: '+2',
                                                    desc: '위꼬리 비중 60%+ + 2배 거래량',
                                                    tooltip: '장중 고점까지 치솟았다가 결국 매도 압력에 눌려 하락 마감하는 패턴.\n위꼬리 길이가 총 변동폭의 60% 이상이면 감지합니다.\n"올라갈 힘은 있었지만 스마트머니가 저항선에서 팔고 있다"는 신호.'
                                                },
                                                {
                                                    key: 'p3GapReversal',
                                                    label: 'P3. 갭업 키리버설',
                                                    score: '+3',
                                                    desc: '갭 상승 출발 → 전일 종가 아래 마감',
                                                    tooltip: '아침에 환호하며 갭 상승으로 시작했지만, 장 내내 팔림을 받아 전일 종가 아래로 마감.\n"기대감으로 샀지만 이미 세력은 팔고 있었다"는 강력한 반전 신호.\n단일 패턴 중 신뢰도가 가장 높습니다.'
                                                },
                                                {
                                                    key: 'p4ConsecBearish',
                                                    label: 'P4. 연속음봉+거래증가',
                                                    score: '+2',
                                                    desc: '3일 연속 음봉 + 이전보다 거래대금 증가',
                                                    tooltip: '하락하는데 오히려 거래량이 늘어나는 것은 공격적인 매도 물량이 나오고 있다는 의미.\n"파는 사람이 점점 많아지고 있다" = 하락 압력 가속 신호.\n추세 전환 초기보다는 하락 확인 단계에서 유효합니다.'
                                                },
                                                {
                                                    key: 'p5Divergence',
                                                    label: 'P5. 신고가 다이버전스',
                                                    score: '+2',
                                                    desc: '신고가 시도 but 거래량 이전 대비 70% 미만',
                                                    tooltip: '가격은 새 고점을 시도하는데 거래량이 이전 고점 갱신 시점보다 현저히 적은 경우.\n"더 올리려는데 힘이 없다" = 모멘텀 소진 조기 신호.\n아직 많이 빠지지 않은 종목에서 가장 선행으로 포착 가능하지만,\n오탐률이 높아 기본값 OFF(실험적)로 설정되어 있습니다.'
                                                },
                                            ] as const).map(({ key, label, score, desc, tooltip }) => (
                                                <div key={key} className="flex items-start gap-3 py-1.5 px-2 rounded-lg hover:bg-muted/20 transition-colors">
                                                    {/* 체크박스 */}
                                                    <button
                                                        onClick={() => updatePeakoutSetting(key, !peakoutSettings[key])}
                                                        className={cn(
                                                            "mt-0.5 w-5 h-5 rounded border-2 shrink-0 flex items-center justify-center transition-all",
                                                            peakoutSettings[key]
                                                                ? "bg-violet-500 border-violet-500 shadow-[0_0_6px_rgba(139,92,246,0.4)]"
                                                                : "bg-transparent border-border/60 hover:border-violet-400"
                                                        )}
                                                    >
                                                        {peakoutSettings[key] && <span className="text-white text-[10px] font-black leading-none">✓</span>}
                                                    </button>
                                                    {/* 레이블 + 설명 */}
                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex items-center gap-2">
                                                            <span className={cn("text-xs font-bold", peakoutSettings[key] ? "text-foreground" : "text-muted-foreground")}>
                                                                {label}
                                                            </span>
                                                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-400 font-black">{score}점</span>
                                                        </div>
                                                        <span className="text-[11px] text-muted-foreground/70 leading-relaxed">{desc}</span>
                                                    </div>
                                                    {/* 툴팁 아이콘 */}
                                                    <div className="relative group shrink-0 mt-0.5">
                                                        <span className="w-4 h-4 rounded-full bg-muted/50 border border-border/60 text-[10px] text-muted-foreground flex items-center justify-center cursor-help hover:border-violet-400 hover:text-violet-300 transition-colors">
                                                            ?
                                                        </span>
                                                        {/* 말풍선 */}
                                                        <div className="absolute right-0 top-full mt-1 z-[60] w-56 bg-popover border border-border rounded-lg p-2.5 shadow-xl hidden group-hover:block pointer-events-none">
                                                            <p className="text-xs text-foreground/90 leading-relaxed whitespace-pre-line">{tooltip}</p>
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>

                                        {/* 구분선 */}
                                        <div className="border-t border-border/40 mx-4" />

                                        {/* 수치 설정 슬라이더 */}
                                        <div className="px-4 py-3 space-y-3">
                                            <p className="text-xs font-bold text-muted-foreground">임계값 설정</p>
                                            {([
                                                {
                                                    key: 'drawdownThreshold',
                                                    label: '낙폭 가산점',
                                                    unit: '%',
                                                    min: 5, max: 30, step: 5,
                                                    tooltip: '기간 내 고점 대비 현재 낙폭이 이 값 이상이면 +1점 보너스를 추가합니다.\n낮게 설정할수록 더 많은 종목이 "낙폭 감지"로 추가 점수를 받습니다.\n예: 10% → 고점 대비 10% 하락 시 +1점, 20% 하락 시 +1점 추가 (총 +2점)',
                                                    example: (v: number) => `고점 대비 ${v}% 이상 하락 시 +1점 (20% 이상이면 +2점)`
                                                },
                                                {
                                                    key: 'alertThreshold',
                                                    label: '⚠️ 경보 기준',
                                                    unit: '점',
                                                    min: 1, max: 8, step: 1,
                                                    tooltip: '패턴 합산 점수가 이 값 이상이면 ⚠️ 경보 배지를 표시합니다.\n낮게 설정할수록 더 많은 종목이 경보로 감지됩니다.\n※ 반드시 "확정 기준"보다 낮아야 합니다.',
                                                    example: (v: number) => `합산 점수 ${v}점 이상 → ⚠️ 경보 배지 표시`
                                                },
                                                {
                                                    key: 'confirmedThreshold',
                                                    label: '☠️ 확정 기준',
                                                    unit: '점',
                                                    min: 3, max: 12, step: 1,
                                                    tooltip: '패턴 합산 점수가 이 값 이상이면 ☠️ 피크확정 배지를 표시합니다.\n높게 설정할수록 정밀하지만 더 적게 감지됩니다.\n예: P1(+3) + P3(+3) = 6점 → 기본 기준(5점) 초과 시 확정',
                                                    example: (v: number) => `합산 점수 ${v}점 이상 → ☠️ 피크확정 배지 표시`
                                                },
                                            ] as const).map(({ key, label, unit, min, max, step, tooltip, example }) => (
                                                <div key={key}>
                                                    <div className="flex items-center gap-2 mb-1">
                                                        <span className="text-xs text-muted-foreground flex-1">{label}</span>
                                                        <span className="text-xs font-mono font-bold text-violet-300">
                                                            {peakoutSettings[key]}{unit}
                                                        </span>
                                                        {/* 슬라이더 툴팁 아이콘 */}
                                                        <div className="relative group">
                                                            <span className="w-4 h-4 rounded-full bg-muted/50 border border-border/60 text-[10px] text-muted-foreground flex items-center justify-center cursor-help hover:border-violet-400 hover:text-violet-300 transition-colors">
                                                                ?
                                                            </span>
                                                            <div className="absolute right-0 bottom-full mb-1 z-[60] w-56 bg-popover border border-border rounded-lg p-2.5 shadow-xl hidden group-hover:block pointer-events-none">
                                                                <p className="text-xs text-foreground/90 leading-relaxed whitespace-pre-line">{tooltip}</p>
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <input
                                                        type="range" min={min} max={max} step={step}
                                                        value={peakoutSettings[key] as number}
                                                        onChange={e => updatePeakoutSetting(key, Number(e.target.value))}
                                                        className="w-full h-1.5 accent-violet-500 cursor-pointer"
                                                    />
                                                    <p className="text-[10px] text-violet-400/70 mt-0.5 leading-snug">
                                                        → {example(peakoutSettings[key] as number)}
                                                    </p>
                                                </div>
                                            ))}
                                        </div>

                                        {/* 적용 버튼 */}
                                        <div className="px-4 pb-4">
                                            <button
                                                onClick={() => { setShowPeakoutPanel(false); fetchLeaders() }}
                                                className="w-full py-2 rounded-lg bg-violet-500/20 text-violet-300 border border-violet-500/30 hover:bg-violet-500/30 transition-colors text-sm font-bold"
                                            >
                                                설정 적용 후 새로고침
                                            </button>
                                        </div>
                                    </div>
                                )}

                            </div>
                        )}
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
                    <div className="flex-1 overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none] px-3 py-3 space-y-2">
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
                    <div className="flex-1 overflow-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none] px-4">
                        <table className="w-full text-sm text-left whitespace-nowrap">
                            <thead className="sticky top-0 z-10 bg-background">
                                <tr className="text-xs uppercase text-muted-foreground border-b border-border/60">
                                    <th className="py-2 pr-3 font-bold w-8 text-center">순위</th>
                                    <th className="py-2 pr-4 font-bold">종목명</th>
                                    <th className="py-2 pr-4 font-bold text-right">누적수익률</th>
                                    <th className="py-2 pr-4 font-bold text-right text-rose-400">시장대비 알파 (α)</th>
                                    {activeTrack === 'track-b-new' && (
                                        <>
                                            <th className="py-2 pr-4 font-bold text-center">알파 타임라인</th>
                                            <th className="py-2 pr-4 font-bold text-center">
                                                <div className="flex items-center justify-center gap-1">
                                                    현재 국면
                                                    <button onClick={() => setShowPhaseInfo(true)} className="text-muted-foreground hover:text-foreground">
                                                        <Info className="w-3.5 h-3.5" />
                                                    </button>
                                                </div>
                                            </th>
                                        </>
                                    )}
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
                                            <div className="flex items-center gap-1.5">
                                                <div className="font-semibold text-sm text-foreground">{item.stockName}</div>
                                                {/* 역상관 헷지 마크 표시 */}
                                                {activeTrack === 'track-b-new' && (item.inverseRiseCount ?? 0) >= (days <= 5 ? 1 : (days <= 10 ? 2 : 3)) && (
                                                    <span title={`하락장 방어/역상관성이 짙은 헷지 종목 (최근 방어 횟수: ${item.inverseRiseCount}회)`} className="flex items-center justify-center bg-blue-500/10 border border-blue-500/20 rounded px-1 group-hover:bg-blue-500/20 transition-colors cursor-help">
                                                        <Shield className="w-3 h-3 text-blue-400" />
                                                    </span>
                                                )}
                                            </div>
                                            <div className="text-xs font-mono text-muted-foreground">{item.stockCode}</div>
                                        </td>

                                        {/* 누적수익률 */}
                                        <td className="py-2.5 pr-4 text-right">
                                            <span className={cn('font-mono text-sm', item.totalChangeRate > 0 ? 'text-rose-500' : 'text-blue-500')}>
                                                {item.totalChangeRate > 0 ? '+' : ''}{item.totalChangeRate.toFixed(1)}%
                                            </span>
                                        </td>

                                        {/* 알파 */}
                                        <td className="py-2.5 pr-4 text-right">
                                            <AlphaCell value={item.marketAlpha} />
                                        </td>

                                        {/* 알파 타임라인 & 국면 배지 */}
                                        {activeTrack === 'track-b-new' && (
                                            <>
                                                <td className="py-2.5 pr-4 text-center">
                                                    <div className="flex items-center justify-center gap-0.5">
                                                        {(item.alphaTimeline || []).map((win, i) => (
                                                            win === null
                                                                ? <div key={i} className="w-2 h-4 rounded-sm bg-muted/40 border border-border/30" title="거래정지일" />
                                                                : <div key={i} className={cn("w-2 h-4 rounded-sm", win ? "bg-rose-500/80" : "bg-blue-500/40")} title={win ? "시장수익률 이김" : "시장수익률 짐"} />
                                                        ))}
                                                    </div>
                                                </td>
                                                <td className="py-2.5 pr-4 text-center min-w-[80px]">
                                                    <div className="flex flex-col items-center gap-0.5">
                                                        {item.phase === 'LEADER' && (
                                                            <span className="text-[10px] bg-red-500/10 text-red-500 border border-red-500/30 px-1.5 py-0.5 rounded font-bold whitespace-nowrap">
                                                                👑 대장주
                                                            </span>
                                                        )}
                                                        {item.phase === 'CANDIDATE' && (
                                                            <span className="text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 px-1.5 py-0.5 rounded font-bold whitespace-nowrap">
                                                                🚀 대장후보
                                                            </span>
                                                        )}
                                                        {item.peakoutLevel === 'ALERT' && (
                                                            <span
                                                                title={`피크아웃 경보 (점수: ${item.peakoutScore}) · 고점 대비 -${item.drawdownFromPeak?.toFixed(1)}%`}
                                                                className="text-[10px] bg-yellow-500/15 text-yellow-400 border border-yellow-500/40 px-1.5 py-0.5 rounded font-bold whitespace-nowrap cursor-help"
                                                            >
                                                                ⚠️ 경보
                                                            </span>
                                                        )}
                                                        {item.peakoutLevel === 'CONFIRMED' && (
                                                            <span
                                                                title={`피크아웃 확정 (점수: ${item.peakoutScore}) · 고점 대비 -${item.drawdownFromPeak?.toFixed(1)}% · 추세 ${item.recentTrend}`}
                                                                className="text-[10px] bg-red-900/20 text-red-400 border border-red-500/50 px-1.5 py-0.5 rounded font-bold whitespace-nowrap cursor-help"
                                                            >
                                                                ☠️ 피크확정
                                                            </span>
                                                        )}
                                                        {!item.phase && (!item.peakoutLevel || item.peakoutLevel === 'NONE') && (
                                                            <span className="text-[10px] text-muted-foreground">-</span>
                                                        )}
                                                    </div>
                                                </td>
                                            </>
                                        )}



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

            {/* 국면 판별 설명 팝업 */}
            {showPhaseInfo && (
                <div className="fixed inset-0 z-[100] bg-background/80 backdrop-blur-sm flex justify-center items-center p-4">
                    <div className="bg-popover border border-border/50 rounded-xl w-[550px] shadow-2xl overflow-hidden flex flex-col">
                        <div className="px-5 py-4 border-b flex items-center justify-between bg-muted/30">
                            <h3 className="font-bold text-base flex items-center gap-2">
                                <Shield className="w-4 h-4 text-primary" />
                                4대 국면(Phase) 판별 기준
                            </h3>
                            <button onClick={() => setShowPhaseInfo(false)} className="text-muted-foreground hover:text-foreground">✕</button>
                        </div>
                        <div className="p-5 space-y-4 text-sm text-muted-foreground overflow-y-auto max-h-[60vh] [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
                            
                            <div className="space-y-1">
                                <h4 className="font-bold text-red-500 flex items-center gap-1.5"><span className="text-base">👑</span> 대장주 (Leader)</h4>
                                <p className="pl-6 mb-2">현재 시장을 강하게 이끌고 있는 진성 주도주</p>
                                <ul className="list-disc pl-10 space-y-1 text-xs">
                                    <li><strong className="text-foreground">과열도 (heat_60):</strong> 30% ~ 70% 구간 (시세가 강하게 분출 중)</li>
                                    <li><strong className="text-foreground">단기 모멘텀:</strong> 최근 5일 중 최소 4일 이상 시장수익률을 상회 (승률 80% 이상)</li>
                                </ul>
                            </div>

                            <div className="space-y-1">
                                <h4 className="font-bold text-emerald-400 flex items-center gap-1.5"><span className="text-base">🚀</span> 대장후보 (Candidate) <span className="text-emerald-500/50 bg-emerald-500/10 px-1 py-0.5 rounded text-[10px] ml-1">Best Buy</span></h4>
                                <p className="pl-6 mb-2">바닥을 다지다 시장 수익률을 역전하기 시작한 초입 종목</p>
                                <ul className="list-disc pl-10 space-y-1 text-xs">
                                    <li><strong className="text-foreground">과열도 (heat_60):</strong> 0% ~ 30% 미만 (하방성이 막힌 바닥 구간)</li>
                                    <li><strong className="text-foreground">단기 모멘텀:</strong> 최근 들어 뚜렷하게 긍정적(+) 단위 알파를 뿜으며 우상향 턴어라운드 시작</li>
                                </ul>
                            </div>

                            <div className="space-y-1">
                                <h4 className="font-bold text-purple-400 flex items-center gap-1.5"><span className="text-base">🔄</span> 눌림목 (Rebound/Dip)</h4>
                                <p className="pl-6 mb-2">1차 급상승 후 잠시 조정을 받고 다시 2차 상승 파동을 준비중인 종목</p>
                                <ul className="list-disc pl-10 space-y-1 text-xs">
                                    <li><strong className="text-foreground">과열도 (heat_60):</strong> 20% ~ 50% 수준 (고점 대비 과열이 다소 식음)</li>
                                    <li><strong className="text-foreground">단기 모멘텀:</strong> 최근 며칠간은 마이너스(조정) 알파였으나, 최근 들어 강하게 알파 양전(+) 추세 이탈</li>
                                </ul>
                            </div>

                            <div className="space-y-1">
                                <h4 className="font-bold text-slate-400 flex items-center gap-1.5"><span className="text-base">☠️</span> 피크아웃 (Peak-out)</h4>
                                <p className="pl-6 mb-2">가장 화려하게 터진 후 탄력이 죽어가며 매도 압력이 커지는 위험구간</p>
                                <ul className="list-disc pl-10 space-y-1 text-xs">
                                    <li><strong className="text-foreground">과열도 (heat_60):</strong> 70% 이상 (단기간 심각한 오버슈팅 상태)</li>
                                    <li><strong className="text-foreground">단기 모멘텀:</strong> 과거와 달리 최근 5일 기준 시장 지수 대비 연패하며 음수 알파 빈도 상승</li>
                                </ul>
                            </div>

                        </div>
                    </div>
                </div>
            )}
            </>)}

            {/* ── 통합 비교 탭 (제거됨) ── */}
        </div>
    )
}

// ─────────────────────────────────────────────────────────────
// TRACK A PANEL — 수급 레짐 대시보드 (Phase 1-C 완성)
// ─────────────────────────────────────────────────────────────

type RegimeRow = {
    id: number; snapshot_date: string; type: string; name: string;
    leader_status: string; appearances_10d: number;
    avg_rank_5d: number; rank_today: number | null; change_rate_today: number;
    lifespan_type: string | null; heat_score_60d: number; heat_score_120d: number;
    stock_avg_heat_60: number; vol_ratio_5d_20d: number;
    entry_zone: string; combined_signal: string; ai_summary: string | null;
    theme_abs_vol?: number;
}

type TimelineRow = {
    snapshot_date: string; leader_status: string; entry_zone: string;
    combined_signal: string; rank_today: number | null;
    heat_score_60d: number; vol_ratio_5d_20d: number; change_rate_today: number;
}

// ── 시그널 메타 ──
const SIGNAL_META: Record<string, { label: string; rowBg: string; badgeCls: string; dot: string }> = {
    BEST_BUY:    { label: '🎯 BEST_BUY',    rowBg: 'bg-emerald-500/5 hover:bg-emerald-500/10', badgeCls: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30', dot: 'bg-emerald-400' },
    BUY:         { label: '✅ BUY',          rowBg: 'bg-blue-500/5 hover:bg-blue-500/10',       badgeCls: 'bg-blue-500/15 text-blue-400 border-blue-500/30',       dot: 'bg-blue-400' },
    REVIVAL_BUY: { label: '🔄 REVIVAL',      rowBg: 'bg-purple-500/5 hover:bg-purple-500/10',   badgeCls: 'bg-purple-500/15 text-purple-400 border-purple-500/30', dot: 'bg-purple-400' },
    HOLD_ONLY:   { label: '⚠️ HOLD',         rowBg: 'bg-yellow-500/5 hover:bg-yellow-500/10',   badgeCls: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30', dot: 'bg-yellow-400' },
    WATCH:       { label: '👀 WATCH',         rowBg: 'hover:bg-muted/30',                        badgeCls: 'bg-muted text-muted-foreground border-border/50',        dot: 'bg-muted-foreground' },
    SELL_ALERT:  { label: '🔴 SELL_ALERT',   rowBg: 'bg-red-500/5 hover:bg-red-500/10',         badgeCls: 'bg-red-500/15 text-red-400 border-red-500/30',           dot: 'bg-red-400' },
    PREPARE_EXIT:{ label: '⚠️ PREP_EXIT',    rowBg: 'bg-red-500/5 hover:bg-red-500/10',         badgeCls: 'bg-orange-500/15 text-orange-400 border-orange-500/30',  dot: 'bg-orange-400' },
    EXIT:        { label: '🔴 EXIT',          rowBg: 'bg-red-500/10 hover:bg-red-500/15',        badgeCls: 'bg-red-600/20 text-red-400 border-red-600/40',           dot: 'bg-red-500' },
}

const STATUS_BADGE: Record<string, string> = {
    CONFIRMED:     '🏆 CONFIRMED',
    EMERGING:      '🚀 EMERGING',
    STRENGTHENING: '📈 GROWING',
    DECLINING:     '📉 DECLINING',
    PAST:          '💤 PAST',
    CANDIDATE:     '👀 CANDIDATE',
}

const ZONE_COLOR: Record<string, string> = {
    EARLY:    'text-emerald-400',
    MOMENTUM: 'text-blue-400',
    RISK:     'text-yellow-400',
    AVOID:    'text-red-400',
    RELOAD:   'text-purple-400',
}

const FILTERS = [
    { id: 'all',      label: '전체' },
    { id: 'buy',      label: '매수' },
    { id: 'hold',     label: '보유' },
    { id: 'exit',     label: '매도' },
]

const FILTER_SIGNALS: Record<string, string[]> = {
    buy:  ['BEST_BUY', 'BUY', 'REVIVAL_BUY'],
    hold: ['HOLD_ONLY', 'WATCH'],
    exit: ['SELL_ALERT', 'PREPARE_EXIT', 'EXIT'],
}

function HeatBar({ value, max = 100 }: { value: number; max?: number }) {
    const pct = Math.min((value / max) * 100, 100)
    const color = value < 20 ? 'bg-emerald-500' : value < 40 ? 'bg-blue-500' : value < 60 ? 'bg-yellow-500' : 'bg-red-500'
    return (
        <div className="flex items-center gap-1.5 w-full">
            <div className="flex-1 h-1.5 rounded-full bg-muted/40 overflow-hidden">
                <div className={cn('h-full rounded-full', color)} style={{ width: `${pct}%` }} />
            </div>
            <span className={cn('text-[10px] font-mono font-bold w-8 text-right', ZONE_COLOR[value < 20 ? 'EARLY' : value < 40 ? 'MOMENTUM' : value < 60 ? 'RISK' : 'AVOID'])}>
                {value.toFixed(0)}%
            </span>
        </div>
    )
}

const TrackAPanel: React.FC = () => {
    const [rows, setRows]               = useState<RegimeRow[]>([])
    const [loading, setLoading]         = useState(false)
    const [analyzing, setAnalyzing]     = useState(false)
    const [lastDate, setLastDate]       = useState<string | null>(null)
    const [filter, setFilter]           = useState('all')
    const [algoMode, setAlgoMode]       = useState<'HEAT' | 'MOMENTUM' | 'MAJOR'>('HEAT')
    const [typeFilter, setTypeFilter]   = useState<'ALL' | 'THEME' | 'SECTOR'>('ALL')
    const [showInfo, setShowInfo]       = useState(false)
    const [selected, setSelected]       = useState<RegimeRow | null>(null)
    const [timeline, setTimeline]       = useState<TimelineRow[]>([])
    const [tlLoading, setTlLoading]     = useState(false)
    const [themeStocks, setThemeStocks] = useState<any[]>([])
    const [selectedStock, setSelectedStock] = useState<any | null>(null)

    const fetchSnapshot = useCallback(async () => {
        setLoading(true)
        try {
            const signals = filter === 'all' ? undefined : FILTER_SIGNALS[filter]
            const res = await (window as any).electronAPI.invoke('track-a:get-regime-snapshot', {
                signals,
                type: typeFilter === 'ALL' ? undefined : typeFilter,
            })
            if (res?.success) {
                setRows(res.data || [])
                setLastDate(res.date)
            }
        } catch (e) { console.error('[TrackA] fetch error', e) }
        finally { setLoading(false) }
    }, [filter, typeFilter])

    const runAnalysis = async () => {
        setAnalyzing(true)
        try {
            const res = await (window as any).electronAPI.invoke('track-a:run-regime-analysis')
            if (res?.success) {
                await fetchSnapshot()
            } else {
                console.error('[TrackA] analysis failed:', res?.error)
            }
        } catch (e) { console.error('[TrackA] analysis error', e) }
        finally { setAnalyzing(false) }
    }

    const fetchTimeline = async (row: RegimeRow) => {
        setTlLoading(true)
        try {
            const res = await (window as any).electronAPI.invoke('track-a:get-regime-timeline', {
                type: row.type, name: row.name, days: 30,
            })
            if (res?.success) setTimeline(res.data || [])
        } catch (e) { console.error('[TrackA] timeline error', e) }
        finally { setTlLoading(false) }
    }

    useEffect(() => { fetchSnapshot() }, [fetchSnapshot])

    const fetchConstituents = async (row: RegimeRow) => {
        try {
            const res = await (window as any).electronAPI.invoke('track-a:get-theme-stocks', { name: row.name })
            if (res?.success) setThemeStocks(res.data || [])
            else setThemeStocks([])
        } catch (e) {
            console.error('[TrackA] theme stocks error', e)
            setThemeStocks([])
        }
    }

    const handleSelect = (row: RegimeRow) => {
        if (selected?.name === row.name) {
            setSelected(null)
            setThemeStocks([])
            setSelectedStock(null)
        } else {
            setSelected(row)
            fetchTimeline(row)
            fetchConstituents(row)
            setSelectedStock(null)
        }
    }

    const sortedRows = React.useMemo(() => {
        return [...rows].sort((a, b) => {
            let scoreA = 0, scoreB = 0;
            if (algoMode === 'HEAT') {
                scoreA = a.heat_score_60d || 0;
                scoreB = b.heat_score_60d || 0;
            } else if (algoMode === 'MOMENTUM') {
                scoreA = (a.heat_score_60d || 0) * (a.vol_ratio_5d_20d || 1);
                scoreB = (b.heat_score_60d || 0) * (b.vol_ratio_5d_20d || 1);
            } else if (algoMode === 'MAJOR') {
                scoreA = (a.heat_score_60d || 0) * Math.log10(Math.max(2, a.theme_abs_vol || 2));
                scoreB = (b.heat_score_60d || 0) * Math.log10(Math.max(2, b.theme_abs_vol || 2));
            }
            return scoreB - scoreA;
        });
    }, [rows, algoMode]);

    // 요약 통계
    const bestBuyCount  = sortedRows.filter(r => r.combined_signal === 'BEST_BUY').length
    const exitCount     = sortedRows.filter(r => ['EXIT', 'SELL_ALERT'].includes(r.combined_signal)).length
    const avgHeat       = sortedRows.length ? (sortedRows.reduce((s, r) => s + (r.heat_score_60d ?? 0), 0) / sortedRows.length) : 0

    return (
        <div className="flex-1 flex flex-col overflow-hidden min-h-0">

            {/* 헤더 */}
            <div className="shrink-0 px-4 py-2.5 border-b border-border/50 bg-muted/10">
                <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                        <Activity className="w-4 h-4 text-emerald-400" />
                        <span className="font-bold text-sm">Track A — 수급 레짐</span>
                        {lastDate && <span className="text-[10px] font-mono text-muted-foreground">{lastDate}</span>}
                        <button onClick={() => setShowInfo(true)} className="ml-1 text-muted-foreground hover:text-foreground">
                            <Info className="w-3.5 h-3.5" />
                        </button>
                    </div>
                    <div className="flex items-center gap-2">
                        {/* 정렬 필터 */}
                        <div className="flex items-center gap-0.5 bg-muted/30 rounded p-0.5 mr-2">
                            {(['HEAT', 'MOMENTUM', 'MAJOR'] as const).map(t => (
                                <button key={t} onClick={() => setAlgoMode(t)}
                                    className={cn('px-2 py-0.5 text-[10px] font-bold rounded transition-colors',
                                        algoMode === t ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                                    )}>
                                    {t === 'HEAT' ? '상승비율' : t === 'MOMENTUM' ? '모멘텀' : '메이저'}
                                </button>
                            ))}
                        </div>
                        {/* 타입 필터 */}
                        <div className="flex items-center gap-0.5 bg-muted/30 rounded p-0.5">
                            {(['ALL', 'THEME', 'SECTOR'] as const).map(t => (
                                <button key={t} onClick={() => setTypeFilter(t)}
                                    className={cn('px-2 py-0.5 text-[10px] font-bold rounded transition-colors',
                                        typeFilter === t ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                                    )}>{t}</button>
                            ))}
                        </div>
                        <button onClick={runAnalysis} disabled={analyzing}
                            className="text-xs px-2 py-1 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 flex items-center gap-1 transition-colors disabled:opacity-50">
                            <Zap className={cn('w-3 h-3', analyzing && 'animate-spin')} />
                            {analyzing ? '분석 중...' : '레짐 분석 실행'}
                        </button>
                        <button onClick={fetchSnapshot} disabled={loading}
                            className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-muted/30 flex items-center gap-1">
                            <RefreshCw className={cn('w-3 h-3', loading && 'animate-spin')} />
                        </button>
                    </div>
                </div>

                {/* 요약 스탯 + 필터 */}
                <div className="flex items-center gap-3">
                    {/* 통계 */}
                    <div className="flex items-center gap-2 text-[10px]">
                        <span className="px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-bold">🎯 {bestBuyCount}건</span>
                        <span className="px-1.5 py-0.5 rounded bg-red-500/10 text-red-400 font-bold">🔴 {exitCount}건</span>
                        <span className="text-muted-foreground">avg heat: <span className="font-mono font-bold">{avgHeat.toFixed(0)}%</span></span>
                    </div>
                    <div className="flex-1" />
                    {/* 시그널 필터 */}
                    <div className="flex items-center gap-1">
                        {FILTERS.map(f => (
                            <button key={f.id} onClick={() => setFilter(f.id)}
                                className={cn('px-2 py-0.5 text-[10px] font-bold rounded transition-colors',
                                    filter === f.id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-muted/30'
                                )}>{f.label}</button>
                        ))}
                    </div>
                </div>
            </div>

            {/* 바디 */}
            <div className="flex flex-1 overflow-hidden min-h-0">

                {/* 좌: 레짐 목록 */}
                <div className={cn('flex flex-col overflow-hidden border-r border-border/50 transition-all', selected ? 'w-[450px] shrink-0' : 'flex-1')}>
                    <div className="flex-1 overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
                        {loading ? (
                            <div className="flex items-center justify-center h-full text-sm text-muted-foreground gap-2">
                                <RefreshCw className="w-4 h-4 animate-spin" />분석 중...
                            </div>
                        ) : sortedRows.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-full gap-3 text-center p-8">
                                <Thermometer className="w-8 h-8 text-muted-foreground/30" />
                                <p className="text-sm font-semibold text-muted-foreground">레짐 데이터 없음</p>
                                <p className="text-xs text-muted-foreground/60 max-w-xs">
                                    "레짐 분석 실행" 버튼을 눌러 오늘의 수급 레짐을 분석하세요.<br/>
                                    naver_market_flow 데이터가 필요합니다.
                                </p>
                                <button onClick={runAnalysis} disabled={analyzing}
                                    className="text-xs px-3 py-1.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 flex items-center gap-1.5">
                                    <Zap className="w-3 h-3" />레짐 분석 실행
                                </button>
                            </div>
                        ) : (
                            <table className="w-full text-sm">
                                <thead className="sticky top-0 z-10 bg-background border-b border-border/40">
                                    <tr className="text-xs uppercase text-muted-foreground">
                                        <th className="py-1.5 px-3 text-left font-bold w-28">신호</th>
                                        <th className="py-1.5 px-2 text-left font-bold">테마/섹터</th>
                                        <th className="py-1.5 px-2 text-left font-bold w-20">상태</th>
                                        <th className="py-1.5 px-2 text-left font-bold w-28">Heat(60봉)</th>
                                        <th className="py-1.5 px-2 text-right font-bold w-16">거래량↑</th>
                                        <th className="py-1.5 px-2 text-right font-bold w-10">순위</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {sortedRows.map((row, idx) => {
                                        const meta = SIGNAL_META[row.combined_signal] ?? SIGNAL_META['WATCH']
                                        const isSelected = selected?.name === row.name
                                        return (
                                            <tr key={`${row.type}-${row.name}`}
                                                onClick={() => handleSelect(row)}
                                                className={cn(
                                                    'border-b border-border/20 cursor-pointer transition-colors text-xs',
                                                    meta.rowBg,
                                                    isSelected && 'ring-1 ring-inset ring-primary/50 bg-primary/5'
                                                )}
                                            >
                                                {/* 신호 */}
                                                <td className="py-2 px-3">
                                                    <span className={cn('inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-xs font-bold', meta.badgeCls)}>
                                                        <span className={cn('w-1.5 h-1.5 rounded-full', meta.dot)} />
                                                        {row.combined_signal}
                                                    </span>
                                                </td>
                                                {/* 테마명 */}
                                                <td className="py-2 px-2">
                                                    <div className="font-semibold text-sm text-foreground truncate max-w-[160px]">{row.name}</div>
                                                    <div className="text-xs text-muted-foreground">{row.type}</div>
                                                </td>
                                                {/* Leader Status */}
                                                <td className="py-2 px-2">
                                                    <span className="text-xs text-muted-foreground font-mono">
                                                        {STATUS_BADGE[row.leader_status] ?? row.leader_status}
                                                    </span>
                                                </td>
                                                {/* Heat Bar */}
                                                <td className="py-2 px-2">
                                                    <HeatBar value={row.heat_score_60d ?? 0} />
                                                </td>
                                                {/* vol_ratio */}
                                                <td className="py-2 px-2 text-right">
                                                    <span className={cn('font-mono font-bold text-xs',
                                                        (row.vol_ratio_5d_20d ?? 1) >= 1.2 ? 'text-emerald-400' :
                                                        (row.vol_ratio_5d_20d ?? 1) < 0.8  ? 'text-red-400' : 'text-muted-foreground'
                                                    )}>
                                                        {(row.vol_ratio_5d_20d ?? 0).toFixed(1)}x
                                                    </span>
                                                </td>
                                                {/* 오늘 순위 */}
                                                <td className="py-2 px-2 text-right">
                                                    <span className="font-mono text-muted-foreground text-xs">
                                                        {row.rank_today ?? '—'}
                                                    </span>
                                                </td>
                                            </tr>
                                        )
                                    })}
                                </tbody>
                            </table>
                        )}
                    </div>
                </div>

                {/* 우: 선택 테마 상세 패널 */}
                {selected && (
                    <div className="w-[360px] shrink-0 flex flex-col overflow-hidden bg-muted/5 font-sans">
                        {/* 패널 헤더 */}
                        <div className="shrink-0 px-4 py-3 border-b border-border/40 flex items-center justify-between">
                            <div>
                                <p className="font-bold text-base truncate">{selected.name}</p>
                                <p className="text-xs text-muted-foreground font-mono mt-0.5">{selected.type} · {selected.entry_zone} zone</p>
                            </div>
                            <button onClick={() => setSelected(null)} className="text-muted-foreground hover:text-foreground text-sm">✕</button>
                        </div>

                        <div className="flex-1 overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none] px-4 py-4 space-y-4">
                            {/* Heat Score 게이지 */}
                            <div className="p-3.5 rounded-lg border border-border/40 bg-background/50 space-y-2.5">
                                <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">과열도 (Heat Score)</p>
                                <div className="space-y-2">
                                    <div className="flex items-center gap-2 text-xs">
                                        <span className="text-muted-foreground w-14">60봉</span>
                                        <HeatBar value={selected.heat_score_60d ?? 0} />
                                    </div>
                                    <div className="flex items-center gap-2 text-xs">
                                        <span className="text-muted-foreground w-14">120봉</span>
                                        <HeatBar value={selected.heat_score_120d ?? 0} max={150} />
                                    </div>
                                    <div className="flex items-center gap-2 text-xs">
                                        <span className="text-muted-foreground w-14">구성종목</span>
                                        <HeatBar value={selected.stock_avg_heat_60 ?? 0} />
                                    </div>
                                </div>
                            </div>

                            {/* 주요 지표 */}
                            <div className="grid grid-cols-2 gap-2.5">
                                {[
                                    { label: '거래량 비율', value: `${(selected.vol_ratio_5d_20d ?? 0).toFixed(2)}x`, color: (selected.vol_ratio_5d_20d ?? 1) >= 1.2 ? 'text-emerald-400' : (selected.vol_ratio_5d_20d ?? 1) < 0.8 ? 'text-red-400' : 'text-foreground' },
                                    { label: '오늘 등락', value: `${(selected.change_rate_today ?? 0) > 0 ? '+' : ''}${(selected.change_rate_today ?? 0).toFixed(1)}%`, color: (selected.change_rate_today ?? 0) > 0 ? 'text-rose-500' : 'text-blue-500' },
                                    { label: '10일 출현', value: `${selected.appearances_10d ?? 0}회`, color: '' },
                                    { label: '오늘 순위', value: selected.rank_today ? `#${selected.rank_today}` : 'Top20 밖', color: '' },
                                ].map(s => (
                                    <div key={s.label} className="p-2.5 rounded border border-border/30 bg-background/40">
                                        <p className="text-[11px] text-muted-foreground mb-0.5">{s.label}</p>
                                        <p className={cn('text-base font-mono font-bold', s.color)}>{s.value}</p>
                                    </div>
                                ))}
                            </div>

                            {/* 30일 타임라인 히트맵 */}
                            <div className="p-3.5 rounded-lg border border-border/40 bg-background/50">
                                <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2.5">
                                    30일 Regime 히스토리
                                </p>
                                {tlLoading ? (
                                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />로딩 중...
                                    </div>
                                ) : timeline.length === 0 ? (
                                    <p className="text-xs text-muted-foreground/60">히스토리 없음</p>
                                ) : (
                                    <div className="flex flex-wrap gap-1.5">
                                        {timeline.map(t => {
                                            const meta = SIGNAL_META[t.combined_signal] ?? SIGNAL_META['WATCH']
                                            return (
                                                <div key={t.snapshot_date} title={`${t.snapshot_date} | ${t.combined_signal} | heat=${t.heat_score_60d?.toFixed(0)}%`}
                                                    className={cn('w-4 h-4 rounded-sm', meta.dot)} />
                                            )
                                        })}
                                    </div>
                                )}
                            </div>

                            {/* AI 생애주기 */}
                            {selected.lifespan_type && (
                                <div className="p-3.5 rounded-lg border border-border/40 bg-primary/5">
                                    <p className="text-xs font-bold text-muted-foreground uppercase mb-1.5">AI 생애주기</p>
                                    <div className="flex items-center gap-1.5">
                                        <span className={cn('px-2.5 py-1 rounded text-xs font-bold',
                                            selected.lifespan_type === '과열' || selected.lifespan_type === '설거지'
                                                ? 'bg-red-500/15 text-red-400' : 'bg-emerald-500/15 text-emerald-400'
                                        )}>{selected.lifespan_type}</span>
                                    </div>
                                    {selected.ai_summary && (
                                        <p className="text-xs text-muted-foreground mt-2 leading-relaxed">{selected.ai_summary}</p>
                                    )}
                                </div>
                            )}

                            {/* 테마 구성 종목 */}
                            <div className="p-3.5 rounded-lg border border-border/40 bg-background/50">
                                <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2.5">구성 종목 (Heat/Drawdown)</p>
                                {themeStocks.length === 0 ? (
                                    <p className="text-xs text-muted-foreground/60 text-center py-3">종목 데이터 없음</p>
                                ) : (
                                    <div className="space-y-1.5 pr-1">
                                        {themeStocks.map((stock: any, idx) => (
                                            <div 
                                                key={stock.stock_code} 
                                                onClick={() => setSelectedStock(stock)}
                                                className={cn(
                                                    "cursor-pointer flex flex-col p-2.5 rounded transition-colors border",
                                                    selectedStock?.stock_code === stock.stock_code 
                                                        ? "bg-primary/10 border-primary/30" 
                                                        : "bg-muted/20 border-transparent hover:bg-muted/40 hover:border-border/50"
                                                )}
                                            >
                                                <div className="flex items-center justify-between mb-1.5">
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-[10px] text-muted-foreground w-4">{idx + 1}</span>
                                                        <span className={cn("text-sm font-bold", selectedStock?.stock_code === stock.stock_code ? "text-primary" : "")}>{stock.stock_name}</span>
                                                    </div>
                                                    <span className="text-xs font-mono whitespace-nowrap px-1.5 py-0.5 rounded-sm bg-background border border-border/30 text-muted-foreground">
                                                        vol: {stock.vol_ratio.toFixed(1)}x
                                                    </span>
                                                </div>
                                                <div className="flex items-center text-[11px] font-mono pl-6 text-muted-foreground">
                                                    <span>고점 <span className="font-bold text-blue-400">-{Math.abs(stock.drawdown_60).toFixed(1)}%</span></span>
                                                    <span className="mx-2 opacity-30">/</span>
                                                    <span>저점 <span className={cn("font-bold", stock.heat_60 >= 60 ? "text-red-400" : stock.heat_60 >= 20 ? "text-orange-400" : "text-emerald-400")}>
                                                        {stock.heat_60 >= 999 ? '-' : `+${Number(stock.heat_60).toFixed(1)}%`}
                                                    </span></span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {/* 우측 3: 개별 종목 차트 / 리포트 표시 */}
                {selected && selectedStock && (
                    <div className="flex-1 flex flex-col min-w-0 border-l border-border/50 bg-background z-10 transition-all">
                        <div className="shrink-0 p-3 bg-muted/10 border-b border-border flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <span className="font-bold text-sm text-primary">{selectedStock.stock_name}</span>
                                <span className="text-xs font-mono text-muted-foreground bg-muted border border-border/50 px-1.5 py-0.5 rounded">{selectedStock.stock_code}</span>
                            </div>
                            <button onClick={() => setSelectedStock(null)} className="text-muted-foreground hover:text-foreground p-1 hover:bg-muted rounded-full">✕</button>
                        </div>
                        <div className="h-[300px] border-b border-border/50 shrink-0 relative flex flex-col pb-2">
                            <StockChart stockCode={selectedStock.stock_code} stockName={selectedStock.stock_name} />
                        </div>
                        <div className="flex-1 overflow-y-auto px-6 py-4 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
                            <StockAiReport symbol={selectedStock.stock_code} name={selectedStock.stock_name} hideTitle />
                        </div>
                    </div>
                )}
            </div>

            {/* 알고리즘 설명 팝업 */}
            {showInfo && (
                <div className="fixed inset-0 z-[100] bg-background/80 backdrop-blur-sm flex justify-center items-center p-4">
                    <div className="bg-popover border border-border/50 rounded-xl w-[500px] shadow-2xl overflow-hidden flex flex-col">
                        <div className="px-5 py-4 border-b flex items-center justify-between bg-muted/30">
                            <h3 className="font-bold text-base flex items-center gap-2">
                                <Activity className="w-4 h-4 text-emerald-400" />
                                대장섹터 및 종목 순위산정 알고리즘
                            </h3>
                            <button onClick={() => setShowInfo(false)} className="text-muted-foreground hover:text-foreground">✕</button>
                        </div>
                        <div className="p-5 space-y-4 text-sm text-muted-foreground overflow-y-auto max-h-[60vh] [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
                            
                            <div className="space-y-1">
                                <h4 className="font-bold text-foreground">1. 테마 & 섹터산정 (좌측 패널)</h4>
                                <ul className="list-disc pl-5 space-y-1">
                                    <li><strong className="text-foreground">HEAT(60봉) 평균 (최우선 정렬):</strong> 각 테마 소속 종목들의 1차 평균 상승률을 구한 뒤, <span className="text-primary font-bold">그 평균 이상인 '핵심 주도주'들만 추려내어 재평균</span> 낸 밀도 높은 점수로 정렬합니다. (단순 평균 시 발생하는 후발주 깎아먹기 방지)</li>
                                    <li><strong className="text-foreground">모멘텀 순위 후순위 정렬:</strong> HEAT 점수가 동일할 경우 최근 거래대금이 폭발한 모멘텀 순위로 차순위 정렬됩니다.</li>
                                    <li><strong className="text-foreground">생애주기 정렬:</strong> 마지막으로 AI가 분석한 테마 생애주기(BEST_BUY, BUY 등)에 의해 그룹핑됩니다.</li>
                                </ul>
                            </div>

                            <div className="space-y-1">
                                <h4 className="font-bold text-foreground">2. 구성 종목 대장주 산정 (중앙 패널)</h4>
                                <ul className="list-disc pl-5 space-y-1">
                                    <li><strong className="text-foreground">Heat-60 (저점대비 상승률):</strong> 60거래일 내 최저가 대비 상승률이 가장 높은 종목을 대장주 그룹으로 간주합니다. (내림차순 정렬 도입 완료)</li>
                                    <li><strong className="text-foreground">단기 변동성 (Vol Ratio):</strong> 단기 5일 평균 거래대금이 20일 평균 거래대금보다 압도적으로 폭발한 종목들 중, 상승 추세를 잃지 않은 종목이 최상단에 오릅니다.</li>
                                </ul>
                            </div>

                            <div className="p-3 rounded-lg bg-orange-500/10 border border-orange-500/20 text-orange-400 text-xs">
                                💡 <strong>Tip:</strong> UI에 표기된 순서는 데이터베이스에서 산정한 1위~N위까지의 정렬 순서입니다.
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}

// ─────────────────────────────────────────────
// TRACK A: STOCK PANEL (Multi-Hit)
// ─────────────────────────────────────────────
const TrackAStockPanel: React.FC = () => {
    const [candidates, setCandidates] = useState<any[]>([])
    const [loading, setLoading]       = useState(false)
    const [lastUpdated, setLastUpdated] = useState<string | null>(null)

    const fetchCandidates = useCallback(async () => {
        setLoading(true)
        try {
            const res = await (window as any).electronAPI.invoke('track-a:get-stock-candidates')
            if (res?.success) {
                setCandidates(res.data || [])
                setLastUpdated(new Date().toLocaleTimeString())
            }
        } catch (err) {
            console.error(err)
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        fetchCandidates()
    }, [fetchCandidates])

    return (
        <div className="flex-1 flex flex-col overflow-hidden bg-background">
            <div className="shrink-0 px-4 py-3 border-b border-border/50 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Target className="w-4 h-4 text-primary" />
                    <span className="text-sm font-bold">다중 교차 대장주 타겟 리스트</span>
                    {lastUpdated && (
                        <span className="text-[10px] text-muted-foreground ml-2">🕒 {lastUpdated}</span>
                    )}
                </div>
                <button
                    onClick={fetchCandidates}
                    className="p-1.5 rounded-md hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
                >
                    <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
                </button>
            </div>

            <div className="flex-1 overflow-y-auto overflow-x-hidden p-4 space-y-2">
                {candidates.length === 0 && !loading && (
                    <div className="text-xs text-muted-foreground text-center py-10">
                        발굴된 대장 종목 후보가 없습니다.
                    </div>
                )}
                {candidates.map((c, idx) => (
                    <div key={c.stock_code} className="flex flex-col bg-muted/5 border border-border/50 rounded-lg p-3 hover:bg-muted/20 transition-colors">
                        <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                                <span className="text-xs font-bold text-muted-foreground w-4">{idx + 1}</span>
                                <span className="text-sm font-bold">{c.stock_name}</span>
                                <span className="text-[10px] text-muted-foreground">{c.stock_code}</span>
                            </div>
                            <div className="flex items-center gap-3 text-[11px] font-mono">
                                <div className="flex space-x-1 items-center">
                                    <span className="text-muted-foreground mr-1">HEAT</span>
                                    <span className={cn(
                                        "font-bold",
                                        c.heat_60 >= 60 ? "text-red-500" :
                                        c.heat_60 >= 40 ? "text-orange-400" :
                                        c.heat_60 >= 20 ? "text-yellow-400" :
                                        "text-emerald-400"
                                    )}>{c.heat_60 >= 999 ? '-' : `${c.heat_60}%`}</span>
                                </div>
                                <div className="flex space-x-1 items-center">
                                    <span className="text-muted-foreground mr-1">VOL</span>
                                    <span className="font-bold">{c.vol_ratio.toFixed(1)}x</span>
                                </div>
                            </div>
                        </div>

                        <div className="flex items-center gap-2 text-[10px] font-bold">
                            <div className={cn("px-2 py-0.5 rounded-sm", c.is_rising ? "bg-red-500/10 text-red-400 border border-red-500/20" : "text-muted-foreground/30")}>
                                급등 포착
                            </div>
                            <div className={cn("px-2 py-0.5 rounded-sm", c.is_theme_leader ? "bg-purple-500/10 text-purple-400 border border-purple-500/20" : "text-muted-foreground/30")}>
                                주도 테마 소속
                            </div>
                            <div className={cn("px-2 py-0.5 rounded-sm", c.is_incubator ? "bg-blue-500/10 text-blue-400 border border-blue-500/20" : "text-muted-foreground/30")}>
                                인큐베이터
                            </div>
                            <div className="ml-auto flex items-center">
                                <span className="text-muted-foreground font-normal mr-1.5">점수</span>
                                <span className="bg-primary/10 text-primary px-1.5 rounded text-[11px] border border-primary/20">{c.total_hits} 힛</span>
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    )
}
