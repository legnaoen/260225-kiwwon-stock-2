/**
 * CrossPeriodTab - Track B Recommended Stocks
 * Primary Category (exclusive) + Signal Tags (multiple allowed)
 */
import React, { useState, useEffect, useCallback } from 'react';
import { RefreshCw, TrendingUp, AlertTriangle, ChevronRight, Target } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { StockDetailModal } from '../common/StockDetailModal';

function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }

// ──────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────

type CrossCategory =
    | 'EXHAUSTED' | 'TRUE_LEADER' | 'INTRADAY_SURGE' | 'EMERGING_STAR' | 'PULLBACK_REBOUND'
    | 'PULLBACK_DIP' | 'SHORT_TERM_CONSOLIDATION' | 'UNCLASSIFIED';

type CrossSignal = 'RANK_CLIMBER' | 'HIGH_CONSISTENCY' | 'BREAKOUT_CANDIDATE' | 'VOLUME_SURGE';

interface SegmentSlot  { index: number; phase: 'LEADER' | 'CANDIDATE' | 'NONE'; alpha: number; }
interface RankSlot     { index: number; rank: number; percentile: number; alpha: number; }
interface SegmentProfile {
    rankTrajectory: RankSlot[];
    rankSlope: number;
    rankRSquared: number;
    isRankClimber: boolean;
    segments: SegmentSlot[];
    trend: 'EARLY_STRONG' | 'LATE_STRONG' | 'CONSISTENT' | 'RANK_RISING' | 'INCONSISTENT';
    consistencyScore: number;
}

interface PeriodProfile {
    stockCode: string;
    stockName: string;
    marketAlpha: number;
    avgTradingValue: number;
    phase: string | null;
    peakoutLevel: 'NONE' | 'ALERT' | 'CONFIRMED';
    peakoutScore: number;
    drawdownFromPeak: number;
    recentTrend: 'UP' | 'DOWN' | 'FLAT';
    relatedThemes: string[];
}

interface CrossCandidate {
    stockCode: string;
    stockName: string;
    relatedThemes: string[];
    category: CrossCategory;
    signals: CrossSignal[];
    convictionScore: number;
    reason: string;
    period_5d: PeriodProfile;
    period_10d: PeriodProfile;
    period_20d: PeriodProfile;
    period_60d: PeriodProfile;
    segmentProfile: SegmentProfile;
}

interface CrossPeriodResult {
    success: boolean;
    candidates: CrossCandidate[];
    themes: { theme: string; count: number }[];
    stats: { total: number; byCategory: Record<CrossCategory, number> };
    error?: string;
}

// ──────────────────────────────────────────────────────────
// Meta definitions
// ──────────────────────────────────────────────────────────

