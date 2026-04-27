import React, { useState, useEffect } from 'react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';
import { RefreshCw, TrendingUp, Calendar, AlertCircle, X, ExternalLink, Sparkles, Link2, Flame, Target } from 'lucide-react';
import { StockDetailModal } from '../common/StockDetailModal';
import { MegaThemeTab } from './MegaThemeTab';
import { ThemeMockTradingTab } from './ThemeMockTradingTab';

function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

export const ThemeTrackerTab: React.FC<{ onNavigate?: (tabId: string, entityId?: string) => void; initialSelection?: string }> = ({ onNavigate, initialSelection }) => {
    const [activeTab, setActiveTab] = useState<'trend' | 'mega' | 'mock'>('trend');
    const [viewType, setViewType] = useState<string>('BOTH');
    const [themeData, setThemeData] = useState<any>(null);
    const [sectorData, setSectorData] = useState<any>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [selectedItem, setSelectedItem] = useState<any>(null);
    const [selectedStock, setSelectedStock] = useState<{stockCode: string, stockName: string, relatedTheme?: { type: string, name: string }, relatedIssues?: any[]} | null>(null);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    
    // Copilot Verify States
    const [userOpinion, setUserOpinion] = useState<string>('');
    const [isVerifying, setIsVerifying] = useState(false);
    const [copilotFeedback, setCopilotFeedback] = useState<string>('');

    // Follower stocks toggle
    const [showAllStocks, setShowAllStocks] = useState(false);

    // Related News State
    const [relatedNews, setRelatedNews] = useState<any[]>([]);
    const [isNewsLoading, setIsNewsLoading] = useState(false);

    // Graph RAG: Linked Issue Edges
    const [linkedEdges, setLinkedEdges] = useState<any[]>([]);
    
    // 수동 이슈 연결 상태
    const [showLinkForm, setShowLinkForm] = useState(false);
    const [showAllIssues, setShowAllIssues] = useState(false);
    const [activeIssues, setActiveIssues] = useState<any[]>([]);
    const [selectedIssueId, setSelectedIssueId] = useState('');
    const [manualLogicalPath, setManualLogicalPath] = useState('');
    const [isLinking, setIsLinking] = useState(false);

    // AI 원본(Raw) 로그 모달 상태
    const [showRawLogModal, setShowRawLogModal] = useState(false);
    const [rawLogContent, setRawLogContent] = useState<string>('');
    const [isRawLogLoading, setIsRawLogLoading] = useState(false);
    
    // 바텀 팝업 상태
    const [showCopilotPopup, setShowCopilotPopup] = useState(false);
    const [showNewsPopup, setShowNewsPopup] = useState(false);

    const [targetDate, setTargetDate] = useState<string>('');
    
    useEffect(() => {
        const today = new Date().toISOString().split('T')[0];
        setTargetDate(today);
    }, []);

    useEffect(() => {
        if (!targetDate) return;
        loadData();
    }, [targetDate]);

    // 딥 네비게이션: 데이터 로드 완료 후 initialSelection에 해당하는 항목 자동 선택
    useEffect(() => {
        if (!initialSelection || (!themeData && !sectorData)) return;
        const name = initialSelection.toLowerCase();
        
        const allThemes: any[] = themeData?.current ?? [];
        const allSectors: any[] = sectorData?.current ?? [];
        
        let found = null;
        let foundType = '';

        const exactTheme = allThemes.find((t: any) => t.name?.toLowerCase() === name);
        const exactSector = allSectors.find((s: any) => s.name?.toLowerCase() === name);
        const includesTheme = allThemes.find((t: any) => t.name?.toLowerCase().includes(name));
        const includesSector = allSectors.find((s: any) => s.name?.toLowerCase().includes(name));

        if (exactTheme) { found = exactTheme; foundType = 'THEME'; }
        else if (exactSector) { found = exactSector; foundType = 'SECTOR'; }
        else if (includesTheme) { found = includesTheme; foundType = 'THEME'; }
        else if (includesSector) { found = includesSector; foundType = 'SECTOR'; }

        if (found) {
            setSelectedItem({ ...found, type: foundType });
            // DOM 렌더링 후 스크롤
            setTimeout(() => {
                const el = document.getElementById(`theme-item-${found.name}`);
                if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 300);
        }
    }, [initialSelection, themeData, sectorData]);

    useEffect(() => {
        if (!selectedItem) {
            setRelatedNews([]);
            setShowAllStocks(false);
            return;
        }
        setShowAllStocks(false);

        const fetchNews = async () => {
            setIsNewsLoading(true);
            try {
                const api = window.electronAPI as any;
                if (api.getThemeRelatedNews) {
                    const keywords = (selectedItem.top_stocks || []).map((s: any) => s.stock_name);
                    const res = await api.getThemeRelatedNews(selectedItem.name, keywords);
                    if (res.success && res.data) {
                        setRelatedNews(res.data);
                    }
                }
            } catch (e) {
                console.error(e);
            } finally {
                setIsNewsLoading(false);
            }
        };

        fetchNews();
    }, [selectedItem?.name]);

    // Graph RAG: 이 테마/섹터와 연결된 이슈 edges 로드
    useEffect(() => {
        if (!selectedItem) { setLinkedEdges([]); return; }
        const fetchEdges = async () => {
            try {
                const api = window.electronAPI as any;
                if (api.getKnowledgeEdgesTo) {
                    const type = selectedItem.type || 'THEME';
                    const res = await api.getKnowledgeEdgesTo(type, selectedItem.name);
                    if (res.success && res.data) setLinkedEdges(res.data);
                    else setLinkedEdges([]);
                }
            } catch (e) { setLinkedEdges([]); }
        };
        fetchEdges();
    }, [selectedItem?.name]);

    const loadData = async () => {
        setIsLoading(true);
        try {
            const api = window.electronAPI as any;
            if (api.getThemeTrackerData) {
                // 10거래일 (정확히 영업일 기준 2주)로 조회
                const [themeRes, sectorRes] = await Promise.all([
                    api.getThemeTrackerData('THEME', targetDate, 10, 5),
                    api.getThemeTrackerData('SECTOR', targetDate, 10, 5)
                ]);
                
                if (themeRes.success) setThemeData(themeRes.data);
                if (sectorRes.success) setSectorData(sectorRes.data);
            }
        } catch (e) {
            console.error(e);
        } finally {
            setIsLoading(false);
        }
    };

    const handleAnalyze = async () => {
        if (!targetDate) return;
        setIsAnalyzing(true);
        try {
            const api = window.electronAPI as any;
            if (api.analyzeThemes) {
                const res = await api.analyzeThemes(targetDate);
                if (res.success) {
                    await loadData(); // Reload UI with new AI data
                } else {
                    console.error('AI 분석 실패:', res.error);
                }
            }
        } catch (e) {
            console.error(e);
        } finally {
            setIsAnalyzing(false);
        }
    };

    const handleViewRawLog = async () => {
        if (!targetDate) return;
        setShowRawLogModal(true);
        setIsRawLogLoading(true);
        try {
            const api = window.electronAPI as any;
            if (api.getAiDailyRawLog) {
                const res = await api.getAiDailyRawLog(targetDate, 'THEME_INTELLIGENCE');
                if (res.success && res.data) {
                    setRawLogContent(res.data);
                } else {
                    setRawLogContent('해당 날짜의 AI 분석 원본 데이터가 존재하지 않습니다.\n(이 기능이 업데이트된 이후의 분석 기록만 표시됩니다.)');
                }
            } else {
                setRawLogContent('시스템 연결 오류: getAiDailyRawLog를 호출할 수 없습니다.');
            }
        } catch (e: any) {
            setRawLogContent(`데이터를 불러오는 중 오류가 발생했습니다.\n${e.message}`);
        } finally {
            setIsRawLogLoading(false);
        }
    };

    const handleAddLinkClick = async () => {
        if (!showLinkForm) {
            try {
                const api = window.electronAPI as any;
                if (api.getActiveIssues) {
                    const res = await api.getActiveIssues();
                    if (res.success && res.data) {
                        const active = res.data.filter((i: any) => i.status !== 'RESOLVED');
                        setActiveIssues(active);
                        if (active.length > 0) setSelectedIssueId(active[0].id);
                    }
                }
            } catch (e) { console.error(e); }
        }
        setShowLinkForm(!showLinkForm);
    };

    const handleSaveLink = async () => {
        if (!selectedItem || !selectedIssueId) return;
        setIsLinking(true);
        try {
            const api = window.electronAPI as any;
            if (api.upsertKnowledgeEdge) {
                const selectedIssue = activeIssues.find(i => i.id === selectedIssueId);
                const issueName = selectedIssue ? selectedIssue.name : selectedIssueId;
                
                // 기본 인과체인 구성 (미입력시)
                const finalLogicalPath = manualLogicalPath.trim() 
                    ? manualLogicalPath 
                    : `${issueName} -> ${selectedItem.name} 수혜`;

                const edge = {
                    source_type: 'ISSUE',
                    source_id: selectedIssueId,
                    target_type: selectedItem.type || 'THEME',
                    target_id: selectedItem.name,
                    logical_path: finalLogicalPath,
                    weight: 1.0,
                    source_name: issueName
                };
                
                const res = await api.upsertKnowledgeEdge(edge);
                if (res.success) {
                    setManualLogicalPath('');
                    setShowLinkForm(false);
                    // edge 다시 불러오기
                    const edgesRes = await api.getKnowledgeEdgesTo(selectedItem.type, selectedItem.name);
                    if (edgesRes.success && edgesRes.data) setLinkedEdges(edgesRes.data);
                } else {
                    alert('연결 저장 실패: ' + res.error);
                }
            }
        } catch (e) {
            console.error(e);
            alert('연결 중 오류 발생');
        } finally {
            setIsLinking(false);
        }
    };

    const handleSyncPipeline = async () => {
        setIsLoading(true);
        try {
            const api = window.electronAPI as any;
            if (api.runV2Pipeline) {
                // 백엔드의 PL-NaverFlow 를 수동 트리거하여 현재 등락률 포함 최신 데이터를 긁어옴
                await api.runV2Pipeline('PL-NaverFlow', {});
                await loadData(); // 재로딩
            }
        } catch (e) {
            console.error(e);
        } finally {
            setIsLoading(false);
        }
    };

    const handleLiveSearch = async () => {
        if (!selectedItem || !selectedItem.top_stocks || selectedItem.top_stocks.length === 0) return;
        setIsNewsLoading(true);
        try {
            const api = window.electronAPI as any;
            if (api.searchLiveNews) {
                // 상위 1~2개 종목명으로 검색 (Open API 퀄리티를 위해 AND 띄어쓰기보다는 사실 그냥 1등 주도주 위주가 결과가 잘나옴)
                const query = selectedItem.top_stocks.slice(0, 2).map((s:any) => s.stock_name).join(' ');
                const res = await api.searchLiveNews(query);
                if (res.success && res.data) {
                    setRelatedNews(res.data);
                }
            }
        } catch (e) {
            console.error(e);
        } finally {
            setIsNewsLoading(false);
        }
    };

    const handleVerify = async () => {
        if (!selectedItem || !userOpinion.trim()) return;
        setIsVerifying(true);
        setCopilotFeedback('');
        try {
            const api = window.electronAPI as any;
            if (api.verifyThemeIntelligence) {
                const res = await api.verifyThemeIntelligence({
                    date: targetDate,
                    type: selectedItem.type,
                    name: selectedItem.name,
                    userOpinion: userOpinion,
                    currentReason: selectedItem.reason
                });

                if (res.success && res.data) {
                    setCopilotFeedback(res.data.copilotMessage);
                    // Update current selected item state so UI updates
                    setSelectedItem((prev: any) => ({
                        ...prev,
                        reason: res.data.revisedReason,
                        lifespan_type: res.data.newLifespanType,
                        lifespan_reasoning: res.data.newLifespanReasoning
                    }));
                    // Reload background data to reflect in the main table
                    loadData();
                } else {
                    setCopilotFeedback("❌ 검증에 실패했습니다: " + (res.error || "알 수 없는 에러"));
                }
            }
        } catch (e: any) {
            setCopilotFeedback("❌ 시스템 오류: " + e.message);
            console.error(e);
        } finally {
            setIsVerifying(false);
        }
    };

    const COLORS = ['#ef4444', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6'];

    const renderTrendChart = (trendData: any[], topNames: string[]) => {
        if (!trendData || trendData.length === 0) return (
            <div className="flex items-center justify-center h-full text-muted-foreground bg-muted/5 rounded border border-dashed text-xs">
                차트 데이터가 없습니다.
            </div>
        );

        return (
            <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trendData} margin={{ top: 20, right: 20, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" opacity={0.5} />
                    <XAxis 
                        dataKey="date" 
                        tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} 
                        tickFormatter={(val) => val.substring(5)} 
                        stroke="var(--border)"
                    />
                    <YAxis 
                        reversed={true}
                        domain={[1, 'dataMax']} 
                        tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} 
                        stroke="transparent"
                        width={40}
                        allowDecimals={false}
                    />
                    <Tooltip 
                        contentStyle={{ fontSize: '12px', backgroundColor: 'var(--card)', borderColor: 'var(--border)' }}
                        itemStyle={{ fontSize: '11px', fontWeight: 'bold' }}
                        labelStyle={{ color: 'var(--muted-foreground)', marginBottom: '4px' }}
                        formatter={(val: any) => [`${val}위`, '순위']}
                    />
                    <Legend wrapperStyle={{ fontSize: '11px' }} />
                    {topNames.map((name, i) => (
                        <Line key={name} type="monotone" dataKey={name} stroke={COLORS[i % COLORS.length]} strokeWidth={2} dot={{ r: 3, fill: COLORS[i % COLORS.length] }} activeDot={{ r: 5 }} connectNulls={true} />
                    ))}
                </LineChart>
            </ResponsiveContainer>
        );
    };

    const renderDetailPanel = () => {
        if (!selectedItem) return null;
        
        // determine if theme or sector based on where it came from
        const isSector = selectedItem.type === 'SECTOR';
        const dataSource = isSector ? sectorData : themeData;
        const itemHistory = (dataSource?.historyData || [])
            .filter((d: any) => d.name.includes(selectedItem.name) || selectedItem.name.includes(d.name));
            
        return (
            <>
                {/* Backdrop */}
                <div 
                    className="absolute inset-0 bg-background/60 backdrop-blur-sm z-40 transition-opacity" 
                    onClick={() => { setSelectedItem(null); setUserOpinion(''); setCopilotFeedback(''); }} 
                />
                
                {/* Panel */}
                <div className="absolute top-0 right-0 bottom-0 w-[450px] border-l bg-card flex flex-col overflow-hidden shadow-2xl z-50 animate-in slide-in-from-right-8 duration-300">
                    <div className="flex items-center justify-between p-4 border-b bg-muted/10">
                        <div>
                            <div className="flex items-center gap-2">
                                <h2 className="text-base font-bold text-foreground">
                                    {selectedItem.name}
                                </h2>
                                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                                    현재 {selectedItem.rank_num}위
                                </span>
                            </div>
                            <div className="text-xs text-muted-foreground mt-1 flex items-center gap-1.5">
                                {isSector ? '섹터' : '테마'} 트래킹 리포트
                            </div>
                        </div>
                        <button onClick={() => { setSelectedItem(null); setUserOpinion(''); setCopilotFeedback(''); setShowCopilotPopup(false); setShowNewsPopup(false); }} className="p-1.5 hover:bg-muted rounded text-muted-foreground">
                            <X size={16} />
                        </button>
                    </div>

                    <div className="flex-1 overflow-y-auto p-4 space-y-6 pb-24">
                        {/* 듀얼 차트 영역 */}
                        <div className="space-y-4">
                            {/* 1. 모멘텀 궤적 (순위) */}
                            <div className="space-y-2">
                                <h3 className="text-xs font-bold text-muted-foreground flex items-center gap-1.5 uppercase tracking-wider">
                                    <TrendingUp size={14} className="text-purple-500" /> 모멘텀 궤적 (순위)
                                </h3>
                                <div className="h-[140px] w-full border rounded-lg p-2 bg-background flex items-center justify-center shadow-sm">
                                    {itemHistory.length > 0 ? (
                                        <ResponsiveContainer width="100%" height="100%">
                                            <LineChart data={itemHistory} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" opacity={0.3} />
                                                <XAxis dataKey="date" tick={{fontSize: 9}} tickFormatter={v=>v.substring(5)} />
                                                <YAxis reversed domain={[1, 'dataMax']} tick={{fontSize: 9}} width={30} allowDecimals={false} />
                                                <Tooltip contentStyle={{fontSize: '11px'}} labelStyle={{color:'var(--muted-foreground)'}} />
                                                <Line type="monotone" dataKey="rank_num" stroke="#8b5cf6" strokeWidth={2} dot={{r: 3}} activeDot={{r: 5}}/>
                                            </LineChart>
                                        </ResponsiveContainer>
                                    ) : (
                                        <span className="text-xs text-muted-foreground">차트 이력이 부족합니다.</span>
                                    )}
                                </div>
                            </div>

                            {/* 2. 주도주 Price 흐름 (하이브리드 인덱스) */}
                            <div className="space-y-2">
                                <h3 className="text-xs font-bold text-muted-foreground flex items-center gap-1.5 uppercase tracking-wider">
                                    <TrendingUp size={14} className="text-emerald-500" /> 주도주 Price 흐름 (누적 인덱스)
                                </h3>
                                <div className="h-[140px] w-full border rounded-lg p-2 bg-background flex items-center justify-center shadow-sm relative">
                                    {(() => {
                                        const baseHistory = selectedItem.price_index_history || [];
                                        
                                        // 1. 당일 Live 인덱스 계산 (dataSource.date 기준으로 판단)
                                        let liveIndex = null;
                                        if (selectedItem.top_stocks && selectedItem.top_stocks.length > 0 && dataSource?.date) {
                                            const todayAvgChangeRate = selectedItem.top_stocks.reduce((acc: number, s: any) => acc + (s.change_rate || 0), 0) / selectedItem.top_stocks.length;
                                            const lastData = baseHistory.length > 0 ? baseHistory[baseHistory.length - 1] : { price_index: 100.0, date: '' };
                                            
                                            if (lastData.date !== dataSource.date) {
                                                liveIndex = parseFloat((lastData.price_index * (1 + todayAvgChangeRate / 100)).toFixed(2));
                                            }
                                        }

                                        // 2. 상단 모멘텀 차트의 기간(itemHistory)에 맞추어 스케일링
                                        const alignedIndexHistory = itemHistory.map((histOption: any) => {
                                            const histDate = histOption.date;
                                            const matchedDB = baseHistory.find((b: any) => b.date === histDate);

                                            // 오늘(Target Date)인 경우 Live 계산치 오버라이드 (혹은 DB값 사용)
                                            if (histDate === dataSource?.date) {
                                                if (liveIndex !== null) {
                                                    return { date: histDate, price_index: liveIndex, isLive: true };
                                                }
                                            }
                                            
                                            // DB에 있던 날짜
                                            if (matchedDB) {
                                                return { date: histDate, price_index: matchedDB.price_index, isLive: false };
                                            }

                                            // 비어있는 날짜 배열 맞춤 (null)
                                            return { date: histDate, price_index: null, isLive: false };
                                        });

                                        return alignedIndexHistory.length > 0 ? (
                                            <ResponsiveContainer width="100%" height="100%">
                                                <LineChart data={alignedIndexHistory} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" opacity={0.3} />
                                                    <XAxis dataKey="date" tick={{fontSize: 9}} tickFormatter={v => v.substring(5)} />
                                                    <YAxis domain={['dataMin - 1', 'dataMax + 1']} tick={{fontSize: 9}} width={35} tickFormatter={v => v ? v.toFixed(0) : ''} />
                                                    <Tooltip 
                                                        contentStyle={{fontSize: '11px', backgroundColor: 'var(--card)', borderColor: 'var(--border)'}} 
                                                        formatter={(val: any) => [val?.toFixed(2), 'Index']}
                                                        labelFormatter={(label) => `일자: ${label}`}
                                                    />
                                                    <Line 
                                                        type="monotone" 
                                                        dataKey="price_index" 
                                                        stroke="#10b981" 
                                                        strokeWidth={2} 
                                                        connectNulls={true}
                                                        dot={(props: any) => {
                                                            const { cx, cy, payload } = props;
                                                            if (payload.price_index === null) return <React.Fragment key={`dot-${cx}`} />;
                                                            return payload.isLive
                                                              ? <circle key={`dot-${cx}`} cx={cx} cy={cy} r={4} fill="#10b981" stroke="var(--background)" strokeWidth={2} className="animate-pulse shadow-glow" /> 
                                                              : <circle key={`dot-${cx}`} cx={cx} cy={cy} r={2.5} fill="#10b981" />;
                                                        }}
                                                        activeDot={{r: 5}} 
                                                    />
                                                </LineChart>
                                            </ResponsiveContainer>
                                        ) : (
                                            <span className="text-xs text-muted-foreground">인덱스 데이터가 아직 구축되지 않았습니다.</span>
                                        );
                                    })()}
                                </div>
                            </div>
                        </div>

                        {(() => {
                            if (!selectedItem.top_stocks || selectedItem.top_stocks.length === 0) return null;
                            const themeRate = selectedItem.change_rate || 0;
                            const leaders: any[] = [];
                            const followers: any[] = [];
                            
                            selectedItem.top_stocks.forEach((s: any) => {
                                if (s.change_rate == null) {
                                    followers.push(s);
                                    return;
                                }
                                
                                if (s.change_rate >= 15.0) {
                                    leaders.push(s);
                                } else if (s.change_rate > themeRate && leaders.length < 5) {
                                    leaders.push(s);
                                } else {
                                    followers.push(s);
                                }
                            });
                            
                            return (
                                <div className="space-y-4 pt-2">
                                    <h3 className="text-xs font-bold text-muted-foreground flex items-center gap-1.5 uppercase tracking-wider">
                                        <Sparkles size={14} className="text-primary" /> 소속 종목 리스트
                                    </h3>
                                    
                                    {leaders.length > 0 && (
                                        <div className="space-y-2">
                                            <div className="text-[10px] text-foreground/70 font-semibold px-1">🔥 핵심 주도주 (테마/섹터 견인)</div>
                                            <div className="flex flex-wrap items-center gap-2">
                                                {leaders.map((stock: any) => (
                                                    <button 
                                                        key={stock.stock_code} 
                                                        className="group flex items-center gap-1.5 text-[12px] bg-muted/40 hover:bg-muted/80 text-foreground px-3 py-1.5 rounded-full border border-primary/20 hover:border-primary/50 transition-colors cursor-pointer"
                                                        onClick={() => setSelectedStock({ 
                                                            stockCode: stock.stock_code, 
                                                            stockName: stock.stock_name,
                                                            relatedTheme: { type: selectedItem.type || 'THEME', name: selectedItem.name },
                                                            relatedIssues: linkedEdges || []
                                                        })}
                                                    >
                                                        <span className="font-bold">
                                                            {stock.stock_name}
                                                        </span>
                                                        {stock.change_rate != null && (
                                                            <span className={cn("text-[10px] font-bold font-mono tracking-tighter", stock.change_rate > 0 ? "text-red-500" : stock.change_rate < 0 ? "text-blue-500" : "text-muted-foreground")}>
                                                                {stock.change_rate > 0 ? '+' : ''}{stock.change_rate}%
                                                            </span>
                                                        )}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                    
                                    {followers.length > 0 && (
                                        <div className="space-y-2 mt-2">
                                            <div className="flex items-center justify-between px-1">
                                                <div className="text-[10px] text-muted-foreground/70 font-semibold">기타 소속 종목 ({followers.length})</div>
                                                <button 
                                                    onClick={() => setShowAllStocks(!showAllStocks)}
                                                    className="text-[10px] text-indigo-500 hover:text-indigo-400 font-semibold"
                                                >
                                                    {showAllStocks ? '숨기기' : '더보기 ▼'}
                                                </button>
                                            </div>
                                            {showAllStocks && (
                                                <div className="flex flex-wrap items-center gap-1.5 animate-in fade-in slide-in-from-top-1 duration-200">
                                                    {followers.map((stock: any) => (
                                                        <button 
                                                            key={stock.stock_code} 
                                                            className="group flex items-center gap-1 text-[11px] bg-muted/20 hover:bg-muted/40 text-muted-foreground hover:text-foreground px-2 py-1 rounded-md border border-border/30 transition-colors cursor-pointer"
                                                            onClick={() => setSelectedStock({ 
                                                                stockCode: stock.stock_code, 
                                                                stockName: stock.stock_name,
                                                                relatedTheme: { type: selectedItem.type || 'THEME', name: selectedItem.name },
                                                                relatedIssues: linkedEdges || []
                                                            })}
                                                        >
                                                            <span>{stock.stock_name}</span>
                                                            {stock.change_rate != null && (
                                                                <span className={cn("text-[9px] font-mono", stock.change_rate > 0 ? "text-red-500/70" : stock.change_rate < 0 ? "text-blue-500/70" : "text-muted-foreground/50")}>
                                                                    {stock.change_rate > 0 ? '+' : ''}{stock.change_rate}%
                                                                </span>
                                                            )}
                                                        </button>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        })()}

                        {/* 연결된 이슈 (Flat style) */}
                        <div className="space-y-3 pt-4 border-t border-border/50">
                            <div className="flex items-center justify-between">
                                <h3 className="text-[11px] font-bold text-muted-foreground flex items-center gap-1.5 uppercase tracking-wider">
                                    <Link2 size={13} className="text-indigo-400" /> ISSUE
                                </h3>
                                <button onClick={handleAddLinkClick} className="flex items-center gap-1 text-[10px] font-semibold text-indigo-500 hover:text-indigo-400 transition-colors">
                                    {showLinkForm ? '닫기' : '+ 연결 추가'}
                                </button>
                            </div>

                            {/* 직접 연결 폼 */}
                            {showLinkForm && (
                                <div className="p-3 bg-indigo-500/5 border border-indigo-500/20 rounded-lg space-y-3 animate-in fade-in slide-in-from-top-2 duration-200">
                                    <div className="space-y-1.5">
                                        <label className="text-[11px] font-bold text-foreground">활성 이슈 선택</label>
                                        <select 
                                            value={selectedIssueId}
                                            onChange={(e) => setSelectedIssueId(e.target.value)}
                                            className="w-full text-[12px] bg-background border border-border/50 rounded p-1.5 focus:border-indigo-500 outline-none"
                                        >
                                            {activeIssues.length === 0 && <option value="">(진행 중인 이슈 없음)</option>}
                                            {activeIssues.map(issue => (
                                                <option key={issue.id} value={issue.id}>{issue.name}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div className="space-y-1.5">
                                        <label className="flex items-center justify-between text-[11px] font-bold text-foreground">
                                            <span>인과 체인 (선택)</span>
                                            <span className="text-[9px] text-muted-foreground font-normal">미입력시 자동 생성</span>
                                        </label>
                                        <input 
                                            type="text"
                                            value={manualLogicalPath}
                                            onChange={(e) => setManualLogicalPath(e.target.value)}
                                            placeholder={`예: 이슈명 -> ${selectedItem.name} 수혜`}
                                            className="w-full text-[12px] bg-background border border-border/50 rounded p-1.5 focus:border-indigo-500 outline-none placeholder:text-muted-foreground/50"
                                        />
                                    </div>
                                    <button
                                        onClick={handleSaveLink}
                                        disabled={isLinking || !selectedIssueId}
                                        className="w-full py-1.5 bg-indigo-500 hover:bg-indigo-600 text-white text-[11px] font-bold rounded transition-colors disabled:opacity-50"
                                    >
                                        {isLinking ? '연결 중...' : '확인'}
                                    </button>
                                </div>
                            )}

                            {linkedEdges.length > 0 ? (
                                <div className="flex flex-col gap-1">
                                    {(showAllIssues ? linkedEdges : linkedEdges.slice(0, 2)).map((edge: any, i: number) => {
                                        const chainNodes: string[] = edge.logical_path
                                            ? edge.logical_path.split(/→|->/).map((s: string) => s.trim()).filter(Boolean)
                                            : [];
                                        
                                        const updateDate = edge.issue_updated_date ? edge.issue_updated_date.split('T')[0] : '';
                                        const dateStr = updateDate || edge.source_id;

                                        return (
                                            <div key={i} className="flex flex-col justify-center">
                                                <button
                                                    onClick={() => onNavigate?.('issue-agent', edge.source_id)}
                                                    className="group flex flex-col items-start gap-0.5 py-1.5 px-2 rounded-lg hover:bg-muted/30 transition-all text-left"
                                                >
                                                    <span className="text-[11px] font-bold text-muted-foreground group-hover:text-primary transition-colors">
                                                        {dateStr}
                                                    </span>
                                                    {chainNodes.length > 0 ? (
                                                        <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                                                            {chainNodes.map((node: string, ni: number) => (
                                                                <React.Fragment key={ni}>
                                                                    <span className="text-[13px] font-medium text-foreground">
                                                                        {node}
                                                                    </span>
                                                                    {ni < chainNodes.length - 1 && (
                                                                        <span className="text-muted-foreground/50 text-[10px]">→</span>
                                                                    )}
                                                                </React.Fragment>
                                                            ))}
                                                        </div>
                                                    ) : (
                                                        <span className="text-[13px] font-medium text-foreground">{edge.source_name || edge.source_id}</span>
                                                    )}
                                                </button>
                                            </div>
                                        );
                                    })}

                                    {linkedEdges.length > 2 && (
                                        <div className="flex items-center justify-between text-[11px] text-muted-foreground mt-1 px-2 pb-1">
                                            <span>과거 이슈 ({linkedEdges.length - 2})</span>
                                            <button 
                                                onClick={() => setShowAllIssues(!showAllIssues)}
                                                className="text-[10px] text-indigo-500 hover:text-indigo-400 font-semibold transition-colors"
                                            >
                                                {showAllIssues ? '접기 ▲' : '더보기 ▼'}
                                            </button>
                                        </div>
                                    )}
                                </div>
                            ) : (
                                !showLinkForm && (
                                    <div className="text-[11.5px] text-muted-foreground italic px-3 py-4 text-center">
                                        현재 연관된 거시 이슈가 없습니다.
                                    </div>
                                )
                            )}
                        </div>

                        {/* AI 역대 브리핑 (타임라인) */}
                        <div className="space-y-3 pt-4 border-t border-border/50">
                            <h3 className="text-[11px] font-bold text-muted-foreground flex items-center gap-1.5 tracking-wider uppercase">
                                <Sparkles size={13} className="text-amber-500" /> 타임라인
                            </h3>
                            
                            <div className="space-y-3">
                                {itemHistory.filter((i:any) => i.reason).slice(0, 5).map((history: any, idx: number) => {
                                    const displayDate = history.date ? history.date.substring(5).replace('-', '/') : '';
                                    return (
                                        <div key={idx} className="flex flex-col gap-1 pb-3 border-b border-border/10 last:border-0 last:pb-0">
                                            <span className="font-bold text-[12px] text-blue-500 mb-0.5">{displayDate}</span>
                                            {(() => {
                                                const match = String(history.reason || '').match(/^\[(.*?)\]\s*(.*)$/s);
                                                if (match) {
                                                    return (
                                                        <>
                                                            <div className="font-bold text-[13px] text-foreground">{match[1].trim()}</div>
                                                            <div className="text-[12px] text-muted-foreground leading-relaxed whitespace-pre-wrap mt-0.5">
                                                                {match[2].trim()}
                                                            </div>
                                                        </>
                                                    );
                                                }
                                                return (
                                                    <div className="text-[13px] text-foreground leading-relaxed whitespace-pre-wrap">
                                                        {history.reason}
                                                    </div>
                                                );
                                            })()}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>

                    {/* Copilot Popup */}
                    {showCopilotPopup && (
                        <div className="absolute bottom-16 left-0 right-0 bg-card border-t shadow-lg border-x mx-0 px-4 py-4 z-20 animate-in slide-in-from-bottom-5">
                            <div className="flex justify-between items-center mb-3">
                                <h3 className="text-xs font-bold text-foreground flex items-center gap-1.5 uppercase">
                                    <Sparkles size={14} className="text-purple-500" /> 코파일럿 심층 검증
                                </h3>
                                <button onClick={() => setShowCopilotPopup(false)} className="text-muted-foreground hover:text-foreground">
                                    <X size={14} />
                                </button>
                            </div>
                            <div className="space-y-3">
                                <div className="flex flex-col gap-2 relative">
                                    <textarea
                                        value={userOpinion}
                                        onChange={e => setUserOpinion(e.target.value)}
                                        placeholder="반박하고 싶은 개인 의견이나 팩트를 적어주세요."
                                        disabled={isVerifying}
                                        className="w-full h-20 bg-background border border-border/80 rounded text-xs p-2.5 outline-none focus:border-primary/50 resize-none"
                                    />
                                    <button 
                                        onClick={handleVerify} 
                                        disabled={isVerifying || !userOpinion.trim()}
                                        className="self-end px-3 py-1.5 bg-primary/10 text-primary hover:bg-primary/20 hover:text-primary border border-primary/20 rounded font-bold text-xs disabled:opacity-50 transition-colors flex items-center gap-1.5"
                                    >
                                        {isVerifying ? <RefreshCw size={12} className="animate-spin" /> : <Sparkles size={12} />}
                                        {isVerifying ? '팩트체크 재검증 중...' : '확인'}
                                    </button>
                                </div>
                                {copilotFeedback && (
                                    <div className="mt-2 bg-gradient-to-br from-purple-500/10 to-blue-500/5 border border-purple-500/20 rounded-lg p-3 text-xs text-foreground leading-relaxed">
                                        <div className="font-bold text-purple-600 mb-1 flex items-center gap-1.5">
                                            <Sparkles size={12} /> 피드백 결과
                                        </div>
                                        {copilotFeedback}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* News Popup */}
                    {showNewsPopup && (
                        <div className="absolute bottom-16 left-0 right-0 h-[300px] overflow-y-auto bg-card border-t shadow-lg border-x mx-0 px-4 py-4 z-20 animate-in slide-in-from-bottom-5">
                            <div className="flex justify-between items-center mb-3">
                                <h3 className="text-xs font-bold text-foreground flex items-center gap-1.5 uppercase">
                                    <ExternalLink size={14} className="text-blue-500" /> 연관 뉴스
                                </h3>
                                <div className="flex items-center gap-2">
                                    <button 
                                        onClick={handleLiveSearch} 
                                        disabled={isNewsLoading || !selectedItem?.top_stocks?.length}
                                        className="px-2.5 py-1 text-[10px] font-bold bg-muted hover:bg-muted/80 text-foreground border rounded transition-colors disabled:opacity-50 flex items-center gap-1 shadow-sm"
                                    >
                                        {isNewsLoading ? <RefreshCw size={10} className="animate-spin text-primary" /> : <Sparkles size={10} className="text-amber-500" />}
                                        실시간 검색
                                    </button>
                                    <button onClick={() => setShowNewsPopup(false)} className="text-muted-foreground hover:text-foreground">
                                        <X size={14} />
                                    </button>
                                </div>
                            </div>
                            <div className="space-y-2 relative">
                                {isNewsLoading ? (
                                    <div className="text-xs text-muted-foreground flex items-center justify-center h-20 gap-2">
                                        <RefreshCw size={14} className="animate-spin text-primary" /> 로딩 중...
                                    </div>
                                ) : relatedNews.length > 0 ? (
                                    <div className="flex flex-col gap-2">
                                        {relatedNews.map((news, idx) => (
                                            <a 
                                                key={idx} 
                                                href={news.url} 
                                                target="_blank" 
                                                rel="noreferrer"
                                                className="block p-3 rounded-lg border bg-background hover:bg-muted/30 transition-all group shadow-sm"
                                            >
                                                <div className="text-[12px] font-bold text-foreground line-clamp-2 leading-snug group-hover:text-primary transition-colors">
                                                    {news.title}
                                                </div>
                                                <div className="flex items-center gap-2 mt-2 text-[10px] text-muted-foreground">
                                                    <span className="px-1.5 py-0.5 bg-muted rounded font-semibold text-foreground/70">{news.source}</span>
                                                    <span>{news.date ? news.date.slice(11, 16) || news.date : ''}</span>
                                                </div>
                                            </a>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="text-[11px] text-muted-foreground text-center py-6 bg-muted/10 rounded-lg border border-dashed flex flex-col items-center gap-2">
                                        <AlertCircle size={14} className="opacity-50" />
                                        뉴스가 없습니다. 실시간 검색을 눌러보세요.
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* 하단 고정 버튼 */}
                    <div className="absolute bottom-0 left-0 right-0 border-t bg-card/95 backdrop-blur-md p-3 flex gap-2 z-30">
                        <button 
                            onClick={() => { setShowCopilotPopup(!showCopilotPopup); setShowNewsPopup(false); }}
                            className={cn(
                                "flex-1 py-2.5 rounded-lg text-[12px] font-bold border transition-colors flex items-center justify-center gap-1.5",
                                showCopilotPopup ? "bg-purple-500 border-purple-500 text-white" : "bg-background hover:bg-muted text-foreground border-border/80"
                            )}
                        >
                            <Sparkles size={14} className={showCopilotPopup ? "text-white" : "text-purple-500"} />
                            AI 코파일럿 검증
                        </button>
                        <button 
                            onClick={() => { setShowNewsPopup(!showNewsPopup); setShowCopilotPopup(false); }}
                            className={cn(
                                "flex-1 py-2.5 rounded-lg text-[12px] font-bold border transition-colors flex items-center justify-center gap-1.5",
                                showNewsPopup ? "bg-blue-500 border-blue-500 text-white" : "bg-background hover:bg-muted text-foreground border-border/80"
                            )}
                        >
                            <ExternalLink size={14} className={showNewsPopup ? "text-white" : "text-blue-500"} />
                            연관 뉴스
                        </button>
                    </div>

                </div>
            </>
        );
    };

    const renderBoard = (data: any, title: string, type: string) => {
        return (
            <div className="flex flex-col gap-4 flex-1 min-w-0">
                {/* Chart */}
                <div className="border border-border/60 rounded-xl overflow-hidden shadow-sm bg-card shrink-0">
                    <div className="px-4 py-2 border-b bg-muted/5 flex items-center justify-between">
                        <h2 className="text-sm font-bold flex items-center gap-2">
                            <TrendingUp size={14} className="text-primary" />
                            {title} 트렌드 차트 (Top 5)
                        </h2>
                    </div>
                    <div className="p-2 h-[200px]">
                        {renderTrendChart(data?.trendData || [], data?.topNames || [])}
                    </div>
                </div>

                {/* Table */}
                <div className="border border-border/60 rounded-xl overflow-hidden shadow-sm bg-card flex-1 flex flex-col min-h-0">
                    <div className="px-4 py-2 border-b bg-muted/5 flex items-center justify-between shrink-0">
                        <h2 className="text-sm font-bold flex items-center gap-2">
                            <TrendingUp size={14} className="text-primary" />
                            {title} 실시간 랭킹
                        </h2>
                        <span className="text-[9px] text-muted-foreground font-mono bg-muted px-2 py-0.5 rounded">
                            {data?.date || '데이터 없음'}
                        </span>
                    </div>
                    <div className="overflow-y-auto flex-1">
                        <table className="w-full text-left border-collapse">
                            <thead className="sticky top-0 bg-muted/10 backdrop-blur z-10 border-b">
                                <tr className="text-muted-foreground text-[10px] uppercase tracking-wider">
                                    <th className="font-semibold py-2 px-3 w-12 text-center">-</th>
                                    <th className="font-semibold py-2 px-3 w-16 text-center">변동</th>
                                    <th className="font-semibold py-2 px-3">{title}명</th>
                                    <th className="font-semibold py-2 px-3 text-right">당일</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border/40">
                                {(data?.current || []).map((row: any) => (
                                    <tr 
                                        key={row.name}
                                        id={`theme-item-${row.name}`}
                                        onClick={() => {
                                            setSelectedItem({...row, type});
                                            setUserOpinion('');
                                            setCopilotFeedback('');
                                        }}
                                        className={cn(
                                            "hover:bg-muted/20 cursor-pointer transition-colors group",
                                            selectedItem?.name === row.name ? "bg-primary/5 ring-1 ring-primary/20" : ""
                                        )}
                                    >
                                        <td className="py-2.5 px-3 text-center font-bold text-foreground text-xs">
                                            {row.rank_num}
                                        </td>
                                        <td className="py-2.5 px-3 text-center">
                                            <span className={cn(
                                                "text-[9px] px-1 py-0.5 rounded font-bold border",
                                                row.changeStr.includes('▲') ? "text-red-500 bg-red-500/10 border-red-500/20" :
                                                row.changeStr.includes('▼') ? "text-blue-500 bg-blue-500/10 border-blue-500/20" :
                                                row.changeStr === 'NEW' ? "text-amber-500 bg-amber-500/10 border-amber-500/20" :
                                                "text-muted-foreground bg-muted border-border"
                                            )}>
                                                {row.changeStr}
                                            </span>
                                        </td>
                                        <td className="py-2.5 px-3 w-full pr-4">
                                            <div className="font-bold text-foreground group-hover:text-primary transition-colors text-sm truncate w-full" title={row.name}>
                                                {row.name}
                                                {row.lifespan_type && (
                                                    <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded border bg-muted/50 text-muted-foreground">
                                                        {row.lifespan_type.includes('단기') ? '⚡' : row.lifespan_type.includes('메가') ? '🚀' : '•'}
                                                    </span>
                                                )}
                                            </div>
                                            {(row.reason || (row.top_stocks && row.top_stocks.length > 0)) && (
                                                <div className="text-[11px] text-muted-foreground mt-1.5 text-wrap w-full leading-tight flex flex-col gap-1">
                                                    {row.top_stocks && row.top_stocks.length > 0 && (
                                                        <span className="text-primary/90 font-bold" title={`전체 소속 종목: ${row.top_stocks.slice(0, 10).map((s:any)=>s.stock_name).join(', ')}${row.top_stocks.length > 10 ? ` 외 ${row.top_stocks.length - 10}개` : ''}`}>
                                                            🎯 {row.top_stocks.slice(0, 3).map((s:any) => 
                                                                `${s.stock_name}${s.change_rate != null ? `(${s.change_rate > 0 ? '+' : ''}${s.change_rate}%)` : ''}`
                                                            ).join(', ')}
                                                        </span>
                                                    )}
                                                    {row.reason && (
                                                        <span className="opacity-80 line-clamp-2 leading-relaxed">
                                                            {row.reason.replace(/[*_`]/g, '')}
                                                        </span>
                                                    )}
                                                </div>
                                            )}
                                        </td>
                                        <td className="py-2.5 px-3 text-right">
                                            <span className={cn(
                                                "font-mono font-bold text-xs",
                                                row.change_rate > 0 ? "text-red-500" : row.change_rate < 0 ? "text-blue-500" : "text-muted-foreground"
                                            )}>
                                                {row.change_rate > 0 ? '+' : ''}{row.change_rate.toFixed(2)}%
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        {(!data?.current || data.current.length === 0) && (
                            <div className="py-10 text-center text-muted-foreground text-xs flex flex-col items-center gap-2">
                                <AlertCircle size={20} className="opacity-50" />
                                테이터가 없습니다.
                            </div>
                        )}
                    </div>
                </div>
            </div>
        )
    }

    return (
        <div className="flex w-full h-full bg-background overflow-hidden text-sm relative">

            <div className={cn("flex-1 flex flex-col min-w-0 transition-all duration-300")}>

                {/* ─── 탭 네비게이션 바 ─────────────────────────── */}
                <div className="px-5 py-0 border-b bg-muted/5 flex items-center justify-between shrink-0">
                    <div className="flex items-center gap-0">
                        <button
                            onClick={() => setActiveTab('trend')}
                            className={cn(
                                'flex items-center gap-2 px-4 py-3 text-xs font-bold border-b-2 transition-colors',
                                activeTab === 'trend'
                                    ? 'border-primary text-primary'
                                    : 'border-transparent text-muted-foreground hover:text-foreground'
                            )}
                        >
                            <TrendingUp size={13} />
                            시장 주도 트렌드
                        </button>
                        <button
                            onClick={() => setActiveTab('mega')}
                            className={cn(
                                'flex items-center gap-2 px-4 py-3 text-xs font-bold border-b-2 transition-colors',
                                activeTab === 'mega'
                                    ? 'border-red-400 text-red-400'
                                    : 'border-transparent text-muted-foreground hover:text-foreground'
                            )}
                        >
                            <Flame size={13} />
                            메가 테마 관리
                        </button>
                        <button
                            onClick={() => setActiveTab('mock')}
                            className={cn(
                                'flex items-center gap-2 px-4 py-3 text-xs font-bold border-b-2 transition-colors',
                                activeTab === 'mock'
                                    ? 'border-emerald-500 text-emerald-500'
                                    : 'border-transparent text-muted-foreground hover:text-foreground'
                            )}
                        >
                            <Target size={13} />
                            모의매매 <span className="ml-1 px-1.5 py-0.5 rounded text-[9px] bg-emerald-500/20 text-emerald-500">NEW</span>
                        </button>
                    </div>

                    {/* 모의매매 전용 툴바 */}
                    {activeTab === 'mock' && (
                        <div className="flex items-center gap-4 py-2">
                            <button
                                className={cn(
                                    'flex items-center gap-2 px-3 py-1.5 border rounded text-xs font-bold transition-colors shadow-sm',
                                    'bg-emerald-500/10 text-emerald-600 border-emerald-500/20 hover:bg-emerald-500/20 hover:border-emerald-500/40'
                                )}
                                title="오늘 일자의 모의매매 종목을 AI로 수동 추출합니다."
                            >
                                <Sparkles size={13} />
                                종목 추출 수동실행
                            </button>
                        </div>
                    )}

                    {/* 탭 1 전용 툴바 — 탭 1 활성 시에만 표시 */}
                    {activeTab === 'trend' && (
                        <div className="flex items-center gap-4 py-2">
                            <button
                                onClick={handleViewRawLog}
                                className="flex items-center gap-2 px-3 py-1.5 border rounded text-xs font-bold transition-colors shadow-sm bg-emerald-500/10 text-emerald-500 border-emerald-500/20 hover:bg-emerald-500/20 hover:border-emerald-500/40"
                                title="오늘 일자 기준 AI 분석 원본 데이터 보기"
                            >
                                <Sparkles size={13} />
                                AI 데이터 전문
                            </button>
                            <div className="flex items-center gap-2 px-3 py-1.5 bg-background border rounded-md text-xs">
                                <Calendar size={13} className="text-muted-foreground" />
                                <input
                                    type="date"
                                    value={targetDate}
                                    onChange={(e) => setTargetDate(e.target.value)}
                                    className="bg-transparent border-none outline-none font-mono text-muted-foreground hover:text-foreground focus:text-foreground"
                                />
                            </div>
                            <button
                                onClick={handleSyncPipeline}
                                disabled={isLoading || isAnalyzing}
                                className={cn(
                                    'flex items-center gap-2 px-3 py-1.5 border rounded text-xs font-bold transition-colors shadow-sm',
                                    'bg-primary/10 text-primary border-primary/20 hover:bg-primary/20 hover:border-primary/40'
                                )}
                                title="네이버 테마/섹터 원본 최신 데이터로 동기화"
                            >
                                <RefreshCw size={13} className={isLoading && !isAnalyzing ? 'animate-spin' : ''} />
                                데이터 동기화
                            </button>
                            <button
                                onClick={handleAnalyze}
                                disabled={isAnalyzing || isLoading}
                                className={cn(
                                    'flex items-center gap-2 px-3 py-1.5 border rounded text-xs font-bold transition-colors shadow-sm',
                                    isAnalyzing
                                        ? 'bg-amber-500/10 text-amber-600 border-amber-500/30 font-semibold'
                                        : 'bg-gradient-to-r from-amber-500/10 to-orange-500/10 text-amber-600 border-amber-500/20 hover:bg-amber-500/20 hover:border-amber-500/40'
                                )}
                            >
                                <Sparkles size={13} className={isAnalyzing ? 'animate-pulse' : ''} />
                                {isAnalyzing ? '분석 중...' : 'AI 분석 실행'}
                            </button>
                            <button
                                onClick={loadData}
                                disabled={isLoading}
                                className="p-1.5 border rounded bg-background hover:bg-muted text-muted-foreground transition-colors"
                            >
                                <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
                            </button>
                        </div>
                    )}
                </div>

                {/* ─── 탭 1: 시장 주도 트렌드 (기존 뷰) ──────────── */}
                {activeTab === 'trend' && (
                    <>
                        {isLoading && (!themeData && !sectorData) ? (
                            <div className="flex-1 flex items-center justify-center p-8 text-muted-foreground">
                                <RefreshCw className="animate-spin mr-2" size={16} /> 데이터를 불러오는 중...
                            </div>
                        ) : (
                            <div className="flex-1 overflow-hidden p-5 flex gap-5">
                               {renderBoard(themeData, '테마', 'THEME')}
                               {renderBoard(sectorData, '섹터', 'SECTOR')}
                            </div>
                        )}
                    </>
                )}

                {/* ─── 탭 2: 메가 테마 관리 (신규) ─────────────────── */}
                {activeTab === 'mega' && (
                    <div className="flex-1 overflow-hidden">
                        <MegaThemeTab onNavigate={onNavigate} />
                    </div>
                )}

                {/* ─── 탭 3: 모의매매 (신규 목업) ─────────────────── */}
                {activeTab === 'mock' && (
                    <div className="flex-1 overflow-hidden">
                        <ThemeMockTradingTab />
                    </div>
                )}

            </div>

            {/* 탭 1 전용 — 상세 패널 + 모달들 */}
            {activeTab === 'trend' && (
                <>
                    {renderDetailPanel()}

                    {selectedStock && (
                        <StockDetailModal
                            stockCode={selectedStock.stockCode}
                            stockName={selectedStock.stockName}
                            relatedTheme={selectedStock.relatedTheme}
                            relatedIssues={selectedStock.relatedIssues}
                            onClose={() => setSelectedStock(null)}
                        />
                    )}

                    {/* AI 원본 로그 모달 */}
                    {showRawLogModal && (
                        <div className="fixed inset-0 z-[100] flex items-center justify-center">
                            <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" onClick={() => setShowRawLogModal(false)} />
                            <div className="relative w-full max-w-4xl h-[80vh] flex flex-col bg-card border border-border/50 rounded-xl shadow-2xl animate-in fade-in zoom-in-95 duration-200">
                                <div className="flex items-center justify-between px-5 py-4 border-b border-border/50 bg-muted/10 shrink-0">
                                    <div className="flex items-center gap-2">
                                        <Sparkles className="w-5 h-5 text-emerald-500" />
                                        <h2 className="text-lg font-bold text-foreground">AI 분석 원본 결과 (Raw Response)</h2>
                                        <span className="ml-2 px-2 py-0.5 text-xs font-mono bg-muted text-muted-foreground rounded">{targetDate}</span>
                                    </div>
                                    <button onClick={() => setShowRawLogModal(false)} className="p-1.5 hover:bg-muted rounded text-muted-foreground transition-colors">
                                        <X className="w-5 h-5" />
                                    </button>
                                </div>
                                <div className="flex-1 overflow-auto p-5 bg-[#0d1117]">
                                    {isRawLogLoading ? (
                                        <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
                                            <RefreshCw className="w-6 h-6 animate-spin text-emerald-500" />
                                            <span className="text-sm">원본 데이터를 불러오는 중...</span>
                                        </div>
                                    ) : (
                                        <pre className="text-[12px] font-mono leading-relaxed text-[#c9d1d9] whitespace-pre-wrap break-words">
                                            {rawLogContent}
                                        </pre>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}
                </>
            )}
        </div>
    );
};

