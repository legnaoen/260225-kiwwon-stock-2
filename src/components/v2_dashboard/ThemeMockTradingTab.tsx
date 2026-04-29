import React, { useState } from 'react';
import { Target, TrendingUp, AlertTriangle, Clock, Info, CheckCircle2, BarChart2, Trash2 } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { StockDetailModal } from '../common/StockDetailModal';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

export const ThemeMockTradingTab: React.FC = () => {
    const [mockData, setMockData] = useState<any[]>([]);
    const [selectedStock, setSelectedStock] = useState<{ stockCode: string; stockName: string; aiReason?: string } | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    React.useEffect(() => {
        const loadData = async () => {
            setIsLoading(true);
            try {
                const api = window.electronAPI as any;
                if (api.getThemeMockTradingPicks) {
                    const res = await api.getThemeMockTradingPicks();
                    if (res.success) {
                        // DB에서 가져온 날짜 그룹 데이터를 그대로 세팅
                        setMockData(res.data || []);
                    }
                }
            } catch (e) {
                console.error('모의매매 데이터 로드 실패:', e);
            } finally {
                setIsLoading(false);
            }
        };
        loadData();
    }, []);

    const handleUpdateLivePrices = async () => {
        setIsLoading(true);
        try {
            const api = window.electronAPI as any;
            if (api.updateThemeMockLivePrices) {
                const res = await api.updateThemeMockLivePrices();
                if (res.success) {
                    const reloadRes = await api.getThemeMockTradingPicks();
                    if (reloadRes.success) setMockData(reloadRes.data || []);
                } else {
                    alert(`주가 갱신 실패: ${res.error}`);
                }
            }
        } catch (e) {
            console.error('주가 갱신 중 에러:', e);
        } finally {
            setIsLoading(false);
        }
    };

    const handleDeleteGroup = async (date: string) => {
        if (!confirm(`해당 날짜(${date})의 모의매매 추천 종목을 모두 삭제하시겠습니까?`)) return;
        setIsLoading(true);
        try {
            const api = window.electronAPI as any;
            if (api.deleteThemeMockTradingPicksByDate) {
                const res = await api.deleteThemeMockTradingPicksByDate(date);
                if (res.success) {
                    const reloadRes = await api.getThemeMockTradingPicks();
                    if (reloadRes.success) setMockData(reloadRes.data || []);
                } else {
                    alert(`삭제 실패: ${res.error}`);
                }
            }
        } catch (e: any) {
            alert(`오류 발생: ${e.message}`);
        } finally {
            setIsLoading(false);
        }
    };

    const getMomentumBadge = (status: string) => {
        switch (status) {
            case 'UPTREND': return <span className="flex items-center gap-1 px-1.5 py-0.5 bg-red-500/10 text-red-500 rounded text-[10px] font-bold border border-red-500/20"><TrendingUp size={10} /> 추가상승</span>;
            case 'PEAKOUT': return <span className="flex items-center gap-1 px-1.5 py-0.5 bg-amber-500/10 text-amber-500 rounded text-[10px] font-bold border border-amber-500/20"><AlertTriangle size={10} /> 고점주의</span>;
            case 'REBOUND': return <span className="flex items-center gap-1 px-1.5 py-0.5 bg-emerald-500/10 text-emerald-500 rounded text-[10px] font-bold border border-emerald-500/20"><TrendingUp size={10} /> 반등기대</span>;
            case 'FADING': return <span className="flex items-center gap-1 px-1.5 py-0.5 bg-gray-500/10 text-muted-foreground rounded text-[10px] font-bold border border-border"><Clock size={10} /> 모멘텀둔화</span>;
            default: return null;
        }
    };

    const getStatusBadge = (status: string) => {
        if (status === '보유중') return <span className="px-2 py-1 bg-blue-500/10 text-blue-500 rounded-md text-[11px] font-bold border border-blue-500/20">보유중</span>;
        if (status.includes('청산')) return <span className="px-2 py-1 bg-muted text-muted-foreground rounded-md text-[11px] font-bold border border-border">{status}</span>;
        return <span>{status}</span>;
    };

    // Table Columns Grid Template
    const gridCols = "grid-cols-[40px_1fr_1fr_80px_2fr_80px_80px_60px_60px_70px_80px]";

    // KPI 계산
    const allItems = mockData.flatMap((group: any) => group.items || []);
    const totalPicks = allItems.length;
    const hitPicks = allItems.filter((item: any) => item.status && (item.status.includes('HIT') || item.status.includes('목표달성'))).length;
    const hitRate = totalPicks > 0 ? ((hitPicks / totalPicks) * 100).toFixed(1) : '0.0';
    
    const activeHoldings = allItems.filter((item: any) => !item.status || !(item.status.includes('청산') || item.status.includes('만료'))).length;
    
    // 평균 수익률 및 피크 계산
    const validReturnItems = allItems.filter((item: any) => item.return !== undefined && item.return !== null);
    const avgReturn = validReturnItems.length > 0 ? (validReturnItems.reduce((acc: number, curr: any) => acc + curr.return, 0) / validReturnItems.length).toFixed(1) : '0.0';
    
    const validPeakItems = allItems.filter((item: any) => item.peak !== undefined && item.peak !== null);
    const avgPeak = validPeakItems.length > 0 ? (validPeakItems.reduce((acc: number, curr: any) => acc + curr.peak, 0) / validPeakItems.length).toFixed(1) : '0.0';

    return (
        <div className="w-full h-full bg-background text-foreground p-5 font-sans overflow-y-auto">

            {/* 헤더 영역 */}
            <div className="flex items-center justify-between mb-5">
                <h2 className="text-xl font-bold flex items-center gap-2">
                    <Target size={20} className="text-primary" />
                    테마 모의매매 현황
                </h2>
                <button
                    onClick={handleUpdateLivePrices}
                    disabled={isLoading}
                    className="flex items-center gap-2 px-3 py-1.5 bg-primary/10 text-primary hover:bg-primary/20 rounded-md text-sm font-semibold transition-colors disabled:opacity-50"
                >
                    <TrendingUp size={16} className={isLoading ? 'animate-pulse' : ''} />
                    {isLoading ? '갱신 중...' : '장중 주가 업데이트'}
                </button>
            </div>

            {/* KPI 영역 */}
            <div className="grid grid-cols-4 gap-4 mb-5">
                <div className="bg-card border border-border/60 rounded-xl p-4 flex flex-col justify-between shadow-sm">
                    <span className="text-muted-foreground text-xs font-semibold flex items-center gap-1.5"><Target size={14} /> 총 추천</span>
                    <div className="text-2xl font-bold mt-2">{totalPicks}<span className="text-sm font-normal text-muted-foreground ml-1">건</span></div>
                </div>
                <div className="bg-card border border-border/60 rounded-xl p-4 flex flex-col justify-between shadow-sm">
                    <span className="text-muted-foreground text-xs font-semibold flex items-center gap-1.5"><CheckCircle2 size={14} className="text-emerald-500" /> HIT (목표달성)</span>
                    <div className="text-2xl font-bold text-emerald-500 mt-2">{hitPicks}<span className="text-sm font-normal text-muted-foreground ml-1">건 ({hitRate}%)</span></div>
                </div>
                <div className="bg-card border border-border/60 rounded-xl p-4 flex flex-col justify-between shadow-sm">
                    <span className="text-muted-foreground text-xs font-semibold flex items-center gap-1.5"><TrendingUp size={14} className={Number(avgReturn) >= 0 ? "text-red-500" : "text-blue-500"} /> 평균 수익률 / 피크</span>
                    <div className="text-2xl font-bold mt-2 flex items-baseline gap-2">
                        <span className={Number(avgReturn) >= 0 ? "text-red-500" : "text-blue-500"}>{Number(avgReturn) > 0 ? '+' : ''}{avgReturn}%</span>
                        <span className="text-sm font-normal text-muted-foreground">/ {Number(avgPeak) > 0 ? '+' : ''}{avgPeak}%</span>
                    </div>
                </div>
                <div className="bg-card border border-border/60 rounded-xl p-4 flex flex-col justify-between shadow-sm">
                    <span className="text-muted-foreground text-xs font-semibold flex items-center gap-1.5"><BarChart2 size={14} /> 현재 보유</span>
                    <div className="text-2xl font-bold mt-2 text-blue-400">{activeHoldings}<span className="text-sm font-normal text-muted-foreground ml-1">종목</span></div>
                </div>
            </div>

            {/* 테이블 영역 */}
            <div className="bg-card border border-border/60 rounded-xl overflow-hidden shadow-sm min-w-[900px]">
                {/* Table Header */}
                <div className={cn("grid gap-3 p-3 border-b border-border/60 text-[11px] font-bold text-muted-foreground uppercase tracking-wider bg-muted/20", gridCols)}>
                    <div className="text-center">순위</div>
                    <div>종목명</div>
                    <div>소속 테마</div>
                    <div className="text-center">모멘텀</div>
                    <div>AI 추천 사유</div>
                    <div className="text-right">진입가</div>
                    <div className="text-right">현재/청산</div>
                    <div className="text-center">D-DAY</div>
                    <div className="text-right">피크</div>
                    <div className="text-right">현재수익</div>
                    <div className="text-center">상태</div>
                </div>

                {/* Table Body (Grouped by Date) */}
                <div className="flex flex-col">
                    {mockData.map((group, idx) => (
                        <div key={idx} className="flex flex-col">
                            {/* Group Header (Only Date + Delete Button) */}
                            <div className="px-4 py-2 bg-muted/40 border-b border-border/40 flex items-center justify-between sticky top-0 z-10">
                                <span className="text-xs font-bold text-blue-500 flex items-center gap-1.5"><Clock size={13} /> {group.date}</span>
                                <button 
                                    onClick={() => handleDeleteGroup(group.date)}
                                    className="text-muted-foreground hover:text-red-500 p-1 rounded-md hover:bg-red-500/10 transition-colors"
                                    title={`${group.date} 모의매매 기록 일괄 삭제`}
                                >
                                    <Trash2 size={14} />
                                </button>
                            </div>

                            {/* Group Items */}
                            {group.items.map((item: any, itemIdx: number) => {
                                const statusStr = item.status || '분석대기';
                                const isCleared = statusStr.includes('청산');
                                const dDay = item.dDay !== undefined ? item.dDay : 10;
                                const returnVal = item.return || 0;
                                const peakVal = item.peak || 0;
                                const entryPrice = item.entryPrice || 0;
                                const currentPrice = item.currentPrice || 0;

                                return (
                                    <div 
                                        key={itemIdx} 
                                        onClick={() => setSelectedStock({ stockCode: item.stock_code || item.code, stockName: item.stock_name || item.name, aiReason: item.reason || item.themeReason })}
                                        className={cn("grid gap-3 p-3 items-center border-b border-border/40 hover:bg-muted/30 transition-colors cursor-pointer", gridCols, isCleared && "opacity-50 grayscale")}
                                    >
                                        {/* 순위 */}
                                        <div className="text-center">
                                            <span className={cn("inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold", itemIdx === 0 ? 'bg-red-500/10 text-red-500 border border-red-500/20' : 'bg-muted text-muted-foreground border border-border')}>
                                                {itemIdx + 1}
                                            </span>
                                        </div>

                                        {/* 종목명 */}
                                        <div>
                                            <div className="text-[13px] font-bold text-foreground">{item.stock_name || item.name}</div>
                                            <div className="text-[10px] text-muted-foreground font-mono">{item.stock_code || item.code}</div>
                                        </div>

                                        {/* 소속 테마 */}
                                        <div className="text-[12px] font-semibold text-foreground/80 truncate">
                                            {item.theme}
                                        </div>

                                        {/* 모멘텀 */}
                                        <div className="flex justify-center">
                                            {getMomentumBadge(item.momentum)}
                                        </div>

                                        {/* 추천사유 */}
                                        <div className="text-[12px] text-muted-foreground truncate flex items-center gap-1.5 group cursor-help" title={item.reason}>
                                            <Info size={13} className="text-primary opacity-70 group-hover:opacity-100 transition-opacity shrink-0" />
                                            <span className="truncate group-hover:text-foreground transition-colors">{item.reason}</span>
                                        </div>

                                        {/* 진입가 */}
                                        <div className="text-right text-[12px] text-foreground/80 font-mono">{entryPrice > 0 ? entryPrice.toLocaleString() : '-'}</div>

                                        {/* 현재가 */}
                                        <div className="text-right text-[12px] text-foreground font-mono font-bold">{currentPrice > 0 ? currentPrice.toLocaleString() : '-'}</div>

                                        {/* D-DAY */}
                                        <div className="text-center">
                                            <span className={cn("text-[11px] font-bold", dDay <= 3 && !isCleared ? 'text-amber-500' : 'text-muted-foreground')}>
                                                D-{dDay}
                                            </span>
                                        </div>

                                        {/* 피크 */}
                                        <div className="text-right text-[12px] text-muted-foreground font-mono">+{peakVal.toFixed(1)}%</div>

                                        {/* 현재수익 */}
                                        <div className={cn("text-right text-[13px] font-bold font-mono", returnVal > 0 ? 'text-red-500' : returnVal < 0 ? 'text-blue-500' : 'text-muted-foreground')}>
                                            {returnVal > 0 ? '+' : ''}{returnVal.toFixed(1)}%
                                        </div>

                                        {/* 상태 */}
                                        <div className="text-center">
                                            {getStatusBadge(statusStr)}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    ))}
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
    );
}
