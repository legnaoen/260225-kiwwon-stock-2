import React, { useState } from 'react';
import { Target, TrendingUp, AlertTriangle, Clock, Info, CheckCircle2, BarChart2 } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

export const ThemeMockTradingTab: React.FC = () => {
    // 예제 데이터 (수정됨: 날짜 그룹 내에 여러 테마의 종목이 섞임)
    const mockData = [
        {
            date: '2026-04-27 (오늘)',
            items: [
                { rank: 1, name: '일진전기', code: '103590', theme: '전선, 전력설비', momentum: 'UPTREND', reason: 'AI 데이터센터 전력망 부족 지속', entryPrice: 109400, currentPrice: 115000, peak: 18.5, return: 5.1, dDay: 10, status: '보유중' },
                { rank: 2, name: '씨엔지하이테크', code: '264660', theme: '반도체 유리기판', momentum: 'PEAKOUT', reason: '단기 급등에 따른 차익실현 출회', entryPrice: 24650, currentPrice: 24800, peak: 4.5, return: 0.6, dDay: 10, status: '보유중' },
                { rank: 3, name: '가온전선', code: '000500', theme: '전선, 전력설비', momentum: 'UPTREND', reason: '키맞추기 후발 상승 기대', entryPrice: 42100, currentPrice: 41800, peak: 2.1, return: -0.7, dDay: 10, status: '보유중' },
            ]
        },
        {
            date: '2026-04-26 (어제)',
            items: [
                { rank: 1, name: '태성', code: '323280', theme: '반도체 유리기판', momentum: 'PEAKOUT', reason: '유리기판 대장주 단기 과열', entryPrice: 89500, currentPrice: 87000, peak: 1.0, return: -2.8, dDay: 9, status: '보유중' },
                { rank: 2, name: '에코프로', code: '086520', theme: '2차전지', momentum: 'REBOUND', reason: '낙폭 과대에 따른 기술적 반등', entryPrice: 120000, currentPrice: 125000, peak: 6.0, return: 4.1, dDay: 9, status: '보유중' },
            ]
        },
        {
            date: '2026-04-15',
            items: [
                { rank: 1, name: '특수건설', code: '026150', theme: '해저터널', momentum: 'FADING', reason: '관련 정책 지연 및 거래대금 급감', entryPrice: 8200, currentPrice: 7500, peak: 8.0, return: -8.5, dDay: 0, status: '청산(만기)' },
            ]
        }
    ];

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

    return (
        <div className="w-full h-full bg-background text-foreground p-5 font-sans overflow-y-auto">

            {/* KPI 영역 */}
            <div className="grid grid-cols-4 gap-4 mb-5">
                <div className="bg-card border border-border/60 rounded-xl p-4 flex flex-col justify-between shadow-sm">
                    <span className="text-muted-foreground text-xs font-semibold flex items-center gap-1.5"><Target size={14} /> 총 추천</span>
                    <div className="text-2xl font-bold mt-2">25<span className="text-sm font-normal text-muted-foreground ml-1">건</span></div>
                </div>
                <div className="bg-card border border-border/60 rounded-xl p-4 flex flex-col justify-between shadow-sm">
                    <span className="text-muted-foreground text-xs font-semibold flex items-center gap-1.5"><CheckCircle2 size={14} className="text-emerald-500" /> HIT (목표달성)</span>
                    <div className="text-2xl font-bold text-emerald-500 mt-2">12<span className="text-sm font-normal text-muted-foreground ml-1">건 (48.0%)</span></div>
                </div>
                <div className="bg-card border border-border/60 rounded-xl p-4 flex flex-col justify-between shadow-sm">
                    <span className="text-muted-foreground text-xs font-semibold flex items-center gap-1.5"><TrendingUp size={14} className="text-red-500" /> 평균 수익률 / 피크</span>
                    <div className="text-2xl font-bold mt-2 flex items-baseline gap-2">
                        <span className="text-red-500">+4.5%</span>
                        <span className="text-sm font-normal text-muted-foreground">/ +12.3%</span>
                    </div>
                </div>
                <div className="bg-card border border-border/60 rounded-xl p-4 flex flex-col justify-between shadow-sm">
                    <span className="text-muted-foreground text-xs font-semibold flex items-center gap-1.5"><BarChart2 size={14} /> 현재 보유</span>
                    <div className="text-2xl font-bold mt-2 text-blue-400">15<span className="text-sm font-normal text-muted-foreground ml-1">종목</span></div>
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
                            {/* Group Header (Only Date) */}
                            <div className="px-4 py-2 bg-muted/40 border-b border-border/40 flex items-center gap-2 sticky top-0 z-10">
                                <span className="text-xs font-bold text-blue-500 flex items-center gap-1.5"><Clock size={13} /> {group.date}</span>
                            </div>

                            {/* Group Items */}
                            {group.items.map((item, itemIdx) => {
                                const isCleared = item.status.includes('청산');
                                return (
                                    <div key={itemIdx} className={cn("grid gap-3 p-3 items-center border-b border-border/40 hover:bg-muted/30 transition-colors", gridCols, isCleared && "opacity-50 grayscale")}>
                                        {/* 순위 */}
                                        <div className="text-center">
                                            <span className={cn("inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold", item.rank === 1 ? 'bg-red-500/10 text-red-500 border border-red-500/20' : 'bg-muted text-muted-foreground border border-border')}>
                                                {item.rank}
                                            </span>
                                        </div>

                                        {/* 종목명 */}
                                        <div>
                                            <div className="text-[13px] font-bold text-foreground">{item.name}</div>
                                            <div className="text-[10px] text-muted-foreground font-mono">{item.code}</div>
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
                                        <div className="text-right text-[12px] text-foreground/80 font-mono">{item.entryPrice.toLocaleString()}</div>

                                        {/* 현재가 */}
                                        <div className="text-right text-[12px] text-foreground font-mono font-bold">{item.currentPrice.toLocaleString()}</div>

                                        {/* D-DAY */}
                                        <div className="text-center">
                                            <span className={cn("text-[11px] font-bold", item.dDay <= 3 && !isCleared ? 'text-amber-500' : 'text-muted-foreground')}>
                                                D-{item.dDay}
                                            </span>
                                        </div>

                                        {/* 피크 */}
                                        <div className="text-right text-[12px] text-muted-foreground font-mono">+{item.peak.toFixed(1)}%</div>

                                        {/* 현재수익 */}
                                        <div className={cn("text-right text-[13px] font-bold font-mono", item.return > 0 ? 'text-red-500' : item.return < 0 ? 'text-blue-500' : 'text-muted-foreground')}>
                                            {item.return > 0 ? '+' : ''}{item.return.toFixed(1)}%
                                        </div>

                                        {/* 상태 */}
                                        <div className="text-center">
                                            {getStatusBadge(item.status)}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
