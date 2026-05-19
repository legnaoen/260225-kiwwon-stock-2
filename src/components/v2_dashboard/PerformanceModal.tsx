import React, { useState, useEffect, useCallback, useRef } from 'react';

// @ts-ignore
const CATEGORY_META: Record<string, { icon: string; label: string; color: string }> = {
    TRUE_LEADER:       { icon: '👑', label: '대장주 모멘텀', color: 'text-amber-500 bg-amber-500/10 border-amber-500/30' },
    INTRADAY_SURGE:    { icon: '🔺', label: '당일 급등주', color: 'text-orange-500 bg-orange-500/10 border-orange-500/30' },
    EMERGING_STAR:     { icon: '🔥', label: '신흥 급부상', color: 'text-red-500 bg-red-500/10 border-red-500/30' },
    PULLBACK_REBOUND:  { icon: '🎣', label: '눌림 반등', color: 'text-rose-500 bg-rose-500/10 border-rose-500/30' },
    PULLBACK_DIP:      { icon: '📉', label: '눌림목', color: 'text-purple-500 bg-purple-500/10 border-purple-500/30' },
    SHORT_TERM_CONSOLIDATION: { icon: '🎯', label: '단기 눌림', color: 'text-green-500 bg-green-500/10 border-green-500/30' }
};

const CATEGORY_ORDER: Record<string, number> = {
    'TRUE_LEADER': 1,
    'INTRADAY_SURGE': 2,
    'EMERGING_STAR': 3,
    'PULLBACK_REBOUND': 4,
    'PULLBACK_DIP': 5,
    'SHORT_TERM_CONSOLIDATION': 6
};

interface PerformanceModalProps {
    isOpen: boolean;
    onClose: () => void;
    picks: any[];
}

interface OverallStats {
    totalPicks: number;
    winRate: number;
    avgPeak: number;
    avgClose: number;
    avgPeakDays: number;
    avgTargetHitDays: number;
    targetHitRate: number;
    alpha: number;
}

interface CategoryStats {
    count: number;
    winRate: number;
    avgPeak: number;
    avgClose: number;
    avgPeakDays: number;
    avgTargetHitDays: number;
}