const CATEGORY_META: Record<CrossCategory, {
    label: string; icon: string; color: string; badgeClass: string; desc: string;
}> = {
    INTRADAY_SURGE: {
        label: '당일 급등', icon: '🚀', color: 'text-fuchsia-500',
        badgeClass: 'bg-fuchsia-500/15 text-fuchsia-500 border-fuchsia-500/30',
        desc: '당일 강력한 수급 및 변동성 유입'
    },
    EMERGING_STAR: {
        label: '\uc2e0\ud765 \uae09\ubd80\uc0c1', icon: '\ud83d\udd25', color: 'text-red-500',
        badgeClass: 'bg-red-500/15 text-red-500 border-red-500/30',
        desc: '최근 5~10일 알파 폭발 — 초기 모멘텀 편승'
    },
    PULLBACK_REBOUND: {
        label: '눌림 반등', icon: '🔥', color: 'text-red-500',
        badgeClass: 'bg-red-500/15 text-red-500 border-red-500/30',
        desc: '큰 낙폭 이후 단기 대장 재진입 — 강력한 턴어라운드'
    },
    PULLBACK_DIP: {
        label: '눌림목', icon: '📉', color: 'text-sky-400',
        badgeClass: 'bg-sky-500/15 text-sky-400 border-sky-500/30',
        desc: '장기 대장주가 단기 조정 중 — 2차 진입 기회'
    },
    TRUE_LEADER: {
        label: '\uc9c4\uc131 \ub300\uc7a5', icon: '\ud83d\udc51', color: 'text-orange-500',
        badgeClass: 'bg-orange-500/15 text-orange-500 border-orange-500/30',
        desc: '4\uae30\uac04 \ubaa8\ub450 \ucd5c\uc0c1\uc704 \u2014 \ud655\uc2e0 long'
    },
    EXHAUSTED: {
        label: '\uc2dc\uc138 \uc885\ub8cc', icon: '\ud83d\udc80', color: 'text-rose-500',
        badgeClass: 'bg-rose-500/10 text-rose-500 border-rose-500/30',
        desc: '\ud53c\ud06c\uc544\uc6c3 \ud655\uc815 + \ub791\ud0b9 \uc774\ud0c8'
    },
    UNCLASSIFIED: {
        label: '\ubbf8\ubd84\ub958', icon: '\u2014', color: 'text-muted-foreground',
        badgeClass: 'bg-muted text-muted-foreground border-border',
        desc: '\ubd84\ub958 \uae30\uc900 \ubbf8\ub2ec'
    },
    SHORT_TERM_CONSOLIDATION: {
        label: '\ub2e8\uae30 \uc0ac\uc774\ub529', icon: '\u23f8\ufe0f', color: 'text-cyan-400',
        badgeClass: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30',
        desc: '\ub2e8\uae30 \uac70\ub798 \uc218\ucda9 \ud6c4 \uc870\uc815 \uc911 \u2014 \uc7a5\uc138 \ud310\ub2e8 \ud544\uc694'
    },
};

const SIGNAL_META: Record<CrossSignal, { label: string; icon: string; badgeClass: string; desc: string }> = {
    RANK_CLIMBER: {
        label: '\uc21c\uc704 \uc0c1\uc2b9\ud615', icon: '\ud83c\udf31',
        badgeClass: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
        desc: '5\uc77c \ub2e8\uc704 \uc21c\uc704 \uafb8\uc900 \uc0c1\uc2b9 \u2014 \uc120\ud589 \ud3ec\uc18d'
    },
    HIGH_CONSISTENCY: {
        label: '\uafb8\uc900\ud568', icon: '\ud83d\udcca',
        badgeClass: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
        desc: '10\uc77c \uad6c\uac04 4/6 \uc774\uc0c1 LEADER'
    },
    BREAKOUT_CANDIDATE: {
        label: '\ube0c\ub808\uc774\ud06c\uc544\uc6c3', icon: '\u26a1',
        badgeClass: 'bg-orange-500/15 text-orange-500 border-orange-500/30',
        desc: '\ucd5c\uadfc 2\uad6c\uac04 \uc5f0\uc18d LEADER \uc9c4\uc785'
    },
    VOLUME_SURGE: {
        label: '\uac70\ub798\ud3ed\ubc1c', icon: '\ud83d\udcb9',
        badgeClass: 'bg-red-500/15 text-red-500 border-red-500/30',
        desc: '5d \uac70\ub798\ub300\uae08 2\ubc30+ \uae09\uc99d'
    },
};

const CATEGORY_ORDER: CrossCategory[] = ['TRUE_LEADER', 'INTRADAY_SURGE', 'EMERGING_STAR', 'PULLBACK_REBOUND', 'PULLBACK_DIP', 'SHORT_TERM_CONSOLIDATION', 'EXHAUSTED'];
const SIGNAL_ORDER: CrossSignal[] = ['RANK_CLIMBER', 'HIGH_CONSISTENCY', 'BREAKOUT_CANDIDATE', 'VOLUME_SURGE'];

// ──────────────────────────────────────────────────────────
// Sub-components
// ──────────────────────────────────────────────────────────

