import React, { useState, useEffect } from 'react'
import { Calendar, TrendingUp, BarChart } from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'

interface StrategyHistory {
    date: string;
    return: number;
}

interface StrategyDetail {
    id: string;
    version: string;
    isActive: boolean;
    history: StrategyHistory[];
}

export default function HistoryTab() {
    const [chartData, setChartData] = useState<any[]>([]);
    const [ledgerData, setLedgerData] = useState<any[]>([]);

    useEffect(() => {
        const loadHistory = async () => {
            try {
                // 1. Load Chart Data (from Strategy history)
                const data = await window.electronAPI.getAiStrategies();
                if (data && data.length > 0) {
                    const activeStrategy = data.find((s: StrategyDetail) => s.isActive) || data[0];
                    if (activeStrategy.history && activeStrategy.history.length > 0) {
                        const chronological = [...activeStrategy.history].reverse();
                        let cumulative = 0;
                        const plotData = chronological.map(h => {
                            cumulative += h.return;
                            return {
                                date: h.date.split('-').slice(1).join('/'),
                                dailyReturn: h.return,
                                cumulative: Number(cumulative.toFixed(2))
                            };
                        });
                        setChartData(plotData);
                    }
                }

                // 2. Load Ledger Data (from Virtual Account state)
                const accountState = await window.electronAPI.getAiAccountState();
                if (accountState && accountState.history) {
                    // Map history to ledger format
                    const mapped = accountState.history.map((h: any) => ({
                        time: h.time,
                        type: h.type,
                        name: h.name,
                        code: h.code,
                        price: h.price,
                        qty: h.quantity,
                        returnRate: h.pnlRate
                    }));
                    setLedgerData(mapped);
                }
            } catch (err) {
                console.error("Failed to load history data", err);
            }
        };
        loadHistory();
    }, []);

    const CustomTooltip = ({ active, payload, label }: any) => {
        if (active && payload && payload.length) {
            const data = payload[0].payload;
            return (
                <div className="bg-background/95 border border-border p-3 shadow-lg text-xs">
                    <p className="font-bold mb-1">{label}</p>
                    <p className="text-primary font-mono cursor-default">누적 수익: <span className={data.cumulative >= 0 ? 'text-green-500' : 'text-red-500'}>{data.cumulative > 0 ? '+' : ''}{data.cumulative}%</span></p>
                    <p className="text-muted-foreground font-mono cursor-default">당일 손익: <span className={data.dailyReturn >= 0 ? 'text-green-500/80' : 'text-red-500/80'}>{data.dailyReturn > 0 ? '+' : ''}{data.dailyReturn}%</span></p>
                </div>
            );
        }
        return null;
    };

    return (
        <div className="flex flex-col h-full overflow-hidden text-sm w-full">
            {/* Header Area */}
            <div className="p-4 shrink-0 flex flex-col md:flex-row md:items-center justify-between border-b border-border bg-muted/5">
                <div>
                    <h2 className="font-bold flex items-center gap-2">
                        <BarChart className="text-primary w-4 h-4" />
                        거래 이력 및 수익률 추이
                    </h2>
                    <p className="text-xs text-muted-foreground mt-1 font-medium">
                        과거 거래 내역과 장기 누적 수익률(PnL)을 정량적으로 시각화합니다.
                    </p>
                </div>
            </div>

            <div className="flex flex-col lg:flex-row flex-1 min-h-0 w-full overflow-hidden">
                {/* Left Col: Chart & Calendar */}
                <div className="w-full lg:w-3/5 flex flex-col border-b lg:border-b-0 lg:border-r border-border min-h-0 bg-background">
                    {/* Cumulative Return Chart */}
                    <div className="flex-[2] flex flex-col min-h-0 border-b border-border">
                        <div className="border-b border-border bg-muted/20 p-3 font-semibold text-xs flex items-center justify-between shrink-0 select-none cursor-default">
                            <div className="flex items-center gap-2">
                                <TrendingUp size={14} className="text-primary" />
                                현재 가동 전략의 누적 수익 차트 (PnL)
                            </div>
                            <span className="text-[10px] text-muted-foreground font-normal">단위: %</span>
                        </div>
                        <div className="flex-1 min-h-[250px] p-4 bg-background">
                            {chartData.length > 0 ? (
                                <ResponsiveContainer width="100%" height="100%">
                                    <LineChart data={chartData} margin={{ top: 5, right: 20, left: -20, bottom: 0 }}>
                                        <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.1} vertical={false} />
                                        <XAxis dataKey="date" tick={{ fontSize: 10 }} tickLine={false} axisLine={{ strokeOpacity: 0.2 }} minTickGap={15} />
                                        <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                                        <Tooltip content={<CustomTooltip />} />
                                        <ReferenceLine y={0} stroke="#888" strokeOpacity={0.5} />
                                        <Line
                                            type="monotone"
                                            dataKey="cumulative"
                                            stroke="#f59e0b" // amber-500 for primary branding
                                            strokeWidth={2}
                                            dot={{ r: 3, fill: "#f59e0b", strokeWidth: 0 }}
                                            activeDot={{ r: 5, strokeWidth: 0 }}
                                            animationDuration={1500}
                                        />
                                    </LineChart>
                                </ResponsiveContainer>
                            ) : (
                                <div className="w-full h-full flex flex-col items-center justify-center text-muted-foreground opacity-50">
                                    <BarChart size={32} className="mb-2" />
                                    <span className="text-xs">데이터가 충분하지 않습니다.</span>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Monthly Calendar */}
                    <div className="h-1/3 min-h-[180px] flex flex-col">
                        <div className="border-b border-border bg-muted/20 p-3 font-semibold text-xs flex items-center gap-2 shrink-0 select-none cursor-default">
                            <Calendar size={14} className="text-amber-500" />
                            월별 일일 손익 달력
                        </div>
                        <div className="flex-1 bg-muted/5 flex items-center justify-center">
                            <span className="text-[10px] font-bold opacity-40 uppercase tracking-widest italic">Calendar UI Placeholder</span>
                        </div>
                    </div>
                </div>

                {/* Right Col: Trade Ledger */}
                <div className="flex-1 flex flex-col min-h-0 overflow-hidden bg-background">
                    <div className="border-b border-border bg-muted/20 p-3 font-semibold text-xs shrink-0 select-none cursor-default flex justify-between items-center">
                        <span>상세 거래 기록표 (Trade Ledger)</span>
                        <span className="text-[10px] text-muted-foreground font-normal">가상 계좌 기반</span>
                    </div>

                    <div className="flex-1 overflow-auto w-full">
                        <table className="w-full text-xs text-left align-middle border-collapse">
                            <thead className="sticky top-0 bg-background/95 backdrop-blur z-10 border-b border-border">
                                <tr className="text-muted-foreground font-semibold">
                                    <th className="p-3 w-[80px]">주문/체결</th>
                                    <th className="p-3">종목명</th>
                                    <th className="p-3 text-right">체결단가</th>
                                    <th className="p-3 text-right">수익률/상태</th>
                                </tr>
                            </thead>
                            <tbody>
                                {ledgerData.length === 0 ? (
                                    <tr>
                                        <td colSpan={4} className="text-center p-8 text-muted-foreground opacity-50">
                                            매매 내역이 없습니다. 가상 계좌가 동작하면 기록됩니다.
                                        </td>
                                    </tr>
                                ) : (
                                    ledgerData.map((item, idx) => {
                                        const timeMatch = item.time.match(/(\d{2}:\d{2}:\d{2})/);
                                        const timeStr = timeMatch ? timeMatch[1] : item.time;

                                        // Make BUY slightly faded compared to SELL 
                                        const isBuy = item.type === 'BUY';

                                        return (
                                            <tr key={idx} className="border-b border-border/50 hover:bg-muted/10 transition-colors cursor-default">
                                                <td className="p-3 font-mono text-[10px] text-muted-foreground w-[80px]">
                                                    {timeStr}
                                                    <br />
                                                    <span className={isBuy ? 'text-blue-500 font-bold' : 'text-red-500 font-bold'}>
                                                        {item.type}
                                                    </span>
                                                </td>
                                                <td className="p-3 font-bold text-foreground">
                                                    {item.name}
                                                    <div className="text-[10px] text-muted-foreground font-normal font-mono">{item.code}</div>
                                                </td>
                                                <td className="p-3 font-mono text-right text-foreground">
                                                    {item.price.toLocaleString()}원
                                                    <div className="text-[10px] text-muted-foreground font-normal mt-0.5">{item.qty}주</div>
                                                </td>
                                                <td className="p-3 text-right font-bold whitespace-nowrap">
                                                    {isBuy ? (
                                                        <span className="text-muted-foreground font-normal">보유 중</span>
                                                    ) : (
                                                        <span className={item.returnRate && item.returnRate > 0 ? 'text-green-500' : 'text-red-500'}>
                                                            {item.returnRate !== undefined ? (item.returnRate > 0 ? `+${item.returnRate.toFixed(2)}%` : `${item.returnRate.toFixed(2)}%`) : '0.00%'}
                                                        </span>
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    )
}
