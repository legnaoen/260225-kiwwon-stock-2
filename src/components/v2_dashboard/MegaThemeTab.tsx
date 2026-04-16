import React, { useState, useEffect, useCallback } from 'react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import {
    RefreshCw, Flame, Zap, Star, TrendingDown, Moon, Sunrise,
    ChevronRight, AlertTriangle, CheckCircle, Circle, ArrowUp, ArrowDown,
    BarChart2, Layers, Target, Clock, Sparkles, Settings, Cpu, Cloud, Wifi, WifiOff, Trash2
} from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { StockDetailModal } from '../common/StockDetailModal';

function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

// ─── 타입 정의 ──────────────────────────────────────────────────────────────

type MegaThemeStatus = 'DOMINANT' | 'STRONG' | 'NEW' | 'EMERGING' | 'FADING' | 'DORMANT' | 'REVIVAL';
type CatalystType = 'STRUCTURAL' | 'POLICY' | 'EVENT';
type EntryTiming = 'ENTRY_NOW' | 'ENTRY_WAIT' | 'WATCH';

interface SubThemeInfo {
    name: string;
    rank_num: number;
    change_rate: number;
    regime?: string;          // CONFIRMED | EMERGING | DECLINING | PAST
    entry_zone?: string;      // EARLY | MOMENTUM | RISK | AVOID
    combined_signal?: string; // BEST_BUY | BUY | HOLD_ONLY | EXIT
}

interface SelectedStock {
    name: string;
    code: string;
    entry_timing: EntryTiming;
    confidence?: number;
    reason?: string;
}

interface DailyLog {
    date: string;
    rank: number;
    power: number;
}

interface MegaTheme {
    id: number;
    mega_theme_name: string;
    sub_themes_json: string;       // JSON string → SubThemeInfo[]
    core_narrative: string;
    catalyst_type: CatalystType;
    first_seen_date: string;
    last_seen_date: string;
    alive_days: number;
    peak_combined_power: number;
    current_combined_power: number;
    current_top_rank: number;
    ranking_score: number;
    entry_timing: EntryTiming;
    selected_stocks_json: string;  // JSON string → SelectedStock[]
    status: MegaThemeStatus;
    daily_log_json: string;        // JSON string → DailyLog[]
    updated_at: string;
}

// ─── 상태별 스타일/아이콘 유틸 ──────────────────────────────────────────────

const STATUS_CONFIG: Record<MegaThemeStatus, {
    icon: React.ReactNode;
    label: string;
    borderCls: string;
    badgeCls: string;
    headerCls: string;
}> = {
    DOMINANT: {
        icon: <Flame size={13} className="text-red-400" />,
        label: 'DOMINANT',
        borderCls: 'border-red-500/40',
        badgeCls: 'bg-red-500/15 text-red-400 border-red-500/30',
        headerCls: 'bg-gradient-to-r from-red-500/10 to-orange-500/5',
    },
    STRONG: {
        icon: <Zap size={13} className="text-orange-400" />,
        label: 'STRONG',
        borderCls: 'border-orange-500/40',
        badgeCls: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
        headerCls: 'bg-gradient-to-r from-orange-500/8 to-amber-500/5',
    },
    NEW: {
        icon: <Star size={13} className="text-violet-400" />,
        label: 'NEW',
        borderCls: 'border-violet-500/40',
        badgeCls: 'bg-violet-500/15 text-violet-400 border-violet-500/30',
        headerCls: 'bg-gradient-to-r from-violet-500/8 to-purple-500/5',
    },
    EMERGING: {
        icon: <Star size={13} className="text-violet-400" />,
        label: 'EMERGING',
        borderCls: 'border-violet-500/40',
        badgeCls: 'bg-violet-500/15 text-violet-400 border-violet-500/30',
        headerCls: 'bg-gradient-to-r from-violet-500/8 to-purple-500/5',
    },
    FADING: {
        icon: <TrendingDown size={13} className="text-blue-400" />,
        label: 'FADING',
        borderCls: 'border-blue-500/30',
        badgeCls: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
        headerCls: 'bg-blue-500/5',
    },
    DORMANT: {
        icon: <Moon size={13} className="text-muted-foreground" />,
        label: 'DORMANT',
        borderCls: 'border-border/40',
        badgeCls: 'bg-muted/60 text-muted-foreground border-border/40',
        headerCls: 'bg-muted/20',
    },
    REVIVAL: {
        icon: <Sunrise size={13} className="text-emerald-400" />,
        label: 'REVIVAL',
        borderCls: 'border-emerald-500/50',
        badgeCls: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
        headerCls: 'bg-gradient-to-r from-emerald-500/10 to-teal-500/5',
    },
};

const CATALYST_CONFIG: Record<CatalystType, { label: string; cls: string }> = {
    STRUCTURAL: { label: '구조적 장기', cls: 'bg-purple-500/15 text-purple-400 border-purple-500/30' },
    POLICY:     { label: '정책 중기',   cls: 'bg-blue-500/15 text-blue-400 border-blue-500/30' },
    EVENT:      { label: '단발 이벤트', cls: 'bg-amber-500/15 text-amber-500 border-amber-500/30' },
};