function AlphaCell({ alpha, compact }: { alpha: number; compact?: boolean }) {
    const pct = alpha.toFixed(1);
    const cls = alpha > 0.5 ? 'text-rose-400 font-semibold' : alpha < -0.5 ? 'text-blue-400 font-semibold' : 'text-foreground/50';
    return (
        <span className={cn('font-mono tabular-nums', cls, compact ? 'text-xs' : 'text-sm')}>
            {alpha > 0 ? '+' : ''}{pct}%
        </span>
    );
}

function SegmentBar({ segments }: { segments: SegmentSlot[] }) {
    if (!segments?.length) return <span className="text-muted-foreground">-</span>;
    return (
        <div className="flex gap-0.5 items-end h-3">
            {segments.map((s) => (
                <div
                    key={s.index}
                    title={`Seg ${s.index}: ${s.phase}, a${s.alpha.toFixed(1)}%`}
                    className={cn(
                        'w-2.5 rounded-sm transition-colors',
                        s.phase === 'LEADER'    ? 'bg-emerald-500 h-3' :
                        s.phase === 'CANDIDATE' ? 'bg-emerald-500/40 h-2' : 'bg-muted h-1'
                    )}
                />
            ))}
        </div>
    );
}

function RankTrajectoryBar({ trajectory, rSquared }: { trajectory: RankSlot[]; rSquared: number }) {
    if (!trajectory?.length) return null;
    return (
        <div className="flex gap-px items-end h-4" title={`R2=${rSquared.toFixed(2)}`}>
            {trajectory.map((r) => {
                const height = Math.max(1, Math.round(((100 - r.percentile) / 100) * 16));
                const isRecent = r.index >= trajectory.length - 2;
                return (
                    <div
                        key={r.index}
                        title={`Seg${r.index}: top${r.percentile.toFixed(0)}%`}
                        style={{ height: `${height}px` }}
                        className={cn('w-1.5 rounded-sm', isRecent ? 'bg-emerald-400' : 'bg-emerald-500/40')}
                    />
                );
            })}
            <span className="ml-1 text-xs text-emerald-400/70 font-mono">R{rSquared.toFixed(2)}</span>
        </div>
    );
}

function PeakoutBadge({ level, score }: { level: string; score: number }) {
    if (level === 'NONE' || !level) return null;
    return (
        <span className={cn(
            'px-1.5 py-0.5 rounded text-xs font-bold leading-none border',
            level === 'CONFIRMED'
                ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                : 'bg-yellow-500/20 text-yellow-300 border-yellow-500/40'
        )}>
            {level === 'CONFIRMED' ? `X${score}pt` : `!${score}pt`}
        </span>
    );
}

function SignalBadge({ signal }: { signal: CrossSignal }) {
    const meta = SIGNAL_META[signal];
    return (
        <span
            className={cn('shrink-0 px-1.5 py-0.5 rounded border text-xs font-semibold leading-none', meta.badgeClass)}
            title={meta.desc}
        >
            {meta.icon} {meta.label}
        </span>
    );
}

// ──────────────────────────────────────────────────────────
// Candidate Row
// ──────────────────────────────────────────────────────────

