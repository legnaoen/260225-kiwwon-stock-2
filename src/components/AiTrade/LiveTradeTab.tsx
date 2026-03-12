import React, { useState, useEffect } from 'react'
import { Activity, Terminal, Crosshair, BarChart2, Briefcase, ChevronRight, TrendingUp, Play, Square, Copy, Filter, AlertCircle, RefreshCw, CheckCircle2, Info, Settings2, X, BrainCircuit } from 'lucide-react'
import { StockChart } from '../StockChart'
import { useAutoTradeStore } from '../../store/useAutoTradeStore'

interface RadarItem {
    code: string;
    name: string;
    currentPrice: number;
    openPrice: number;
    vwap: number;
    gap: number;
    velocity: number;
    aiScore?: number;
}

interface Holding {
    code: string;
    name: string;
    avgPrice: number;
    quantity: number;
    currentPrice: number;
    pnl: number;
    pnlRate: number;
    buyTime: string;
    targetPrice?: number;
    stopPrice?: number;
}

interface LogEntry {
    time: string;
    message: string;
    type: 'info' | 'trade' | 'alert';
}

export default function LiveTradeTab() {
    const [radar, setRadar] = useState<RadarItem[]>([]);
    const [holdings, setHoldings] = useState<Holding[]>([]);
    const [history, setHistory] = useState<any[]>([]);
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [account, setAccount] = useState({ balance: 0, totalAssets: 0 });
    const [isAutoPilot, setIsAutoPilot] = useState(false);
    const [selectedStock, setSelectedStock] = useState<string | null>(null);
    const [logFilter, setLogFilter] = useState<'all' | 'trade' | 'alert' | 'info'>('all');
    const [isCopying, setIsCopying] = useState(false);
    const [initialBalance, setInitialBalance] = useState(1000000);
    const [isConfigOpen, setIsConfigOpen] = useState(false);
    const [configTab, setConfigTab] = useState<'step1' | 'step2' | 'step3'>('step1');
    const [isSyncPreviewOpen, setIsSyncPreviewOpen] = useState(false);
    const [syncPreviewData, setSyncPreviewData] = useState<any>(null);
    const [runtimeConfig, setRuntimeConfig] = useState<any>({
        targetProfit: 3.0,
        stopLoss: -2.0,
        minAiScore: 60,
        maxPositions: 2,
        scoringWeights: { vwap: 30, velocity: 25, trend: 20, gap: 10, leader: 15 },
        masterPrompt: "기본 지침을 불러오는 중..."
    });

    const isAiEvaluating = useAutoTradeStore(state => state.isAiEvaluating);
    const aiEvaluatingStock = useAutoTradeStore(state => state.aiEvaluatingStock);
    const setAiEvaluating = useAutoTradeStore(state => state.setAiEvaluating);

    useEffect(() => {
        // 1. Initial State Fetch
        const fetchInitial = async () => {
            const settings = await window.electronAPI.getAiSettings();
            if (settings) {
                setInitialBalance(settings.virtualInitialBalance ?? 1000000);
            }

            const config = await window.electronAPI.getAiRuntimeConfig();
            if (config && Object.keys(config).length > 0) {
                setRuntimeConfig(config);
            }

            if (window.electronAPI?.getAiAccountState) {
                const state = await window.electronAPI.getAiAccountState();
                if (state) {
                    setAccount({ balance: state.balance, totalAssets: state.totalAssets });
                    setHoldings(state.holdings);
                    setHistory(state.history);
                }
            }

            if (window.electronAPI?.getAiAutoPilot) {
                const active = await window.electronAPI.getAiAutoPilot();
                setIsAutoPilot(active);
            }

            if (window.electronAPI?.getAiTradeLogs) {
                const history = await window.electronAPI.getAiTradeLogs();
                if (history && history.length > 0) {
                    setLogs(history);
                }
            }
        };
        fetchInitial();

        // 2. Stream Setup

        // Return a combined cleanup function
        let cleanupStream: (() => void) | undefined;
        let cleanupEval: (() => void) | undefined;

        if (window.electronAPI?.onAiTradeStream) {
            cleanupStream = window.electronAPI.onAiTradeStream((data: any) => {
                if (data.radar) setRadar(data.radar);
                if (data.account) {
                    setAccount({ balance: data.account.balance, totalAssets: data.account.totalAssets });
                    setHoldings(data.account.holdings);
                    setHistory(data.account.history);
                }
                if (data.logs && data.logs.length > 0) {
                    setLogs(prev => [...prev, ...data.logs].slice(-200));
                }
            });
        }

        if (window.electronAPI?.onAiTradeEvaluationUpdate) {
            cleanupEval = window.electronAPI.onAiTradeEvaluationUpdate((data) => {
                setAiEvaluating(data.isEvaluating, data.stock);
            });
        }

        return () => {
            if (cleanupStream) cleanupStream();
            if (cleanupEval) cleanupEval();
        };
    }, [setAiEvaluating]);

    const resetAccount = async () => {
        const settings = await window.electronAPI.getAiSettings();
        const initialBalance = settings?.virtualInitialBalance ?? 1000000;

        if (!confirm(`가상 계좌를 ${initialBalance.toLocaleString()}원으로 초기화하시겠습니까?`)) return;
        const res = await window.electronAPI.resetAiAccount();
        if (res.success) {
            const state = await window.electronAPI.getAiAccountState();
            setAccount({ balance: state.balance, totalAssets: state.totalAssets });
            setHoldings([]);
            setHistory([]);
            setLogs(prev => [...prev, { time: new Date().toLocaleTimeString(), message: '가상 계좌가 초기화되었습니다.', type: 'info' }]);
        }
    };

    const handleToggleAutoPilot = async () => {
        const newState = !isAutoPilot;
        const res = await window.electronAPI.setAiAutoPilot(newState);
        if (res.success) {
            setIsAutoPilot(newState);
        }
    };

    const handleSaveConfig = async () => {
        await window.electronAPI.saveAiRuntimeConfig(runtimeConfig);
        setIsConfigOpen(false);
    };

    const handleSyncConfig = async () => {
        const activeStrategy = await window.electronAPI.getAiRuntimeConfig(); // 현재(Runtime) 값 가져오기용
        await window.electronAPI.syncStrategyConfig(); // DB에서 활성 전략 동기화 명령
        const newConfig = await window.electronAPI.getAiRuntimeConfig();

        if (!newConfig) {
            alert('동기화할 데이터를 가져오지 못했습니다.');
            return;
        }

        setSyncPreviewData({
            before: runtimeConfig,
            after: newConfig
        });
        setIsSyncPreviewOpen(true);
    };

    const confirmSync = () => {
        if (syncPreviewData) {
            setRuntimeConfig(syncPreviewData.after);
        }
        setIsSyncPreviewOpen(false);
        setSyncPreviewData(null);
    };

    const handleFactoryReset = async () => {
        if (confirm("시스템 초기 기본값(Factory Defaults)으로 완전히 초기화하시겠습니까?")) {
            const factoryDefaults = {
                targetProfit: 3.0,
                stopLoss: -2.0,
                minAiScore: 60,
                maxPositions: 2,
                scoringWeights: { vwap: 30, velocity: 25, trend: 20, gap: 10, leader: 15 },
                masterPrompt: "당신은 대한민국 코스피/코스닥 시장의 실시간 단타 및 스캘핑 전문가입니다. 아래 제공된 지표와 최근 20일 일봉 및 15분 분봉 데이터를 분석하여 '강력한 수급이 동반된 눌림목' 자리인지 판단하세요.\n\n[분석 지침]\n1. 거래대금이 상위권인 '시장 주도주' 여부와 VWAP(당일평균단가) 지지 여부를 최우선으로 분석하십시오.\n2. [최근 20일 일봉] 데이터를 통해 오늘의 위치가 주요 저항선을 돌파하는 자리인지, 혹은 매물대 상단인지 파악하십시오.\n3. 매수 승인(BUY) 시, 일봉 맥락을 고려하여 3% 이상의 높은 수익이 가능한 구간이라면 그에 맞는 target_price(익절가)를, 단기 고점이라면 타이트한 stop_price(손절가)를 반드시 구체적인 숫자로 제안하십시오.\n4. 다음 형식을 지켜 100% JSON으로 응답해야 합니다."
            };
            await window.electronAPI.saveAiRuntimeConfig(factoryDefaults);
            setRuntimeConfig(factoryDefaults);
        }
    };

    const handleCopyLogs = () => {
        const filteredLogs = logs.filter(l => logFilter === 'all' || l.type === logFilter);
        const logText = filteredLogs
            .map(l => `[${l.time}] [${l.type.toUpperCase()}] ${l.message}`)
            .join('\n');

        navigator.clipboard.writeText(logText);
        setIsCopying(true);
        setTimeout(() => setIsCopying(false), 2000);
    };

    const filteredLogs = logs.filter(l => logFilter === 'all' || l.type === logFilter);

    const formatPrice = (p: number) => p.toLocaleString();

    return (
        <div className="flex flex-col h-full overflow-hidden text-sm w-full">
            {/* Top Bar: Virtual Portfolio (Single Line Summary) */}
            <div className="flex items-center justify-between p-3 border-b border-border bg-muted/5 shrink-0 w-full">
                <div className="flex items-center gap-6">
                    <div className="flex items-center gap-2 font-bold select-none cursor-default">
                        <div className="flex items-center justify-center w-6 h-6 rounded-full bg-primary/10 text-primary">
                            <Activity size={12} className="animate-pulse" />
                        </div>
                        <span className="text-primary tracking-tighter">VIRTUAL SIMULATOR</span>
                    </div>

                    <div className="h-4 w-px bg-border"></div>

                    <div className="flex items-center gap-4">
                        <div className="flex flex-col">
                            <span className="text-[9px] text-muted-foreground uppercase font-bold tracking-tight">Virtual Balance</span>
                            <span className="font-mono font-bold tracking-tight text-sm">₩ {formatPrice(account.balance)}</span>
                        </div>
                        <div className="flex flex-col">
                            <span className="text-[9px] text-muted-foreground uppercase font-bold tracking-tight">Total Assets</span>
                            <span className="font-mono font-bold tracking-tight text-sm">₩ {formatPrice(account.totalAssets)}</span>
                        </div>
                        <div className="flex flex-col">
                            <span className="text-[9px] text-muted-foreground uppercase font-bold tracking-tight">Total PnL</span>
                            <span className={`font-mono font-bold text-xs ${account.totalAssets >= initialBalance ? 'text-green-500' : 'text-red-500'}`}>
                                {initialBalance > 0 ? (((account.totalAssets - initialBalance) / initialBalance) * 100).toFixed(2) : '0.00'}%
                            </span>
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    <button
                        onClick={resetAccount}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm font-bold text-[10px] text-red-500 hover:bg-red-500/10 transition-all border border-red-500/20 active:scale-95"
                        title={`가상계좌 초기화 (${initialBalance.toLocaleString()}원)`}
                    >
                        <RefreshCw size={12} />
                        RESET
                    </button>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => setIsConfigOpen(true)}
                            className="bg-muted hover:bg-muted/80 text-muted-foreground p-2 rounded-md transition-colors"
                            title="전략 파라미터 수동 설정"
                        >
                            <Settings2 size={18} />
                        </button>
                        <button
                            onClick={handleToggleAutoPilot}
                            className={`flex items-center gap-2 px-4 py-2 rounded-md font-bold transition-all ${isAutoPilot
                                ? 'bg-red-500/10 text-red-500 hover:bg-red-500/20 border border-red-500/50'
                                : 'bg-primary text-secondary hover:bg-primary/90 shadow-lg shadow-primary/20'
                                }`}
                        >
                            {isAutoPilot ? <Square size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
                            AI 자동매매 {isAutoPilot ? '중단' : '시작'}
                        </button>
                    </div>
                    <div className="flex items-center gap-2 bg-background border border-border px-3 py-1.5 text-xs font-semibold">
                        <Briefcase size={14} className="text-muted-foreground" />
                        Slot: <span className="text-primary font-bold">{holdings.length}</span> / {runtimeConfig.maxPositions}
                    </div>
                </div>
            </div>


            {/* Main Content Area */}
            <div className="flex flex-col flex-1 min-h-0 overflow-hidden w-full">

                {/* Middle Row: Radar & Trade Ledger (2-Column) */}
                <div className="flex flex-col lg:flex-row h-1/2 min-h-0 border-b border-border w-full">
                    {/* Live Radar (Left) */}
                    <div className="flex-1 flex flex-col min-h-0 overflow-hidden border-r border-border bg-background relative">
                        {/* AI Evaluation Overlay (covers header) */}
                        {isAiEvaluating && aiEvaluatingStock && (
                            <div className="absolute top-0 left-0 w-full h-[45px] bg-background/80 backdrop-blur-md z-20 flex items-center justify-between px-3 border-b border-amber-500/30 animate-pulse">
                                <div className="flex items-center gap-2">
                                    <Activity className="text-amber-500 animate-spin-slow" size={14} />
                                    <span className="text-xs font-bold text-amber-500 tracking-tight">AI PANOPTICON</span>
                                </div>
                                <div className="text-[11px] font-semibold text-amber-500/90 truncate ml-2">
                                    <span className="text-foreground">{aiEvaluatingStock.name}</span> 차트 패턴 판독 중...
                                </div>
                            </div>
                        )}
                        <div className="font-bold flex items-center justify-between gap-2 shrink-0 p-3 h-[45px] bg-muted/20 border-b border-border select-none">
                            <div className="flex items-center gap-2">
                                <Crosshair size={14} className="text-amber-500" />
                                Live Market Radar
                                <span className="text-[10px] font-normal text-muted-foreground ml-2">Sorted by AI Score (Score &ge; 60 triggers AI)</span>
                            </div>
                        </div>

                        <div className="flex-1 overflow-auto">
                            {radar.length > 0 ? (
                                <table className="w-full text-xs text-left align-middle border-collapse">
                                    <thead className="sticky top-0 bg-background/95 backdrop-blur z-10 border-b border-border">
                                        <tr className="text-muted-foreground font-semibold">
                                            <th className="px-3 py-2 font-bold uppercase tracking-wider text-[10px]">Stock</th>
                                            <th className="px-3 py-2 text-right font-bold uppercase tracking-wider text-[10px]">Price</th>
                                            <th className="px-3 py-2 text-right font-bold uppercase tracking-wider text-[10px]">Gap</th>
                                            <th className="px-3 py-2 text-right font-bold uppercase tracking-wider text-[10px]">AI Score</th>
                                            <th className="px-3 py-2 text-right font-bold uppercase tracking-wider text-[10px]">VWAP Gap</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {radar.map((item) => {
                                            const vwapGap = item.vwap > 0 ? ((item.currentPrice - item.vwap) / item.vwap * 100).toFixed(2) : '0.00';
                                            return (
                                                <tr
                                                    key={item.code}
                                                    className={`border-b border-border/50 hover:bg-muted/10 transition-colors cursor-pointer ${selectedStock === item.code ? 'bg-primary/5' : ''}`}
                                                    onClick={() => setSelectedStock(item.code)}
                                                >
                                                    <td className="px-3 py-3 font-bold">{item.name}</td>
                                                    <td className="px-3 py-3 text-right font-mono">{formatPrice(item.currentPrice)}</td>
                                                    <td className={`px-3 py-3 text-right font-bold font-mono ${item.gap >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                                                        {item.gap > 0 ? '+' : ''}{item.gap}%
                                                    </td>
                                                    <td className="px-3 py-3 text-right">
                                                        <div className="flex items-center justify-end gap-2">
                                                            <div className="h-1.5 w-16 bg-muted rounded-full overflow-hidden">
                                                                <div
                                                                    className={`h-full transition-all duration-500 ${(item.aiScore || 0) >= 80 ? 'bg-red-500 shadow-[0_0_5px_rgba(239,68,68,0.5)]' : (item.aiScore || 0) >= 60 ? 'bg-amber-500' : 'bg-green-500'}`}
                                                                    style={{ width: `${Math.min(item.aiScore || 0, 100)}%` }}
                                                                ></div>
                                                            </div>
                                                            <span className={`font-mono font-bold text-[10px] w-6 ${(item.aiScore || 0) >= 80 ? 'text-red-500' : (item.aiScore || 0) >= 60 ? 'text-amber-500' : 'text-foreground'}`}>{item.aiScore || 0}</span>
                                                        </div>
                                                    </td>
                                                    <td className={`px-3 py-3 text-right font-mono font-bold ${Number(vwapGap) >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                                                        {vwapGap}%
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            ) : (
                                <div className="h-full flex flex-col items-center justify-center opacity-30 gap-2">
                                    <BarChart2 size={32} className="text-muted-foreground" />
                                    <span className="text-xs font-medium">Scanning Market...</span>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Trade Ledger (Right) */}
                    <div className="flex-1 flex flex-col min-h-0 overflow-hidden bg-background">
                        <div className="font-bold flex items-center gap-2 shrink-0 p-3 bg-muted/20 border-b border-border select-none">
                            <Briefcase size={14} className="text-primary" />
                            Virtual Holdings & Ledger
                        </div>
                        <div className="flex-1 overflow-auto">
                            <table className="w-full text-xs text-left align-middle border-collapse table-auto">
                                <thead className="sticky top-0 bg-background/95 backdrop-blur z-10 border-b border-border">
                                    <tr className="text-muted-foreground font-semibold">
                                        <th className="px-2 py-2 font-bold uppercase tracking-wider text-[10px]">Status</th>
                                        <th className="px-2 py-2 font-bold uppercase tracking-wider text-[10px]">Stock</th>
                                        <th className="px-2 py-2 text-right font-bold uppercase tracking-wider text-[10px]">Bought</th>
                                        <th className="px-2 py-2 text-right font-bold uppercase tracking-wider text-[10px]">AI Target</th>
                                        <th className="px-2 py-2 text-right font-bold uppercase tracking-wider text-[10px]">AI Stop</th>
                                        <th className="px-2 py-2 text-right font-bold uppercase tracking-wider text-[10px]">Current</th>
                                        <th className="px-2 py-2 text-right font-bold uppercase tracking-wider text-[10px]">PnL</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {holdings.length > 0 ? holdings.map(h => (
                                        <tr key={h.code} className="border-b border-border/50 bg-primary/5 hover:bg-primary/10 transition-colors cursor-pointer" onClick={() => setSelectedStock(h.code)}>
                                            <td className="px-2 py-3">
                                                <span className="text-[9px] bg-primary text-primary-foreground font-bold px-1.5 py-0.5 rounded-sm animate-pulse uppercase">Active</span>
                                            </td>
                                            <td className="px-2 py-3">
                                                <div className="flex flex-col">
                                                    <span className="font-bold">{h.name}</span>
                                                    <span className="text-[9px] opacity-50">{h.buyTime}</span>
                                                </div>
                                            </td>
                                            <td className="px-2 py-3 text-right font-mono text-muted-foreground">{formatPrice(h.avgPrice)}</td>
                                            <td className="px-2 py-3 text-right">
                                                <div className="flex flex-col items-end">
                                                    <span className="font-mono text-green-500/80 font-bold">{h.targetPrice ? formatPrice(h.targetPrice) : '-'}</span>
                                                    {h.targetPrice && (
                                                        <div className="w-16 h-1 bg-muted rounded-full overflow-hidden mt-1">
                                                            <div
                                                                className="h-full bg-green-500 transition-all duration-500"
                                                                style={{ width: `${Math.min(100, Math.max(0, ((h.currentPrice - h.avgPrice) / (h.targetPrice - h.avgPrice)) * 100))}%` }}
                                                            />
                                                        </div>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="px-2 py-3 text-right font-mono text-red-500/80 font-semibold">{h.stopPrice ? formatPrice(h.stopPrice) : '-'}</td>
                                            <td className="px-2 py-3 text-right font-mono font-bold">{formatPrice(h.currentPrice)}</td>
                                            <td className={`px-2 py-3 text-right font-mono font-bold ${h.pnlRate >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                                                {h.pnlRate > 0 ? '+' : ''}{h.pnlRate?.toFixed(2)}%
                                            </td>
                                        </tr>
                                    )) : history.length > 0 ? (
                                        <tr className="border-b border-border/50 opacity-30 italic">
                                            <td colSpan={7} className="py-8 text-center text-[10px]">All trades settled. Hunting for new momentum.</td>
                                        </tr>
                                    ) : (
                                        <tr className="border-b border-border/50 opacity-30 italic">
                                            <td colSpan={7} className="py-8 text-center text-[10px]">No active holdings. Start AI Auto-Pilot.</td>
                                        </tr>
                                    )}

                                    {/* Recent History (Settled Trades) */}
                                    {history.filter(h => h.type === 'SELL').map(h => (
                                        <tr key={h.id} className="border-b border-border/30 opacity-60 hover:opacity-100 transition-opacity">
                                            <td className="px-2 py-2">
                                                <span className="text-[9px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded-sm uppercase font-bold">Closed</span>
                                            </td>
                                            <td className="px-2 py-2 text-muted-foreground font-medium">{h.name}</td>
                                            <td className="px-2 py-2 text-right font-mono text-[10px]">{h.time}</td>
                                            <td className="px-2 py-2 text-right font-mono text-[10px]">{formatPrice(h.price)}</td>
                                            <td className={`px-2 py-2 text-right font-mono font-bold ${h.pnlRate >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                                                {h.pnlRate > 0 ? '+' : ''}{h.pnlRate?.toFixed(2)}%
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>

                {/* Bottom Row: Live Chart & Decision Log */}
                <div className="flex flex-col lg:flex-row flex-1 min-h-0 w-full bg-background border-t border-border">
                    {/* AI Live Chart Widget */}
                    <div className="flex-1 flex flex-col h-full overflow-hidden lg:border-r border-border select-none">
                        <div className="font-bold flex items-center justify-between shrink-0 p-3 bg-muted/20 border-b border-border">
                            <div className="flex items-center gap-2">
                                <BarChart2 size={14} className="text-blue-500" />
                                {selectedStock ? (holdings.find(h => h.code === selectedStock)?.name || radar.find(r => r.code === selectedStock)?.name || 'AI Momentum Analysis Chart') : 'AI Momentum Analysis Chart'}
                            </div>
                            <div className="flex items-center gap-1 text-[11px] font-mono tracking-widest">
                                {selectedStock ? (
                                    <span className="flex items-center gap-2 bg-muted px-2 py-0.5 rounded-sm border border-border">
                                        <span className="text-muted-foreground">VWAP</span>
                                        <span className="font-bold text-orange-500">{formatPrice(Math.floor(radar.find(r => r.code === selectedStock)?.vwap || 0))}</span>
                                    </span>
                                ) : (
                                    <span className="text-muted-foreground/50">1M CANDLESTICKS</span>
                                )}
                            </div>
                        </div>
                        <div className="flex-1 flex items-center justify-center min-h-0 bg-black/5 relative">
                            {selectedStock ? (
                                <StockChart stockCode={selectedStock} stockName={holdings.find(h => h.code === selectedStock)?.name || radar.find(r => r.code === selectedStock)?.name || ''} theme="light" />
                            ) : (
                                <span className="text-muted-foreground opacity-50 text-[10px] font-bold uppercase tracking-tighter animate-pulse">Waiting for real-time tick synchronization...</span>
                            )}
                        </div>
                    </div>

                    {/* AI Decision Log Stream */}
                    <div className="flex-1 flex flex-col text-foreground font-mono text-xs h-full overflow-hidden bg-background">
                        <div className="font-bold flex items-center justify-between shrink-0 px-3 py-2 bg-muted/20 border-b border-border select-none">
                            <div className="flex items-center gap-4 text-foreground/90">
                                <div className="flex items-center gap-2">
                                    <Terminal size={14} />
                                    AI Core Terminal
                                    <span className={`w-1.5 h-1.5 rounded-full animate-pulse ml-1 ${isAutoPilot ? 'bg-green-500' : 'bg-red-500'}`} />
                                </div>

                                {/* Log Filters */}
                                <div className="flex items-center gap-1">
                                    <button
                                        onClick={() => setLogFilter('all')}
                                        className={`px-2 py-0.5 rounded text-[9px] transition-all ${logFilter === 'all' ? 'bg-muted-foreground/20 text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                                    >
                                        ALL
                                    </button>
                                    <button
                                        onClick={() => setLogFilter('trade')}
                                        className={`px-2 py-0.5 rounded text-[9px] transition-all flex items-center gap-1 ${logFilter === 'trade' ? 'bg-green-500/10 text-green-600' : 'text-muted-foreground hover:text-foreground'}`}
                                    >
                                        <TrendingUp size={10} /> TRADE
                                    </button>
                                    <button
                                        onClick={() => setLogFilter('alert')}
                                        className={`px-2 py-0.5 rounded text-[9px] transition-all flex items-center gap-1 ${logFilter === 'alert' ? 'bg-red-500/10 text-red-600' : 'text-muted-foreground hover:text-foreground'}`}
                                    >
                                        <AlertCircle size={10} /> ERROR
                                    </button>
                                </div>
                            </div>

                            <button
                                onClick={handleCopyLogs}
                                disabled={isCopying}
                                className="flex items-center gap-1.5 text-[9px] font-bold px-2 py-1 rounded bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground transition-all active:scale-95 disabled:opacity-50"
                                title="현재 필터링된 로그 복사"
                            >
                                {isCopying ? <CheckCircle2 size={12} className="text-green-500" /> : <Copy size={12} />}
                                {isCopying ? 'COPIED' : 'COPY'}
                            </button>
                        </div>
                        <div className="flex-1 overflow-y-auto p-4 space-y-2 scrollbar-thin scrollbar-thumb-muted-foreground/20 flex flex-col-reverse">
                            <div className="animate-pulse opacity-20 text-muted-foreground ml-1">_</div>
                            {filteredLogs.length > 0 ? [...filteredLogs].reverse().map((entry, idx) => (
                                <div key={idx} className={`flex items-start break-all leading-relaxed animate-in fade-in slide-in-from-bottom-1 duration-300 ${entry.type === 'trade' ? 'text-green-600 font-bold' : entry.type === 'alert' ? 'text-amber-600 font-bold' : 'text-muted-foreground'}`}>
                                    <span className="opacity-50 text-[9px] mr-2 shrink-0 mt-[1.5px] font-mono">[{entry.time}]</span>
                                    <span className="flex-1">
                                        {entry.type === 'alert' && <AlertCircle size={10} className="inline mr-1 mb-0.5" />}
                                        {entry.type === 'trade' && <TrendingUp size={10} className="inline mr-1 mb-0.5" />}
                                        {entry.message}
                                    </span>
                                </div>
                            )) : (
                                <div className="h-full flex items-center justify-center text-muted-foreground/50 italic text-[10px]">
                                    No logs available for the selected filter.
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
            {/* Strategy Config Modal */}
            {isConfigOpen && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
                    <div className="bg-background border border-border w-full max-w-xl shadow-2xl animate-in zoom-in-95 duration-200 flex flex-col max-h-[90vh]">
                        <div className="p-4 border-b border-border flex items-center justify-between bg-muted/20 shrink-0">
                            <h3 className="font-bold flex items-center gap-2">
                                <Settings2 className="w-4 h-4 text-primary" />
                                AI 엔진 전략 상세 설정
                                <span className="text-[10px] bg-primary/20 text-primary px-1.5 py-0.5 rounded ml-2">v{runtimeConfig.version || 'Active'}</span>
                            </h3>
                            <button onClick={() => setIsConfigOpen(false)} className="text-muted-foreground hover:text-foreground">
                                <X size={20} />
                            </button>
                        </div>

                        <div className="flex border-b border-border bg-muted/5 shrink-0">
                            <button
                                onClick={() => setConfigTab('step1')}
                                className={`flex-1 py-3 text-[11px] font-bold transition-all ${configTab === 'step1' ? 'text-primary border-b-2 border-primary bg-primary/5' : 'text-muted-foreground hover:bg-muted/10'}`}
                            >
                                Step 1. 매매 수치
                            </button>
                            <button
                                onClick={() => setConfigTab('step2')}
                                className={`flex-1 py-3 text-[11px] font-bold transition-all ${configTab === 'step2' ? 'text-primary border-b-2 border-primary bg-primary/5' : 'text-muted-foreground hover:bg-muted/10'}`}
                            >
                                Step 2. 채점 가중치
                            </button>
                            <button
                                onClick={() => setConfigTab('step3')}
                                className={`flex-1 py-3 text-[11px] font-bold transition-all ${configTab === 'step3' ? 'text-primary border-b-2 border-primary bg-primary/5' : 'text-muted-foreground hover:bg-muted/10'}`}
                            >
                                Step 3. AI 판단 지침
                            </button>
                        </div>

                        <div className="flex-1 overflow-y-auto p-6 space-y-6 min-h-[400px] custom-scrollbar relative">
                            {/* Sync Preview Overlay */}
                            {isSyncPreviewOpen && syncPreviewData && (
                                <div className="absolute inset-0 z-50 bg-background/95 backdrop-blur-md p-6 flex flex-col border-t border-border animate-in fade-in slide-in-from-bottom-4">
                                    <div className="flex items-center justify-between mb-4">
                                        <h4 className="text-sm font-bold flex items-center gap-2">
                                            <RefreshCw size={16} className="text-primary animate-spin-slow" />
                                            전략 변경 비교 (Before vs After)
                                        </h4>
                                        <button onClick={() => setIsSyncPreviewOpen(false)} className="text-muted-foreground hover:text-foreground">
                                            <X size={16} />
                                        </button>
                                    </div>

                                    <div className="flex-1 overflow-auto border border-border rounded-md">
                                        <table className="w-full text-[11px] text-left">
                                            <thead className="bg-muted/50 border-b border-border">
                                                <tr>
                                                    <th className="px-3 py-2 font-bold opacity-60">항목</th>
                                                    <th className="px-3 py-2 font-bold">현재 설정</th>
                                                    <th className="px-3 py-2 font-bold text-primary">AI 추천</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-border/50">
                                                <tr>
                                                    <td className="px-3 py-2 font-medium bg-muted/20">목표 수익률</td>
                                                    <td className="px-3 py-2 font-mono">{syncPreviewData.before?.targetProfit}%</td>
                                                    <td className="px-3 py-2 font-mono font-bold text-green-500">{syncPreviewData.after?.targetProfit}%</td>
                                                </tr>
                                                <tr>
                                                    <td className="px-3 py-2 font-medium bg-muted/20">손절 제한선</td>
                                                    <td className="px-3 py-2 font-mono">{syncPreviewData.before?.stopLoss}%</td>
                                                    <td className="px-3 py-2 font-mono font-bold text-red-500">{syncPreviewData.after?.stopLoss}%</td>
                                                </tr>
                                                <tr>
                                                    <td className="px-3 py-2 font-medium bg-muted/20">진입 최소 점수</td>
                                                    <td className="px-3 py-2 font-mono">{(syncPreviewData.before?.minAiScore) || 0}점</td>
                                                    <td className="px-3 py-2 font-mono font-bold text-blue-500">{(syncPreviewData.after?.minAiScore) || 0}점</td>
                                                </tr>
                                                {syncPreviewData.after?.scoringWeights && Object.keys(syncPreviewData.after.scoringWeights).map(key => (
                                                    <tr key={key}>
                                                        <td className="px-3 py-2 font-medium bg-muted/20 capitalize">가중치: {key}</td>
                                                        <td className="px-3 py-2 font-mono">{(syncPreviewData.before?.scoringWeights?.[key]) || 0}%</td>
                                                        <td className="px-3 py-2 font-mono font-bold text-primary">{(syncPreviewData.after.scoringWeights[key]) || 0}%</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>

                                    <div className="mt-4 flex gap-2">
                                        <button
                                            onClick={confirmSync}
                                            className="flex-1 bg-primary text-secondary font-bold py-2.5 rounded-sm text-xs hover:bg-primary/90"
                                        >
                                            추천 설정으로 즉시 변경
                                        </button>
                                        <button
                                            onClick={() => setIsSyncPreviewOpen(false)}
                                            className="px-4 bg-muted text-muted-foreground font-bold py-2.5 rounded-sm text-xs"
                                        >
                                            취소
                                        </button>
                                    </div>
                                </div>
                            )}

                            {configTab === 'step1' && (
                                <div className="space-y-4">
                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="space-y-2">
                                            <label className="text-[10px] font-bold text-muted-foreground uppercase">목표 수익률 (%)</label>
                                            <input type="number" step="0.1" value={runtimeConfig.targetProfit} onChange={(e) => setRuntimeConfig({ ...runtimeConfig, targetProfit: parseFloat(e.target.value) })} className="w-full bg-muted/30 border border-border p-2 font-mono text-sm" />
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-[10px] font-bold text-muted-foreground uppercase">손절 제한선 (%)</label>
                                            <input type="number" step="0.1" value={runtimeConfig.stopLoss} onChange={(e) => setRuntimeConfig({ ...runtimeConfig, stopLoss: parseFloat(e.target.value) })} className="w-full bg-muted/30 border border-border p-2 font-mono text-sm" />
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-[10px] font-bold text-muted-foreground uppercase">진입 최소 점수 (Threshold)</label>
                                            <input type="number" value={runtimeConfig.minAiScore} onChange={(e) => setRuntimeConfig({ ...runtimeConfig, minAiScore: parseInt(e.target.value) })} className="w-full bg-muted/30 border border-border p-2 font-mono text-sm" />
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-[10px] font-bold text-muted-foreground uppercase">최대 보유 종목</label>
                                            <input type="number" value={runtimeConfig.maxPositions} onChange={(e) => setRuntimeConfig({ ...runtimeConfig, maxPositions: parseInt(e.target.value) })} className="w-full bg-muted/30 border border-border p-2 font-mono text-sm" />
                                        </div>
                                    </div>
                                    <div className="p-3 bg-blue-500/5 border border-blue-500/20 text-[11px] text-blue-500 leading-relaxed rounded">
                                        <Info size={14} className="inline mr-1 mb-0.5" />
                                        수동 설정 수치는 AI의 추천 전략보다 우선적으로 적용됩니다.
                                    </div>
                                </div>
                            )}

                            {configTab === 'step2' && (
                                <div className="space-y-6">
                                    <div className="p-3 bg-muted/30 border border-border space-y-2 rounded-sm">
                                        <h5 className="text-[10px] font-bold text-muted-foreground flex items-center gap-1.5 uppercase">
                                            <Filter size={12} /> 레이더 필터링 기준 (Hard Filters)
                                        </h5>
                                        <div className="flex flex-wrap gap-2">
                                            <span className="text-[9px] bg-background px-1.5 py-0.5 border border-border rounded">가격 1,000원 이상</span>
                                            <span className="text-[9px] bg-background px-1.5 py-0.5 border border-border rounded">당일 상승률 2% 이상</span>
                                            <span className="text-[9px] bg-background px-1.5 py-0.5 border border-border rounded">ETF/ETN/스팩/우선주 제외</span>
                                            <span className="text-[9px] bg-background px-1.5 py-0.5 border border-border rounded">거래대금 상위 위주</span>
                                        </div>
                                    </div>

                                    <h4 className="text-[10px] font-bold text-primary uppercase border-b border-primary/20 pb-1 flex items-center gap-2">
                                        <BarChart2 size={12} /> AI 채점 가중치 설정 (Ranker Weights)
                                    </h4>
                                    <div className="grid grid-cols-1 gap-4">
                                        {Object.entries(runtimeConfig.scoringWeights || {}).map(([key, value]: [string, any]) => (
                                            <div key={key} className="space-y-2">
                                                <div className="flex justify-between text-[11px] font-semibold">
                                                    <span className="capitalize">
                                                        {key === 'vwap' ? 'VWAP 타점 (이격도)' :
                                                            key === 'velocity' ? '수급 속도 (거래량 전입)' :
                                                                key === 'trend' ? '추세 강도 (고점 근접)' :
                                                                    key === 'gap' ? '상승 탄력 (당일 상승률)' : '시장 지배력 (주도주 여부)'}
                                                    </span>
                                                    <span className="text-primary font-mono">{value}%</span>
                                                </div>
                                                <input
                                                    type="range" min="0" max="100" value={value}
                                                    onChange={(e) => setRuntimeConfig({
                                                        ...runtimeConfig,
                                                        scoringWeights: { ...runtimeConfig.scoringWeights, [key]: parseInt(e.target.value) }
                                                    })}
                                                    className="w-full h-1.5 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
                                                />
                                            </div>
                                        ))}
                                        <div className="p-2.5 bg-primary/5 border border-primary/20 text-[10px] flex justify-between items-center rounded">
                                            <span className="font-bold">가중치 합계 (100% 권장)</span>
                                            <span className={`text-sm font-mono font-bold ${(Object.values(runtimeConfig.scoringWeights || {}) as number[]).reduce((a: number, b: number) => a + b, 0) === 100 ? 'text-green-500' : 'text-amber-500'}`}>
                                                {(Object.values(runtimeConfig.scoringWeights || {}) as number[]).reduce((a: number, b: number) => a + b, 0)}%
                                            </span>
                                        </div>

                                        <div className="mt-4 pt-4 border-t border-border space-y-3">
                                            <div className="flex justify-between items-center">
                                                <h5 className="text-[10px] font-bold text-primary flex items-center gap-1.5 uppercase">
                                                    <Activity size={12} /> 최종 진입 커트라인 (Threshold Score)
                                                </h5>
                                                <span className="text-sm font-mono font-bold text-primary">{runtimeConfig.minAiScore}점</span>
                                            </div>
                                            <input
                                                type="range" min="0" max="100" value={runtimeConfig.minAiScore}
                                                onChange={(e) => setRuntimeConfig({ ...runtimeConfig, minAiScore: parseInt(e.target.value) })}
                                                className="w-full h-1.5 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
                                            />
                                            <p className="text-[9px] text-muted-foreground leading-relaxed italic">
                                                * 가중치로 계산된 매수 점수가 이 점수를 넘어야만 AI가 최종 분석을 수행합니다.
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {configTab === 'step3' && (
                                <div className="space-y-4">
                                    <h4 className="text-[10px] font-bold text-primary uppercase flex items-center gap-2">
                                        <BrainCircuit size={12} /> AI 최종 판단용 마스터 프롬프트 (Master Prompt)
                                    </h4>
                                    <textarea
                                        value={runtimeConfig.masterPrompt}
                                        onChange={(e) => setRuntimeConfig({ ...runtimeConfig, masterPrompt: e.target.value })}
                                        className="w-full h-[320px] bg-muted/30 border border-border p-3 font-mono text-[11px] leading-relaxed focus:outline-none focus:ring-1 focus:ring-primary custom-scrollbar"
                                        placeholder="AI의 판단 지침을 입력하세요..."
                                    />
                                    <div className="p-2.5 bg-amber-500/5 border border-amber-500/20 text-[10px] text-amber-500 leading-relaxed italic">
                                        * 주의: 지침을 고도로 수정하면 AI의 판단 로직이 크게 변할 수 있습니다.
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Fixed Footer for Buttons */}
                        <div className="p-4 border-t border-border bg-muted/20 shrink-0">
                            <div className="grid grid-cols-3 gap-2">
                                <button
                                    onClick={handleSaveConfig}
                                    className="bg-primary text-secondary font-bold py-2 hover:bg-primary/90 transition-all flex flex-col items-center justify-center gap-1 rounded-sm shadow-sm"
                                >
                                    <CheckCircle2 size={14} />
                                    <span className="text-[9px] uppercase">설정 저장</span>
                                </button>
                                <button
                                    onClick={handleSyncConfig}
                                    className="bg-muted text-muted-foreground font-bold py-2 hover:bg-muted/80 transition-all flex flex-col items-center justify-center gap-1 rounded-sm border border-border shadow-sm"
                                >
                                    <RefreshCw size={14} />
                                    <span className="text-[9px] uppercase">AI 전략 동기화</span>
                                </button>
                                <button
                                    onClick={handleFactoryReset}
                                    className="bg-red-500/10 text-red-500 hover:bg-red-500/20 font-bold py-2 transition-all flex flex-col items-center justify-center gap-1 rounded-sm border border-red-500/10 shadow-sm"
                                >
                                    <AlertCircle size={14} />
                                    <span className="text-[9px] uppercase">공장 초기화</span>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
