import React, { useState, useEffect, useCallback } from 'react';
import { Target, Settings, BarChart2, Award, TrendingUp, ArrowUpRight, Clock, Trash2, ShieldCheck, Zap, X, ShieldOff, ShieldAlert, AlertTriangle, Copy, CheckCheck } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)) }

// ── 카테고리 메타 ──
const CATEGORY_META: Record<string, { icon: string; label: string; color: string }> = {
    EMERGING_STAR:     { icon: '🔥', label: '신흥 급부상', color: 'text-red-500 bg-red-500/10 border-red-500/30' },
    PULLBACK_REBOUND:  { icon: '🔥', label: '눌림 반등',   color: 'text-red-500 bg-red-500/10 border-red-500/30' },
    PULLBACK_DIP:      { icon: '📉', label: '눌림목',      color: 'text-amber-500 bg-amber-500/10 border-amber-500/30' },
    TRUE_LEADER:       { icon: '👑', label: '진성 대장',   color: 'text-orange-500 bg-orange-500/10 border-orange-500/30' },
    INTRADAY_SURGE:    { icon: '🔺', label: '당일 급등',      color: 'text-rose-500 bg-rose-500/10 border-rose-500/30' },
    SHORT_TERM_CONSOLIDATION: { icon: '🎯', label: '단기 눌림', color: 'text-green-500 bg-green-500/10 border-green-500/30' },
}

function CategoryBadge({ category }: { category: string }) {
    const meta = CATEGORY_META[category] || { icon: '❓', label: category, color: 'text-muted-foreground bg-muted/20 border-border/30' }
    return (
        <span className={cn('inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold border whitespace-nowrap', meta.color)}>
            {meta.icon} {meta.label}
        </span>
    )
}

function formatPrice(price: number): string {
    if (!price || price <= 0) return '—'
    return price.toLocaleString('ko-KR')
}

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

function StatusBadge({ status, isUp, failReason }: { status: string; isUp: boolean; failReason?: string }) {
    switch (status) {
        case 'BUYING':
            return <span className="text-[10px] px-1.5 py-0.5 rounded font-bold bg-blue-500/10 text-blue-500 border border-blue-500/30">⏳ 매수중</span>
        case 'ACTIVE':
        case 'HOLDING':
            return <span className={cn("text-[10px] px-1.5 py-0.5 rounded font-bold border", isUp ? "bg-rose-500/10 text-rose-500 border-rose-500/30" : "bg-blue-500/10 text-blue-500 border-blue-500/30")}>
                {isUp ? '🟢 보유' : '🔴 보유'}
            </span>
        case 'SELLING':
            return <span className="text-[10px] px-1.5 py-0.5 rounded font-bold bg-amber-500/10 text-amber-500 border border-amber-500/30">⚡ 매도중</span>
        case 'CLOSED':
            return <span className="text-[10px] px-1.5 py-0.5 rounded font-bold bg-muted/30 text-muted-foreground border border-border/50">✅ 청산</span>
        case 'FAILED':
            return <span className="text-[10px] px-1.5 py-0.5 rounded font-bold bg-red-500/10 text-red-500 border border-red-500/30 cursor-help" title={failReason || '매수 실패'}>❌ 실패</span>
        default:
            return null;
    }
}

// 목업 데이터
const MOCK_PICKS = [
    {
        id: 'TKT-103', pick_date: '2026-04-22', pick_rank: 1, stock_code: '004710', stock_name: '한솔테크닉스', category: 'PULLBACK_DIP',
        buy_score: 91, related_themes: '친환경에너지, IT부품', entry_price: 7300, current_price: 7320, holding_days: 0, target_days: 3, 
        peak_return: 0.2, status: 'BUYING', pnlPct: 0.2
    },
    {
        id: 'TKT-102', pick_date: '2026-04-19', pick_rank: 1, stock_code: '083450', stock_name: 'GST', category: 'TRUE_LEADER',
        buy_score: 93, related_themes: '반도체', entry_price: 40000, current_price: 44750, holding_days: 3, target_days: 7, 
        peak_return: 11.8, status: 'HOLDING', pnlPct: 11.8
    },
    {
        id: 'TKT-101', pick_date: '2026-04-19', pick_rank: 2, stock_code: '004710', stock_name: '한솔테크닉스', category: 'EMERGING_STAR',
        buy_score: 89, related_themes: '친환경에너지, IT부품', entry_price: 7540, current_price: 7320, holding_days: 3, target_days: 5, 
        peak_return: 1.2, status: 'SELLING', pnlPct: -2.9
    },
    {
        id: 'TKT-100', pick_date: '2026-04-17', pick_rank: 1, stock_code: '001440', stock_name: '대한전선', category: 'INTRADAY_SURGE',
        buy_score: 90, related_themes: '전력설비', entry_price: 39500, current_price: 41050, holding_days: 2, target_days: 2, 
        peak_return: 4.2, status: 'CLOSED', pnlPct: 3.9
    }
];

