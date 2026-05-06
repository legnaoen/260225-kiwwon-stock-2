/**
 * ReportTrackerTab.tsx - 리포트 기반 AI 트래커
 * - 실DB 연동 + UI 상단 탭 방식 + 라이트 모드 적용
 */
import React, { useState, useEffect, useCallback } from 'react';
import { Play, RefreshCw, Activity, History, BarChart2, BookOpen, Eye, AlertCircle } from 'lucide-react';
import ReportDashboardTab from './ReportDashboardTab';
import { StockDetailModal } from '../common/StockDetailModal';

type SubTab = 'active' | 'history' | 'logs' | 'rawdb';

export default function ReportTrackerTab() {
    const [activeSubTab, setActiveSubTab] = useState<SubTab>('active');
    const [portfolio, setPortfolio] = useState<any[]>([]);
    const [history, setHistory] = useState<any[]>([]);
    const [logs, setLogs] = useState<any[]>([]);
    const [stats, setStats] = useState<any>(null);
    const [loading, setLoading] = useState(false);
    
    // 모달 상태
    const [selectedStock, setSelectedStock] = useState<{ stockCode: string; stockName: string; aiReason?: string } | null>(null);

    // 정렬 상태
    const [sortConfig, setSortConfig] = useState<{ key: string, direction: 'asc'|'desc' }>(() => {
        const saved = localStorage.getItem('reportTrackerSort');
        return saved ? JSON.parse(saved) : { key: 'ai_score', direction: 'desc' };
    });

    useEffect(() => {
        localStorage.setItem('reportTrackerSort', JSON.stringify(sortConfig));
    }, [sortConfig]);

    const requestSort = (key: string) => {
        let direction: 'asc' | 'desc' = 'desc';
        if (sortConfig && sortConfig.key === key && sortConfig.direction === 'desc') {
            direction = 'asc';
        }
        setSortConfig({ key, direction });
    };

    const renderSortArrow = (key: string) => {
        if (sortConfig.key !== key) return null;
        return <span className="ml-1 text-[10px]">{sortConfig.direction === 'asc' ? '▲' : '▼'}</span>;
    };

    const sortedPortfolio = React.useMemo(() => {
        let sortableItems = [...portfolio];
        if (sortConfig !== null) {
            sortableItems.sort((a, b) => {
                let valA = a[sortConfig.key];
                let valB = b[sortConfig.key];
                
                if (sortConfig.key === 'currentReturn') {
                    valA = a.entry_price > 0 ? ((a.current_price - a.entry_price) / a.entry_price * 100) : 0;
                    valB = b.entry_price > 0 ? ((b.current_price - b.entry_price) / b.entry_price * 100) : 0;
                }

                if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1;
                if (valA > valB) return sortConfig.direction === 'asc' ? 1 : -1;
                return 0;
            });
        }
        return sortableItems;
    }, [portfolio, sortConfig]);

    // 수동 실행 상태
    const [runningRebalance, setRunningRebalance] = useState(false);
    const [runningScout, setRunningScout] = useState(false);
    const [lastRunResult, setLastRunResult] = useState<string | null>(null);

    const api = (window as any).electronAPI;

    const loadAll = useCallback(async () => {
        setLoading(true);
        try {
            const [p, h, l, s] = await Promise.all([
                api.getReportPortfolio?.() ?? [],
                api.getReportTradeHistory?.(100) ?? [],
                api.getReportRebalanceLogs?.(30) ?? [],
                api.getReportPortfolioStats?.() ?? null,
            ]);
            setPortfolio(p || []);
            setHistory(h || []);
            setLogs(l || []);
            setStats(s || { activeCount: 0, totalTrades: 0, winRate: 0, avgReturn: 0, avgHoldDays: 0 });
        } catch (e) {
            console.error('[ReportTracker] 데이터 로드 오류:', e);
        } finally {
            setLoading(false);
        }
    }, [api]);

    const handleRefresh = async () => {
        setLoading(true);
        try {
            if (api.refreshReportPrices) {
                await api.refreshReportPrices();
            }
            await loadAll();
        } catch (e) {
            console.error(e);
            setLoading(false);
        }
    };

    // 페이지 진입 시 실시간 데이터로 자동 업데이트
    useEffect(() => {
        let mounted = true;
        handleRefresh().then(() => {
            if (!mounted) return;
        });
        return () => { mounted = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleRebalance = async () => {
        if (runningRebalance) return;
        setRunningRebalance(true);
        setLastRunResult(null);
        try {
            const result = await api.runReportRebalance?.();
            if (result?.success) {
                setLastRunResult("✅ 완료 (유지:" + result.kept + " 탈락:" + result.dropped + " 신규:" + result.added + ")");
            } else {
                setLastRunResult("❌ 실패: " + result?.error);
            }
            await loadAll();
        } catch (e: any) {
            setLastRunResult("❌ 오류: " + e.message);
        } finally {
            setRunningRebalance(false);
        }
    };

    const handleScoutPreview = async () => {
        if (runningScout) return;
        setRunningScout(true);
        try {
            const result = await api.runReportScoutPreview?.();
            if (result?.success && result.candidates?.length > 0) {
                setLastRunResult("🔍 Scout 후보 " + result.candidates.length + "개 발견");
            } else {
                setLastRunResult("🔍 Scout 후보 없음 | " + (result?.error || ''));
            }
        } catch (e: any) {
            setLastRunResult("❌ Scout 오류: " + e.message);
        } finally {
            setRunningScout(false);
        }
    };

    const handleDrop = async (stockCode: string, stockName: string, e: React.MouseEvent) => {
        e.stopPropagation();
        if (!confirm('"' + stockName + '" 을 탈락 처리하시겠습니까?')) return;
        try {
            await api.dropReportItem?.(stockCode, '수동 탈락');
            await loadAll();
        } catch (e: any) {
            alert("오류: " + e.message);
        }
    };

    const handleClearPortfolio = async () => {
        if (!confirm('현재 보유 중인 리포트 매매 종목이 모두 영구 삭제되며 히스토리에 남지 않습니다. 정말 초기화하시겠습니까?')) return;
        try {
            await api.clearReportPortfolio?.();
            await loadAll();
        } catch (e: any) {
            alert("초기화 오류: " + e.message);
        }
    };

    const rateColor = (r: number) => r > 0 ? 'text-red-500' : r < 0 ? 'text-blue-500' : 'text-gray-500';
    const rateBg = (r: number) => r > 0 ? 'bg-red-50 text-red-600' : r < 0 ? 'bg-blue-50 text-blue-600' : 'bg-gray-100 text-gray-600';
    
    const currentAvgReturn = portfolio.length > 0
        ? portfolio.reduce((acc, item) => acc + (item.entry_price > 0 ? ((item.current_price - item.entry_price) / item.entry_price * 100) : 0), 0) / portfolio.length
        : 0;

    // 라이트 모드 상단 탭
    const tabs: { id: SubTab; label: string; icon: any }[] = [
        { id: 'active', label: '보유 종목', icon: Activity },
        { id: 'history', label: '매매 이력', icon: History },
        { id: 'logs', label: '리밸런싱 로그', icon: BarChart2 },
        { id: 'rawdb', label: '리포트 DB', icon: BookOpen },
    ];

    return (
        <div className="flex flex-col h-full bg-slate-50 text-slate-800 font-sans">
            {/* 상단 네비게이션 & 통계 */}
            <div className="flex flex-col bg-white border-b border-slate-200 shadow-sm flex-shrink-0">
                <div className="flex justify-between items-center px-6 py-3 border-b border-slate-100">
                    <div className="flex space-x-6">
                        {tabs.map(t => {
                            const Icon = t.icon;
                            const isActive = activeSubTab === t.id;
                            const btnClass = "flex items-center space-x-2 pb-1 border-b-2 transition-colors " + 
                                (isActive ? "border-blue-600 text-blue-600 font-bold" : "border-transparent text-slate-500 hover:text-slate-700");
                            return (
                                <button
                                    key={t.id}
                                    onClick={() => setActiveSubTab(t.id)}
                                    className={btnClass}
                                >
                                    <Icon size={16} />
                                    <span>{t.label}</span>
                                </button>
                            );
                        })}
                    </div>
                    {/* 우측 요약 통계 */}
                    <div className="flex items-center space-x-4 text-xs">
                        {logs && logs.length > 0 && (
                            <div className="text-slate-400 border-r border-slate-200 pr-4">
                                최근 업데이트: <span className="font-mono">{new Date(logs[0].created_at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                            </div>
                        )}
                        {stats && (
                            <div className="flex space-x-4 text-slate-500">
                                <div title="현재 보유 중인 종목 수">보유 <span className="font-semibold text-slate-800">{stats.activeCount}개</span></div>
                                <div title="현재 보유 종목의 평균 수익률">현재수익률 <span className={"font-semibold " + rateColor(currentAvgReturn)}>{currentAvgReturn > 0 ? '+' : ''}{currentAvgReturn.toFixed(2)}%</span></div>
                                <div className="border-l border-slate-200 pl-4" title="역대 청산 완료된 종목 수">총거래 <span className="font-semibold text-slate-800">{stats.totalTrades}건</span></div>
                                <div title="역대 매매 승률">승률 <span className={"font-semibold " + (stats.winRate >= 50 ? "text-red-500" : "text-blue-500")}>{stats.winRate}%</span></div>
                                <div title="역대 매매 평균 수익률">누적평균 <span className={"font-semibold " + rateColor(stats.avgReturn)}>{stats.avgReturn > 0 ? '+' : ''}{stats.avgReturn.toFixed(2)}%</span></div>
                            </div>
                        )}
                    </div>
                </div>

                {/* 액션 바 */}
                {activeSubTab !== 'rawdb' && (
                    <div className="flex items-center space-x-3 px-6 py-2 bg-slate-50/50">
                        <button
                            onClick={handleRebalance}
                            disabled={runningRebalance}
                            className={"flex items-center space-x-2 px-3 py-1.5 rounded-md text-sm font-semibold text-white transition-colors " + 
                                (runningRebalance ? "bg-slate-400" : "bg-blue-600 hover:bg-blue-700")}
                        >
                            <Play size={14} className={runningRebalance ? "animate-pulse" : ""} />
                            <span>수동 리밸런싱</span>
                        </button>
                        <button
                            onClick={handleScoutPreview}
                            disabled={runningScout}
                            className="flex items-center space-x-2 px-3 py-1.5 rounded-md text-sm font-medium border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                        >
                            <Eye size={14} />
                            <span>Scout 미리보기</span>
                        </button>
                        <button
                            onClick={handleRefresh}
                            className="p-1.5 rounded-md border border-slate-200 bg-white text-slate-500 hover:text-blue-600"
                        >
                            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
                        </button>
                        
                        <div className="flex-grow"></div>
                        <button
                            onClick={handleClearPortfolio}
                            className="flex items-center space-x-1 px-3 py-1.5 rounded-md text-xs font-semibold text-red-500 hover:bg-red-50 border border-red-200"
                            title="현재 보유 중인 종목을 모두 영구 삭제합니다"
                        >
                            <span>보유종목 전체 비우기</span>
                        </button>
                        {lastRunResult && (
                            <div className="ml-4 flex items-center space-x-1 text-xs text-slate-600 bg-white px-3 py-1 rounded-full border border-slate-200">
                                <AlertCircle size={12} className={lastRunResult.includes('❌') ? 'text-red-500' : 'text-green-500'} />
                                <span>{lastRunResult}</span>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* 메인 컨텐츠 영역 */}
            <div className="flex-1 overflow-auto p-6">
                
                {activeSubTab === 'active' && (
                    <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
                        <table className="w-full text-left text-sm whitespace-nowrap">
                            <thead className="bg-slate-50 text-slate-500 text-xs uppercase border-b border-slate-200">
                                <tr>
                                    <th onClick={() => requestSort('entry_date')} className="px-4 py-3 font-semibold cursor-pointer select-none hover:text-slate-700">편입일{renderSortArrow('entry_date')}</th>
                                    <th onClick={() => requestSort('stock_name')} className="px-4 py-3 font-semibold cursor-pointer select-none hover:text-slate-700">종목{renderSortArrow('stock_name')}</th>
                                    <th onClick={() => requestSort('ai_score')} className="px-4 py-3 font-semibold text-center cursor-pointer select-none hover:text-slate-700">점수{renderSortArrow('ai_score')}</th>
                                    <th onClick={() => requestSort('entry_price')} className="px-4 py-3 font-semibold text-right cursor-pointer select-none hover:text-slate-700">진입가{renderSortArrow('entry_price')}</th>
                                    <th onClick={() => requestSort('current_price')} className="px-4 py-3 font-semibold text-right cursor-pointer select-none hover:text-slate-700">현재가{renderSortArrow('current_price')}</th>
                                    <th onClick={() => requestSort('currentReturn')} className="px-4 py-3 font-semibold text-right cursor-pointer select-none hover:text-slate-700">수익률{renderSortArrow('currentReturn')}</th>
                                    <th onClick={() => requestSort('holding_days')} className="px-4 py-3 font-semibold text-center cursor-pointer select-none hover:text-slate-700">보유/목표{renderSortArrow('holding_days')}</th>
                                    <th className="px-4 py-3 font-semibold">AI 사유</th>
                                    <th className="px-4 py-3 text-center">액션</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {portfolio.length === 0 ? (
                                    <tr>
                                        <td colSpan={9} className="px-6 py-12 text-center text-slate-400">보유 종목이 없습니다.</td>
                                    </tr>
                                ) : sortedPortfolio.map(item => {
                                    const ret = item.entry_price > 0 ? ((item.current_price - item.entry_price) / item.entry_price * 100) : 0;
                                    const scoreClass = "px-2 py-0.5 rounded text-xs font-bold " + (item.ai_score >= 80 ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-600");
                                    const retClass = "px-2 py-1 rounded font-bold text-xs " + rateBg(ret);
                                    return (
                                        <tr 
                                            key={item.id} 
                                            onClick={() => setSelectedStock({ stockCode: item.stock_code, stockName: item.stock_name, aiReason: item.ai_entry_reason })}
                                            className="hover:bg-slate-50 transition-colors cursor-pointer"
                                        >
                                            <td className="px-4 py-3 text-xs text-slate-500 font-medium">
                                                {item.entry_date?.slice(5) || '-'}
                                            </td>
                                            <td className="px-4 py-3">
                                                <div className="font-bold text-slate-800">{item.stock_name}</div>
                                                <div className="text-xs text-slate-400">{item.stock_code}</div>
                                            </td>
                                            <td className="px-4 py-3 text-center">
                                                <span className={scoreClass}>
                                                    {item.ai_score}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3 text-right text-slate-500">{item.entry_price.toLocaleString()}</td>
                                            <td className="px-4 py-3 text-right font-medium text-slate-800">{item.current_price.toLocaleString()}</td>
                                            <td className="px-4 py-3 text-right">
                                                <span className={retClass}>
                                                    {ret > 0 ? '+' : ''}{ret.toFixed(2)}%
                                                </span>
                                            </td>
                                            <td className="px-4 py-3 text-center text-xs">
                                                <div className="text-slate-700">{item.holding_days}일</div>
                                                <div className="text-slate-400">/ {item.target_days}일 (+{item.target_return_pct}%)</div>
                                            </td>
                                            <td className="px-4 py-3">
                                                <div className="max-w-[200px] truncate text-xs text-slate-500" title={item.ai_entry_reason}>
                                                    {item.ai_entry_reason}
                                                </div>
                                            </td>
                                            <td className="px-4 py-3 text-center">
                                                <button onClick={(e) => handleDrop(item.stock_code, item.stock_name, e)} className="px-2 py-1 bg-white border border-red-200 text-red-500 rounded text-xs hover:bg-red-50">
                                                    탈락
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}

                {activeSubTab === 'history' && (
                    <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
                        <table className="w-full text-left text-sm whitespace-nowrap">
                            <thead className="bg-slate-50 text-slate-500 text-xs uppercase border-b border-slate-200">
                                <tr>
                                    <th className="px-4 py-3 font-semibold">종목</th>
                                    <th className="px-4 py-3 font-semibold text-right">진입가</th>
                                    <th className="px-4 py-3 font-semibold text-right">청산가</th>
                                    <th className="px-4 py-3 font-semibold text-right">수익률</th>
                                    <th className="px-4 py-3 font-semibold text-center">보유일</th>
                                    <th className="px-4 py-3 font-semibold text-center">유형</th>
                                    <th className="px-4 py-3 font-semibold">청산 사유</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {history.length === 0 ? (
                                    <tr>
                                        <td colSpan={7} className="px-6 py-12 text-center text-slate-400">매매 이력이 없습니다.</td>
                                    </tr>
                                ) : history.map(item => {
                                    const retClass = "px-2 py-1 rounded font-bold text-xs " + rateBg(item.final_return);
                                    const exitTypeClass = "px-2 py-0.5 rounded text-xs font-bold " + (item.exit_type === 'TARGET_HIT' ? "bg-red-100 text-red-600" : "bg-slate-100 text-slate-600");
                                    return (
                                        <tr 
                                            key={item.id} 
                                            onClick={() => setSelectedStock({ stockCode: item.stock_code, stockName: item.stock_name, aiReason: item.ai_exit_reason })}
                                            className="hover:bg-slate-50 transition-colors cursor-pointer"
                                        >
                                            <td className="px-4 py-3">
                                                <div className="font-bold text-slate-800">{item.stock_name}</div>
                                                <div className="text-xs text-slate-400">{item.stock_code}</div>
                                            </td>
                                            <td className="px-4 py-3 text-right text-slate-500">{item.entry_price.toLocaleString()}</td>
                                            <td className="px-4 py-3 text-right text-slate-500">{item.exit_price.toLocaleString()}</td>
                                            <td className="px-4 py-3 text-right">
                                                <span className={retClass}>
                                                    {item.final_return > 0 ? '+' : ''}{item.final_return.toFixed(2)}%
                                                </span>
                                            </td>
                                            <td className="px-4 py-3 text-center text-slate-600 text-xs">{item.holding_days}일</td>
                                            <td className="px-4 py-3 text-center">
                                                <span className={exitTypeClass}>
                                                    {item.exit_type === 'TARGET_HIT' ? '목표달성' : '일반탈락'}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3">
                                                <div className="max-w-[250px] truncate text-xs text-slate-500" title={item.ai_exit_reason}>
                                                    {item.ai_exit_reason}
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}

                {activeSubTab === 'logs' && (
                    <div className="space-y-4">
                        {logs.length === 0 ? (
                            <div className="text-center py-12 text-slate-400">로그가 없습니다.</div>
                        ) : logs.map(log => (
                            <div key={log.id} className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm">
                                <div className="text-sm font-bold text-blue-600 mb-2">{log.run_date}</div>
                                <pre className="text-xs text-slate-600 whitespace-pre-wrap font-mono leading-relaxed bg-slate-50 p-3 rounded border border-slate-100">
                                    {log.log_text}
                                </pre>
                            </div>
                        ))}
                    </div>
                )}

                {activeSubTab === 'rawdb' && (
                    <ReportDashboardTab />
                )}

            </div>
            
            {selectedStock && (
                <StockDetailModal 
                    stockCode={selectedStock.stockCode} 
                    stockName={selectedStock.stockName} 
                    aiReason={selectedStock.aiReason}
                    onClose={() => setSelectedStock(null)} 
                />
            )}
        </div>
    );
}