export function PerformanceModal({ isOpen, onClose, picks }: PerformanceModalProps) {
    const [targetReturn, setTargetReturn] = useState<number>(20);
    const [startDate, setStartDate] = useState<string>('');
    const [endDate, setEndDate] = useState<string>('');

    const [isLoading, setIsLoading] = useState(false);
    const [overall, setOverall] = useState<OverallStats | null>(null);
    const [byCategory, setByCategory] = useState<Record<string, CategoryStats>>({});

    const [isOptimizing, setIsOptimizing] = useState(false);
    const [optimizedResults, setOptimizedResults] = useState<Record<string, any> | null>(null);
    const [userHoldDays, setUserHoldDays] = useState<number | ''>('');

    const debounceRef = useRef<NodeJS.Timeout | null>(null);

    // 날짜 필터 적용
    const filteredPicks = React.useMemo(() => {
        let result = picks.filter(p => p.status === 'ACTIVE' || p.status === 'CLOSED');
        if (startDate) result = result.filter(p => p.pick_date >= startDate);
        if (endDate) result = result.filter(p => p.pick_date <= endDate);
        return result;
    }, [picks, startDate, endDate]);

    // OHLCV 기반 성과 통계 계산 (백엔드 호출)
    const fetchStats = useCallback(async (currentPicks: any[], target: number) => {
        if (currentPicks.length === 0) {
            setOverall(null);
            setByCategory({});
            return;
        }
        setIsLoading(true);
        try {
            const result = await (window as any).electronAPI.getPerformanceStats(currentPicks, target);
            if (result?.overall) {
                setOverall(result.overall);
                setByCategory(result.byCategory || {});
            }
        } catch (e) {
            console.error('[PerformanceModal] fetchStats error:', e);
        } finally {
            setIsLoading(false);
        }
    }, []);

    // targetReturn 변경 시 debounce(400ms) 후 재계산
    useEffect(() => {
        if (!isOpen) return;
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
            fetchStats(filteredPicks, targetReturn);
        }, 400);
        return () => {
            if (debounceRef.current) clearTimeout(debounceRef.current);
        };
    }, [filteredPicks, targetReturn, isOpen, fetchStats]);

    // 최적화 (Grid Search)
    const handleOptimize = async () => {
        setIsOptimizing(true);
        try {
            const validPicks = filteredPicks.filter(p => p.entry_date && p.stock_code);
            const userDaysArg = typeof userHoldDays === 'number' && userHoldDays > 0 ? userHoldDays : undefined;
            const res = await (window as any).electronAPI.runPerformanceOptimizer(validPicks, userDaysArg);
            if (res && res.success) {
                setOptimizedResults(res.optimized);
            } else {
                alert(`최적화 실패: ${res?.error || '알 수 없는 오류'}`);
            }
        } catch (e) {
            console.error(e);
            alert('최적화 중 오류가 발생했습니다.');
        } finally {
            setIsOptimizing(false);
        }
    };

    // 카테고리 배열 정렬
    const catArray = Object.entries(byCategory)
        .map(([cat, s]) => ({ category: cat, ...s }))
        .sort((a, b) => (CATEGORY_ORDER[a.category] || 99) - (CATEGORY_ORDER[b.category] || 99));

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex flex-col pt-10 pb-10 sm:pt-20 sm:pb-20 justify-center items-center">
            {/* Backdrop */}
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

            <div className="relative w-full max-w-5xl max-h-full overflow-hidden bg-background border border-border shadow-2xl rounded-xl flex flex-col">
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-border/50 bg-muted/30">
                    <h2 className="text-lg font-bold">📉 실전 매매 검증 시뮬레이션 (Performance)</h2>
                    <button onClick={onClose} className="p-1 hover:bg-muted rounded transition-colors">&times;</button>
                </div>

                {/* Content */}
                <div className="p-6 overflow-y-auto flex-1 flex flex-col gap-6">
                    {/* 설정 영역 */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 bg-muted/10 p-4 border border-border/50 rounded-lg">
                        <div className="flex flex-col gap-1.5">
                            <label className="text-xs font-semibold text-muted-foreground">목표 수익률 (%)</label>
                            <input
                                type="number"
                                value={targetReturn}
                                onChange={(e) => setTargetReturn(Number(e.target.value))}
                                className="w-full bg-background border border-input rounded px-3 py-1.5 text-sm"
                            />
                        </div>
                        <div className="flex flex-col gap-1.5">
                            <label className="text-xs font-semibold text-muted-foreground">기간 설정</label>
                            <div className="flex items-center gap-2">
                                <input
                                    type="date"
                                    value={startDate}
                                    onChange={(e) => setStartDate(e.target.value)}
                                    className="w-full bg-background border border-input rounded px-2 py-1.5 text-xs text-muted-foreground"
                                />
                                <span className="text-muted-foreground">~</span>
                                <input
                                    type="date"
                                    value={endDate}
                                    onChange={(e) => setEndDate(e.target.value)}
                                    className="w-full bg-background border border-input rounded px-2 py-1.5 text-xs text-muted-foreground"
                                />
                            </div>
                        </div>
                        <div className="flex items-center gap-2 pt-4">
                            <div className="text-xs text-muted-foreground leading-tight bg-muted/20 rounded px-2 py-1.5 border border-border/30">
                                📡 OHLCV 실데이터 기반 계산<br/>
                                <span className="text-emerald-500 font-semibold">매수 당일 제외, 익일 캔들부터 스캔</span>
                            </div>
                        </div>
                    </div>

                    {/* 종합 요약 */}
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                        {/* 통합 승률 */}
                        <div className="flex flex-col items-center justify-center bg-card border border-border rounded-lg p-4 shadow-sm">
                            <span className="text-xs font-semibold text-muted-foreground mb-1">통합 승률</span>
                            {isLoading ? <LoadingDot /> : (
                                <>
                                    <span className="text-2xl font-black text-emerald-500">{overall ? overall.winRate.toFixed(1) : '-'}%</span>
                                    <span className="text-[10px] text-muted-foreground mt-1">총 {overall?.totalPicks ?? filteredPicks.length}건</span>
                                </>
                            )}
                        </div>
                        {/* 평균 고점 수익률 */}
                        <div className="flex flex-col items-center justify-center bg-card border border-border rounded-lg p-4 shadow-sm">
                            <span className="text-xs font-semibold text-muted-foreground mb-1">평균 고점 수익률</span>
                            {isLoading ? <LoadingDot /> : (
                                <span className="text-xl font-bold text-red-500">+{overall ? overall.avgPeak.toFixed(2) : '-'}%</span>
                            )}
                        </div>
                        {/* 평균 종가 수익률 */}
                        <div className="flex flex-col items-center justify-center bg-card border border-border rounded-lg p-4 shadow-sm">
                            <span className="text-xs font-semibold text-muted-foreground mb-1">평균 종가 수익률</span>
                            {isLoading ? <LoadingDot /> : (
                                <span className={`text-xl font-bold ${(overall?.avgClose ?? 0) > 0 ? 'text-red-500' : 'text-blue-500'}`}>
                                    {overall ? `${overall.avgClose > 0 ? '+' : ''}${overall.avgClose.toFixed(2)}%` : '-'}
                                </span>
                            )}
                        </div>
                        {/* 평균 고점 도달일 */}
                        <div className="flex flex-col items-center justify-center bg-card border border-border rounded-lg p-4 shadow-sm">
                            <span className="text-xs font-semibold text-muted-foreground mb-1">평균 고점 도달일</span>
                            {isLoading ? <LoadingDot /> : (
                                <span className="text-xl font-bold">
                                    {overall && overall.avgPeakDays > 0 ? `D+${Math.round(overall.avgPeakDays)}일` : '-'}
                                </span>
                            )}
                        </div>
                        {/* 평균 목표 도달일 */}
                        <div className="flex flex-col items-center justify-center bg-card border border-border rounded-lg p-4 shadow-sm">
                            <span className="text-xs font-semibold text-muted-foreground mb-1">평균 목표 도달일</span>
                            {isLoading ? <LoadingDot /> : (
                                <span className="text-xl font-bold">
                                    {overall && overall.avgTargetHitDays > 0 ? `D+${Math.round(overall.avgTargetHitDays)}일` : '-'}
                                </span>
                            )}
                            {!isLoading && overall && (
                                <span className="text-[10px] text-muted-foreground mt-0.5">
                                    달성률 {overall.targetHitRate.toFixed(0)}%
                                </span>
                            )}
                        </div>
                        {/* 초과 수익률(Alpha) */}
                        <div className="flex flex-col items-center justify-center bg-card border border-border rounded-lg p-4 shadow-sm">
                            <span className="text-xs font-semibold text-muted-foreground mb-1">초과 수익률(Alpha)</span>
                            {isLoading ? <LoadingDot /> : (
                                <span className={`text-xl font-bold ${(overall?.alpha ?? 0) > 0 ? 'text-emerald-500' : 'text-blue-500'}`}>
                                    {overall ? `${overall.alpha > 0 ? '+' : ''}${overall.alpha.toFixed(2)}%p` : '-'}
                                </span>
                            )}
                            <span className="text-[10px] text-muted-foreground mt-1">vs 시장(임시지수)</span>
                        </div>
                    </div>

                    {/* 카테고리별 테이블 */}
                    <div className="flex flex-col md:flex-row items-start md:items-center justify-between mb-3 gap-2">
                        <h3 className="text-sm font-semibold">📋 전술(Track)별 성과 비교 보드</h3>
                        <div className="flex items-center gap-2">
                            <div className="flex items-center gap-1.5 bg-muted/20 border border-border/50 rounded-lg px-2 py-1">
                                <span className="text-xs text-muted-foreground whitespace-nowrap">보유일 지정(선택)</span>
                                <input
                                    type="number"
                                    min="1"
                                    max="30"
                                    value={userHoldDays}
                                    onChange={(e) => setUserHoldDays(e.target.value ? Number(e.target.value) : '')}
                                    className="w-12 bg-background border border-input rounded px-1.5 py-0.5 text-xs text-center"
                                    placeholder="N일"
                                />
                            </div>
                            <button
                                onClick={handleOptimize}
                                disabled={isOptimizing}
                                className="text-xs font-bold bg-indigo-500 hover:bg-indigo-600 text-white px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 disabled:opacity-50"
                            >
                                {isOptimizing ? (
                                    <>
                                        <span className="animate-spin w-3 h-3 border-2 border-white/30 border-t-white rounded-full" />
                                        <span>시나리오 연산 중...</span>
                                    </>
                                ) : (
                                    <>
                                        <span>🪄</span>
                                        <span>AI 최적 파라미터 검색 (Grid Search)</span>
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                    <div>
                        <div className="overflow-x-auto border border-border rounded-lg">
                            <table className="w-full text-sm text-left">
                                <thead className="bg-muted/50 text-xs uppercase text-muted-foreground border-b border-border">
                                    <tr>
                                        <th className="px-4 py-3">분류 (카테고리)</th>
                                        <th className="px-4 py-3 text-right">추천 건수</th>
                                        <th className="px-4 py-3 text-right">승률</th>
                                        <th className="px-4 py-3 text-right">평균 고점</th>
                                        <th className="px-4 py-3 text-right">평균 종가</th>
                                        <th className="px-4 py-3 text-right">목표 도달일</th>
                                        <th className="px-4 py-3 text-right">고점 소요일</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {isLoading ? (
                                        <tr>
                                            <td colSpan={7} className="text-center py-8 text-muted-foreground">
                                                <div className="flex items-center justify-center gap-2">
                                                    <span className="animate-spin w-4 h-4 border-2 border-muted-foreground/30 border-t-muted-foreground rounded-full" />
                                                    <span className="text-sm">OHLCV 캔들 데이터 분석 중...</span>
                                                </div>
                                            </td>
                                        </tr>
                                    ) : catArray.length > 0 ? catArray.map((row, i) => {
                                        const meta = CATEGORY_META[row.category] || { icon: '❓', label: row.category, color: '' };
                                        const optResult = optimizedResults ? optimizedResults[row.category] : null;

                                        return (
                                            <React.Fragment key={i}>
                                                <tr className="border-b border-border/50 hover:bg-muted/10">
                                                    <td className="px-4 py-3 font-medium">
                                                        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium border ${meta.color}`}>
                                                            {meta.icon} {meta.label}
                                                        </span>
                                                    </td>
                                                    <td className="px-4 py-3 text-right text-muted-foreground">{row.count}건</td>
                                                    <td className="px-4 py-3 text-right font-bold text-emerald-500">{row.winRate.toFixed(1)}%</td>
                                                    <td className="px-4 py-3 text-right font-semibold text-red-500">{row.avgPeak > 0 ? '+' : ''}{row.avgPeak.toFixed(2)}%</td>
                                                    <td className="px-4 py-3 text-right font-semibold">{row.avgClose > 0 ? '+' : ''}{row.avgClose.toFixed(2)}%</td>
                                                    <td className="px-4 py-3 text-right font-bold text-amber-500">
                                                        {row.avgTargetHitDays > 0 ? `D+${row.avgTargetHitDays.toFixed(1)}일` : '-'}
                                                    </td>
                                                    <td className="px-4 py-3 text-right text-muted-foreground">
                                                        {row.avgPeakDays > 0 ? `D+${row.avgPeakDays.toFixed(1)}일` : '-'}
                                                    </td>
                                                </tr>
                                                {optResult && (
                                                    <>
                                                        {/* ✨ 수익 극대 추천 행 */}
                                                        <tr className="bg-indigo-500/5 border-b border-border/30">
                                                            <td colSpan={7} className="px-4 py-2">
                                                                <div className="flex flex-wrap items-center gap-2 text-xs">
                                                                    <span className="font-bold text-indigo-400 whitespace-nowrap">✨ 수익극대</span>
                                                                    <span className="text-muted-foreground">
                                                                        목표가 <span className="font-bold text-foreground">{optResult.targetYield}%</span> 익절 후 최대{' '}
                                                                        <span className="font-bold text-foreground">{optResult.targetDays}일</span> 보유 시 개별 수익 최대
                                                                    </span>
                                                                    <span className="ml-auto flex items-center gap-2">
                                                                        <span className="text-muted-foreground border-r border-border/50 pr-2">
                                                                            평균수익: <span className={`font-bold ${optResult.avgReturn >= 0 ? 'text-red-500' : 'text-blue-500'}`}>{optResult.avgReturn > 0 ? '+' : ''}{optResult.avgReturn.toFixed(2)}%</span>
                                                                        </span>
                                                                        <span className="text-muted-foreground">
                                                                            승률: <span className="font-bold text-emerald-500">{optResult.winRate.toFixed(1)}%</span>
                                                                        </span>
                                                                    </span>
                                                                </div>
                                                            </td>
                                                        </tr>

                                                        {/* ⚡ 자본효율 극대 추천 행 */}
                                                        {optResult.bestEfficiencyCombo && (() => {
                                                            const eff = optResult.bestEfficiencyCombo;
                                                            return (
                                                                <tr className="bg-amber-500/5 border-b border-border/50">
                                                                    <td colSpan={7} className="px-4 py-2">
                                                                        <div className="flex flex-wrap items-center gap-2 text-xs">
                                                                            <span className="font-bold text-amber-400 whitespace-nowrap">⚡ 효율극대</span>
                                                                            <span className="text-muted-foreground">
                                                                                목표가 <span className="font-bold text-foreground">{eff.targetYield}%</span> 익절 후 최대{' '}
                                                                                <span className="font-bold text-foreground">{eff.targetDays}일</span> 보유 →{' '}
                                                                                자본 회전율 고려 시 포폴 수익 최대
                                                                            </span>
                                                                            <span className="ml-auto flex items-center gap-3">
                                                                                <span className="text-muted-foreground border-r border-border/50 pr-2">
                                                                                    평균수익: <span className={`font-bold ${eff.avgReturn >= 0 ? 'text-red-400' : 'text-blue-500'}`}>{eff.avgReturn > 0 ? '+' : ''}{eff.avgReturn.toFixed(2)}%</span>
                                                                                </span>
                                                                                <span className="text-muted-foreground border-r border-border/50 pr-2">
                                                                                    효율: <span className={`font-bold ${eff.efficiencyScore >= 0 ? 'text-amber-400' : 'text-blue-500'}`}>{eff.efficiencyScore > 0 ? '+' : ''}{eff.efficiencyScore.toFixed(2)}%/일</span>
                                                                                </span>
                                                                                <span className="text-muted-foreground border-r border-border/50 pr-2">
                                                                                    연환산: <span className={`font-bold ${eff.annualizedReturn >= 0 ? 'text-orange-400' : 'text-blue-500'}`}>{eff.annualizedReturn > 0 ? '+' : ''}{Math.round(eff.annualizedReturn)}%</span>
                                                                                </span>
                                                                                <span className="text-muted-foreground">
                                                                                    종목당 <span className="font-bold text-foreground">{eff.capitalPerPos.toFixed(0)}%</span> 배분
                                                                                </span>
                                                                            </span>
                                                                        </div>
                                                                    </td>
                                                                </tr>
                                                            );
                                                        })()}
                                                        
                                                        {/* 🎯 지정 보유일 최적 추천 행 */}
                                                        {optResult.bestUserDayCombo && (() => {
                                                            const uCombo = optResult.bestUserDayCombo;
                                                            return (
                                                                <tr className="bg-emerald-500/5 border-b border-border/50">
                                                                    <td colSpan={7} className="px-4 py-2">
                                                                        <div className="flex flex-wrap items-center gap-2 text-xs">
                                                                            <span className="font-bold text-emerald-500 whitespace-nowrap">🎯 지정일({uCombo.targetDays}일) 최적</span>
                                                                            <span className="text-muted-foreground">
                                                                                지정한 <span className="font-bold text-foreground">{uCombo.targetDays}일</span> 보유 조건 하에서,{' '}
                                                                                목표가를 <span className="font-bold text-foreground">{uCombo.targetYield}%</span> 로 설정 시 수익 최대
                                                                            </span>
                                                                            <span className="ml-auto flex items-center gap-3">
                                                                                <span className="text-muted-foreground border-r border-border/50 pr-2">
                                                                                    평균수익: <span className={`font-bold ${uCombo.avgReturn >= 0 ? 'text-red-500' : 'text-blue-500'}`}>{uCombo.avgReturn > 0 ? '+' : ''}{uCombo.avgReturn.toFixed(2)}%</span>
                                                                                </span>
                                                                                <span className="text-muted-foreground border-r border-border/50 pr-2">
                                                                                    연환산: <span className={`font-bold ${((uCombo.avgReturn / uCombo.targetDays) * 252) >= 0 ? 'text-orange-400' : 'text-blue-500'}`}>{((uCombo.avgReturn / uCombo.targetDays) * 252) > 0 ? '+' : ''}{Math.round((uCombo.avgReturn / uCombo.targetDays) * 252)}%</span>
                                                                                </span>
                                                                                <span className="text-muted-foreground">
                                                                                    승률: <span className="font-bold text-emerald-500">{uCombo.winRate.toFixed(1)}%</span>
                                                                                </span>
                                                                            </span>
                                                                        </div>
                                                                    </td>
                                                                </tr>
                                                            );
                                                        })()}
                                                    </>
                                                )}
                                            </React.Fragment>
                                        );
                                    }) : (
                                        <tr>
                                            <td colSpan={7} className="text-center py-8 text-muted-foreground">결과 데이터가 없습니다.</td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

function LoadingDot() {
    return <span className="animate-spin w-5 h-5 border-2 border-muted-foreground/20 border-t-muted-foreground rounded-full my-1" />;
}
