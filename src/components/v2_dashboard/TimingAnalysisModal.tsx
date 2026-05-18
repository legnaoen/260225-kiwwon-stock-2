import React, { useEffect, useState, useMemo } from 'react';
import { X, TrendingUp, Clock, AlertTriangle, Lightbulb, List } from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Cell, ReferenceLine } from 'recharts';

interface TimingAnalysisModalProps {
    isOpen: boolean;
    onClose: () => void;
}

interface PeakData {
    yield: string;
    count: number;
}

interface TimeData {
    time: string;
    return: number;
}

interface RawData {
    entry_date: string;
    trading_date: string;
    times: Record<string, number>;
}

const TIME_SLOTS = [
    '09:00', '09:10', '09:20', '09:30', '09:40', '09:50',
    '10:00', '10:10', '10:20', '10:30', '10:40', '10:50',
    '11:00', '11:10', '11:20', '11:30', '11:40', '11:50',
    '12:00', '12:10', '12:20', '12:30', '12:40', '12:50',
    '13:00', '13:10', '13:20', '13:30', '13:40', '13:50',
    '14:00', '14:10', '14:20', '14:30', '14:40'
];

export function TimingAnalysisModal({ isOpen, onClose }: TimingAnalysisModalProps) {
    const [peakData, setPeakData] = useState<PeakData[]>([]);
    const [timeData, setTimeData] = useState<TimeData[]>([]);
    const [sampleCount, setSampleCount] = useState<number>(0);
    const [isLoading, setIsLoading] = useState<boolean>(true);

    const [rawData, setRawData] = useState<RawData[]>([]);
    const [rawOffset, setRawOffset] = useState<number>(0);
    const [hasMoreRaw, setHasMoreRaw] = useState<boolean>(true);
    const [isLoadingRaw, setIsLoadingRaw] = useState<boolean>(false);

    useEffect(() => {
        if (!isOpen) return;
        
        let isMounted = true;
        setIsLoading(true);

        const fetchData = async () => {
            try {
                // @ts-ignore
                const result = await window.electronAPI.invoke('livetrade:get-timing-analysis');
                if (isMounted && result) {
                    setPeakData(result.peakDistribution || []);
                    setTimeData((result.timeTrajectory || []).filter((d: any) => d.time <= '14:40'));
                    setSampleCount(result.sampleCount || 0);
                }
            } catch (err) {
                console.error('Failed to fetch timing analysis data:', err);
            } finally {
                if (isMounted) setIsLoading(false);
            }
        };

        const loadRawData = async (offsetToLoad: number) => {
            setIsLoadingRaw(true);
            try {
                // @ts-ignore
                const result = await window.electronAPI.invoke('livetrade:get-timing-raw-data', 10, offsetToLoad);
                if (isMounted && result && result.length > 0) {
                    if (offsetToLoad === 0) {
                        setRawData(result);
                    } else {
                        setRawData(prev => [...prev, ...result]);
                    }
                    setRawOffset(offsetToLoad);
                    if (result.length < 10) setHasMoreRaw(false);
                } else if (isMounted) {
                    setHasMoreRaw(false);
                }
            } catch (err) {
                console.error('Failed to load raw data:', err);
            } finally {
                if (isMounted) setIsLoadingRaw(false);
            }
        };

        fetchData().then(() => {
            if (isMounted) loadRawData(0);
        });

        return () => { isMounted = false; };
    }, [isOpen]);

    const handleLoadMoreRaw = () => {
        // @ts-ignore
        const loadRawData = async (offsetToLoad: number) => {
            setIsLoadingRaw(true);
            try {
                // @ts-ignore
                const result = await window.electronAPI.invoke('livetrade:get-timing-raw-data', 10, offsetToLoad);
                if (result && result.length > 0) {
                    setRawData(prev => [...prev, ...result]);
                    setRawOffset(offsetToLoad);
                    if (result.length < 10) setHasMoreRaw(false);
                } else {
                    setHasMoreRaw(false);
                }
            } catch (err) {
                console.error('Failed to load raw data:', err);
            } finally {
                setIsLoadingRaw(false);
            }
        };
        loadRawData(rawOffset + 10);
    };

    // Calculate dynamic insights
    const optimalPeak = useMemo(() => {
        if (!peakData || peakData.length === 0) return { yield: '+2.0%', count: 0 };
        return peakData.reduce((max, curr) => curr.count > max.count ? curr : max, peakData[0]);
    }, [peakData]);

    const optimalProb = useMemo(() => {
        if (sampleCount === 0) return 0;
        return Math.round((optimalPeak.count / sampleCount) * 100);
    }, [optimalPeak, sampleCount]);

    const peakTimeInsight = useMemo(() => {
        if (!timeData || timeData.length === 0) return { peakTime: '09:40', maxReturn: 0, dropTime: '10:00', dropReturn: 0 };
        
        let maxObj = timeData[0];
        let maxIdx = 0;
        timeData.forEach((d, idx) => {
            if (d.return > maxObj.return) {
                maxObj = d;
                maxIdx = idx;
            }
        });

        // find next worst drop after peak
        let minAfterObj = maxObj;
        for (let i = maxIdx + 1; i < timeData.length; i++) {
            if (timeData[i].return < minAfterObj.return) {
                minAfterObj = timeData[i];
            }
        }

        return {
            peakTime: maxObj.time,
            maxReturn: maxObj.return,
            dropTime: minAfterObj.time,
            dropReturn: minAfterObj.return
        };
    }, [timeData]);

    const dropAmount = (peakTimeInsight.maxReturn - peakTimeInsight.dropReturn).toFixed(1);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm animate-in fade-in duration-200 p-4">
            <div className="bg-white border border-slate-200 rounded-xl shadow-2xl w-full max-w-5xl flex flex-col max-h-[90vh] overflow-hidden animate-in zoom-in-95 duration-200">
                
                {/* ── Header ── */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/50">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-blue-50 text-blue-600 rounded-lg border border-blue-100">
                            <TrendingUp className="w-5 h-5" />
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <h2 className="text-lg font-bold text-slate-800">최적 타이밍 분석 리포트</h2>
                                <span className="text-[10px] bg-slate-200 text-slate-600 px-2 py-0.5 rounded-full font-bold border border-slate-300">
                                    통계 표본: 누적 데이터 (총 {sampleCount}건)
                                </span>
                            </div>
                            <p className="text-xs text-slate-500 mt-0.5">D+1일차 포트폴리오 익절 수익률 및 손절 시간대 분석 결과</p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-slate-100 rounded-full transition-colors text-slate-400 hover:text-slate-700"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* ── Content ── */}
                <div className="flex-1 overflow-y-auto p-6 space-y-8 bg-slate-50/30">
                    {isLoading ? (
                        <div className="flex items-center justify-center h-[400px] text-slate-400 font-medium">데이터를 분석 중입니다...</div>
                    ) : (
                        <>
                            {/* SECTION A: Take-Profit Optimizer */}
                            <div className="space-y-4">
                                <div className="flex items-center gap-2">
                                    <TrendingUp className="w-5 h-5 text-emerald-500" />
                                    <h3 className="text-base font-bold text-slate-800">섹션 A. 최적 포트폴리오 익절선 분석</h3>
                                </div>
                                
                                <div className="grid grid-cols-3 gap-4">
                                    <div className="col-span-2 bg-white border border-slate-200 rounded-xl p-5 shadow-sm h-[280px]">
                                        <h4 className="text-xs font-bold text-slate-500 mb-4 text-center">코호트별 당일 최고점(Peak) 도달 분포도</h4>
                                        <ResponsiveContainer width="100%" height="100%">
                                            <BarChart data={peakData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                                                <XAxis dataKey="yield" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                                                <YAxis tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                                                <Tooltip 
                                                    cursor={{ fill: '#f8fafc' }}
                                                    contentStyle={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                                                    itemStyle={{ color: '#0f172a', fontWeight: 'bold' }}
                                                />
                                                <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                                                    {peakData.map((entry, index) => (
                                                        <Cell key={`cell-${index}`} fill={entry.yield === optimalPeak.yield ? '#10b981' : '#93c5fd'} />
                                                    ))}
                                                </Bar>
                                            </BarChart>
                                        </ResponsiveContainer>
                                    </div>

                                    <div className="flex flex-col gap-3">
                                        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex-1 flex flex-col justify-center items-center text-center">
                                            <div className="text-xs text-slate-500 font-bold mb-2">통계적 최적 익절선</div>
                                            <div className="text-4xl font-black text-emerald-500 drop-shadow-sm">{optimalPeak.yield}</div>
                                            <div className="text-xs text-slate-500 mt-3">도달 확률: <span className="text-slate-800 font-bold text-sm">{optimalProb}%</span></div>
                                        </div>
                                        <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 flex-1">
                                            <div className="flex gap-2 items-start">
                                                <Lightbulb className="w-5 h-5 text-blue-500 shrink-0" />
                                                <div className="text-[13px] leading-relaxed text-blue-900/80">
                                                    과거 데이터 상, 포트폴리오 수익률 <strong className="text-blue-700">{optimalPeak.yield}</strong>에 도달할 확률이 가장 높으며 안정적인 저항선으로 작용합니다. 해당 수익률에 전체 익절을 설정하는 것을 권장합니다.
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="h-px bg-slate-200 w-full" />

                            {/* SECTION B: Time-Cut Optimizer */}
                            <div className="space-y-4">
                                <div className="flex items-center gap-2">
                                    <Clock className="w-5 h-5 text-purple-500" />
                                    <h3 className="text-base font-bold text-slate-800">섹션 B. 시간대별 타임-컷(Time-Cut) 분석</h3>
                                </div>
                                
                                <div className="grid grid-cols-3 gap-4">
                                    <div className="flex flex-col gap-3">
                                        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex-1 flex flex-col justify-center items-center text-center">
                                            <div className="text-xs text-slate-500 font-bold mb-2">마의 꺾임 시간대</div>
                                            <div className="text-3xl font-black text-purple-600 drop-shadow-sm">{peakTimeInsight.peakTime} <span className="text-purple-300">~</span> {peakTimeInsight.dropTime}</div>
                                            <div className="text-xs text-slate-500 mt-3">평균 하락폭: <span className="text-rose-500 font-bold text-sm">-{dropAmount}%</span></div>
                                        </div>
                                        <div className="bg-purple-50 border border-purple-100 rounded-xl p-4 flex-1">
                                            <div className="flex gap-2 items-start">
                                                <AlertTriangle className="w-5 h-5 text-purple-500 shrink-0" />
                                                <div className="text-[13px] leading-relaxed text-purple-900/80">
                                                    평균적으로 <strong className="text-purple-700">{peakTimeInsight.peakTime}</strong> 부근에서 당일 고점을 형성한 뒤 수익을 반납하는 우하향 추세가 나타납니다. <strong className="text-rose-600">{peakTimeInsight.dropTime} 전후</strong>로 남은 물량을 청산하는 것이 통계적으로 안전합니다.
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="col-span-2 bg-white border border-slate-200 rounded-xl p-5 shadow-sm h-[280px]">
                                        <h4 className="text-xs font-bold text-slate-500 mb-4 text-center">오전/오후장 평균 포트폴리오 수익률 궤적 (D+1)</h4>
                                        <ResponsiveContainer width="100%" height="100%">
                                            <LineChart data={timeData} margin={{ top: 10, right: 20, left: -20, bottom: 0 }}>
                                                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                                                <XAxis dataKey="time" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                                                <YAxis tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} domain={['auto', 'auto']} />
                                                <Tooltip 
                                                    contentStyle={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                                                    labelStyle={{ color: '#64748b', fontWeight: 'bold', marginBottom: '4px' }}
                                                    itemStyle={{ color: '#0f172a', fontWeight: 'bold' }}
                                                    formatter={(value: number) => [`${value > 0 ? '+' : ''}${value}%`, '평균 수익률']}
                                                />
                                                <ReferenceLine x={peakTimeInsight.peakTime} stroke="#a855f7" strokeDasharray="3 3" label={{ position: 'top', value: 'Peak Time', fill: '#a855f7', fontSize: 10, fontWeight: 'bold' }} />
                                                <ReferenceLine y={0} stroke="#cbd5e1" />
                                                <Line type="monotone" dataKey="return" stroke="#a855f7" strokeWidth={3} dot={{ r: 4, fill: '#ffffff', stroke: '#a855f7', strokeWidth: 2 }} activeDot={{ r: 6, fill: '#a855f7', stroke: '#ffffff' }} />
                                            </LineChart>
                                        </ResponsiveContainer>
                                    </div>
                                </div>
                            </div>
                            
                            <div className="h-px bg-slate-200 w-full" />

                            {/* SECTION C: Raw Data Table */}
                            <div className="space-y-4">
                                <div className="flex items-center gap-2">
                                    <List className="w-5 h-5 text-indigo-500" />
                                    <h3 className="text-base font-bold text-slate-800">섹션 C. 날짜별 포트폴리오 수익률 로우데이터</h3>
                                </div>
                                <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-xs text-center border-collapse">
                                            <thead>
                                                <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold">
                                                    <th className="p-3 sticky left-0 bg-slate-50 border-r border-slate-200 whitespace-nowrap z-10 shadow-[1px_0_0_0_#e2e8f0]">매수일(Entry)</th>
                                                    <th className="p-3 sticky left-[105px] bg-slate-50 border-r border-slate-200 whitespace-nowrap z-10 shadow-[1px_0_0_0_#e2e8f0]">거래일(D+N)</th>
                                                    {TIME_SLOTS.map(t => (
                                                        <th key={t} className="p-2 min-w-[50px] border-r border-slate-100">{t}</th>
                                                    ))}
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {rawData.map((row, idx) => (
                                                    <tr key={`${row.entry_date}-${row.trading_date}-${idx}`} className="border-b border-slate-100 hover:bg-slate-50/50">
                                                        <td className="p-3 sticky left-0 bg-white border-r border-slate-200 whitespace-nowrap z-10 shadow-[1px_0_0_0_#e2e8f0] text-slate-600 font-medium">
                                                            {row.entry_date}
                                                        </td>
                                                        <td className="p-3 sticky left-[105px] bg-white border-r border-slate-200 whitespace-nowrap z-10 shadow-[1px_0_0_0_#e2e8f0] text-indigo-600 font-bold">
                                                            {row.trading_date}
                                                        </td>
                                                        {TIME_SLOTS.map(t => {
                                                            const val = row.times[t];
                                                            const isPos = val > 0;
                                                            const isNeg = val < 0;
                                                            return (
                                                                <td key={t} className={`p-2 border-r border-slate-50 ${isPos ? 'text-rose-500 font-bold' : isNeg ? 'text-blue-500 font-bold' : 'text-slate-400'}`}>
                                                                    {val !== undefined ? (val > 0 ? `+${val.toFixed(2)}%` : `${val.toFixed(2)}%`) : '-'}
                                                                </td>
                                                            );
                                                        })}
                                                    </tr>
                                                ))}
                                                {rawData.length === 0 && !isLoadingRaw && (
                                                    <tr>
                                                        <td colSpan={TIME_SLOTS.length + 2} className="p-8 text-slate-400">로우데이터가 없습니다.</td>
                                                    </tr>
                                                )}
                                            </tbody>
                                        </table>
                                    </div>
                                    {hasMoreRaw && (
                                        <div className="p-3 border-t border-slate-100 flex justify-center bg-slate-50/50">
                                            <button 
                                                onClick={handleLoadMoreRaw}
                                                disabled={isLoadingRaw}
                                                className="px-6 py-2 bg-white border border-slate-300 text-slate-600 rounded-lg text-xs font-bold hover:bg-slate-50 hover:text-indigo-600 transition-colors disabled:opacity-50"
                                            >
                                                {isLoadingRaw ? '불러오는 중...' : '10개 더보기 (Load More)'}
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