const ENTRY_CONFIG: Record<EntryTiming, { label: string; cls: string; icon: React.ReactNode }> = {
    ENTRY_NOW:  { label: '즉시매수', cls: 'bg-red-500/15 text-red-400 border-red-500/30',   icon: <Target size={10} /> },
    ENTRY_WAIT: { label: '조정대기', cls: 'bg-amber-500/15 text-amber-500 border-amber-500/30', icon: <Clock size={10} /> },
    WATCH:      { label: '관망',     cls: 'bg-muted/60 text-muted-foreground border-border/40',   icon: <Circle size={10} /> },
};

const REGIME_CONFIG: Record<string, { cls: string }> = {
    CONFIRMED:  { cls: 'bg-red-500/15 text-red-400 border-red-500/25' },
    EMERGING:   { cls: 'bg-amber-500/15 text-amber-500 border-amber-500/25' },
    DECLINING:  { cls: 'bg-blue-500/15 text-blue-400 border-blue-500/25' },
    PAST:       { cls: 'bg-muted/50 text-muted-foreground border-border/30' },
};

const SIGNAL_CONFIG: Record<string, { cls: string }> = {
    BEST_BUY:   { cls: 'bg-red-500/20 text-red-400 border-red-500/30' },
    BUY:        { cls: 'bg-orange-500/15 text-orange-400 border-orange-500/25' },
    HOLD_ONLY:  { cls: 'bg-muted/50 text-muted-foreground border-border/30' },
    EXIT:       { cls: 'bg-blue-500/15 text-blue-400 border-blue-500/25' },
};

// ─── 메인 컴포넌트 ───────────────────────────────────────────────────────────

