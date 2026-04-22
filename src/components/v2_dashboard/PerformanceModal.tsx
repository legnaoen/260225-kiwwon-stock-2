import React, { useState, useMemo } from 'react';

// @ts-ignore
const CATEGORY_META: Record<string, { icon: string; label: string; color: string }> = {
    TRUE_LEADER:       { icon: '👑', label: '대장주 모멘텀', color: 'text-amber-500 bg-amber-500/10 border-amber-500/30' },
    INTRADAY_SURGE:    { icon: '🔺', label: '당일 급등주', color: 'text-orange-500 bg-orange-500/10 border-orange-500/30' },
    EMERGING_STAR:     { icon: '🔥', label: '신흥 급부상', color: 'text-red-500 bg-red-500/10 border-red-500/30' },
    PULLBACK_REBOUND:  { icon: '🎣', label: '눌림 반등', color: 'text-rose-500 bg-rose-500/10 border-rose-500/30' },
    PULLBACK_DIP:      { icon: '📉', label: '눌림목', color: 'text-purple-500 bg-purple-500/10 border-purple-500/30' },
    SHORT_TERM_CONSOLIDATION: { icon: '🎯', label: '단기 눌림', color: 'text-green-500 bg-green-500/10 border-green-500/30' }
};

interface SimTradePick {
    id: number
    pick_date: string
    category: string
    entry_price: number
    exit_price: number | null
    current_price: number | null
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

interface PerformanceModalProps {
    isOpen: boolean;
    onClose: () => void;
    picks: any[];
}

export function PerformanceModal({ isOpen, onClose, picks }: PerformanceModalProps) {
    const [targetReturn, setTargetReturn] = useState<number>(20);
    const [useFavorableCloseOption, setUseFavorableCloseOption] = useState<boolean>(true);
    const [startDate, setStartDate] = useState<string>('');
    const [endDate, setEndDate] = useState<string>('');

    const [isOptimizing, setIsOptimizing] = useState(false);
    const [optimizedResults, setOptimizedResults] = useState<Record<string, any> | null>(null);

    const handleOptimize = async () => {
        setIsOptimizing(true);
        try {
            const validPicks = picks.filter(p => (p.status === 'ACTIVE' || p.status === 'CLOSED') && p.entry_date && p.stock_code);
            let filteredPicks = validPicks;
            if (startDate) filteredPicks = filteredPicks.filter(p => p.pick_date >= startDate);
            if (endDate) filteredPicks = filteredPicks.filter(p => p.pick_date <= endDate);
            
            const res = await (window as any).electronAPI.runPerformanceOptimizer(filteredPicks);
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
    }

    // 필터링 및 로직 처리
    const stats = useMemo(() => {
        let validPicks = picks.filter(p => p.status === 'ACTIVE' || p.status === 'CLOSED');
        
        if (startDate) validPicks = validPicks.filter(p => p.pick_date >= startDate);
        if (endDate) validPicks = validPicks.filter(p => p.pick_date <= endDate);

        let totalPicks = validPicks.length;
        let hits = 0;
        let sumPeak = 0;
        let sumClose = 0;
        let totalPeakDays = 0;
        let picksWithPeakDate = 0;

        const categoryStats: Record<string, any> = {};

        validPicks.forEach(p => {
            const currentRet = p.status === 'CLOSED' ? (p.final_return ?? 0) : 
                ((p.current_price! - p.entry_price) / p.entry_price * 100);
            const peakRet = p.peak_return ?? currentRet;
            
            // 승리 판정: 피크가 목표 터치했거나, 종가가 3% 이상일 때
            const isHit = peakRet >= targetReturn || currentRet >= 3.0;
            if (isHit) hits++;

            // 우대 옵션
            let finalCalculatedClose = currentRet;
            if (useFavorableCloseOption && peakRet >= targetReturn) {
                finalCalculatedClose = targetReturn;
            }

            sumPeak += peakRet;
            sumClose += finalCalculatedClose;

            // 도달 소요일
            if (p.peak_date && p.entry_date) {
                const eDate = new Date(p.entry_date);
                const pDate = new Date(p.peak_date);
                const diffTime = Math.abs(pDate.getTime() - eDate.getTime());
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                totalPeakDays += diffDays;
                picksWithPeakDate++;
            }

            // 카테고리별 집계
            if (!categoryStats[p.category]) {
                categoryStats[p.category] = { count: 0, hits: 0, sumPeak: 0, sumClose: 0, sumPeakDays: 0, peakDateCount: 0 };
            }
            categoryStats[p.category].count++;
            if (isHit) categoryStats[p.category].hits++;
            categoryStats[p.category].sumPeak += peakRet;
            categoryStats[p.category].sumClose += finalCalculatedClose;
            if (p.peak_date && p.entry_date) {
                const diffDays = Math.ceil(Math.abs(new Date(p.peak_date).getTime() - new Date(p.entry_date).getTime()) / (1000 * 60 * 60 * 24));
                categoryStats[p.category].sumPeakDays += diffDays;
                categoryStats[p.category].peakDateCount++;
            }
        });

        const winRate = totalPicks > 0 ? (hits / totalPicks) * 100 : 0;
        const avgPeak = totalPicks > 0 ? (sumPeak / totalPicks) : 0;
        const avgClose = totalPicks > 0 ? (sumClose / totalPicks) : 0;
        const avgPeakDays = picksWithPeakDate > 0 ? (totalPeakDays / picksWithPeakDate) : 0;

        // 시장 대비 지수는 벤치마크 데이터를 완벽하게 구할 수 없어 임시로 0.0% 설정 (향후 DB 연동 시 교체)
        const dummyMarketReturn = 0.0;
        const alpha = avgClose - dummyMarketReturn;

        const catArray = Object.keys(categoryStats).map(cat => {
            const s = categoryStats[cat];
            return {
                category: cat,
                count: s.count,
                winRate: s.count > 0 ? (s.hits / s.count) * 100 : 0,
                avgPeak: s.count > 0 ? (s.sumPeak / s.count) : 0,
                avgClose: s.count > 0 ? (s.sumClose / s.count) : 0,
                avgPeakDays: s.peakDateCount > 0 ? (s.sumPeakDays / s.peakDateCount) : 0
            };
        });

        // 카테고리 정렬
        const catOrder: Record<string, number> = {
            'TRUE_LEADER': 1,
            'INTRADAY_SURGE': 2,
            'EMERGING_STAR': 3,
            'PULLBACK_REBOUND': 4,
            'PULLBACK_DIP': 5,
            'SHORT_TERM_CONSOLIDATION': 6
        };
        catArray.sort((a, b) => (catOrder[a.category] || 99) - (catOrder[b.category] || 99));

        return {
            totalPicks,
            winRate,
            avgPeak,
            avgClose,
            avgPeakDays,
            alpha,
            catArray
        };

    }, [picks, targetReturn, useFavorableCloseOption, startDate, endDate]);

    // Cleanup optimize results when filter changes
    React.useEffect(() => {
        setOptimizedResults(null);
    }, [picks, startDate, endDate]);

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
                            <input 
                                type="checkbox" 
                                id="favorableClose"
                                checked={useFavorableCloseOption}
                                onChange={(e) => setUseFavorableCloseOption(e.target.checked)}
                                className="rounded"
                            />
                            <label htmlFor="favorableClose" className="text-xs text-muted-foreground cursor-pointer leading-tight">
                                고점이 목표치 터치 시 <br/>해당 종목 종가 수익률 = 목표치(%) 로 고정 반영
                            </label>
                        </div>
                    </div>

                    {/* 종합 요약 */}
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                        <div className="flex flex-col items-center justify-center bg-card border border-border rounded-lg p-4 shadow-sm">
                            <span className="text-xs font-semibold text-muted-foreground mb-1">통합 승률</span>
                            <span className="text-2xl font-black text-emerald-500">{stats.winRate.toFixed(1)}%</span>
                            <span className="text-[10px] text-muted-foreground mt-1">총 {stats.totalPicks}건</span>
                        </div>
                        <div className="flex flex-col items-center justify-center bg-card border border-border rounded-lg p-4 shadow-sm">
                            <span className="text-xs font-semibold text-muted-foreground mb-1">평균 고점 수익률</span>
                            <span className="text-xl font-bold text-red-500">+{stats.avgPeak.toFixed(2)}%</span>
                        </div>
                        <div className="flex flex-col items-center justify-center bg-card border border-border rounded-lg p-4 shadow-sm">
                            <span className="text-xs font-semibold text-muted-foreground mb-1">평균 종가 수익률</span>
                            <span className={`text-xl font-bold ${stats.avgClose > 0 ? 'text-red-500' : 'text-blue-500'}`}>
                                {stats.avgClose > 0 ? '+' : ''}{stats.avgClose.toFixed(2)}%
                            </span>
                        </div>
                        <div className="flex flex-col items-center justify-center bg-card border border-border rounded-lg p-4 shadow-sm">
                            <span className="text-xs font-semibold text-muted-foreground mb-1">평균 고점 도달일</span>
                            <span className="text-xl font-bold">D+{Math.round(stats.avgPeakDays)}일</span>
                        </div>
                        <div className="flex flex-col items-center justify-center bg-card border border-border rounded-lg p-4 shadow-sm">
                            <span className="text-xs font-semibold text-muted-foreground mb-1">초과 수익률(Alpha)</span>
                            <span className={`text-xl font-bold ${stats.alpha > 0 ? 'text-emerald-500' : 'text-blue-500'}`}>
                                {stats.alpha > 0 ? '+' : ''}{stats.alpha.toFixed(2)}%p
                            </span>
                            <span className="text-[10px] text-muted-foreground mt-1">vs 시장(임시지수)</span>
                        </div>
                    </div>

                    {/* 카테고리별 테이블 상단 제목 & 버튼 영역 */}
                    <div className="flex items-center justify-between mb-3">
                        <h3 className="text-sm font-semibold">📋 전술(Track)별 성과 비교 보드</h3>
                        <button
                            onClick={handleOptimize}
                            disabled={isOptimizing}
                            className="text-xs font-bold bg-indigo-500 hover:bg-indigo-600 text-white px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 disabled:opacity-50"
                        >
                            {isOptimizing ? (
                                <>
                                    <span className="animate-spin w-3 h-3 border-2 border-white/30 border-t-white rounded-full"></span>
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
                                        <th className="px-4 py-3 text-right">고점 소요일</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {stats.catArray.map((row, i) => {
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
                                                    <td className="px-4 py-3 text-right text-muted-foreground">D+{row.avgPeakDays.toFixed(1)}일</td>
                                                </tr>
                                                {optResult && (
                                                    <tr className="bg-indigo-500/5 border-b border-border/50">
                                                        <td colSpan={6} className="px-4 py-2">
                                                            <div className="flex flex-wrap items-center gap-3 text-xs">
                                                                <span className="font-bold text-indigo-400">✨ AI 딥러닝 최적화 추천:</span>
                                                                <span className="text-muted-foreground">
                                                                    목표가 <span className="font-bold text-foreground">{optResult.targetYield}%</span> 익절선 세팅 후 
                                                                    최대 <span className="font-bold text-foreground">{optResult.targetDays}일</span>간 보유 시 수익 가장 극대화!
                                                                </span>
                                                                <span className="ml-auto flex items-center gap-2">
                                                                    <span className="text-muted-foreground border-r border-border/50 pr-2">예상 평균수익: <span className="font-bold text-red-500">+{optResult.avgReturn.toFixed(2)}%</span></span>
                                                                    <span className="text-muted-foreground">예상 승률: <span className="font-bold text-emerald-500">{optResult.winRate.toFixed(1)}%</span></span>
                                                                </span>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                )}
                                            </React.Fragment>
                                        );
                                    })}
                                    {stats.catArray.length === 0 && (
                                        <tr>
                                            <td colSpan={6} className="text-center py-8 text-muted-foreground">결과 데이터가 없습니다.</td>
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