export const LiveTradeTab: React.FC = () => {
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [activeStrategy, setActiveStrategy] = useState('TRUE_LEADER');
    const [strategies, setStrategies] = useState<any[]>([]);
    const [tickets, setTickets] = useState<any[]>([]);
    const [editForm, setEditForm] = useState({ amt: 1000000, days: 7, tp: 10, isActive: false });
    const [killSwitch, setKillSwitch] = useState(false);

    // ─── 에러 로그 ───────────────────────────────────────────────────────
    const [errorLogs, setErrorLogs] = useState<Array<{ time: string; source: string; message: string; detail: string }>>([]);
    const [isErrorLogOpen, setIsErrorLogOpen] = useState(false);
    const [isCopied, setIsCopied] = useState(false);

    // ─── Grid Search 최적 파라미터 ─────────────────────────────────────────────
    const [gridSearchResults, setGridSearchResults] = useState<Record<string, any> | null>(null);
    const [gridSearchCachedAt, setGridSearchCachedAt] = useState<string | null>(null);
    const [isLoadingGridSearch, setIsLoadingGridSearch] = useState(false);

    // ─── 실시간 현재가 Map (종목코드 → 현재가) ────────────────────────────────
    // 동일 종목코드를 여러 티켓이 추적해도 Map에는 1개 엔트리만 유지됨
    const [livePrices, setLivePrices] = useState<Record<string, number>>({});

    // 현재 WS 구독 중인 종목코드 Set — ref로 관리해 리렌더 없이 diff 계산
    const subscribedCodesRef = React.useRef<Set<string>>(new Set());
    
    // Kill-Switch 초기 상태 로드
    useEffect(() => {
        const loadKillSwitch = async () => {
            if (window.electronAPI?.getLiveTradeKillSwitch) {
                const active = await window.electronAPI.getLiveTradeKillSwitch();
                setKillSwitch(active);
            }
        };
        loadKillSwitch();
    }, []);

    const handleToggleKillSwitch = useCallback(async () => {
        if (!window.electronAPI?.setLiveTradeKillSwitch) return;
        const newState = !killSwitch;
        if (newState) {
            const confirmed = window.confirm('⚠️ 긴급 중단을 활성화하면 모든 실전 매매 주문이 차단됩니다.\n계속하시겠습니까?');
            if (!confirmed) return;
        }
        try {
            await window.electronAPI.setLiveTradeKillSwitch(newState);
            setKillSwitch(newState);
        } catch (e: any) {
            alert('Kill-Switch 설정 오류: ' + e.message);
        }
    }, [killSwitch]);
    
    useEffect(() => {
        const loadData = async () => {
            if (window.electronAPI && window.electronAPI.getLiveTradeStrategies) {
                const fetchedStrategies = await window.electronAPI.getLiveTradeStrategies();
                const fetchedTickets = await window.electronAPI.getLiveTradeTickets();
                setStrategies(fetchedStrategies || []);
                setTickets(fetchedTickets || []);
                
                // Initialize activeStrategy dropdown to the currently running strategy if exists
                const running = fetchedStrategies?.find((s: any) => s.is_active === 1);
                if (running) {
                    setActiveStrategy(running.strategy_category);
                }
            } else {
                setTickets(MOCK_PICKS);
            }
        };
        loadData();
    }, []);

    useEffect(() => {
        const strat = strategies.find(s => s.strategy_category === activeStrategy);
        if (strat) {
            setEditForm({ amt: strat.buy_amount_per_trade, days: strat.max_hold_days, tp: strat.target_profit_rate, isActive: strat.is_active === 1 });
        } else {
            setEditForm({ amt: 1000000, days: 7, tp: 10, isActive: false });
        }
    }, [activeStrategy, strategies]);

    // ─── Grid Search 결과 로드 (모달 열릴 때마다) ──────────────────────────────
    useEffect(() => {
        if (!isSettingsOpen) return;
        const load = async () => {
            if (!window.electronAPI?.getGridSearchResults) return;
            setIsLoadingGridSearch(true);
            try {
                const cached = await window.electronAPI.getGridSearchResults();
                if (cached?.optimized) {
                    setGridSearchResults(cached.optimized);
                    setGridSearchCachedAt(cached.cachedAt || null);
                } else {
                    setGridSearchResults(null);
                    setGridSearchCachedAt(null);
                }
            } catch (e) {
                console.error('[LiveTradeTab] getGridSearchResults error:', e);
            } finally {
                setIsLoadingGridSearch(false);
            }
        };
        load();
    }, [isSettingsOpen]);

    // ─── 최적 파라미터 적용 ────────────────────────────────────────────────────
    const applyOptimalParams = (type: 'profit' | 'efficiency') => {
        const result = gridSearchResults?.[activeStrategy];
        if (!result) return;
        if (type === 'profit') {
            setEditForm(prev => ({ ...prev, days: result.targetDays, tp: result.targetYield }));
        } else {
            const eff = result.bestEfficiencyCombo;
            if (!eff) return;
            setEditForm(prev => ({ ...prev, days: eff.targetDays, tp: eff.targetYield }));
        }
    };

    // ─── WebSocket 구독 관리 ───────────────────────────────────────────────────
    // tickets가 바뀔 때마다 ACTIVE/SELLING 종목코드를 기준으로
    // 신규 구독 추가(subscribe) / 더 이상 보유하지 않는 종목 해제(unsubscribe)
    useEffect(() => {
        if (!window.electronAPI?.wsRegister || !window.electronAPI?.wsUnregister) return;

        // 현재 보유 중(ACTIVE/SELLING)인 종목코드를 Set으로 — 중복 자동 제거
        const currentActive = new Set<string>(
            tickets
                .filter(t => t.status === 'ACTIVE' || t.status === 'SELLING')
                .map(t => (t.stock_code || '').replace(/^A/, '').trim())
                .filter(c => c.length === 6)
        );

        const prev = subscribedCodesRef.current;

        // 새로 구독할 코드: currentActive에 있지만 아직 구독하지 않은 코드
        const toSubscribe = [...currentActive].filter(c => !prev.has(c));

        // 해제할 코드: prev에 있지만 더 이상 ACTIVE/SELLING 티켓이 없는 코드
        const toUnsubscribe = [...prev].filter(c => !currentActive.has(c));

        if (toSubscribe.length > 0) {
            window.electronAPI.wsRegister(toSubscribe);
            toSubscribe.forEach(c => prev.add(c));
            console.log('[LiveTradeTab] WS 구독 추가:', toSubscribe);
        }

        if (toUnsubscribe.length > 0) {
            window.electronAPI.wsUnregister(toUnsubscribe);
            toUnsubscribe.forEach(c => prev.delete(c));
            console.log('[LiveTradeTab] WS 구독 해제:', toUnsubscribe);
        }

        // subscribedCodesRef는 이미 직접 수정했으므로 별도 setState 불필요
    }, [tickets]);

    // ─── 실시간 시세 수신 ─────────────────────────────────────────────────────
    useEffect(() => {
        if (!window.electronAPI?.onRealTimeData) return;

        const unsub = window.electronAPI.onRealTimeData((data: any) => {
            // stk_cd는 'A005930' 또는 '005930' 형식 모두 처리
            const rawCode = String(data.stk_cd || data.item || '');
            const code = rawCode.replace(/^A/, '').replace(/[^0-9]/g, '');
            if (code.length !== 6) return;

            // 우리가 구독 중인 종목만 처리 (다른 탭의 구독 데이터 혼입 방지)
            if (!subscribedCodesRef.current.has(code)) return;

            const rawPrice = String(data.cur_prc || data.stck_prpr || data.price || '0');
            const price = Math.abs(parseInt(rawPrice.replace(/[^0-9-]/g, ''), 10));
            if (price <= 0) return;

            setLivePrices(prev => {
                if (prev[code] === price) return prev; // 변화 없으면 리렌더 방지
                return { ...prev, [code]: price };
            });
        });

        return () => { if (typeof unsub === 'function') unsub(); };
    }, []);

    // ─── 실전 매매 에러 이벤트 수신 ───────────────────────────────────────
    useEffect(() => {
        if (!window.electronAPI?.onLiveTradeError) return;
        const unsub = window.electronAPI.onLiveTradeError((errorInfo: any) => {
            setErrorLogs(prev => [errorInfo, ...prev].slice(0, 200)); // 최대 200개 보존
        });
        return () => { if (typeof unsub === 'function') unsub(); };
    }, []);

    const handleCopyErrorLog = useCallback(() => {
        const text = errorLogs.map(e =>
            `[${e.time}] [${e.source}] ${e.message}\n${e.detail ? `  상세: ${e.detail}` : ''}`
        ).join('\n\n');
        navigator.clipboard.writeText(text).then(() => {
            setIsCopied(true);
            setTimeout(() => setIsCopied(false), 2000);
        });
    }, [errorLogs]);

    const handleSaveStrategy = async () => {
        if (!window.electronAPI) return;
        try {
            await window.electronAPI.saveLiveTradeStrategy({
                strategy_category: activeStrategy,
                is_active: editForm.isActive ? 1 : 0,
                buy_amount_per_trade: editForm.amt,
                max_hold_days: editForm.days,
                target_profit_rate: editForm.tp
            });
            alert('실전 매매 설정이 저장되었습니다.');
            setIsSettingsOpen(false);
            const fetchedStrategies = await window.electronAPI.getLiveTradeStrategies();
            setStrategies(fetchedStrategies || []);
        } catch (error: any) {
            alert('저장 중 오류가 발생했습니다: ' + error.message);
        }
    };

    // 모의 그룹핑 (날짜별) - Grouping real tickets
    const dateGroups = Array.from(new Set(tickets.map(t => (t.pick_date || t.entry_date)?.split('T')[0]))).sort().reverse();
    const groupedByDate = dateGroups.map(date => ({
        date,
        picks: tickets.filter(t => (t.pick_date || t.entry_date)?.split('T')[0] === date)
    }));

    const activeRunningStrategy = strategies.find(s => s.is_active === 1);
    const systemStatus = activeRunningStrategy ? 'System Online' : 'System Offline';
    const systemStatusColor = activeRunningStrategy ? 'bg-emerald-500/20 text-emerald-600 border-emerald-500/30' : 'bg-muted/20 text-muted-foreground border-border/30';

    // Stats Calculation
    const closedTickets = tickets.filter(t => t.status === 'CLOSED');
    const winTickets = closedTickets.filter(t => (t.pnlPct || 0) > 0);
    const totalClosed = closedTickets.length;
    const winRate = totalClosed > 0 ? ((winTickets.length / totalClosed) * 100).toFixed(1) : '0.0';
    
    const cumulativeReturn = closedTickets.reduce((sum, t) => sum + (t.pnlPct || 0), 0);
    const cumulativeProfit = closedTickets.reduce((sum, t) => {
        const pnlAmt = t.pnlAmount || ((t.entry_price && t.quantity && t.pnlPct) ? (t.entry_price * t.quantity * (t.pnlPct / 100)) : 0);
        return sum + pnlAmt;
    }, 0);

    return (
        <div className="flex flex-col h-full overflow-hidden select-none relative">
            {/* ── 상단 요약 바 ── */}
            <div className="shrink-0 px-4 py-3 border-b border-border/50 bg-emerald-500/5">
                <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                        <Zap className={cn("w-4 h-4", activeRunningStrategy ? "text-emerald-500" : "text-muted-foreground")} />
                        {activeRunningStrategy ? (
                            <span className="font-bold text-sm text-emerald-600 dark:text-emerald-400">
                                {CATEGORY_META[activeRunningStrategy.strategy_category]?.label || activeRunningStrategy.strategy_category} ({activeRunningStrategy.buy_amount_per_trade?.toLocaleString()}원 / 보유 {activeRunningStrategy.max_hold_days}일 / 목표 {activeRunningStrategy.target_profit_rate}%)
                            </span>
                        ) : (
                            <span className="font-bold text-sm text-muted-foreground">설정된 실전 매매 전략이 없습니다</span>
                        )}
                        <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded border", systemStatusColor)}>
                            {systemStatus}
                        </span>
                    </div>
                    <div className="flex items-center gap-2">
                        {/* ─── 에러 로그 버튼 ─── */}
                        {errorLogs.length > 0 && (
                            <button
                                id="live-trade-error-log-btn"
                                onClick={() => setIsErrorLogOpen(true)}
                                title="에러 로그 보기"
                                className="relative text-xs font-bold px-3 py-1.5 rounded transition-all shadow-sm flex items-center gap-1.5 border bg-background hover:bg-amber-500/10 text-amber-500 border-amber-500/40 hover:border-amber-500"
                            >
                                <AlertTriangle className="w-3.5 h-3.5" />
                                에러 로그
                                <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] bg-amber-500 text-white text-[10px] font-black rounded-full flex items-center justify-center px-1">
                                    {errorLogs.length}
                                </span>
                            </button>
                        )}
                        {/* Kill-Switch 버튼 */}
                        <button
                            id="live-trade-kill-switch-btn"
                            onClick={handleToggleKillSwitch}
                            title={killSwitch ? '긴급 중단 해제' : '긴급 중단 활성화'}
                            className={cn(
                                'text-xs font-bold px-3 py-1.5 rounded transition-all shadow-sm flex items-center gap-1.5 border',
                                killSwitch
                                    ? 'bg-red-500 hover:bg-red-600 text-white border-red-600 animate-pulse'
                                    : 'bg-background hover:bg-red-500/10 text-red-500 border-red-500/40 hover:border-red-500'
                            )}
                        >
                            {killSwitch ? <ShieldAlert className="w-3.5 h-3.5" /> : <ShieldOff className="w-3.5 h-3.5" />}
                            {killSwitch ? '긴급 중단 中' : '긴급 중단'}
                        </button>
                        <button
                            onClick={() => setIsSettingsOpen(true)}
                            className="text-xs font-bold text-white bg-indigo-500 hover:bg-indigo-600 px-3 py-1.5 rounded transition-colors shadow-sm flex items-center gap-1.5"
                        >
                            <Settings className="w-3.5 h-3.5" />
                            실전 전략 설정
                        </button>
                    </div>
                </div>

                {/* Stats Bar */}
                <div className="grid grid-cols-4 gap-3">
                    {[
                        { icon: <ShieldCheck className="w-4 h-4 text-indigo-400" />, label: '총 건수 (진행중)', value: `${tickets.length}건`, sub: `(진행중 ${tickets.length - totalClosed}건)` },
                        { icon: <TrendingUp className={cn("w-4 h-4", cumulativeReturn > 0 ? "text-rose-500" : (cumulativeReturn < 0 ? "text-blue-500" : "text-muted-foreground"))} />, label: '누적 수익률', value: `${cumulativeReturn > 0 ? '+' : ''}${cumulativeReturn.toFixed(1)}%`, color: cumulativeReturn > 0 ? 'text-rose-500' : (cumulativeReturn < 0 ? 'text-blue-500' : 'text-foreground') },
                        { icon: <Award className={cn("w-4 h-4", cumulativeProfit > 0 ? "text-rose-500" : (cumulativeProfit < 0 ? "text-blue-500" : "text-muted-foreground"))} />, label: '누적 수익금', value: `${Math.floor(cumulativeProfit).toLocaleString()}원`, color: cumulativeProfit > 0 ? 'text-rose-500' : (cumulativeProfit < 0 ? 'text-blue-500' : 'text-foreground') },
                        { icon: <Target className="w-4 h-4 text-emerald-500" />, label: '총 승률 (수익/청산)', value: `${winRate}%`, sub: `(${winTickets.length}건 / ${totalClosed}건)` },
                    ].map(({ icon, label, value, sub, color }) => (
                        <div key={label} className="flex items-center gap-3 px-4 py-2.5 bg-background border border-border/40 rounded-lg shadow-sm">
                            <div className="flex-shrink-0 p-2 bg-muted/40 rounded-lg">{icon}</div>
                            <div className="min-w-0 flex-1">
                                <div className="text-[11px] text-muted-foreground font-bold mb-0.5">
                                    {label}
                                </div>
                                <div className="flex items-baseline gap-1.5">
                                    <div className={cn('text-lg font-mono font-black', color || 'text-foreground')}>{value}</div>
                                    {sub && <div className="text-xs text-muted-foreground font-medium">{sub}</div>}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* ── 메인 테이블 ── */}
            <div className="flex-1 overflow-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
                <table className="w-full text-sm text-left whitespace-nowrap">
                    <thead className="sticky top-0 z-10 bg-background">
                        <tr className="text-xs uppercase text-muted-foreground border-b border-border/60">
                            <th className="py-2 px-3 font-bold">종목명</th>
                            <th className="py-2 px-3 font-bold">테마</th>
                            <th className="py-2 px-3 font-bold text-center">카테고리</th>
                            <th className="py-2 px-3 font-bold text-center">AI점수</th>
                            <th className="py-2 px-3 font-bold text-right">진입가</th>
                            <th className="py-2 px-3 font-bold text-right">현재/청산가</th>
                            <th className="py-2 px-3 font-bold text-center">D-day</th>
                            <th className="py-2 px-3 font-bold text-right">피크</th>
                            <th className="py-2 px-3 font-bold text-right">현재수익</th>
                            <th className="py-2 px-3 font-bold text-center">진행 상태</th>
                        </tr>
                    </thead>
                    <tbody>
                        {groupedByDate.map(({ date, picks: datePicks }) => (
                            <React.Fragment key={date}>
                                <tr className="bg-muted/30 border-y border-border/40">
                                    <td colSpan={10} className="py-2 px-3">
                                        <div className="flex items-center gap-3">
                                            <span className="font-black text-xs text-foreground">
                                                📅 {date} 진입분
                                            </span>
                                            <span className="text-[10px] text-muted-foreground font-mono">
                                                해당일 진입 {datePicks.length}건
                                            </span>
                                        </div>
                                    </td>
                                </tr>
                                {datePicks.map((pick) => {
                                    const stockCode = (pick.stock_code || '').replace(/^A/, '').trim();
                                    const isLive = pick.status === 'ACTIVE' || pick.status === 'SELLING';

                                    // 실시간 현재가 (WS 수신 시) 또는 DB 저장값 폴백
                                    const livePrice = isLive ? (livePrices[stockCode] || pick.current_price || pick.entry_price) : (pick.current_price || pick.entry_price);
                                    const isReceivingLive = isLive && !!livePrices[stockCode];

                                    // 실시간으로 수익률 계산
                                    const livePnlPct = (isReceivingLive && pick.entry_price > 0)
                                        ? ((livePrice - pick.entry_price) / pick.entry_price) * 100
                                        : (pick.pnlPct || 0);

                                    return (
                                        <tr key={pick.id} className="border-b border-border/20 hover:bg-accent/30 transition-colors group">
                                            <td className="py-2.5 px-3">
                                                <div className="font-semibold text-sm text-foreground">{pick.stock_name || pick.stock_code}</div>
                                                <div className="text-[10px] font-mono text-muted-foreground">{pick.stock_code}</div>
                                            </td>
                                            <td className="py-2.5 px-3">
                                                <div className="text-xs text-muted-foreground truncate max-w-[120px] sm:max-w-[160px]">
                                                    {pick.related_themes || '분석 중'}
                                                </div>
                                            </td>
                                            <td className="py-2.5 px-3 text-center">
                                                <CategoryBadge category={pick.category || pick.strategy_category} />
                                            </td>
                                            <td className="py-2.5 px-3 text-center">
                                                <span className="font-mono font-bold text-sm text-amber-400">{pick.buy_score || 90}</span>
                                            </td>
                                            <td className="py-2.5 px-3 text-right">
                                                <span className="font-mono text-sm text-muted-foreground">
                                                    {formatPrice(pick.entry_price)}
                                                </span>
                                            </td>
                                            {/* 현재가 — 실시간 수신 시 라이브 표시 */}
                                            <td className="py-2.5 px-3 text-right">
                                                <div className="flex items-center justify-end gap-1">
                                                    {isReceivingLive && (
                                                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shrink-0" title="실시간 시세 수신 중" />
                                                    )}
                                                    <span className={cn('font-mono text-sm font-bold', livePnlPct > 0 ? 'text-rose-500' : livePnlPct < 0 ? 'text-blue-500' : 'text-foreground')}>
                                                        {formatPrice(livePrice)}
                                                    </span>
                                                </div>
                                                {isReceivingLive && (
                                                    <div className={cn('text-[10px] font-mono font-bold text-right', livePnlPct > 0 ? 'text-rose-500' : livePnlPct < 0 ? 'text-blue-400' : 'text-muted-foreground')}>
                                                        {livePnlPct > 0 ? '+' : ''}{livePnlPct.toFixed(2)}%
                                                    </div>
                                                )}
                                            </td>
                                            <td className="py-2.5 px-3 text-center">
                                                {pick.status === 'ACTIVE' ? (
                                                    <span className={cn('text-xs font-bold', (pick.target_days - (pick.holding_days || 0)) <= 0 ? 'text-red-400' : 'text-foreground')}>
                                                        {(pick.target_days - (pick.holding_days || 0)) <= 0 ? '매도예정' : `D-${(pick.target_days - (pick.holding_days || 0))}`}
                                                    </span>
                                                ) : pick.status === 'FAILED' ? (
                                                    <span className="text-xs text-red-500/70 font-bold" title={pick.fail_reason}>실패</span>
                                                ) : (
                                                    <span className="text-xs text-muted-foreground">종료</span>
                                                )}
                                            </td>
                                            <td className="py-2.5 px-3 text-right">
                                                <ReturnCell value={pick.peak_return} />
                                            </td>
                                            <td className="py-2.5 px-3 text-right">
                                                <ReturnCell value={isReceivingLive ? livePnlPct : pick.pnlPct} />
                                            </td>
                                            <td className="py-2.5 px-3 text-center">
                                                <StatusBadge status={pick.status} isUp={livePnlPct > 0} failReason={pick.fail_reason} />
                                            </td>
                                        </tr>
                                    )
                                })}

                            </React.Fragment>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* ── 에러 로그 팝업 (Modal) ── */}
            {isErrorLogOpen && (
                <div className="fixed inset-0 z-[110] flex justify-center items-center p-4">
                    <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setIsErrorLogOpen(false)} />
                    <div className="relative bg-background border border-border shadow-2xl rounded-xl w-full max-w-3xl overflow-hidden flex flex-col max-h-[80vh]">
                        {/* 헤더 */}
                        <div className="flex items-center justify-between p-4 border-b border-border bg-amber-500/5 shrink-0">
                            <h2 className="text-base font-bold flex items-center gap-2 text-amber-500">
                                <AlertTriangle className="w-5 h-5" />
                                실전 매매 에러 로그
                                <span className="text-xs font-normal text-muted-foreground">({errorLogs.length}건 / 최대 200건 보존)</span>
                            </h2>
                            <div className="flex items-center gap-2">
                                {/* 전체 복사 버튼 */}
                                <button
                                    onClick={handleCopyErrorLog}
                                    className={cn(
                                        'text-xs font-bold px-3 py-1.5 rounded transition-all flex items-center gap-1.5 border',
                                        isCopied
                                            ? 'bg-emerald-500/20 text-emerald-500 border-emerald-500/40'
                                            : 'bg-background hover:bg-muted text-muted-foreground border-border hover:text-foreground'
                                    )}
                                >
                                    {isCopied ? <CheckCheck className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                                    {isCopied ? '복사됨!' : '전체 복사'}
                                </button>
                                {/* 전체 삭제 버튼 */}
                                <button
                                    onClick={() => { setErrorLogs([]); setIsErrorLogOpen(false); }}
                                    className="text-xs font-bold px-3 py-1.5 rounded transition-all flex items-center gap-1.5 border bg-background hover:bg-red-500/10 text-red-400 border-red-500/30 hover:border-red-500"
                                >
                                    <Trash2 className="w-3.5 h-3.5" />
                                    전체 삭제
                                </button>
                                <button onClick={() => setIsErrorLogOpen(false)} className="p-1.5 hover:bg-muted rounded-lg text-muted-foreground hover:text-foreground transition-colors">
                                    <X className="w-4 h-4" />
                                </button>
                            </div>
                        </div>

                        {/* 로그 목록 */}
                        <div className="flex-1 overflow-auto p-3 space-y-2">
                            {errorLogs.length === 0 ? (
                                <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
                                    <AlertTriangle className="w-8 h-8 mb-2 opacity-30" />
                                    <p className="text-sm">기록된 에러가 없습니다</p>
                                </div>
                            ) : (
                                errorLogs.map((log, idx) => (
                                    <div key={idx} className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs font-mono">
                                        {/* 헤더 행 */}
                                        <div className="flex items-center gap-2 mb-1.5">
                                            <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 font-bold text-[10px] shrink-0">
                                                {log.source}
                                            </span>
                                            <span className="text-muted-foreground text-[10px] shrink-0">{log.time}</span>
                                            <span className="text-[11px] font-bold text-foreground truncate">{log.message}</span>
                                        </div>
                                        {/* 상세 */}
                                        {log.detail && (
                                            <div className="ml-1 pl-2 border-l-2 border-amber-500/30 text-muted-foreground break-all whitespace-pre-wrap leading-relaxed">
                                                {log.detail}
                                            </div>
                                        )}
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* ── 실전 매매 설정 팝업 (Modal) ── */}
            {isSettingsOpen && (
                <div className="fixed inset-0 z-[100] flex justify-center items-center p-4">
                    <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setIsSettingsOpen(false)} />
                    <div className="relative bg-background border border-border shadow-2xl rounded-xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[80vh]">
                        <div className="flex items-center justify-between p-4 border-b border-border bg-muted/30">
                            <h2 className="text-lg font-bold flex items-center gap-2">
                                <Settings className="w-5 h-5 text-indigo-500" />
                                실전 매매 자동화 설정 (Track 전략 제어)
                            </h2>
                            <button onClick={() => setIsSettingsOpen(false)} className="p-1 hover:bg-muted rounded transition-colors"><X className="w-5 h-5"/></button>
                        </div>
                        <div className="p-6 overflow-y-auto space-y-6">
                            <p className="text-sm text-muted-foreground">
                                선택된 <strong>단 하나의 단일 전략</strong>에 한해 AI가 포착한 종목을 키움증권 계좌로 <strong>자동 매수 및 청산</strong>합니다.
                            </p>
                            
                            {(() => {
                                const STRATEGIES = [
                                    { cat: 'TRUE_LEADER', name: '👑 진성 대장 (Track A)', amt: '1,000,000', days: 7, tp: '20.0', rec_days: 4, rec_tp: 3, expected_win_rate: '94.7', expected_avg_return: '2.39' },
                                    { cat: 'EMERGING_STAR', name: '🔥 신흥 급부상 (Track B)', amt: '1,000,000', days: 5, tp: '15.0', rec_days: 7, rec_tp: 20, expected_win_rate: '66.7', expected_avg_return: '7.54' },
                                    { cat: 'PULLBACK_REBOUND', name: '🔥 눌림 반등 (Track C)', amt: '1,000,000', days: 5, tp: '10.0', rec_days: 5, rec_tp: 10, expected_win_rate: '55.5', expected_avg_return: '4.20' },
                                    { cat: 'PULLBACK_DIP', name: '📉 눌림목 (Track C)', amt: '1,500,000', days: 10, tp: '10.0', rec_days: 7, rec_tp: 15, expected_win_rate: '41.2', expected_avg_return: '5.44' },
                                    { cat: 'INTRADAY_SURGE', name: '🔺 당일 급등 (Track D)', amt: '500,000', days: 2, tp: '5.0', rec_days: 7, rec_tp: 10, expected_win_rate: '62.5', expected_avg_return: '3.66' },
                                    { cat: 'SHORT_TERM_CONSOLIDATION', name: '🎯 단기 눌림 (Track E)', amt: '1,000,000', days: 5, tp: '5.0', rec_days: 5, rec_tp: 8, expected_win_rate: '70.0', expected_avg_return: '2.50' },
                                ];
                                const selectedConfig = STRATEGIES.find(s => s.cat === activeStrategy) || STRATEGIES[0];

                                return (
                                    <>
                                        {/* Dropdown for Strategy Selection */}
                                        <div>
                                            <label className="text-xs font-bold text-foreground mb-2 block">운용 전략 선택</label>
                                            <select 
                                                value={activeStrategy}
                                                onChange={(e) => setActiveStrategy(e.target.value)}
                                                className="w-full bg-background border border-input rounded-lg px-3 py-2 text-sm font-bold text-foreground focus:ring-2 focus:ring-indigo-500/50 outline-none transition-shadow"
                                            >
                                                {STRATEGIES.map(s => (
                                                    <option key={s.cat} value={s.cat}>{s.name}</option>
                                                ))}
                                            </select>
                                        </div>

                                        {/* Config Form for selected Strategy */}
                                        <div className="border border-indigo-500/30 bg-indigo-500/5 rounded-xl p-5 space-y-5">
                                            <div className="flex items-center justify-between pb-4 border-b border-indigo-500/10">
                                                <div className="font-bold text-sm flex items-center gap-2 text-indigo-600 dark:text-indigo-400">
                                                    <Settings className="w-4 h-4" />
                                                    선택된 전략 세부 설정
                                                </div>
                                                <div className="flex items-center gap-3">
                                                    <span className="text-xs font-bold text-foreground">자동매매 시스템</span>
                                                    <button
                                                        onClick={() => setEditForm(prev => ({...prev, isActive: !prev.isActive}))}
                                                        className={cn(
                                                            "relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none",
                                                            editForm.isActive ? "bg-indigo-500" : "bg-muted"
                                                        )}
                                                    >
                                                        <span className="sr-only">Use setting</span>
                                                        <span
                                                            aria-hidden="true"
                                                            className={cn(
                                                                "pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out",
                                                                editForm.isActive ? "translate-x-4" : "translate-x-0"
                                                            )}
                                                        />
                                                    </button>
                                                    <span className={cn("text-xs font-bold w-6", editForm.isActive ? "text-indigo-500" : "text-muted-foreground")}>
                                                        {editForm.isActive ? 'ON' : 'OFF'}
                                                    </span>
                                                </div>
                                            </div>
                                            <div className="font-bold text-sm flex items-center justify-end text-indigo-600 dark:text-indigo-400 -mt-2">
                                                <div className="text-[10px] font-bold flex gap-3">
                                                    <span className="text-muted-foreground">✨ AI 예상 승률: <span className="text-emerald-500">{selectedConfig.expected_win_rate}%</span></span>
                                                    <span className="text-muted-foreground">AI 예상 평균수익: <span className="text-rose-500">+{selectedConfig.expected_avg_return}%</span></span>
                                                </div>
                                            </div>
                                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
                                                <div>
                                                    <label className="text-[10px] text-muted-foreground font-bold mb-1 block">1회 매수 금액</label>
                                                    <div className="flex">
                                                        <input 
                                                            type="text" 
                                                            value={editForm.amt.toLocaleString()} 
                                                            onChange={(e) => {
                                                                const val = e.target.value.replace(/[^0-9]/g, '');
                                                                setEditForm(prev => ({...prev, amt: Number(val)}));
                                                            }} 
                                                            key={`${activeStrategy}-amt`} 
                                                            className="w-full bg-background border border-input border-r-0 rounded-l px-2 py-1.5 text-sm font-mono text-right" 
                                                        />
                                                        <span className="bg-muted border border-input rounded-r px-2 py-1.5 text-xs text-muted-foreground flex items-center">원</span>
                                                    </div>
                                                </div>
                                                <div>
                                                    <label className="text-[10px] text-muted-foreground font-bold mb-1 block">최대 보유일 (D-Day)</label>
                                                    <div className="flex">
                                                        <input type="number" value={editForm.days} onChange={(e) => setEditForm(prev => ({...prev, days: Number(e.target.value)}))} key={`${activeStrategy}-days`} className="w-full bg-background border border-input border-r-0 rounded-l px-2 py-1.5 text-sm font-mono text-right" />
                                                        <span className="bg-muted border border-input rounded-r px-2 py-1.5 text-xs text-muted-foreground flex items-center">일</span>
                                                    </div>
                                                    <div className="mt-1.5 text-[10px] text-indigo-500 font-bold flex items-center gap-1">
                                                        <Zap className="w-3 h-3" /> AI 딥러닝 추천: 최대 {selectedConfig.rec_days}일
                                                    </div>
                                                </div>
                                                <div>
                                                    <label className="text-[10px] text-muted-foreground font-bold mb-1 block text-rose-500">목표 수익률 (Take-Profit)</label>
                                                    <div className="flex">
                                                        <input type="number" value={editForm.tp} onChange={(e) => setEditForm(prev => ({...prev, tp: Number(e.target.value)}))} key={`${activeStrategy}-tp`} className="w-full bg-background border border-input border-r-0 rounded-l px-2 py-1.5 text-sm font-mono text-right text-rose-500 font-bold" />
                                                        <span className="bg-muted border border-input rounded-r px-2 py-1.5 text-xs text-muted-foreground flex items-center">%</span>
                                                    </div>
                                                    <div className="mt-1.5 text-[10px] text-indigo-500 font-bold flex items-center gap-1">
                                                        <Zap className="w-3 h-3" /> AI 딥러닝 추천: 목표가 {selectedConfig.rec_tp}%
                                                    </div>
                                                </div>
                                            </div>
                                        </div>

                                        {/* ── Grid Search 최적 파라미터 패널 ── */}
                                        <div className={cn(
                                            "rounded-xl border p-4 space-y-3 transition-all",
                                            gridSearchResults?.[activeStrategy]
                                                ? "border-indigo-500/20 bg-gradient-to-b from-indigo-500/5 to-transparent"
                                                : "border-border/30 bg-muted/10"
                                        )}>
                                            <div className="flex items-center justify-between">
                                                <div className="text-[11px] font-bold text-muted-foreground flex items-center gap-1.5">
                                                    <span>📊</span>
                                                    <span>모의매매 Grid Search 최적 파라미터</span>
                                                </div>
                                                {gridSearchCachedAt && (
                                                    <span className="text-[10px] text-muted-foreground/60">
                                                        분석일: {new Date(gridSearchCachedAt).toLocaleDateString('ko-KR')}
                                                    </span>
                                                )}
                                            </div>

                                            {isLoadingGridSearch ? (
                                                <div className="flex items-center gap-2 py-2">
                                                    <span className="animate-spin w-3.5 h-3.5 border-2 border-muted-foreground/30 border-t-indigo-500 rounded-full" />
                                                    <span className="text-xs text-muted-foreground">분석 결과 로딩 중...</span>
                                                </div>
                                            ) : gridSearchResults?.[activeStrategy] ? (
                                                <div className="space-y-2">
                                                    {/* 수익 극대 */}
                                                    {(() => {
                                                        const r = gridSearchResults[activeStrategy];
                                                        return (
                                                            <div className="flex items-center gap-2 bg-indigo-500/8 rounded-lg px-3 py-2 border border-indigo-500/15">
                                                                <span className="text-[11px] font-black text-indigo-400 whitespace-nowrap w-16 shrink-0">✨ 수익극대</span>
                                                                <div className="flex-1 text-[11px] text-muted-foreground">
                                                                    목표 <span className="font-bold text-foreground">{r.targetYield}%</span> 익절 후
                                                                    최대 <span className="font-bold text-foreground">{r.targetDays}일</span> 보유
                                                                    <span className="ml-2 text-emerald-500 font-bold">승률 {r.winRate?.toFixed(1)}%</span>
                                                                    <span className="ml-1 text-rose-500 font-bold">평균 +{r.avgReturn?.toFixed(2)}%</span>
                                                                </div>
                                                                <button
                                                                    onClick={() => applyOptimalParams('profit')}
                                                                    className="shrink-0 text-[10px] font-bold px-2.5 py-1 rounded-md bg-indigo-500 hover:bg-indigo-600 text-white transition-colors"
                                                                >
                                                                    적용
                                                                </button>
                                                            </div>
                                                        );
                                                    })()}

                                                    {/* 효율 극대 — 수익극대와 다를 때만 표시 */}
                                                    {(() => {
                                                        const r = gridSearchResults[activeStrategy];
                                                        const eff = r?.bestEfficiencyCombo;
                                                        if (!eff) return null;
                                                        const isSame = eff.targetYield === r.targetYield && eff.targetDays === r.targetDays;
                                                        if (isSame) return null;
                                                        return (
                                                            <div className="flex items-center gap-2 bg-amber-500/8 rounded-lg px-3 py-2 border border-amber-500/15">
                                                                <span className="text-[11px] font-black text-amber-400 whitespace-nowrap w-16 shrink-0">⚡ 효율극대</span>
                                                                <div className="flex-1 text-[11px] text-muted-foreground">
                                                                    목표 <span className="font-bold text-foreground">{eff.targetYield}%</span> 익절 후
                                                                    최대 <span className="font-bold text-foreground">{eff.targetDays}일</span> 보유
                                                                    <span className="ml-2 text-amber-400 font-bold">+{eff.efficiencyScore?.toFixed(2)}%/일</span>
                                                                    <span className="ml-1 text-orange-400 font-bold">연환산 +{Math.round(eff.annualizedReturn ?? 0)}%</span>
                                                                </div>
                                                                <button
                                                                    onClick={() => applyOptimalParams('efficiency')}
                                                                    className="shrink-0 text-[10px] font-bold px-2.5 py-1 rounded-md bg-amber-500 hover:bg-amber-600 text-white transition-colors"
                                                                >
                                                                    적용
                                                                </button>
                                                            </div>
                                                        );
                                                    })()}
                                                </div>
                                            ) : (
                                                <div className="flex items-center gap-2 py-1">
                                                    <span className="text-[11px] text-muted-foreground/70">
                                                        ⚠️ 데이터 없음 — Performance 탭 &gt; <span className="font-bold">AI 최적 파라미터 검색 (Grid Search)</span>을 먼저 실행하세요.
                                                    </span>
                                                </div>
                                            )}
                                        </div>
                                    </>
                                )
                            })()}
                        </div>
                        <div className="p-4 border-t border-border bg-muted/30 flex justify-end gap-2">
                            <button onClick={() => setIsSettingsOpen(false)} className="px-4 py-2 rounded-lg text-sm font-bold text-muted-foreground hover:bg-muted-foreground/10 transition-colors">취소</button>
                            <button onClick={handleSaveStrategy} className="px-4 py-2 rounded-lg text-sm font-bold bg-indigo-500 hover:bg-indigo-600 text-white transition-colors shadow-sm">설정 저장 및 적용</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