export const MegaThemeTab: React.FC<{ onNavigate?: (tabId: string, entityId?: string) => void }> = ({ onNavigate }) => {
    const [themes, setThemes] = useState<MegaTheme[]>([]);
    const [selectedTheme, setSelectedTheme] = useState<MegaTheme | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [isRunning, setIsRunning] = useState(false);
    const [lastUpdated, setLastUpdated] = useState<string>('');
    const [selectedStock, setSelectedStock] = useState<{ stockCode: string; stockName: string } | null>(null);

    // AI 설정 상태
    const [showAiSettings, setShowAiSettings] = useState(false);
    const [aiTargetType, setAiTargetType] = useState<'gemini' | 'local'>('gemini');
    const [localAiStatus, setLocalAiStatus] = useState<{ isOnline: boolean; models: string[] } | null>(null);
    const [isSavingConfig, setIsSavingConfig] = useState(false);

    // 집계 진행 상태
    const [progressStep, setProgressStep] = useState<string>('');
    const [progressDetail, setProgressDetail] = useState<string>('');
    const [runError, setRunError] = useState<string>('');

    // 상태 필터
    const [statusFilter, setStatusFilter] = useState<MegaThemeStatus | 'ALL'>('ALL');

    useEffect(() => {
        loadData();
        loadAiConfig();

        // 메가 테마 집계 진행 상태 구독
        const api = (window as any).electronAPI;
        if (api?.on) {
            api.on('mega-theme:progress', (data: { step: string; detail: string }) => {
                setProgressStep(data.step);
                setProgressDetail(data.detail);
                if (data.step === 'ERROR' || data.step === 'AI_ERROR') {
                    setRunError(data.detail);
                    setTimeout(() => setRunError(''), 8000);
                }
                if (data.step === 'DONE') {
                    setTimeout(() => {
                        setProgressStep('');
                        setProgressDetail('');
                    }, 3000);
                }
            });
        }
    }, []);

    const loadAiConfig = useCallback(async () => {
        const api = (window as any).electronAPI;
        if (!api?.getMegaThemeAiConfig) return;
        try {
            const config = await api.getMegaThemeAiConfig();
            setAiTargetType(config?.targetType || 'gemini');
        } catch {}
    }, []);

    const handleOpenAiSettings = useCallback(async () => {
        setShowAiSettings(true);
        const api = (window as any).electronAPI;
        if (api?.checkMegaThemeLocalAi) {
            try {
                const status = await api.checkMegaThemeLocalAi();
                setLocalAiStatus(status);
            } catch {
                setLocalAiStatus({ isOnline: false, models: [] });
            }
        }
    }, []);

    const handleSaveAiConfig = useCallback(async (targetType: 'gemini' | 'local') => {
        setIsSavingConfig(true);
        const api = (window as any).electronAPI;
        if (api?.setMegaThemeAiConfig) {
            await api.setMegaThemeAiConfig({ targetType });
            setAiTargetType(targetType);
        }
        setIsSavingConfig(false);
        setShowAiSettings(false);
    }, []);

    const loadData = useCallback(async () => {
        setIsLoading(true);
        try {
            const api = (window as any).electronAPI;
            if (api?.getMegaThemeLedger) {
                const rows: any[] = await api.getMegaThemeLedger();
                if (Array.isArray(rows)) {
                    const normalized: MegaTheme[] = rows.map(r => ({
                        ...r,
                        sub_themes_json:      typeof r.sub_themes_json === 'string' ? r.sub_themes_json : JSON.stringify(r.sub_themes ?? []),
                        selected_stocks_json: typeof r.selected_stocks_json === 'string' ? r.selected_stocks_json : JSON.stringify(r.selected_stocks ?? []),
                        daily_log_json:       typeof r.daily_log_json === 'string' ? r.daily_log_json : JSON.stringify(r.daily_log ?? []),
                    }));
                    setThemes(normalized);
                    if (normalized.length > 0) {
                        setLastUpdated(normalized[0]?.updated_at || '');
                    } else {
                        setLastUpdated('');
                    }
                }
            }
        } catch (e) {
            // API 미연결 상태: 더미 데이터 유지
        } finally {
            setIsLoading(false);
        }
    }, []);


    const handleRun = useCallback(async () => {
        setIsRunning(true);
        setRunError('');
        setProgressStep('STARTING');
        setProgressDetail('집계 시작 중...');
        try {
            const api = (window as any).electronAPI;
            if (api?.runThemeContextBuilder) {
                const result = await api.runThemeContextBuilder();
                if (result?.success === false) {
                    setRunError(result.error || '알 수 없는 오류');
                    setTimeout(() => setRunError(''), 8000);
                } else {
                    await loadData();
                }
            }
        } catch (e: any) {
            setRunError(e.message || '집계 실패');
            setTimeout(() => setRunError(''), 8000);
        } finally {
            setIsRunning(false);
        }
    }, [loadData]);

    const handleResetLedger = useCallback(async () => {
        if (!window.confirm('디버깅용: 메가 테마 DB를 완전히 초기화합니다. 이전 분석 이력이 모두 삭제됩니다. 계속하시겠습니까?')) return;
        setIsRunning(true);
        try {
            const api = (window as any).electronAPI;
            if (api?.resetThemeLedger) {
                const res = await api.resetThemeLedger();
                if (res?.success) {
                    await loadData();
                    alert('초기화 완료. 다시 집계 실행을 눌러주세요.');
                } else {
                    setRunError(res?.error || '초기화 실패');
                }
            }
        } catch (e: any) {
            setRunError(e.message || '초기화 실패');
        } finally {
            setIsRunning(false);
        }
    }, [loadData]);

    // 필터링 & 정렬
    const filteredThemes = themes
        .filter(t => statusFilter === 'ALL' || t.status === statusFilter)
        .sort((a, b) => {
            // DOMINANT/STRONG/NEW 먼저, FADING, DORMANT 나중
            const order: Record<MegaThemeStatus, number> = {
                REVIVAL: 0, DOMINANT: 1, STRONG: 2, NEW: 3, FADING: 4, DORMANT: 5
            };
            if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
            return b.ranking_score - a.ranking_score;
        });

    const parseJson = <T,>(str: string, fallback: T): T => {
        try { return JSON.parse(str) as T; } catch { return fallback; }
    };

    const formatUpdated = (dt: string) => {
        if (!dt) return '미실행';
        try {
            const d = new Date(dt);
            return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
        } catch { return dt; }
    };

    // ── 메가 테마 카드 ────────────────────────────────────────────────────────
    const renderCard = (theme: MegaTheme, rank: number) => {
        const cfg = STATUS_CONFIG[theme.status] ?? STATUS_CONFIG['NEW'];
        const entryCfg = ENTRY_CONFIG[theme.entry_timing] ?? ENTRY_CONFIG['WATCH'];
        const stocks = parseJson<SelectedStock[]>(theme.selected_stocks_json, []);
        const subThemes = parseJson<SubThemeInfo[]>(theme.sub_themes_json, []);
        const isDormant = theme.status === 'DORMANT' || theme.status === 'FADING';
        const isSelected = selectedTheme?.id === theme.id;

        return (
            <div
                key={theme.id}
                onClick={() => setSelectedTheme(isSelected ? null : theme)}
                className={cn(
                    'border rounded-xl cursor-pointer transition-all duration-200 overflow-hidden group',
                    cfg.borderCls,
                    isDormant ? 'opacity-60' : '',
                    isSelected ? 'ring-2 ring-primary/40 shadow-lg shadow-primary/5' : 'hover:shadow-md hover:scale-[1.005]',
                    theme.status === 'REVIVAL' ? 'animate-pulse-slow' : ''
                )}
            >
                {/* 카드 헤더 */}
                <div className={cn('px-4 py-3 flex items-start justify-between gap-3', cfg.headerCls)}>
                    <div className="flex items-center gap-2 min-w-0">
                        <span className="text-muted-foreground text-xs font-mono shrink-0">#{rank}</span>
                        {cfg.icon}
                        <span className="font-bold text-sm text-foreground truncate">{theme.mega_theme_name}</span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                        {/* 종합점수 */}
                        {!isDormant && (
                            <span className="text-[10px] font-mono font-bold text-foreground/60 bg-background/60 px-1.5 py-0.5 rounded border border-border/40">
                                {theme.ranking_score}점
                            </span>
                        )}
                        {/* 상태 배지 */}
                        <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full border', cfg.badgeCls)}>
                            {cfg.label}
                        </span>
                        <ChevronRight size={14} className={cn('text-muted-foreground/50 transition-transform', isSelected ? 'rotate-90' : '')} />
                    </div>
                </div>

                {/* 카드 바디 */}
                <div className="px-4 pb-3 pt-2 space-y-2">
                    {/* 생존 정보 */}
                    <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                        <span className="flex items-center gap-1">
                            <Clock size={10} />
                            <span>{theme.alive_days}일 생존</span>
                        </span>
                        <span className="text-border">|</span>
                        <span className="flex items-center gap-1">
                            <BarChart2 size={10} />
                            <span className="font-mono text-foreground/80">+{(theme.current_combined_power ?? 0).toFixed(1)}% 합산</span>
                        </span>
                    </div>

                    {/* 구성 하위 테마 칩 */}
                    <div className="flex flex-wrap gap-1">
                        {subThemes.map((st) => (
                            <span key={st.name} className="text-[10px] bg-muted/40 text-muted-foreground px-2 py-0.5 rounded-md border border-border/40">
                                {st.name.length > 10 ? st.name.slice(0, 10) + '…' : st.name}
                                {st.rank_num != null && (
                                    <span className="ml-1 font-mono text-red-400/80">#{st.rank_num}</span>
                                )}
                            </span>
                        ))}
                    </div>

                    {/* 선발 종목 */}
                    {stocks.length > 0 && !isDormant && (
                        <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                            {stocks.map((s) => {
                                const ec = ENTRY_CONFIG[s.entry_timing] ?? ENTRY_CONFIG['WATCH'];
                                return (
                                    <button
                                        key={s.code}
                                        onClick={(e) => { e.stopPropagation(); setSelectedStock({ stockCode: s.code, stockName: s.name }); }}
                                        className={cn('flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border transition-colors hover:brightness-110', ec.cls)}
                                    >
                                        {ec.icon} {s.name}
                                    </button>
                                );
                            })}
                        </div>
                    )}

                    {/* DORMANT 부활 안내 */}
                    {theme.status === 'DORMANT' && (
                        <div className="text-[10px] text-muted-foreground/70 flex items-center gap-1 pt-0.5">
                            <Moon size={10} />
                            <span>소강 {theme.alive_days - (theme.last_seen_date ? Math.floor((Date.now() - new Date(theme.last_seen_date).getTime()) / 86400000) : 0)}일 · 부활 모니터링 중</span>
                        </div>
                    )}
                </div>
            </div>
        );
    };

    // ── 상세 패널 ─────────────────────────────────────────────────────────────
    const renderDetailPanel = () => {
        if (!selectedTheme) {
            return (
                <div className="flex flex-col items-center justify-center h-full text-muted-foreground/40 gap-3">
                    <Layers size={32} className="opacity-30" />
                    <span className="text-xs">좌측 메가 테마 카드를 클릭하세요</span>
                </div>
            );
        }

        const theme = selectedTheme;
        const cfg = STATUS_CONFIG[theme.status] ?? STATUS_CONFIG['NEW'];
        const stocks = parseJson<SelectedStock[]>(theme.selected_stocks_json, []);
        const subThemes = parseJson<SubThemeInfo[]>(theme.sub_themes_json, []);
        const dailyLog = parseJson<DailyLog[]>(theme.daily_log_json, []);

        const REVIVAL_CONDITIONS = [
            { label: 'Top 15 재진입 (3일 중 2회+)', met: theme.current_top_rank <= 15 && theme.status !== 'DORMANT' },
            { label: '2일 연속 +3% 이상 (price_index)', met: theme.current_combined_power >= 3.0 && theme.alive_days <= 2 },
            { label: '신규 거시 이슈 등록 감지', met: false },
        ];

        const narrativeRaw = theme.core_narrative || '분석 데이터 없음';
        let narrativeHistory: { date: string; title: string; body: string }[] = [];
        try {
            if (narrativeRaw.trim()?.startsWith('[')) {
                const arr = JSON.parse(narrativeRaw);
                if (Array.isArray(arr)) {
                    narrativeHistory = arr.map(h => {
                        let t = ''; let b = h.text;
                        const match = b.match(/^\[(.*?)\]\s*(.*)/);
                        if (match) { t = match[1]; b = match[2]; }
                        return { date: h.date, title: t, body: b };
                    });
                } else { throw new Error('Not array'); }
            } else { throw new Error('Legacy string'); }
        } catch {
            let t = ''; let b = narrativeRaw;
            const match = b.match(/^\[(.*?)\]\s*(.*)/);
            if (match) { t = match[1]; b = match[2]; }
            narrativeHistory = [{ date: theme.last_seen_date?.slice(5) || '이전 기록', title: t, body: b }];
        }

        return (
            <div
                className="flex flex-col space-y-4 p-5"
                style={{ minHeight: '100%' }}
            >
                {/* 헤더 */}
                <div className={cn('rounded-xl p-4 border space-y-1', cfg.headerCls, cfg.borderCls)}>
                    <div className="flex items-center gap-2">
                        {cfg.icon}
                        <h3 className="font-bold text-base text-foreground">{theme.mega_theme_name}</h3>
                    </div>
                    <div className="flex flex-wrap gap-1.5 pt-1">
                        <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full border', cfg.badgeCls)}>{cfg.label}</span>
                        <span className="text-[10px] font-mono bg-muted/50 text-muted-foreground px-2 py-0.5 rounded-full border border-border/40">
                            생존 {theme.alive_days}일
                        </span>
                        {theme.ranking_score > 0 && (
                            <span className="text-[10px] font-mono font-bold bg-primary/10 text-primary px-2 py-0.5 rounded-full border border-primary/20">
                                {theme.ranking_score}점
                            </span>
                        )}
                    </div>
                </div>

                {/* 생존 이력 차트 */}
                {dailyLog.length > 1 && (
                    <div className="border border-border/50 rounded-xl overflow-hidden bg-card">
                        <div className="px-3 py-2 border-b bg-muted/5 text-[11px] font-bold text-muted-foreground flex items-center gap-1.5">
                            <BarChart2 size={12} /> 합산파워 이력 (%)
                        </div>
                        <div className="h-[120px] p-2">
                            <ResponsiveContainer width="100%" height="100%">
                                <LineChart data={dailyLog} margin={{ top: 5, right: 8, left: -20, bottom: 0 }}>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" opacity={0.3} />
                                    <XAxis dataKey="date" tick={{ fontSize: 9, fill: 'var(--muted-foreground)' }} />
                                    <YAxis tick={{ fontSize: 9 }} width={32} />
                                    <Tooltip
                                        contentStyle={{ fontSize: '11px', backgroundColor: 'var(--card)', borderColor: 'var(--border)' }}
                                        formatter={(val: any) => [`+${Number(val).toFixed(1)}%`, '합산파워']}
                                    />
                                    <Line type="monotone" dataKey="power" stroke={
                                        theme.status === 'DOMINANT' ? '#ef4444' :
                                        theme.status === 'STRONG' ? '#f97316' :
                                        theme.status === 'DORMANT' ? '#94a3b8' : '#8b5cf6'
                                    } strokeWidth={2} dot={{ r: 2.5 }} activeDot={{ r: 4 }} />
                                </LineChart>
                            </ResponsiveContainer>
                        </div>
                    </div>
                )}

                {/* 구성 하위 테마 */}
                <div className="border border-border/50 rounded-xl overflow-hidden bg-card">
                    <div className="px-3 py-2 border-b bg-muted/5 text-[11px] font-bold text-muted-foreground flex items-center gap-1.5">
                        <Layers size={12} /> 구성 하위 테마
                    </div>
                    <div className="p-3 space-y-2">
                        {subThemes.map((st) => (
                            <div key={st.name} className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2 min-w-0">
                                    {st.rank_num != null && (
                                        <span className="text-[10px] font-mono text-muted-foreground shrink-0">#{st.rank_num}</span>
                                    )}
                                    <span className="text-[12px] font-semibold text-foreground truncate">{st.name}</span>
                                    {st.change_rate != null && (
                                        <span className="text-[10px] font-mono text-red-400 shrink-0">+{Number(st.change_rate).toFixed(2)}%</span>
                                    )}
                                    {st.added_date != null && st.rank_num == null && (
                                        <span className="text-[9px] text-muted-foreground/60">{st.added_date}</span>
                                    )}
                                </div>
                                <div className="flex items-center gap-1 shrink-0">
                                    {st.regime && (
                                        <span className={cn('text-[9px] font-bold px-1.5 py-0.5 rounded border', REGIME_CONFIG[st.regime]?.cls ?? 'bg-muted text-muted-foreground border-border')}>
                                            {st.regime}
                                        </span>
                                    )}
                                    {st.combined_signal && (
                                        <span className={cn('text-[9px] font-bold px-1.5 py-0.5 rounded border', SIGNAL_CONFIG[st.combined_signal]?.cls ?? 'bg-muted text-muted-foreground border-border')}>
                                            {st.combined_signal}
                                        </span>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* 진테마 스토리 타임라인 */}
                <div className="border border-border/50 rounded-xl overflow-hidden bg-card">
                    <div className="px-3 py-2 border-b bg-muted/5 text-[11px] font-bold text-muted-foreground flex items-center gap-1.5">
                        <Sparkles size={12} className="text-amber-500" /> 스토리 (타임라인)
                    </div>
                    <div className="p-3 space-y-3 max-h-[350px] overflow-y-auto">
                        {narrativeHistory.map((h, i) => (
                            <div key={i} className="relative pl-3 border-l-2 border-border/40 pb-2">
                                <div className="absolute -left-[5px] top-1.5 w-2 h-2 rounded-full bg-border" />
                                <div className="flex items-center justify-between pb-1">
                                    <div className="flex items-baseline gap-2">
                                        <span className="text-[10px] text-muted-foreground font-mono bg-muted/40 px-1 py-0.5 rounded">{h.date}</span>
                                        {h.title && <span className="font-bold text-[12px] text-foreground">{h.title}</span>}
                                    </div>
                                    {i === 0 && theme.alive_days >= 10 && (
                                        <span className="text-[9px] px-1.5 py-0.5 rounded-full border bg-emerald-500/10 text-emerald-400 border-emerald-500/25 shrink-0">
                                            장기 지속 검증됨
                                        </span>
                                    )}
                                </div>
                                <p className="text-[11px] leading-relaxed text-foreground/80 pt-0.5 whitespace-pre-wrap">
                                    {h.body}
                                </p>
                            </div>
                        ))}
                    </div>
                </div>

                {/* DORMANT 부활 조건 */}
                {theme.status === 'DORMANT' && (
                    <div className="border border-border/40 rounded-xl overflow-hidden bg-card mb-10">
                        <div className="px-3 py-2 border-b bg-muted/5 text-[11px] font-bold text-muted-foreground flex items-center gap-1.5">
                            <Moon size={12} /> 부활 감지 조건
                        </div>
                        <div className="p-3 space-y-2">
                            {REVIVAL_CONDITIONS.map((cond, i) => (
                                <div key={i} className="flex items-center gap-2 text-[11px]">
                                    {cond.met
                                        ? <CheckCircle size={13} className="text-emerald-400 shrink-0" />
                                        : <Circle size={13} className="text-muted-foreground/40 shrink-0" />
                                    }
                                    <span className={cond.met ? 'text-foreground' : 'text-muted-foreground'}>{cond.label}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
                
                {/* 핵심 주도 종목군 (인라인 칩 형태) */}
                {stocks.length > 0 && (
                    <div className="border border-border/50 rounded-xl overflow-hidden bg-card mt-4 mb-6">
                        <div className="px-3 py-2 border-b bg-muted/5 text-[11px] font-bold text-muted-foreground flex items-center gap-1.5">
                            <Target size={12} className="text-primary" /> 핵심 주도 종목군
                        </div>
                        <div className="p-4 space-y-3">
                            <div className="text-[10px] text-foreground/70 font-semibold px-1">🔥 AI 필터링 주도주 (테마/섹터 견인)</div>
                            <div className="flex flex-wrap items-center gap-2">
                                {stocks.map((stock: any) => (
                                    <button 
                                        key={stock.code} 
                                        className="group flex items-center gap-1.5 text-[12px] bg-muted/40 hover:bg-muted/80 text-foreground px-3 py-1.5 rounded-full border border-primary/20 hover:border-primary/50 transition-colors cursor-pointer"
                                        onClick={() => setSelectedStock({ stockCode: stock.code, stockName: stock.name })}
                                    >
                                        <span className="font-bold group-hover:text-primary transition-colors">
                                            {stock.name}
                                        </span>
                                        {stock.confidence && (
                                            <span className="text-[10px] font-bold font-mono tracking-tighter text-primary">
                                                {stock.confidence}%
                                            </span>
                                        )}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        );
    };

    // ── 상태 필터 탭 ─────────────────────────────────────────────────────────
    const STATUS_FILTERS: { label: string; value: MegaThemeStatus | 'ALL'; count: number }[] = [
        { label: '전체', value: 'ALL', count: themes.length },
        { label: '🔥 활성', value: 'DOMINANT', count: themes.filter(t => t.status === 'DOMINANT' || t.status === 'STRONG').length },
        { label: '⭐ 신규', value: 'NEW', count: themes.filter(t => t.status === 'NEW' || t.status === 'REVIVAL').length },
        { label: '💤 소강', value: 'DORMANT', count: themes.filter(t => t.status === 'DORMANT' || t.status === 'FADING').length },
    ];

    // ── 메인 렌더 ─────────────────────────────────────────────────────────────
    return (
        <div className="flex flex-col h-full overflow-hidden">
            {/* 헤더 툴바 */}
            <div className="px-5 py-3 border-b bg-muted/5 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-3">
                    <h2 className="text-sm font-bold text-foreground flex items-center gap-2">
                        <Flame size={15} className="text-red-400" />
                        메가 테마 관리
                    </h2>
                    <div className="flex items-center gap-1 bg-muted/30 rounded-lg p-0.5 border border-border/40">
                        {STATUS_FILTERS.map((f) => (
                            <button
                                key={f.value}
                                onClick={() => setStatusFilter(f.value === 'DORMANT' ? 'DORMANT' : f.value === 'NEW' ? 'NEW' : f.value === 'DOMINANT' ? 'DOMINANT' : 'ALL')}
                                className={cn(
                                    'px-2.5 py-1 rounded-md text-[11px] font-bold transition-colors flex items-center gap-1',
                                    statusFilter === f.value || (f.value === 'DOMINANT' && (statusFilter === 'DOMINANT' || statusFilter === 'STRONG'))
                                        ? 'bg-background text-foreground shadow-sm'
                                        : 'text-muted-foreground hover:text-foreground'
                                )}
                            >
                                {f.label}
                                <span className="text-[9px] font-mono bg-muted/60 px-1 py-0.5 rounded">{f.count}</span>
                            </button>
                        ))}
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    {lastUpdated && !isRunning && (
                        <span className="text-[10px] text-muted-foreground font-mono">
                            업데이트: {formatUpdated(lastUpdated)}
                        </span>
                    )}
                    {/* 진행 상태 표시 */}
                    {isRunning && progressDetail && (
                        <span className={cn(
                            'text-[10px] font-mono px-2 py-1 rounded border flex items-center gap-1.5 max-w-[200px] truncate',
                            progressStep === 'AI_CALL'
                                ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                                : progressStep === 'AI_DONE'
                                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                                : progressStep === 'AI_ERROR' || progressStep === 'ERROR'
                                ? 'bg-red-500/10 text-red-400 border-red-500/20'
                                : 'bg-primary/10 text-primary border-primary/20'
                        )}>
                            {progressStep === 'AI_CALL' && <RefreshCw size={9} className="animate-spin shrink-0" />}
                            {progressStep === 'AI_DONE' && <span className="shrink-0">✓</span>}
                            {progressStep === 'AI_ERROR' && <span className="shrink-0">⚠</span>}
                            <span className="truncate">{progressDetail}</span>
                        </span>
                    )}
                    {/* AI 모델 배지 */}
                    <span className={cn(
                        'flex items-center gap-1 px-2 py-1 rounded text-[10px] font-bold border',
                        aiTargetType === 'local'
                            ? 'bg-purple-500/10 text-purple-400 border-purple-500/20'
                            : 'bg-sky-500/10 text-sky-400 border-sky-500/20'
                    )}>
                        {aiTargetType === 'local' ? <Cpu size={10} /> : <Cloud size={10} />}
                        {aiTargetType === 'local' ? 'LOCAL AI' : 'Gemini'}
                    </span>
                    <button
                        onClick={handleResetLedger}
                        disabled={isRunning}
                        className={cn(
                            'flex items-center gap-1 px-3 py-1.5 border rounded text-xs font-bold transition-colors shadow-sm',
                            isRunning 
                                ? 'bg-muted/50 text-muted-foreground border-border/40' 
                                : 'bg-red-500/10 text-red-500 border-red-500/20 hover:bg-red-500/20'
                        )}
                        title="과거 데이터 삭제 및 완전 초기화"
                    >
                        <Trash2 size={12} /> 초기화
                    </button>
                    <button
                        onClick={handleRun}
                        disabled={isRunning}
                        className={cn(
                            'flex items-center gap-1.5 px-3 py-1.5 border rounded text-xs font-bold transition-colors shadow-sm',
                            isRunning
                                ? 'bg-primary/10 text-primary border-primary/30'
                                : 'bg-gradient-to-r from-red-500/10 to-orange-500/10 text-orange-500 border-orange-500/20 hover:bg-orange-500/20'
                        )}
                    >
                        {isRunning
                            ? <><RefreshCw size={12} className="animate-spin" /> 집계 중...</>
                            : <><Flame size={12} /> 집계 실행</>
                        }
                    </button>
                    <button onClick={loadData} disabled={isLoading} className="p-1.5 border rounded bg-background hover:bg-muted text-muted-foreground transition-colors">
                        <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
                    </button>
                    {/* AI 설정 버튼 */}
                    <button
                        onClick={handleOpenAiSettings}
                        title="AI 모델 설정"
                        className="p-1.5 border rounded bg-background hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                    >
                        <Settings size={14} />
                    </button>
                </div>
            </div>

            {/* 에러 토스트 */}
            {runError && (
                <div className="mx-4 mt-2 px-3 py-2 rounded-lg border border-red-500/30 bg-red-500/5 text-red-400 text-[11px] flex items-center gap-2 shrink-0">
                    <span className="shrink-0">⚠️</span>
                    <span className="flex-1 truncate">{runError}</span>
                    <button onClick={() => setRunError('')} className="shrink-0 text-red-400/60 hover:text-red-400">✕</button>
                </div>
            )}
            {/* 바디: 좌측 카드 리스트 50% + 우측 상세 패널 50% */}
            <div className="flex-1 flex overflow-hidden">

                {/* 좌측 카드 리스트 — 독립 스크롤, 스크롤바 숨김 */}
                <div
                    className="w-1/2 border-r p-4 space-y-3 overflow-y-auto [&::-webkit-scrollbar]:hidden"
                    style={{ scrollbarWidth: 'none' } as React.CSSProperties}
                >
                    {isLoading && themes.length === 0 ? (
                        <div className="flex items-center justify-center pt-16 text-muted-foreground">
                            <RefreshCw size={16} className="animate-spin mr-2" /> 데이터 로드 중...
                        </div>
                    ) : filteredThemes.length === 0 ? (
                        <div className="flex flex-col items-center justify-center pt-16 text-muted-foreground gap-2">
                            <AlertTriangle size={24} className="opacity-30" />
                            <span className="text-xs">집계 데이터가 없습니다.<br />우상단 [집계 실행] 버튼을 눌러 시작하세요.</span>
                        </div>
                    ) : (
                        filteredThemes.map((theme, idx) => renderCard(theme, idx + 1))
                    )}
                </div>

                {/* 우측 상세 패널 — 항상 표시, 독립 스크롤, 스크롤바 숨김 */}
                <div
                    className="w-1/2 overflow-y-auto bg-muted/[0.02] [&::-webkit-scrollbar]:hidden"
                    style={{ scrollbarWidth: 'none' } as React.CSSProperties}
                >
                    {selectedTheme ? (
                        renderDetailPanel()
                    ) : (
                        <div className="flex flex-col items-center justify-center h-full text-muted-foreground/30 gap-3">
                            <Layers size={36} className="opacity-20" />
                            <span className="text-xs text-center leading-relaxed">
                                좌측 메가 테마 카드를<br />클릭하면 상세 분석이 표시됩니다
                            </span>
                        </div>
                    )}
                </div>
            </div>

            {/* 종목 상세 모달 */}
            {selectedStock && (
                <StockDetailModal
                    stockCode={selectedStock.stockCode}
                    stockName={selectedStock.stockName}
                    onClose={() => setSelectedStock(null)}
                />
            )}

            {/* AI 설정 팝업 */}
            {showAiSettings && (
                <div className="fixed inset-0 z-50 flex items-center justify-center">
                    {/* 오버레이 */}
                    <div
                        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                        onClick={() => setShowAiSettings(false)}
                    />
                    {/* 팝업 */}
                    <div className="relative z-10 w-[420px] rounded-2xl border border-border bg-card shadow-2xl overflow-hidden">
                        {/* 팝업 헤더 */}
                        <div className="px-5 py-4 border-b bg-muted/5 flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <Settings size={15} className="text-muted-foreground" />
                                <h3 className="font-bold text-sm text-foreground">AI 모델 설정 — 메가 테마 집계</h3>
                            </div>
                            <button
                                onClick={() => setShowAiSettings(false)}
                                className="text-muted-foreground hover:text-foreground transition-colors text-lg leading-none"
                            >✕</button>
                        </div>

                        {/* 팝업 바디 */}
                        <div className="p-5 space-y-4">
                            <p className="text-[12px] text-muted-foreground leading-relaxed">
                                메가 테마 그루핑에 사용할 AI 모델을 선택합니다.<br />
                                로컬 AI는 LM Studio가 실행 중이어야 합니다.
                            </p>

                            {/* 옵션 1: Gemini */}
                            <button
                                onClick={() => handleSaveAiConfig('gemini')}
                                disabled={isSavingConfig}
                                className={cn(
                                    'w-full text-left p-4 rounded-xl border-2 transition-all',
                                    aiTargetType === 'gemini'
                                        ? 'border-sky-500/60 bg-sky-500/5'
                                        : 'border-border bg-muted/5 hover:border-border/80 hover:bg-muted/10'
                                )}
                            >
                                <div className="flex items-center gap-3">
                                    <div className={cn(
                                        'w-8 h-8 rounded-lg flex items-center justify-center',
                                        aiTargetType === 'gemini' ? 'bg-sky-500/20' : 'bg-muted'
                                    )}>
                                        <Cloud size={16} className={aiTargetType === 'gemini' ? 'text-sky-400' : 'text-muted-foreground'} />
                                    </div>
                                    <div className="flex-1">
                                        <div className="flex items-center gap-2">
                                            <span className="font-bold text-sm text-foreground">Gemini (시스템 기본)</span>
                                            {aiTargetType === 'gemini' && (
                                                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-sky-500/20 text-sky-400 border border-sky-500/30">사용 중</span>
                                            )}
                                        </div>
                                        <span className="text-[11px] text-muted-foreground">시스템 설정에 지정된 Gemini API 키 사용</span>
                                    </div>
                                </div>
                            </button>

                            {/* 옵션 2: Local AI */}
                            <button
                                onClick={() => handleSaveAiConfig('local')}
                                disabled={isSavingConfig}
                                className={cn(
                                    'w-full text-left p-4 rounded-xl border-2 transition-all',
                                    aiTargetType === 'local'
                                        ? 'border-purple-500/60 bg-purple-500/5'
                                        : 'border-border bg-muted/5 hover:border-border/80 hover:bg-muted/10'
                                )}
                            >
                                <div className="flex items-center gap-3">
                                    <div className={cn(
                                        'w-8 h-8 rounded-lg flex items-center justify-center',
                                        aiTargetType === 'local' ? 'bg-purple-500/20' : 'bg-muted'
                                    )}>
                                        <Cpu size={16} className={aiTargetType === 'local' ? 'text-purple-400' : 'text-muted-foreground'} />
                                    </div>
                                    <div className="flex-1">
                                        <div className="flex items-center gap-2">
                                            <span className="font-bold text-sm text-foreground">로컬 AI (LM Studio)</span>
                                            {aiTargetType === 'local' && (
                                                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-400 border border-purple-500/30">사용 중</span>
                                            )}
                                        </div>
                                        <span className="text-[11px] text-muted-foreground">군집 AI와 동일한 로컬 모델 사용 (비용 0원)</span>
                                    </div>
                                    {/* 연결 상태 */}
                                    <div className="shrink-0">
                                        {localAiStatus === null ? (
                                            <RefreshCw size={14} className="animate-spin text-muted-foreground" />
                                        ) : localAiStatus.isOnline ? (
                                            <div className="flex items-center gap-1 text-emerald-400">
                                                <Wifi size={13} />
                                                <span className="text-[10px] font-bold">온라인</span>
                                            </div>
                                        ) : (
                                            <div className="flex items-center gap-1 text-red-400">
                                                <WifiOff size={13} />
                                                <span className="text-[10px] font-bold">오프라인</span>
                                            </div>
                                        )}
                                    </div>
                                </div>
                                {/* 로드된 모델 표시 */}
                                {localAiStatus?.isOnline && localAiStatus.models.length > 0 && (
                                    <div className="mt-2 ml-11 text-[10px] font-mono text-muted-foreground bg-muted/30 px-2 py-1 rounded border border-border/40">
                                        {localAiStatus.models.slice(0, 2).map(m => (
                                            <div key={m} className="truncate">▸ {m}</div>
                                        ))}
                                    </div>
                                )}
                            </button>
                        </div>

                        {/* 팝업 푸터 */}
                        <div className="px-5 py-3 border-t bg-muted/5 flex justify-end">
                            <button
                                onClick={() => setShowAiSettings(false)}
                                className="px-4 py-1.5 rounded-lg text-xs text-muted-foreground border hover:bg-muted transition-colors"
                            >닫기</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