function CandidateRow({ item, rank, onClick }: {
    item: CrossCandidate; rank: number; onClick: (item: CrossCandidate) => void;
}) {
    const meta = CATEGORY_META[item.category] ?? CATEGORY_META['UNCLASSIFIED'];
    const seg  = item.segmentProfile;
    const p5   = item.period_5d;
    const isExhausted = item.category === 'EXHAUSTED';
    const signals = item.signals ?? [];

    return (
        <div
            onClick={() => onClick(item)}
            className={cn(
                'group px-3 py-2.5 border-b border-border/30 cursor-pointer hover:bg-muted/20 transition-colors',
                isExhausted && 'opacity-60'
            )}
        >
            {/* Row 1: rank + category badge + signal badges + name + peakout + themes */}
            <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                <span className="w-5 text-right text-xs text-foreground/40 font-mono shrink-0">{rank}</span>

                <span className={cn('shrink-0 px-1.5 py-0.5 rounded border text-xs font-bold leading-none', meta.badgeClass)}>
                    {meta.icon} {meta.label}
                </span>

                {signals.map(sig => <SignalBadge key={sig} signal={sig} />)}

                <span className="font-bold text-sm text-foreground truncate">{item.stockName}</span>
                <span className="text-xs text-foreground/40 font-mono shrink-0">({item.stockCode})</span>

                <PeakoutBadge level={p5.peakoutLevel} score={p5.peakoutScore} />

                <div className="flex gap-1 overflow-hidden min-w-0">
                    {item.relatedThemes.slice(0, 3).map(t => (
                        <span key={t} className="shrink-0 px-1.5 py-0.5 rounded bg-muted/80 text-xs text-foreground/70 leading-none truncate max-w-24 border border-border/50">
                            {t}
                        </span>
                    ))}
                </div>

                <ChevronRight className="w-3 h-3 text-foreground/30 shrink-0 ml-auto opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>

            {/* Row 2: 4-period alpha */}
            <div className="flex items-center gap-3 pl-7 mb-1.5">
                {([
                    { label: '5d',  alpha: item.period_5d.marketAlpha },
                    { label: '10d', alpha: item.period_10d.marketAlpha },
                    { label: '20d', alpha: item.period_20d.marketAlpha },
                    { label: '60d', alpha: item.period_60d.marketAlpha },
                ] as const).map(({ label, alpha }) => (
                    <div key={label} className="flex items-center gap-0.5">
                        <span className="text-xs text-foreground/50 font-medium">{label}</span>
                        <AlphaCell alpha={alpha} compact />
                    </div>
                ))}
                <span className="text-xs text-foreground/60 font-medium ml-2">
                    {p5.avgTradingValue > 1e10
                        ? `${(p5.avgTradingValue / 1e10).toFixed(0)}100M`
                        : p5.avgTradingValue > 1e8
                        ? `${(p5.avgTradingValue / 1e8).toFixed(0)}100M`
                        : `${(p5.avgTradingValue / 1e7).toFixed(0)}10M`}
                </span>
            </div>

            {/* Row 3: segment viz + reason */}
            <div className="flex items-center gap-2 pl-7">
                {signals.includes('RANK_CLIMBER') && seg.rankTrajectory?.length > 0 ? (
                    <RankTrajectoryBar trajectory={seg.rankTrajectory} rSquared={seg.rankRSquared} />
                ) : (
                    <SegmentBar segments={seg.segments} />
                )}

                {seg.trend !== 'INCONSISTENT' && (
                    <span className={cn(
                        'shrink-0 text-xs font-mono px-1.5 py-0.5 rounded font-semibold',
                        seg.trend === 'CONSISTENT'   ? 'bg-emerald-500/15 text-emerald-500' :
                        seg.trend === 'LATE_STRONG'  ? 'bg-orange-500/15 text-orange-500' :
                        seg.trend === 'EARLY_STRONG' ? 'bg-sky-500/15 text-sky-500' :
                        seg.trend === 'RANK_RISING'  ? 'bg-emerald-500/15 text-emerald-500' : 'text-foreground/40'
                    )}>
                        {seg.trend === 'CONSISTENT'   ? '꾸준' :
                         seg.trend === 'LATE_STRONG'  ? '후반↑' :
                         seg.trend === 'EARLY_STRONG' ? '전반↑' :
                         seg.trend === 'RANK_RISING'  ? '순위↑' : '불규칙'}
                    </span>
                )}

                <span className="text-xs text-foreground/75 leading-relaxed truncate">{item.reason}</span>
            </div>
        </div>
    );
}

// ──────────────────────────────────────────────────────────
// Main Component
// ──────────────────────────────────────────────────────────

