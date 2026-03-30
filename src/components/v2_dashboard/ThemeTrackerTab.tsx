import React, { useState, useEffect } from 'react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';
import { RefreshCw, TrendingUp, Calendar, AlertCircle, X, ExternalLink, Sparkles } from 'lucide-react';

function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

export const ThemeTrackerTab: React.FC = () => {
    const [viewType, setViewType] = useState<string>('BOTH'); // Just for internal consistency if needed, though completely removing it might be better. Let's remove the selector and load both.
    const [themeData, setThemeData] = useState<any>(null);
    const [sectorData, setSectorData] = useState<any>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [selectedItem, setSelectedItem] = useState<any>(null);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    
    // Copilot Verify States
    const [userOpinion, setUserOpinion] = useState<string>('');
    const [isVerifying, setIsVerifying] = useState(false);
    const [copilotFeedback, setCopilotFeedback] = useState<string>('');

    // Related News State
    const [relatedNews, setRelatedNews] = useState<any[]>([]);
    const [isNewsLoading, setIsNewsLoading] = useState(false);

    const [targetDate, setTargetDate] = useState<string>('');
    
    useEffect(() => {
        const today = new Date().toISOString().split('T')[0];
        setTargetDate(today);
    }, []);

    useEffect(() => {
        if (!targetDate) return;
        loadData();
    }, [targetDate]);

    useEffect(() => {
        if (!selectedItem) {
            setRelatedNews([]);
            return;
        }

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
                        formatter={(val: number) => [`${val}위`, '순위']}
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
        const itemHistory = (dataSource?.historyData || []).filter((d: any) => d.name === selectedItem.name).reverse();
            
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
                        <button onClick={() => { setSelectedItem(null); setUserOpinion(''); setCopilotFeedback(''); }} className="p-1.5 hover:bg-muted rounded text-muted-foreground">
                            <X size={16} />
                        </button>
                    </div>

                    <div className="flex-1 overflow-y-auto p-4 space-y-6">
                        <div className="space-y-2">
                            <h3 className="text-xs font-bold text-muted-foreground flex items-center gap-1.5 uppercase tracking-wider">
                                <TrendingUp size={14} /> 모멘텀 궤적 (순위)
                            </h3>
                            <div className="h-[200px] w-full border rounded-lg p-2 bg-background flex items-center justify-center shadow-sm">
                                {itemHistory.length > 0 ? (
                                    <ResponsiveContainer width="100%" height="100%">
                                        <LineChart data={itemHistory} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" opacity={0.3} />
                                        <XAxis dataKey="date" tick={{fontSize: 9}} tickFormatter={v=>v.substring(5)} />
                                        <YAxis reversed domain={[1, 'dataMax']} tick={{fontSize: 9}} width={30} allowDecimals={false} />
                                        <Tooltip contentStyle={{fontSize: '11px'}} />
                                        <Line type="monotone" dataKey="rank_num" stroke="#8b5cf6" strokeWidth={2} dot={{r: 3}} activeDot={{r: 5}}/>
                                        </LineChart>
                                    </ResponsiveContainer>
                                ) : (
                                    <span className="text-xs text-muted-foreground">차트 이력이 부족합니다.</span>
                                )}
                            </div>
                        </div>

                        {selectedItem.top_stocks && selectedItem.top_stocks.length > 0 && (
                            <div className="space-y-3 pt-2">
                                <h3 className="text-xs font-bold text-muted-foreground flex items-center gap-1.5 uppercase tracking-wider">
                                    <Sparkles size={14} className="text-primary" /> 데이터 파이프라인 주도주
                                </h3>
                                <div className="bg-muted/30 border rounded-lg p-3 grid grid-cols-2 gap-2">
                                    {selectedItem.top_stocks.map((stock: any, idx: number) => (
                                        <div key={stock.stock_code} className="flex items-center gap-2 text-[12px] bg-background border px-2.5 py-1.5 rounded-md shadow-sm">
                                            <span className="font-mono text-[9px] text-muted-foreground px-1 py-0.5 bg-muted rounded">
                                                {stock.stock_code}
                                            </span>
                                            <span className="font-bold text-foreground truncate flex-1">
                                                {stock.stock_name}
                                            </span>
                                            {stock.change_rate != null && (
                                                <span className={cn("text-[10px] font-bold font-mono text-right", stock.change_rate > 0 ? "text-red-500" : stock.change_rate < 0 ? "text-blue-500" : "text-muted-foreground")}>
                                                    {stock.change_rate > 0 ? '+' : ''}{stock.change_rate}%
                                                </span>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {selectedItem.reason && (
                            <div className="space-y-4 pt-2">
                                <h3 className="text-xs font-bold text-muted-foreground flex items-center gap-1.5 uppercase tracking-wider">
                                    <Sparkles size={14} className="text-amber-500" /> AI 브리핑
                                </h3>
                                
                                <div className="space-y-3">
                                    <div className="bg-muted/30 border rounded-lg p-3.5 space-y-2 relative overflow-hidden">
                                        <div className="absolute top-0 left-0 w-1 h-full bg-primary/40"></div>
                                        <p className="text-[13px] leading-relaxed text-foreground">
                                            {selectedItem.reason}
                                        </p>
                                    </div>

                                    <div className="grid grid-cols-1 gap-2">
                                        <div className="flex items-start gap-3 bg-muted/20 border border-border/50 rounded-lg p-3">
                                            <div className="shrink-0 mt-0.5">
                                                <div className={cn(
                                                    "w-2 h-2 rounded-full",
                                                    selectedItem.lifespan_type?.includes('메가트렌드') ? "bg-purple-500" :
                                                    selectedItem.lifespan_type?.includes('중기') ? "bg-blue-500" :
                                                    selectedItem.lifespan_type?.includes('단기') ? "bg-orange-500" : "bg-muted-foreground"
                                                )} />
                                            </div>
                                            <div className="flex-1 space-y-1">
                                                <div className="text-xs font-bold text-foreground">
                                                    예상 생명력: <span className="text-primary">{selectedItem.lifespan_type}</span>
                                                </div>
                                                <div className="text-xs leading-relaxed text-muted-foreground">
                                                    {selectedItem.lifespan_reasoning}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Copilot Verification Block */}
                        <div className="space-y-4 pt-4 border-t border-border/50">
                            <h3 className="text-xs font-bold text-muted-foreground flex items-center gap-1.5 uppercase tracking-wider">
                                <Sparkles size={14} className="text-purple-500" /> 코파일럿 심층 검증
                            </h3>
                            <div className="space-y-3">
                                <div className="text-[11px] text-muted-foreground leading-relaxed">
                                    AI 분석에 아쉬움이 있나요? 반박하고 싶은 개인 의견(팩트)과 함께 실시간 서치/검증을 요청해보세요.
                                </div>
                                <div className="flex flex-col gap-2 relative">
                                    <textarea
                                        value={userOpinion}
                                        onChange={e => setUserOpinion(e.target.value)}
                                        placeholder="예: 플라스틱 원자재 공급 우려 때문 아닌지 뉴스 검색해서 다시 원인과 수명을 판단해봐."
                                        disabled={isVerifying}
                                        className="w-full h-20 bg-background border border-border/80 rounded font-sans text-xs p-2.5 outline-none focus:border-primary/50 resize-none"
                                    />
                                    <button 
                                        onClick={handleVerify} 
                                        disabled={isVerifying || !userOpinion.trim()}
                                        className="self-end px-3 py-1.5 bg-primary/10 text-primary hover:bg-primary/20 hover:text-primary border border-primary/20 rounded font-bold text-xs disabled:opacity-50 transition-colors flex items-center gap-1.5"
                                    >
                                        {isVerifying ? <RefreshCw size={12} className="animate-spin" /> : <Sparkles size={12} />}
                                        {isVerifying ? '팩트체크 및 재검증 중...' : '💡 팩트체크'}
                                    </button>
                                </div>
                                
                                {copilotFeedback && (
                                    <div className="mt-2 bg-gradient-to-br from-purple-500/10 to-blue-500/5 border border-purple-500/20 rounded-lg p-3 text-xs text-foreground leading-relaxed animate-in fade-in slide-in-from-top-2">
                                        <div className="font-bold text-purple-600 mb-1 flex items-center gap-1.5">
                                            <Sparkles size={12} /> 피드백 결과
                                        </div>
                                        {copilotFeedback}
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Related News Block */}
                        <div className="space-y-4 pt-4 border-t border-border/50 pb-8">
                            <div className="flex items-center justify-between">
                                <h3 className="text-xs font-bold text-muted-foreground flex items-center gap-1.5 uppercase tracking-wider">
                                    <ExternalLink size={14} className="text-blue-500" /> 연관 뉴스
                                </h3>
                                <button 
                                    onClick={handleLiveSearch} 
                                    disabled={isNewsLoading || !selectedItem?.top_stocks?.length}
                                    className="px-2.5 py-1 text-[10px] font-bold bg-muted hover:bg-muted/80 text-foreground border rounded transition-colors disabled:opacity-50 flex items-center gap-1 shadow-sm"
                                    title="주도주 키워드로 네이버 실시간 뉴스 검색"
                                >
                                    {isNewsLoading ? <RefreshCw size={10} className="animate-spin text-primary" /> : <Sparkles size={10} className="text-amber-500" />}
                                    실시간 검색
                                </button>
                            </div>
                            <div className="space-y-2 relative min-h-[50px]">
                                {isNewsLoading ? (
                                    <div className="text-xs text-muted-foreground flex items-center justify-center h-20 gap-2">
                                        <RefreshCw size={14} className="animate-spin text-primary" /> NewsHub 알고리즘 추출 중...
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
                                        현재 NewsHub 캐시에서 발견된 종목/테마 관련 뉴스가 없습니다.
                                    </div>
                                )}
                            </div>
                        </div>

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
                                        onClick={() => {
                                            setSelectedItem({...row, type});
                                            setUserOpinion('');
                                            setCopilotFeedback('');
                                        }}
                                        className={cn(
                                            "hover:bg-muted/20 cursor-pointer transition-colors group",
                                            selectedItem?.name === row.name ? "bg-primary/5" : ""
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
                                                        <span className="text-primary/90 font-bold" title={`주요 종목: ${row.top_stocks.map((s:any)=>s.stock_name).join(', ')}`}>
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
                
                <div className="px-5 py-3 border-b flex items-center justify-between bg-muted/5 z-0 shrink-0">
                    <div className="flex items-center gap-4">
                        <h1 className="text-lg font-bold tracking-tight text-foreground flex items-center gap-3">
                            <TrendingUp size={18} className="text-primary" />
                            시장 주도 트렌드
                        </h1>
                    </div>

                    <div className="flex items-center gap-4">
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
                                "flex items-center gap-2 px-3 py-1.5 border rounded text-xs font-bold transition-colors shadow-sm",
                                "bg-primary/10 text-primary border-primary/20 hover:bg-primary/20 hover:border-primary/40"
                            )}
                            title="네이버 테마/섹터 원본 최신 데이터로 동기화"
                        >
                            <RefreshCw size={13} className={isLoading && !isAnalyzing ? "animate-spin" : ""} />
                            데이터 동기화
                        </button>
                        <button 
                            onClick={handleAnalyze}
                            disabled={isAnalyzing || isLoading}
                            className={cn(
                                "flex items-center gap-2 px-3 py-1.5 border rounded text-xs font-bold transition-colors shadow-sm",
                                isAnalyzing 
                                    ? "bg-amber-500/10 text-amber-600 border-amber-500/30 font-semibold" 
                                    : "bg-gradient-to-r from-amber-500/10 to-orange-500/10 text-amber-600 border-amber-500/20 hover:bg-amber-500/20 hover:border-amber-500/40"
                            )}
                        >
                            <Sparkles size={13} className={isAnalyzing ? "animate-pulse" : ""} />
                            {isAnalyzing ? '분석 중...' : 'AI 분석 실행'}
                        </button>
                        <button 
                            onClick={loadData}
                            disabled={isLoading}
                            className="p-1.5 border rounded bg-background hover:bg-muted text-muted-foreground transition-colors"
                        >
                            <RefreshCw size={14} className={isLoading ? "animate-spin" : ""} />
                        </button>
                    </div>
                </div>

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
            </div>

            {renderDetailPanel()}
        </div>
    );
};