export function CrossPeriodTab() {
    const [data, setData] = useState<CrossPeriodResult | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [activeCat, setActiveCat] = useState<CrossCategory | 'ALL'>('ALL');
    const [activeSignal, setActiveSignal] = useState<CrossSignal | null>(null);
    const [activeTheme, setActiveTheme] = useState<string | null>(null);
    const [sortKey, setSortKey] = useState<'conviction' | 'alpha5d' | 'trading_value' | 'rank_slope'>('conviction');

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const result = await (window as any).electronAPI.getCrossPeriodProfile(60);
            setData(result);
        } catch (e: any) {
            setError(e.message ?? 'Load failed');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    const filtered = React.useMemo(() => {
        if (!data?.candidates) return [];
        let list = data.candidates;
        if (activeCat !== 'ALL') list = list.filter(c => c.category === activeCat);
        if (activeSignal) list = list.filter(c => (c.signals ?? []).includes(activeSignal));
        if (activeTheme) list = list.filter(c => c.relatedThemes.includes(activeTheme));
        return [...list].sort((a, b) => {
            if (sortKey === 'alpha5d')       return b.period_5d.marketAlpha - a.period_5d.marketAlpha;
            if (sortKey === 'trading_value') return b.period_5d.avgTradingValue - a.period_5d.avgTradingValue;
            if (sortKey === 'rank_slope')    return a.segmentProfile.rankSlope - b.segmentProfile.rankSlope;
            return b.convictionScore - a.convictionScore;
        });
    }, [data, activeCat, activeSignal, activeTheme, sortKey]);

    const stats = data?.stats;
    const themes = data?.themes ?? [];

    const signalCounts = React.useMemo(() => {
        const counts: Record<CrossSignal, number> = { RANK_CLIMBER: 0, HIGH_CONSISTENCY: 0, BREAKOUT_CANDIDATE: 0, VOLUME_SURGE: 0 };
        if (data?.candidates) {
            for (const c of data.candidates) {
                for (const sig of (c.signals ?? [])) {
                    counts[sig] = (counts[sig] ?? 0) + 1;
                }
            }
        }
        return counts;
    }, [data]);

    const handleCatClick = (cat: CrossCategory | 'ALL') => {
        setActiveCat(prev => prev === cat ? 'ALL' : cat);
        setActiveSignal(null);
        setActiveTheme(null);
    };

    const handleSignalClick = (sig: CrossSignal) => {
        setActiveSignal(prev => prev === sig ? null : sig);
        setActiveCat('ALL');
    };

    const [selectedStock, setSelectedStock] = useState<{ code: string; name: string; themes: string[]; issues: any[] } | null>(null);

    const handleStockClick = useCallback(async (item: CrossCandidate) => {
        setSelectedStock({ code: item.stockCode, name: item.stockName, themes: item.relatedThemes, issues: [] });
        try {
            const edges = await (window as any).electronAPI.getKnowledgeEdgesTo('STOCK', item.stockCode);
            if (edges?.length > 0) {
                setSelectedStock(prev => prev ? { ...prev, issues: edges } : null);
            }
        } catch { /* silent */ }
    }, []);

    return (
        <div className="flex flex-col h-full overflow-hidden">

            {/* Header */}
            <div className="shrink-0 flex items-center justify-between px-3 py-2 border-b border-border/50 bg-muted/5">
                <div className="flex items-center gap-2">
                    <Target className="w-3.5 h-3.5 text-primary" />
                    <span className="text-xs font-bold text-foreground">Track B &mdash; 추천 종목</span>
                    {data && <span className="text-xs text-muted-foreground">전 {stats?.total ?? 0}종목</span>}
                </div>
                <button onClick={load} disabled={loading}
                    className="flex items-center gap-1.5 px-2 py-1 rounded text-xs text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors">
                    <RefreshCw className={cn('w-3 h-3', loading && 'animate-spin')} />
                    {loading ? '분석 중...' : '새로고침'}
                </button>
            </div>

            {error && (
                <div className="shrink-0 px-3 py-2 bg-rose-500/5 border-b border-rose-500/20 text-xs text-rose-400 flex items-center gap-1.5">
                    <AlertTriangle className="w-3 h-3" />{error}
                </div>
            )}

            <div className="flex-1 flex overflow-hidden">

                {/* Left panel */}
                <div className="w-60 shrink-0 flex flex-col border-r border-border/50 overflow-y-auto">

                    {/* Category stats */}
                    <div className="px-2.5 py-2.5 border-b border-border/30">
                        <div className="text-sm font-bold text-foreground/60 mb-2 px-1 uppercase tracking-wide">카테고리 집계</div>
                        <div className="space-y-0.5">
                            {CATEGORY_ORDER.map(cat => {
                                const meta = CATEGORY_META[cat];
                                const cnt  = stats?.byCategory?.[cat] ?? 0;
                                if (cnt === 0) return null;
                                return (
                                    <div key={cat} className="flex items-center justify-between px-1 py-0.5">
                                        <span className={cn('text-sm font-medium', meta.color)}>{meta.icon} {meta.label}</span>
                                        <span className="text-sm font-mono font-bold text-foreground/60">{cnt}</span>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* Signal stats */}
                    {Object.values(signalCounts).some(v => v > 0) && (
                        <div className="px-2.5 py-2.5 border-b border-border/30">
                            <div className="text-sm font-bold text-foreground/60 mb-2 px-1 uppercase tracking-wide">시그널</div>
                            <div className="space-y-0.5">
                                {SIGNAL_ORDER.map(sig => {
                                    const cnt = signalCounts[sig] ?? 0;
                                    if (cnt === 0) return null;
                                    const sMeta = SIGNAL_META[sig];
                                    return (
                                        <button key={sig} onClick={() => handleSignalClick(sig)}
                                            className={cn(
                                                'w-full flex items-center justify-between px-1 py-0.5 rounded text-left transition-colors',
                                                activeSignal === sig ? 'bg-emerald-500/15 text-emerald-400' : 'hover:bg-muted/30 text-foreground/65'
                                            )}>
                                            <span className="text-sm font-medium">{sMeta.icon} {sMeta.label}</span>
                                            <span className="text-sm font-mono font-bold">{cnt}</span>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* Theme ranking */}
                    <div className="px-2.5 py-2.5 flex-1 min-h-0">
                        <div className="flex items-center justify-between mb-2 px-1">
                            <span className="text-sm font-bold text-foreground/60 uppercase tracking-wide">주도 테마</span>
                            {activeTheme && (
                                <button onClick={() => setActiveTheme(null)} className="text-sm text-primary hover:underline font-medium">
                                    해제
                                </button>
                            )}
                        </div>
                        <div className="space-y-0.5">
                            {themes.slice(0, 25).map((t, i) => (
                                <button key={t.theme} onClick={() => setActiveTheme(prev => prev === t.theme ? null : t.theme)}
                                    className={cn(
                                        'w-full flex items-center justify-between px-1.5 py-1 rounded text-sm transition-colors text-left',
                                        activeTheme === t.theme ? 'bg-primary/15 text-primary font-semibold' : 'hover:bg-muted/40 text-foreground/65 hover:text-foreground'
                                    )}>
                                    <span className="flex items-center gap-1.5 truncate">
                                        <span className="text-foreground/30 font-mono w-5 text-right shrink-0">{i + 1}</span>
                                        <span className="truncate">{t.theme}</span>
                                    </span>
                                    <span className="font-mono font-bold shrink-0 ml-1">{t.count}</span>
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Right: stock table */}
                <div className="flex-1 flex flex-col overflow-hidden">

                    {/* Filter chips */}
                    <div className="shrink-0 flex items-center gap-1.5 px-3 py-2 border-b border-border/30 bg-muted/5 flex-wrap">
                        <button onClick={() => handleCatClick('ALL')}
                            className={cn(
                                'px-2.5 py-1 rounded-full border text-xs font-bold transition-colors',
                                activeCat === 'ALL' && !activeSignal ? 'bg-primary/20 border-primary/50 text-primary' : 'border-border text-muted-foreground hover:border-border/80 hover:text-foreground'
                            )}>
                            전체 {stats?.total ?? 0}
                        </button>

                        {CATEGORY_ORDER.map(cat => {
                            const meta = CATEGORY_META[cat];
                            const cnt  = stats?.byCategory?.[cat] ?? 0;
                            return (
                                <button key={cat} onClick={() => handleCatClick(cat)} disabled={cnt === 0}
                                    className={cn(
                                        'flex items-center gap-1 px-2.5 py-1 rounded-full border text-xs font-bold transition-colors disabled:opacity-30 disabled:cursor-default',
                                        activeCat === cat ? `${meta.badgeClass} border-current` : 'border-border text-muted-foreground hover:border-border/80 hover:text-foreground'
                                    )}>
                                    {meta.icon} {meta.label}
                                    {cnt > 0 && <span className="ml-0.5 px-1 py-0.5 rounded-full bg-current/20 text-current leading-none">{cnt}</span>}
                                </button>
                            );
                        })}

                        <span className="w-px h-4 bg-border/50 mx-0.5" />

                        {SIGNAL_ORDER.map(sig => {
                            const sMeta = SIGNAL_META[sig];
                            const cnt = signalCounts[sig] ?? 0;
                            return (
                                <button key={sig} onClick={() => handleSignalClick(sig)} disabled={cnt === 0} title={sMeta.desc}
                                    className={cn(
                                        'flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs font-medium transition-colors disabled:opacity-25 disabled:cursor-default',
                                        activeSignal === sig ? `${sMeta.badgeClass} border-current` : 'border-border/50 text-muted-foreground hover:border-border hover:text-foreground'
                                    )}>
                                    {sMeta.icon} {sMeta.label}
                                    {cnt > 0 && <span className="font-mono">{cnt}</span>}
                                </button>
                            );
                        })}

                        <div className="ml-auto flex items-center gap-1">
                            <span className="text-xs text-foreground/50 font-medium">정렬:</span>
                            {([
                                { key: 'conviction',    label: '추천도순' },
                                { key: 'alpha5d',       label: '5d알파' },
                                { key: 'trading_value', label: '거래대금' },
                                { key: 'rank_slope',    label: '순위상승' },
                            ] as const).map(opt => (
                                <button key={opt.key} onClick={() => setSortKey(opt.key)}
                                    className={cn(
                                        'px-2 py-0.5 rounded text-xs transition-colors font-medium',
                                        sortKey === opt.key ? 'bg-primary/20 text-primary font-bold' : 'text-foreground/55 hover:text-foreground'
                                    )}>
                                    {opt.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {loading && !data && (
                        <div className="flex-1 overflow-y-auto">
                            {Array.from({ length: 8 }).map((_, i) => (
                                <div key={i} className="px-3 py-3 border-b border-border/20 animate-pulse">
                                    <div className="flex gap-2 mb-2">
                                        <div className="h-4 w-16 bg-muted/40 rounded" />
                                        <div className="h-4 w-28 bg-muted/40 rounded" />
                                    </div>
                                    <div className="flex gap-3 pl-7">
                                        <div className="h-3 w-32 bg-muted/30 rounded" />
                                        <div className="h-3 w-48 bg-muted/20 rounded" />
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    {!loading && filtered.length === 0 && (
                        <div className="flex-1 flex flex-col items-center justify-center gap-2 text-muted-foreground">
                            <TrendingUp className="w-8 h-8 opacity-20" />
                            <span className="text-sm">
                                {data ? '해당 카테고리에 종목이 없습니다' : '새로고침을 눌러 분석을 시작하세요'}
                            </span>
                        </div>
                    )}

                    {!loading && filtered.length > 0 && (
                        <div className="flex-1 overflow-y-auto">
                            {filtered.map((item, idx) => (
                                <CandidateRow key={item.stockCode} item={item} rank={idx + 1} onClick={handleStockClick} />
                            ))}
                            <div className="h-4" />
                        </div>
                    )}
                </div>
            </div>

            {selectedStock && (
                <StockDetailModal
                    stockCode={selectedStock.code}
                    stockName={selectedStock.name}
                    relatedTheme={selectedStock.themes.length > 0 ? { type: 'THEME', name: selectedStock.themes[0] } : undefined}
                    relatedIssues={selectedStock.issues}
                    onClose={() => setSelectedStock(null)}
                />
            )}
        </div>
    );
}
