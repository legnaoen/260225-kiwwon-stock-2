import React, { useState, useEffect, useMemo } from 'react';
import { Youtube, MessageSquare, TrendingUp, AlertCircle, PlayCircle, Search, Settings as SettingsIcon, Filter, RefreshCw, Info, Activity, X, Trash2, Zap, Plus, BrainCircuit, Calendar, BarChart3, LayoutList, Clock, Users, Send } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, AreaChart, Area } from 'recharts';

interface YoutubeInsight {
    id: number;
    video_id: string;
    channel_name: string;
    title: string;
    thumbnail: string | null;
    transcript: string | null;
    published_at: string;
    summary_json: string | null;
}

export default function NarrativeInsightTab() {
    const [activeView, setActiveView] = useState<'dashboard' | 'management'>('dashboard');
    const [narrativeType, setNarrativeType] = useState<'youtube' | 'news'>('youtube');
    const [youtubeSubTab, setYoutubeSubTab] = useState<'report' | 'sector' | 'feed'>('report');
    
    const [insights, setInsights] = useState<YoutubeInsight[]>([]);
    const [channels, setChannels] = useState<any[]>([]);
    const [youtubeTrends, setYoutubeTrends] = useState<any[]>([]);
    const [youtubeConsensus, setYoutubeConsensus] = useState<any[]>([]);
    
    const [newsBriefings, setNewsBriefings] = useState<any[]>([]);
    const [newsTrends, setNewsTrends] = useState<any[]>([]);
    const [newsSettings, setNewsSettings] = useState<any>({
        keywords: ['코스피 코스닥 시황', '뉴욕증시 마감', '미국 금리 환율'],
        enabled: true,
        reportTime: '08:20',
        telegramTime: '08:30',
        max_total_keywords: 5,
        ai_keywords_pool: []
    });
    const [loading, setLoading] = useState(true);
    const [isCollecting, setIsCollecting] = useState(false);
    const [showReportModal, setShowReportModal] = useState(false);
    const [collectionReport, setCollectionReport] = useState<any>(null);
    const [progress, setProgress] = useState<{stage: string, message: string, current: number, total: number} | null>(null);
    
    // Modal states for individual clips
    const [selectedInsight, setSelectedInsight] = useState<YoutubeInsight | null>(null);
    const [showTranscriptModal, setShowTranscriptModal] = useState(false);
    const [showDeepDiveModal, setShowDeepDiveModal] = useState(false);
    const [isReanalyzing, setIsReanalyzing] = useState(false);
    
    // Add Channel Modal State
    const [showAddModal, setShowAddModal] = useState(false);
    const [newChannelId, setNewChannelId] = useState('');
    const [newChannelName, setNewChannelName] = useState('');

    // Youtube Settings State
    const [showYtSettingsModal, setShowYtSettingsModal] = useState(false);
    const [ytSettings, setYtSettings] = useState({
        enabled: true,
        collectTime: '08:30'
    });

    // Market News Modal States
    const [showNewsSettingsModal, setShowNewsSettingsModal] = useState(false);
    const [showNewsSourceModal, setShowNewsSourceModal] = useState(false);
    const [selectedBriefingSources, setSelectedBriefingSources] = useState<any[]>([]);
    const [newKeyword, setNewKeyword] = useState('');

    const fetchData = async () => {
        setLoading(true);
        try {
            if (narrativeType === 'youtube') {
                if (window.electronAPI?.getLatestYoutubeInsights) {
                    const data = await window.electronAPI.getLatestYoutubeInsights(15);
                    setInsights(data || []);
                }
                if (window.electronAPI?.getYoutubeChannels) {
                    const chanData = await window.electronAPI.getYoutubeChannels();
                    setChannels(chanData || []);
                }
                if (window.electronAPI?.getYoutubeTrends) {
                    const res = await window.electronAPI.getYoutubeTrends(14);
                    if (res.success) setYoutubeTrends(res.data || []);
                }
                if (window.electronAPI?.getYoutubeConsensus) {
                    const res = await window.electronAPI.getYoutubeConsensus(10);
                    if (res.success) setYoutubeConsensus(res.data || []);
                }
                if ((window.electronAPI as any).getYoutubeSettings) {
                    const settings = await (window.electronAPI as any).getYoutubeSettings();
                    if (settings) setYtSettings(settings);
                }
            } else {
                if ((window.electronAPI as any).getNewsSettings) {
                    const settings = await (window.electronAPI as any).getNewsSettings();
                    setNewsSettings(settings);
                }
                if ((window.electronAPI as any).getLatestBriefings) {
                    const briefings = await (window.electronAPI as any).getLatestBriefings(15);
                    setNewsBriefings(briefings || []);
                }
                if ((window.electronAPI as any).getNewsTrends) {
                    const res = await (window.electronAPI as any).getNewsTrends(14);
                    if (res.success) setNewsTrends(res.data || []);
                }
            }
        } catch (err) {
            console.error('Failed to fetch data:', err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();

        // Listen for progress updates
        const unlisten = (window.electronAPI as any).onYoutubeProgress?.((data: any) => {
            if (narrativeType === 'youtube') setProgress(data);
        });

        return () => {
            if (unlisten) unlisten();
        };
    }, [narrativeType]);

    const handleCollectNow = async (channelId?: string) => {
        if (isCollecting) return;
        setIsCollecting(true);
        setProgress({ stage: 'START', message: '분석 준비 중...', current: 0, total: 0 });
        try {
            const result = await (window.electronAPI as any).collectYoutubeNow(channelId);
            if (result.success) {
                setCollectionReport(result);
                setShowReportModal(true);
                await fetchData();
            } else {
                alert(`수집 오류: ${result.error}`);
            }
        } catch (err: any) {
            console.error('Collection failed:', err);
            alert(`수집 중 시스템 오류가 발생했습니다: ${err.message}`);
        } finally {
            setIsCollecting(false);
            setProgress(null);
        }
    };

    const handleSyncVideos = async () => {
        if (isCollecting) return;
        setIsCollecting(true);
        setProgress({ stage: 'START', message: '신규 영상 목록 업데이트 중...', current: 0, total: 0 });
        try {
            const result = await (window.electronAPI as any).syncYoutubeVideos();
            if (result.success) {
                await fetchData();
            } else {
                alert(`동기화 오류: ${result.error}`);
            }
        } catch (err: any) {
            console.error('Sync failed:', err);
        } finally {
            setIsCollecting(false);
            setProgress(null);
        }
    };

    const handleReanalyze = async (videoId: string) => {
        if (isReanalyzing) return;
        setIsReanalyzing(true);
        try {
            const result = await (window.electronAPI as any).reanalyzeYoutubeVideo(videoId);
            if (result.success) {
                // Update specific insight in local state
                setInsights(prev => prev.map(item => 
                    item.video_id === videoId ? { ...item, summary_json: JSON.stringify(result.summary) } : item
                ));
                // Update selected insight if it's the one open
                if (selectedInsight?.video_id === videoId) {
                    setSelectedInsight({ ...selectedInsight, summary_json: JSON.stringify(result.summary) });
                }
            } else {
                alert(`재분석 오류: ${result.error}`);
            }
        } catch (err: any) {
            console.error('Re-analysis failed:', err);
        } finally {
            setIsReanalyzing(false);
        }
    };

    const handleUpdateTrust = async (id: string, score: number) => {
        try {
            const result = await (window.electronAPI as any).updateYoutubeTrust({ id, score });
            if (result.success) {
                setChannels(prev => prev.map(c => c.channel_id === id ? { ...c, trust_score: score } : c));
            }
        } catch (err) {
            console.error('Trust update failed:', err);
        }
    };

    const handleAddChannel = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newChannelId || !newChannelName) return;
        
        try {
            const result = await (window.electronAPI as any).addYoutubeChannel({ id: newChannelId, name: newChannelName });
            if (result.success) {
                setShowAddModal(false);
                setNewChannelId('');
                setNewChannelName('');
                await fetchData();
            } else {
                alert('채널 추가 실패');
            }
        } catch (err: any) {
            alert(`오류: ${err.message}`);
        }
    };

    const handleRemoveChannel = async (id: string) => {
        if (!confirm('정말로 이 채널을 삭제하시겠습니까? 관련 설정만 삭제되며 수집된 데이터는 유지됩니다.')) return;
        try {
            const result = await (window.electronAPI as any).removeYoutubeChannel(id);
            if (result.success) {
                await fetchData();
            } else {
                alert('채널 삭제 실패');
            }
        } catch (err: any) {
            alert(`오류: ${err.message}`);
        }
    };

    const handleSendTelegram = async (type: 'youtube' | 'news', report: any, reportData?: any) => {
        try {
            let msg = '';
            if (type === 'youtube') {
                msg = `📺 [유튜브 내러티브 데일리 리포트]\n📅 날짜: ${report.date}\n\n`;
                msg += `▶️ 분석 요약:\n${report.consensus_report}\n\n`;
                if (report.pivot_analysis) msg += `▶️ Market Pivot:\n${report.pivot_analysis}\n\n`;
                
                const sources = parseSummary(report.sources_json);
                if (sources?.length) {
                    msg += `💡 분석된 주요 채널: ${sources.slice(0, 5).map((s:any)=>s.channel?.[0] || '채널').join(', ')} 등 ${sources.length}건`;
                }
            } else {
                msg = `📰 [시장 뉴스 메가 브리핑]\n📅 날짜: ${report.date}\n\n`;
                msg += `🌡️ 시장 심리 (Sentiment): ${reportData?.sentiment || 0}\n`;
                if (reportData?.pivot) msg += `\n▶️ Market Pivot:\n${reportData.pivot}\n`;
                
                if (Array.isArray(reportData?.summary)) {
                    msg += `\n▶️ 주요 내러티브:\n${reportData.summary.map((s:string) => `✔️ ${s}`).join('\n')}\n`;
                }
                
                if (reportData?.themes?.length) {
                    msg += `\n🔥 주요 테마:\n${reportData.themes.map((t:any) => `[${t.theme_name}] ${t.reason}`).join('\n')}\n`;
                }
            }

            const result = await (window.electronAPI as any).sendTelegramMessage(msg);
            if (result?.success) {
                alert('텔레그램 전송 성공!');
            } else {
                alert(`전송 실패: ${result?.error || '알 수 없는 오류'}`);
            }
        } catch (error: any) {
            console.error('Telegram Send Error:', error);
            alert(`전송 중 오류 발생: ${error.message}`);
        }
    };

    const parseSummary = (jsonStr: string | null) => {
        try {
            return jsonStr ? JSON.parse(jsonStr) : null;
        } catch (e) {
            return null;
        }
    };

    // Chart Data Preparation
    const sentimentChartData = useMemo(() => {
        return [...youtubeTrends].reverse().map(t => ({
            date: t.date.slice(5),
            sentiment: t.sentiment_score * 100,
            originalDate: t.date
        }));
    }, [youtubeTrends]);

    const sectorTrendData = useMemo(() => {
        const sortedTrends = [...youtubeTrends].reverse();
        const allSectors = new Set<string>();
        
        sortedTrends.forEach(t => {
            const sectors = parseSummary(t.sector_rankings_json);
            if (Array.isArray(sectors)) {
                sectors.slice(0, 3).forEach(s => allSectors.add(s.sector));
            }
        });

        return sortedTrends.map(t => {
            const sectors = parseSummary(t.sector_rankings_json);
            const row: any = { date: t.date.slice(5) };
            if (Array.isArray(sectors)) {
                sectors.forEach(s => {
                    if (allSectors.has(s.sector)) {
                        row[s.sector] = s.score;
                    }
                });
            }
            return row;
        });
    }, [youtubeTrends]);

    const distinctSectors = useMemo(() => {
        const sectors = new Set<string>();
        youtubeTrends.forEach(t => {
            const parsed = parseSummary(t.sector_rankings_json);
            if (Array.isArray(parsed)) {
                parsed.slice(0, 3).forEach(s => sectors.add(s.sector));
            }
        });
        return Array.from(sectors);
    }, [youtubeTrends]);

    const colors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];

    // News Chart Data Preparation
    const newsSentimentChartData = useMemo(() => {
        return [...newsTrends].reverse().map(t => ({
            date: t.date.slice(5),
            sentiment: (t.sentiment_score + 1) * 50, // -1~1 to 0~100
            originalSentiment: t.sentiment_score,
            originalDate: t.date
        }));
    }, [newsTrends]);

    const newsKeywordTrendData = useMemo(() => {
        const sortedTrends = [...newsTrends].reverse();
        const allKeywords = new Set<string>();
        
        sortedTrends.forEach(t => {
            const keywords = parseSummary(t.hot_keywords_json);
            if (Array.isArray(keywords)) {
                keywords.slice(0, 5).forEach(k => allKeywords.add(k.keyword));
            }
        });

        return sortedTrends.map(t => {
            const keywords = parseSummary(t.hot_keywords_json);
            const row: any = { date: t.date.slice(5) };
            if (Array.isArray(keywords)) {
                keywords.forEach(k => {
                    if (allKeywords.has(k.keyword)) {
                        row[k.keyword] = k.score;
                    }
                });
            }
            return row;
        });
    }, [newsTrends]);

    const distinctNewsKeywords = useMemo(() => {
        const keywords = new Set<string>();
        newsTrends.forEach(t => {
            const parsed = parseSummary(t.hot_keywords_json);
            if (Array.isArray(parsed)) {
                parsed.slice(0, 5).forEach(k => keywords.add(k.keyword));
            }
        });
        return Array.from(keywords);
    }, [newsTrends]);



    return (
        <div className="flex flex-col h-full bg-background overflow-hidden">
            {/* Tab Switcher */}
            <div className="px-8 pt-6 pb-2 border-b border-border/40 flex items-center justify-between bg-card/30">
                <div className="flex bg-muted/30 p-1.5 rounded-2xl border border-border/20">
                    <button
                        onClick={() => setNarrativeType('youtube')}
                        className={`flex items-center gap-2 px-6 py-2 rounded-xl text-sm font-bold transition-all ${
                            narrativeType === 'youtube' 
                            ? 'bg-background text-primary shadow-lg shadow-primary/10' 
                            : 'text-muted-foreground hover:text-foreground'
                        }`}
                    >
                        <Youtube size={16} /> Youtube
                    </button>
                    <button
                        onClick={() => setNarrativeType('news')}
                        className={`flex items-center gap-2 px-6 py-2 rounded-xl text-sm font-bold transition-all ${
                            narrativeType === 'news' 
                            ? 'bg-background text-primary shadow-lg shadow-primary/10' 
                            : 'text-muted-foreground hover:text-foreground'
                        }`}
                    >
                        <MessageSquare size={16} /> News briefing
                    </button>
                </div>

                <div className="flex items-center gap-3">
                    <button 
                        onClick={fetchData}
                        className="p-2.5 rounded-2xl hover:bg-muted/50 border border-border/10 text-muted-foreground transition-all"
                    >
                        <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
                    </button>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-8 space-y-8 animate-in fade-in duration-500">
                {narrativeType === 'youtube' ? (
                    activeView === 'management' ? (
                        <div className="space-y-8 animate-in slide-in-from-right duration-500">
                            {/* Management Header */}
                            <div className="flex items-center justify-between">
                                <div className="space-y-1">
                                    <h2 className="text-3xl font-extrabold tracking-tight flex items-center gap-2">
                                        <SettingsIcon className="text-primary" size={28} />
                                        인텔리전스 채널 관리
                                    </h2>
                                    <p className="text-muted-foreground font-medium">분석 대상 채널을 관리하고 데이터 수집 가중치를 설정합니다.</p>
                                </div>
                                <button 
                                    onClick={() => setActiveView('dashboard')}
                                    className="px-6 py-2.5 border border-border hover:bg-muted rounded-2xl text-xs font-bold transition-all"
                                >
                                    ← 대시보드로 돌아가기
                                </button>
                            </div>

                            {/* Channel List Card */}
                            <div className="bg-card border border-border/60 rounded-3xl p-8 shadow-sm space-y-6">
                                <div className="flex items-center justify-between border-b border-border/40 pb-4">
                                    <h4 className="font-bold">모니터링 중인 전문가 채널 ({channels.length})</h4>
                                    <button 
                                        onClick={() => setShowAddModal(true)}
                                        className="text-xs font-bold px-4 py-2 bg-primary text-primary-foreground rounded-xl hover:opacity-90 transition-all flex items-center gap-2"
                                    >
                                        + 채널 추가
                                    </button>
                                </div>

                                <div className="space-y-4">
                                    {channels.map((channel) => (
                                        <div key={channel.channel_id} className="flex items-center justify-between p-4 bg-muted/20 border border-border/40 rounded-2xl group hover:border-primary/30 transition-all">
                                            <div className="flex items-center gap-4">
                                                <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center font-bold text-muted-foreground overflow-hidden">
                                                    {channel.channel_name ? channel.channel_name[0] : 'Y'}
                                                </div>
                                                <div>
                                                    <div className="flex items-center gap-2">
                                                        <h5 className="font-bold text-sm">{channel.channel_name}</h5>
                                                        <span className="text-[10px] text-muted-foreground font-mono bg-muted px-1.5 py-0.5 rounded">{channel.channel_id}</span>
                                                    </div>
                                                    <p className="text-[10px] text-muted-foreground mt-0.5">최종 수집: {channel.last_collected_at ? new Date(channel.last_collected_at).toLocaleString() : '수집 이력 없음'}</p>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-8">
                                                <div className="flex flex-col items-center gap-1">
                                                    <span className="text-[9px] font-bold text-muted-foreground uppercase">신뢰도 가중치</span>
                                                    <div className="flex items-center gap-2">
                                                        <input 
                                                            type="range" 
                                                            min="0.5" 
                                                            max="2.0" 
                                                            step="0.1" 
                                                            value={channel.trust_score || 1.0}
                                                            className="w-24 accent-primary" 
                                                            onChange={(e) => handleUpdateTrust(channel.channel_id, parseFloat(e.target.value))}
                                                        />
                                                        <span className="text-xs font-bold text-primary w-6">{channel.trust_score || 1.0}</span>
                                                    </div>
                                                </div>
                                                <button 
                                                    onClick={() => handleCollectNow(channel.channel_id)}
                                                    disabled={isCollecting}
                                                    className="p-2 text-muted-foreground hover:text-primary transition-colors disabled:opacity-30"
                                                    title="이 채널만 즉시 수집"
                                                >
                                                    <RefreshCw size={18} className={isCollecting ? 'animate-spin' : ''} />
                                                </button>
                                                <button 
                                                    onClick={() => handleRemoveChannel(channel.channel_id)}
                                                    className="p-2 text-muted-foreground hover:text-destructive transition-colors"
                                                    title="채널 삭제"
                                                >
                                                    <Trash2 size={18} />
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>

                                {/* Global Collection Stats */}
                                <div className="pt-6 mt-6 border-t border-border/40 flex items-center justify-between">
                                    <div className="space-y-1">
                                        <h5 className="text-sm font-bold">글로벌 수집 설정</h5>
                                        <p className="text-xs text-muted-foreground">모든 채널에 대해 4시간 주기로 자동 업데이트가 수행됩니다.</p>
                                    </div>
                                    <button 
                                        onClick={() => handleCollectNow()}
                                        disabled={isCollecting}
                                        className="px-6 py-3 bg-red-600 text-white rounded-2xl font-bold text-xs hover:bg-red-700 disabled:bg-muted disabled:text-muted-foreground transition-all shadow-xl shadow-red-600/20 flex items-center gap-2"
                                    >
                                        {isCollecting ? <RefreshCw size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                                        지금 즉시 전체 수집
                                    </button>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-10 animate-in slide-in-from-bottom-4 duration-500">
                            {/* Header Section */}
                            <div className="flex items-center justify-between">
                                <div className="space-y-1">
                                    <h2 className="text-3xl font-extrabold tracking-tight flex items-center gap-2">
                                        <Youtube className="text-red-600" size={32} />
                                        내러티브 인사이트 센터
                                    </h2>
                                    <p className="text-muted-foreground font-medium">전문가들의 정성적 분석을 정량화하여 시장 내러티브를 파악합니다.</p>
                                </div>
                                <div className="flex gap-2">
                                    {isCollecting && progress && (
                                        <div className="flex items-center gap-3 px-4 py-2 bg-muted/30 border border-border/50 rounded-xl animate-in fade-in zoom-in-95 duration-500">
                                             <div className="flex flex-col">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-[10px] font-black uppercase text-primary animate-pulse">{progress.stage}</span>
                                                    <span className="text-[10px] text-muted-foreground font-bold">{progress.message}</span>
                                                </div>
                                                {progress.total > 0 && (
                                                    <div className="h-1 w-32 bg-muted rounded-full mt-1 overflow-hidden">
                                                        <div 
                                                            className="h-full bg-primary transition-all duration-500" 
                                                            style={{ width: `${(progress.current / progress.total) * 100}%` }}
                                                        />
                                                    </div>
                                                )}
                                             </div>
                                        </div>
                                    )}
                                    <button className="flex items-center gap-2 px-4 py-2 bg-muted hover:bg-muted/80 rounded-xl text-xs font-bold transition-all">
                                        <Filter size={14} /> 필터링
                                    </button>
                                    <button 
                                        onClick={() => handleSyncVideos()}
                                        disabled={isCollecting}
                                        className="flex items-center gap-2 px-4 py-2 bg-muted hover:bg-muted/80 rounded-xl text-xs font-bold transition-all border border-border/40"
                                    >
                                        <RefreshCw size={14} className={isCollecting ? 'animate-spin' : ''} /> 신규 영상 수집
                                    </button>
                                    <button 
                                        onClick={() => handleCollectNow()}
                                        disabled={isCollecting}
                                        className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground hover:opacity-90 rounded-xl text-xs font-bold shadow-lg shadow-primary/20 transition-all"
                                    >
                                        {isCollecting ? <RefreshCw size={14} className="animate-spin" /> : <Search size={14} />} 즉시 분석
                                    </button>
                                    <button 
                                        onClick={() => setShowYtSettingsModal(true)}
                                        className="flex items-center justify-center w-10 h-10 bg-muted hover:bg-muted/80 rounded-xl text-muted-foreground hover:text-foreground transition-all"
                                        title="유튜브 설정"
                                    >
                                        <SettingsIcon size={18} />
                                    </button>
                                </div>
                            </div>

                            {/* Dashboard Grid (Charts) */}
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                                {/* Leading Sector Trend Chart */}
                                <div className="bg-card/40 border border-border/60 rounded-[32px] p-8 shadow-sm space-y-6 flex flex-col min-h-[400px]">
                                    <div className="flex items-center justify-between">
                                        <div className="space-y-1">
                                            <h3 className="text-sm font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                                                <TrendingUp size={14} className="text-green-500" /> Leading Sector Trend
                                            </h3>
                                            <p className="text-[11px] text-muted-foreground">주요 섹터의 주도권 점수 전이 모니터링</p>
                                        </div>
                                        <TrendingUp size={18} className="text-green-500" />
                                    </div>
                                    <div className="flex-1 w-full min-h-[250px] pt-4">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <LineChart data={sectorTrendData}>
                                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" opacity={0.5} />
                                                <XAxis dataKey="date" fontSize={10} axisLine={false} tickLine={false} tick={{fill: '#64748b'}} />
                                                <YAxis domain={[0, 100]} fontSize={10} axisLine={false} tickLine={false} tick={{fill: '#64748b'}} hide />
                                                <Tooltip 
                                                    contentStyle={{ backgroundColor: '#fff', borderRadius: '16px', border: '1px solid #E2E8F0', fontSize: '12px', fontWeight: 'bold' }}
                                                />
                                                <Legend iconType="circle" wrapperStyle={{ fontSize: '10px', fontWeight: 'bold', paddingTop: '20px' }} />
                                                {distinctSectors.map((sector, idx) => (
                                                    <Line 
                                                        key={sector}
                                                        type="monotone" 
                                                        dataKey={sector} 
                                                        stroke={colors[idx % colors.length]} 
                                                        strokeWidth={3}
                                                        dot={{ r: 4, strokeWidth: 2, fill: '#fff' }}
                                                        activeDot={{ r: 6 }}
                                                        animationDuration={1500}
                                                    />
                                                ))}
                                            </LineChart>
                                        </ResponsiveContainer>
                                    </div>
                                </div>

                                {/* Market Sentiment Trend Chart */}
                                <div className="bg-card/40 border border-border/60 rounded-[32px] p-8 shadow-sm space-y-6 flex flex-col min-h-[400px]">
                                    <div className="flex items-center justify-between">
                                        <div className="space-y-1">
                                            <h3 className="text-sm font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                                                <Activity size={14} className="text-blue-500" /> Market Sentiment Trend
                                            </h3>
                                            <p className="text-[11px] text-muted-foreground">영상 분석 기반 가중 시장 심리 점수</p>
                                        </div>
                                        <Activity size={18} className="text-blue-500" />
                                    </div>
                                    <div className="flex-1 w-full min-h-[250px] pt-4">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <AreaChart data={sentimentChartData}>
                                                <defs>
                                                    <linearGradient id="colorSentiment" x1="0" y1="0" x2="0" y2="1">
                                                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/>
                                                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                                                    </linearGradient>
                                                </defs>
                                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" opacity={0.5} />
                                                <XAxis dataKey="date" fontSize={10} axisLine={false} tickLine={false} tick={{fill: '#64748b'}} />
                                                <YAxis domain={[0, 100]} fontSize={10} axisLine={false} tickLine={false} tick={{fill: '#64748b'}} hide />
                                                <Tooltip 
                                                    contentStyle={{ backgroundColor: '#fff', borderRadius: '16px', border: '1px solid #E2E8F0', fontSize: '12px', fontWeight: 'bold' }}
                                                />
                                                <Area 
                                                    type="monotone" 
                                                    dataKey="sentiment" 
                                                    stroke="#3b82f6" 
                                                    strokeWidth={3}
                                                    fillOpacity={1} 
                                                    fill="url(#colorSentiment)"
                                                    animationDuration={2000}
                                                />
                                            </AreaChart>
                                        </ResponsiveContainer>
                                    </div>
                                </div>
                            </div>

                            {/* Youtube Sub-Tabs */}
                            <div className="flex items-center border-b border-border/40 gap-8">
                                <button 
                                    onClick={() => setYoutubeSubTab('report')}
                                    className={`pb-4 text-sm font-black transition-all relative ${youtubeSubTab === 'report' ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}`}
                                >
                                    <div className="flex items-center gap-2">
                                        <Calendar size={16} /> Daily Report
                                    </div>
                                    {youtubeSubTab === 'report' && <div className="absolute bottom-0 left-0 right-0 h-1 bg-primary rounded-t-full shadow-lg shadow-primary/20" />}
                                </button>
                                <button 
                                    onClick={() => setYoutubeSubTab('sector')}
                                    className={`pb-4 text-sm font-black transition-all relative ${youtubeSubTab === 'sector' ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}`}
                                >
                                    <div className="flex items-center gap-2">
                                        <BarChart3 size={16} /> Leading Sector
                                    </div>
                                    {youtubeSubTab === 'sector' && <div className="absolute bottom-0 left-0 right-0 h-1 bg-primary rounded-t-full shadow-lg shadow-primary/20" />}
                                </button>
                                <button 
                                    onClick={() => setYoutubeSubTab('feed')}
                                    className={`pb-4 text-sm font-black transition-all relative ${youtubeSubTab === 'feed' ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}`}
                                >
                                    <div className="flex items-center gap-2">
                                        <LayoutList size={16} /> Analysis Feed
                                    </div>
                                    {youtubeSubTab === 'feed' && <div className="absolute bottom-0 left-0 right-0 h-1 bg-primary rounded-t-full shadow-lg shadow-primary/20" />}
                                </button>
                            </div>

                            {/* Sub-Tab Content */}
                            <div className="space-y-6">
                                {youtubeSubTab === 'report' && (
                                    <div className="space-y-4 animate-in fade-in slide-in-from-left-4 duration-500">
                                        {youtubeConsensus.length === 0 ? (
                                            <div className="py-20 text-center bg-muted/5 border border-dashed border-border/40 rounded-3xl">
                                                <p className="text-muted-foreground font-medium">생성된 데일리 통합 리포트가 없습니다.</p>
                                            </div>
                                        ) : (
                                            youtubeConsensus.map((report, idx) => (
                                                <div key={idx} className="group bg-card/10 border border-border/50 hover:border-primary/30 p-8 rounded-[32px] transition-all space-y-4">
                                                    <div className="flex items-center justify-between">
                                                        <div className="p-3 bg-muted/40 rounded-2xl font-black text-foreground text-sm flex items-center gap-2">
                                                            <Calendar size={14} className="text-primary" /> {report.date}
                                                        </div>
                                                        <div className="flex items-center gap-4">
                                                            <span className="text-[10px] text-muted-foreground font-mono">생성: {new Date(report.created_at).toLocaleString()}</span>
                                                            <button 
                                                                onClick={() => handleSendTelegram('youtube', report)}
                                                                className="px-3 py-1 bg-blue-500/10 text-blue-600 hover:bg-blue-500/20 rounded-full text-[10px] font-bold flex items-center gap-1.5 transition-all"
                                                            >
                                                                <Send size={12} /> Telegram 전송
                                                            </button>
                                                        </div>
                                                    </div>
                                                    <div className="space-y-4">
                                                        <h4 className="text-lg font-bold leading-snug text-foreground/90">마켓 내러티브 데일리 컨센서스</h4>
                                                        <div className="p-6 bg-muted/5 border border-border/30 rounded-2xl leading-[1.8] text-sm font-medium text-muted-foreground whitespace-pre-wrap">
                                                            {report.consensus_report}
                                                        </div>
                                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                            <div className="p-5 bg-amber-500/5 border border-amber-500/10 rounded-2xl space-y-2">
                                                                <h5 className="text-[10px] font-black text-amber-600 uppercase tracking-widest flex items-center gap-2">
                                                                    <Zap size={14} /> Narrative Pivot Analysis
                                                                </h5>
                                                                <p className="text-xs font-medium text-amber-700/80 leading-relaxed italic line-clamp-2">
                                                                    {report.pivot_analysis}
                                                                </p>
                                                            </div>
                                                            <div className="p-5 bg-primary/5 border border-primary/10 rounded-2xl flex flex-col justify-center">
                                                                <span className="text-[10px] font-black text-primary uppercase tracking-widest mb-2">Sources Analyzed</span>
                                                                <div className="flex items-center gap-2">
                                                                    <div className="flex -space-x-2">
                                                                        {parseSummary(report.sources_json)?.slice(0, 3).map((s: any, i: number) => (
                                                                            <div key={i} className="w-8 h-8 rounded-full bg-muted border-2 border-background flex items-center justify-center text-[10px] font-black text-muted-foreground">
                                                                                {s.channel?.[0] || 'Y'}
                                                                            </div>
                                                                        ))}
                                                                    </div>
                                                                    <span className="text-xs font-bold text-muted-foreground">
                                                                        {parseSummary(report.sources_json)?.length || 0} Expert Clips
                                                                    </span>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            ))
                                        )}
                                    </div>
                                )}

                                {youtubeSubTab === 'sector' && (
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 animate-in fade-in slide-in-from-right-4 duration-500">
                                        {youtubeTrends.length > 0 && parseSummary(youtubeTrends[0].sector_rankings_json)?.map((s: any, idx: number) => (
                                            <div key={idx} className="bg-card/20 border border-border/50 p-8 rounded-[40px] shadow-sm hover:border-primary/40 transition-all flex flex-col gap-6">
                                                <div className="flex items-center justify-between">
                                                    <div className="flex items-center gap-4">
                                                        <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center font-black text-primary">
                                                            #{idx + 1}
                                                        </div>
                                                        <div>
                                                            <h4 className="text-xl font-black">{s.sector}</h4>
                                                            <span className="text-xs font-bold text-muted-foreground">{s.score}(point)</span>
                                                        </div>
                                                    </div>
                                                    <TrendingUp className={idx === 0 ? 'text-green-500' : 'text-blue-500'} size={24} />
                                                </div>
                                                
                                                <div className="flex-1 space-y-4">
                                                    <div className="p-5 bg-muted/10 rounded-[24px] border border-border/30">
                                                        <p className="text-xs font-medium leading-relaxed text-muted-foreground">
                                                            {s.summary || "해당 섹터에 대한 전문가들의 긍정적 내러티브가 강화되고 있습니다. 주요 수혜주를 중심으로 한 선별적 접근이 유효해 보입니다."}
                                                        </p>
                                                    </div>
                                                    
                                                    <div className="flex flex-wrap gap-2">
                                                        {s.related_stocks?.map((stk: any, i: number) => (
                                                            <div key={i} className="px-4 py-2 bg-background border border-border/40 rounded-xl text-[10px] font-bold flex items-center gap-2">
                                                                <span>{stk.name}</span>
                                                                <span className={stk.change > 0 ? 'text-red-500' : 'text-blue-500'}>
                                                                    {stk.change > 0 ? '+' : ''}{stk.change}%
                                                                </span>
                                                            </div>
                                                        ))}
                                                        {(!s.related_stocks || s.related_stocks.length === 0) && (
                                                            ['삼성전자', 'SK하이닉스', '한미반도체'].map(n => (
                                                                <div key={n} className="px-4 py-2 bg-background border border-border/40 rounded-xl text-[10px] font-bold flex items-center gap-2">
                                                                    <span>{n}</span>
                                                                    <span className="text-red-500">+1.2%</span>
                                                                </div>
                                                            ))
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                        {youtubeTrends.length === 0 && (
                                            <div className="col-span-full py-20 text-center bg-muted/5 border border-dashed border-border/40 rounded-3xl">
                                                <p className="text-muted-foreground font-medium">분석된 섹터 데이터가 없습니다. 먼저 즉시 분석을 수행하세요.</p>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {youtubeSubTab === 'feed' && (
                                    <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
                                        {insights.length === 0 && !loading && (
                                            <div className="flex flex-col items-center justify-center py-20 bg-muted/5 border border-dashed border-border/60 rounded-3xl space-y-4">
                                                <div className="p-4 bg-muted/20 rounded-full text-muted-foreground">
                                                    <Activity size={32} />
                                                </div>
                                                <div className="text-center">
                                                    <p className="font-bold text-muted-foreground">수집된 내러티브가 없습니다.</p>
                                                </div>
                                            </div>
                                        )}
                                        <div className="grid grid-cols-1 gap-4">
                                            {insights.map((insight) => {
                                                const summary = parseSummary(insight.summary_json);
                                                return (
                                                    <div key={insight.id} className="group flex flex-col md:flex-row gap-6 p-6 bg-muted/10 border border-border/50 hover:border-primary/30 rounded-2xl transition-all duration-300">
                                                        <div 
                                                            onClick={() => window.open(`https://youtube.com/watch?v=${insight.video_id}`)}
                                                            className="hidden md:flex shrink-0 w-48 aspect-video bg-muted rounded-xl items-center justify-center overflow-hidden relative group-hover:shadow-2xl transition-all duration-300 bg-cover bg-center cursor-pointer"
                                                            style={{ backgroundImage: `url(https://i.ytimg.com/vi/${insight.video_id}/mqdefault.jpg)` }}
                                                        >
                                                             <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-60 group-hover:opacity-40 transition-opacity" />
                                                             <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                                                 <PlayCircle size={40} className="text-white drop-shadow-lg" />
                                                             </div>
                                                        </div>
                                                        <div className="flex-1 space-y-3">
                                                            <div className="flex items-center justify-between">
                                                                <div className="flex items-center gap-2">
                                                                    <span className="px-2 py-0.5 bg-red-100 text-red-600 rounded text-[10px] font-black uppercase tracking-tighter">{insight.channel_name}</span>
                                                                    {summary?.contentType && (
                                                                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                                                            summary.contentType === 'MARKET_ANALYSIS' ? 'bg-blue-100 text-blue-600' :
                                                                            summary.contentType === 'STOCK_DEEP_DIVE' ? 'bg-purple-100 text-purple-600' :
                                                                            summary.contentType === 'ECONOMIC_INSIGHT' ? 'bg-amber-100 text-amber-600' :
                                                                            'bg-gray-100 text-gray-600'
                                                                        }`}>
                                                                            {summary.contentType}
                                                                        </span>
                                                                    )}
                                                                    <span className="text-[10px] text-muted-foreground font-medium">{new Date(insight.published_at).toLocaleString()}</span>
                                                                </div>
                                                            </div>
                                                            <div className="space-y-1">
                                                                <h4 
                                                                    onClick={() => window.open(`https://youtube.com/watch?v=${insight.video_id}`)}
                                                                    className="text-lg font-bold group-hover:text-primary transition-colors leading-snug cursor-pointer"
                                                                >
                                                                    {insight.title}
                                                                </h4>
                                                                {summary?.summary && (
                                                                    <p className="text-sm text-muted-foreground font-medium line-clamp-1">{summary.summary}</p>
                                                                )}
                                                            </div>
                                                            
                                                            {summary && (
                                                                <div className="flex flex-wrap items-center gap-x-6 gap-y-2 mt-2">
                                                                    {summary.topSectors?.length > 0 ? summary.topSectors.map((s: any, idx: number) => (
                                                                        <div key={idx} className="flex flex-col">
                                                                            <span className="text-[9px] uppercase font-bold text-muted-foreground tracking-widest leading-none">Target Sector</span>
                                                                            <div className="flex items-center gap-2 mt-1">
                                                                                <span className="text-xs font-bold">{s.sector}</span>
                                                                                <div className={`h-1.5 w-12 rounded-full bg-muted overflow-hidden`}>
                                                                                    <div 
                                                                                        className={`h-full ${s.bias > 0 ? 'bg-green-500' : 'bg-red-500'} transition-all`} 
                                                                                        style={{ width: `${Math.abs(s.bias) * 100}%` }}
                                                                                    />
                                                                                </div>
                                                                            </div>
                                                                        </div>
                                                                    )) : (
                                                                        <div className="flex items-center gap-2 text-muted-foreground italic text-[10px]">
                                                                            <Info size={12} /> 분석 결과 대기 중...
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            )}
                                                        </div>
                                                        <div className="flex flex-row md:flex-col justify-end gap-2 shrink-0 border-t md:border-t-0 md:border-l border-border/50 pt-4 md:pt-0 md:pl-6">
                                                            <button 
                                                                onClick={() => {
                                                                    setSelectedInsight(insight);
                                                                    setShowTranscriptModal(true);
                                                                }}
                                                                className="flex-1 md:flex-none px-4 py-2 border border-border hover:bg-muted rounded-xl text-[11px] font-bold transition-all"
                                                            >원문 보기</button>
                                                            <button 
                                                                onClick={() => {
                                                                    setSelectedInsight(insight);
                                                                    setShowDeepDiveModal(true);
                                                                }}
                                                                className="flex-1 md:flex-none px-4 py-2 bg-primary/10 text-primary hover:bg-primary/20 rounded-xl text-[11px] font-bold transition-all"
                                                            >AI 심층분석</button>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    )
                ) : (
            /* Market News View */
            <div className="space-y-8 animate-in slide-in-from-right-4 duration-500">
                {/* News Briefing Dashboard Header */}
                <div className="flex items-center justify-between">
                    <div className="space-y-1">
                        <h2 className="text-3xl font-extrabold tracking-tight flex items-center gap-2">
                            <MessageSquare className="text-primary" size={32} />
                            시장 뉴스 브리핑 센터
                        </h2>
                        <p className="text-muted-foreground font-medium">네이버 뉴스를 기반으로 한 시장 심리 및 내러티브를 분석합니다.</p>
                    </div>
                    <div className="flex gap-3">
                        <button 
                            onClick={() => setShowNewsSettingsModal(true)}
                            className="flex items-center gap-2 px-6 py-3 bg-muted hover:bg-muted/80 border border-border/40 rounded-2xl font-bold transition-all"
                        >
                            <SettingsIcon size={16} /> 설정
                        </button>
                        <button 
                            onClick={async () => {
                                setIsCollecting(true);
                                try {
                                    const res = await (window.electronAPI as any).generateNewsBriefingNow();
                                    if (res.success) {
                                        alert('뉴스 브리핑이 생성되었습니다.');
                                        await fetchData();
                                    } else {
                                        alert('뉴스 브리핑 생성 실패: ' + res.error);
                                    }
                                } finally {
                                    setIsCollecting(false);
                                }
                            }}
                            disabled={isCollecting}
                            className="flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-2xl font-bold shadow-xl shadow-primary/20 hover:opacity-90 transition-all disabled:opacity-50"
                        >
                            {isCollecting ? <RefreshCw size={14} className="animate-spin" /> : <Zap size={14} />} 즉시 뉴스 분석
                        </button>
                    </div>
                </div>

                {/* News Trends Dashboard - Divider style */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-12 py-8 border-y border-border/40">
                    {/* Leading Keywords Chart */}
                    <div className="space-y-6">
                        <div className="flex items-center justify-between">
                            <div>
                                <h3 className="text-xl font-black italic tracking-tighter text-foreground/80 uppercase">Leading Keywords</h3>
                                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">데일리 핵심 키워드 트렌드 (Top 5)</p>
                            </div>
                            <TrendingUp size={18} className="text-primary" />
                        </div>
                        <div className="h-[250px] w-full">
                            <ResponsiveContainer width="100%" height="100%">
                                <LineChart data={newsKeywordTrendData}>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" opacity={0.3} />
                                    <XAxis dataKey="date" fontSize={10} axisLine={false} tickLine={false} tick={{fill: '#64748b'}} />
                                    <YAxis domain={[0, 100]} hide />
                                    <Tooltip 
                                        contentStyle={{ backgroundColor: '#fff', borderRadius: '16px', border: '1px solid #E2E8F0', fontSize: '12px', fontWeight: 'bold' }}
                                    />
                                    <Legend iconType="circle" wrapperStyle={{ fontSize: '10px', fontWeight: 'black', paddingTop: '20px' }} />
                                    {distinctNewsKeywords.map((keyword, idx) => (
                                        <Line 
                                            key={keyword}
                                            type="monotone" 
                                            dataKey={keyword} 
                                            stroke={colors[idx % colors.length]} 
                                            strokeWidth={3}
                                            dot={{ r: 4, strokeWidth: 2, fill: '#fff' }}
                                            activeDot={{ r: 6, strokeWidth: 0 }}
                                            animationDuration={1500}
                                        />
                                    ))}
                                </LineChart>
                            </ResponsiveContainer>
                        </div>
                    </div>

                    {/* Market Sentiment Chart */}
                    <div className="space-y-6 md:border-l md:border-border/40 md:pl-12">
                        <div className="flex items-center justify-between">
                            <div>
                                <h3 className="text-xl font-black italic tracking-tighter text-foreground/80 uppercase">Market Sentiment</h3>
                                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">뉴스 기반 시장 심리 변화</p>
                            </div>
                            <Activity size={18} className="text-blue-500" />
                        </div>
                        <div className="h-[250px] w-full">
                            <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={newsSentimentChartData}>
                                    <defs>
                                        <linearGradient id="colorNewsSentiment" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#10b981" stopOpacity={0.2}/>
                                            <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" opacity={0.3} />
                                    <XAxis dataKey="date" fontSize={10} axisLine={false} tickLine={false} tick={{fill: '#64748b'}} />
                                    <YAxis domain={[0, 100]} hide />
                                    <Tooltip 
                                        contentStyle={{ backgroundColor: '#fff', borderRadius: '16px', border: '1px solid #E2E8F0', fontSize: '12px', fontWeight: 'bold' }}
                                        formatter={(val: any) => [`${((Number(val)/50)-1).toFixed(2)}`, 'Sentiment']}
                                    />
                                    <Area 
                                        type="monotone" 
                                        dataKey="sentiment" 
                                        stroke="#10b981" 
                                        strokeWidth={3}
                                        fillOpacity={1} 
                                        fill="url(#colorNewsSentiment)"
                                        animationDuration={2000}
                                    />
                                </AreaChart>
                            </ResponsiveContainer>
                        </div>
                    </div>
                </div>

                {/* Recent Briefings List - Divider separated */}
                <div className="space-y-8 py-4">
                    <h3 className="text-lg font-bold px-2">최근 데일리 내러티브 리포트</h3>
                    <div className="space-y-0">
                        {newsBriefings.length === 0 ? (
                            <div className="py-20 text-center bg-muted/5 border border-dashed border-border/40 rounded-3xl">
                                <p className="text-muted-foreground font-medium">생성된 브리핑이 없습니다.</p>
                            </div>
                        ) : (
                            newsBriefings.map((b, idx) => {
                                const data = JSON.parse(b.summary_json);
                                return (
                                    <div key={idx} className={`py-12 ${idx !== newsBriefings.length - 1 ? 'border-b border-border/40' : ''} space-y-8 px-2`}>
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-6">
                                                <div className="text-2xl font-black text-foreground">
                                                    {b.date}
                                                </div>
                                                <div className={`px-4 py-1.5 rounded-full text-[10px] font-black shadow-sm ${
                                                    data.sentiment > 0.5 ? 'bg-orange-500 text-white' : 
                                                    data.sentiment < -0.3 ? 'bg-blue-500 text-white' : 
                                                    'bg-emerald-500 text-white'
                                                }`}>
                                                    MARKET TEMPEARTURE: {data.sentiment > 0.5 ? '🔥 GREED' : data.sentiment < -0.3 ? '😨 FEAR' : '😐 NEUTRAL'} ({data.sentiment})
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-4">
                                                <span className="text-[10px] text-muted-foreground font-mono">ID: BR-${b.id} | {new Date(b.created_at).toLocaleString()}</span>
                                                <button 
                                                    onClick={() => handleSendTelegram('news', b, data)}
                                                    className="px-3 py-1 bg-blue-500/10 text-blue-600 hover:bg-blue-500/20 rounded-full text-[10px] font-bold flex items-center gap-1.5 transition-all"
                                                >
                                                    <Send size={12} /> Telegram 전송
                                                </button>
                                                <button 
                                                    onClick={() => {
                                                        const sources = b.source_news ? JSON.parse(b.source_news) : [];
                                                        setSelectedBriefingSources(sources);
                                                        setShowNewsSourceModal(true);
                                                    }}
                                                    className="p-2 hover:bg-muted rounded-full transition-all text-muted-foreground"
                                                    title="분석 뉴스 리스트"
                                                >
                                                    <Filter size={16} />
                                                </button>
                                            </div>
                                        </div>

                                        <div className="space-y-10">
                                            {/* Key Narratives Section (Unified Tags + Summary) */}
                                            <div className="space-y-6">
                                                <h5 className="text-[10px] font-black text-primary uppercase tracking-widest flex items-center gap-2">
                                                    <BrainCircuit size={14} /> 오늘의 핵심 내러티브 (KEY NARRATIVES)
                                                </h5>
                                                
                                                {(() => {
                                                    const hotKeywords = b.hot_keywords_json ? JSON.parse(b.hot_keywords_json) : [];
                                                    const hasNewFormat = hotKeywords.some((k: any) => k.summary);

                                                    if (hasNewFormat) {
                                                        return (
                                                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                                                {hotKeywords.map((kw: any, i: number) => (
                                                                    <div key={i} className="group p-5 bg-card/40 hover:bg-card/60 border border-border/40 hover:border-primary/30 rounded-[24px] transition-all duration-300 space-y-3 shadow-sm">
                                                                        <div className="flex items-center justify-between">
                                                                            <span className="px-3 py-1 bg-primary/5 text-primary border border-primary/20 rounded-full text-[10px] font-black tracking-tight group-hover:bg-primary group-hover:text-white transition-colors duration-300">
                                                                                #{kw.keyword}
                                                                            </span>
                                                                            <span className="text-[14px] font-black text-primary/40 group-hover:text-primary transition-colors">
                                                                                {kw.score}
                                                                            </span>
                                                                        </div>
                                                                        <p className="text-sm font-medium leading-relaxed text-foreground/80 pl-1 border-l-2 border-primary/20">
                                                                            {kw.summary}
                                                                        </p>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        );
                                                    } else {
                                                        // Legacy Fallback: 3-column summary grid + tags at bottom
                                                        const lines = Array.isArray(data.summary) ? data.summary : (typeof data.summary === 'string' ? data.summary.split('\n') : []);
                                                        return (
                                                            <div className="space-y-6">
                                                                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                                                    {lines.map((s: string, i: number) => (
                                                                        <div key={i} className="p-4 bg-muted/20 rounded-2xl border border-border/20 text-sm font-medium leading-relaxed">
                                                                            {s.replace(/^- /, '')}
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                                <div className="flex flex-wrap gap-2 pt-2">
                                                                    {hotKeywords.map((kw: any, i: number) => (
                                                                        <span key={i} className="px-3 py-1 bg-card border border-border/60 rounded-full text-[10px] font-black text-foreground/70 flex items-center gap-2">
                                                                            <div className="w-1.5 h-1.5 rounded-full bg-primary/60" />
                                                                            {kw.keyword} {kw.score}
                                                                        </span>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        );
                                                    }
                                                })()}
                                            </div>

                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
                                                {/* Pivot Analysis */}
                                                <div className="space-y-4">
                                                    <h5 className="text-[10px] font-black text-amber-600 uppercase tracking-widest flex items-center gap-2">
                                                        <Zap size={14} /> 어제 대비 변화 (PIVOT)
                                                    </h5>
                                                    <p className="text-sm font-medium leading-relaxed text-muted-foreground px-1 border-l-2 border-amber-500/30">
                                                        {data.pivot}
                                                    </p>
                                                </div>

                                                {/* Future Outlook */}
                                                <div className="space-y-4">
                                                    <h5 className="text-[10px] font-black text-blue-600 uppercase tracking-widest flex items-center gap-2">
                                                        <TrendingUp size={14} /> 향후 전망 및 유망 섹터
                                                    </h5>
                                                    <div className="space-y-3">
                                                        <p className="text-sm font-bold text-foreground/80 leading-relaxed italic">
                                                            " {data.outlook?.forecast || '시황 분석 중입니다.'} "
                                                        </p>
                                                        <div className="flex gap-2">
                                                            {data.outlook?.sectors?.map((sec: string, i: number) => (
                                                                <span key={i} className="px-3 py-1 bg-blue-500/5 text-blue-600 border border-blue-500/20 rounded-lg text-[10px] font-black">
                                                                    {sec}
                                                                </span>
                                                            ))}
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>
            </div>
        )}
    </div>
            
            {/* Collection Report Modal */}
            {showReportModal && collectionReport && (
                <div className="fixed inset-0 bg-black/70 backdrop-blur-md flex items-center justify-center z-[100] p-6 animate-in fade-in duration-300">
                    <div className="bg-background border border-border/60 w-full max-w-4xl max-h-[90vh] rounded-[32px] shadow-2xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-300">
                        {/* Modal Header */}
                        <div className="p-8 border-b border-border/40 flex items-center justify-between bg-muted/20">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-primary/10 rounded-xl">
                                    <Activity className="text-primary" size={24} />
                                </div>
                                <div>
                                    <h3 className="text-2xl font-black tracking-tight">마켓 내러티브 분석 리포트</h3>
                                    <p className="text-sm text-muted-foreground font-medium">최신 {collectionReport.count}개의 영상을 종합 분석한 결과입니다.</p>
                                </div>
                            </div>
                            <button onClick={() => setShowReportModal(false)} className="w-10 h-10 flex items-center justify-center bg-muted rounded-full hover:bg-muted/80 transition-all">
                                <X size={20} />
                            </button>
                        </div>

                        {/* Modal Body */}
                        <div className="flex-1 overflow-y-auto p-8 space-y-8">
                            {/* AI Summary Section */}
                            <div className="space-y-4">
                                <div className="flex items-center gap-2">
                                    <div className="w-2 h-6 bg-primary rounded-full" />
                                    <h4 className="text-lg font-bold">AI 종합 요약 및 전략</h4>
                                </div>
                                <div className="p-6 bg-primary/5 border border-primary/20 rounded-3xl leading-relaxed text-foreground whitespace-pre-wrap font-medium">
                                    {collectionReport.report}
                                </div>
                            </div>

                            {/* Pivot Analysis Section */}
                            {collectionReport.pivot && (
                                <div className="space-y-4">
                                    <div className="flex items-center gap-2">
                                        <div className="w-2 h-6 bg-amber-500 rounded-full" />
                                        <h4 className="text-lg font-bold flex items-center gap-2">
                                            <Zap size={18} className="text-amber-500" /> 세만틱 피보팅 감지 (Trend Shift)
                                        </h4>
                                    </div>
                                    <div className="p-6 bg-amber-500/5 border border-amber-500/20 rounded-3xl text-sm leading-relaxed text-foreground/90 font-medium">
                                        {collectionReport.pivot}
                                    </div>
                                </div>
                            )}

                            {/* Narrative Trends Pulse */}
                            {collectionReport.trends && collectionReport.trends.length > 0 && (
                                <div className="space-y-4">
                                    <div className="flex items-center gap-2">
                                        <div className="w-2 h-6 bg-blue-500 rounded-full" />
                                        <h4 className="text-lg font-bold">내러티브 트렌드 펄스 (Lifecycle)</h4>
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        {collectionReport.trends.map((t: any, i: number) => (
                                            <div key={i} className="p-4 bg-muted/10 border border-border/40 rounded-2xl flex items-center justify-between">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center text-[10px] font-black text-primary">
                                                        #{i + 1}
                                                    </div>
                                                    <span className="font-bold text-sm">{t.sector || t.name}</span>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <div className="w-24 h-1.5 bg-muted rounded-full overflow-hidden">
                                                        <div className="h-full bg-primary" style={{ width: `${(t.score > 1 ? t.score : t.score * 100)}%` }} />
                                                    </div>
                                                    <span className="text-[10px] font-bold text-muted-foreground">{(t.score > 1 ? t.score : t.score * 100).toFixed(0)}%</span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Sources List */}
                            <div className="space-y-4">
                                <div className="flex items-center gap-2">
                                    <div className="w-2 h-6 bg-muted-foreground/30 rounded-full" />
                                    <h4 className="text-lg font-bold">분석에 사용된 원본 리스트</h4>
                                </div>
                                <div className="grid grid-cols-1 gap-3">
                                    {collectionReport.sources?.map((src: any, idx: number) => (
                                        <div key={idx} className="flex items-center gap-4 p-4 bg-muted/10 border border-border/40 rounded-2xl hover:bg-muted/20 transition-all group">
                                            <div className="w-8 h-8 shrink-0 flex items-center justify-center bg-muted rounded-xl text-[10px] font-bold text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary transition-colors">
                                                {idx + 1}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2 mb-0.5">
                                                    <span className="text-[10px] font-black uppercase text-primary/70">{src.channel}</span>
                                                    <span className="text-[10px] text-muted-foreground">#{src.id}</span>
                                                </div>
                                                <p className="text-sm font-bold truncate">{src.title}</p>
                                            </div>
                                            <button 
                                                onClick={() => window.open(`https://youtube.com/watch?v=${src.id}`)}
                                                className="px-4 py-2 bg-background border border-border/60 hover:bg-muted rounded-xl text-[11px] font-bold transition-all shrink-0"
                                            >
                                                영상 보기
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Improvement Goals Status */}
                            <div className="space-y-4 p-6 bg-muted/5 rounded-[32px] border border-border/20">
                                <h4 className="text-xs font-black text-muted-foreground uppercase tracking-widest text-center mb-2">MAIIS 유튜브 파이프라인 고도화 완료 보고</h4>
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                    {[
                                        { label: '네러티브 연속성', status: '완료', color: 'text-green-500' },
                                        { label: '장기 흐름 추적', status: '완료', color: 'text-green-500' },
                                        { label: '피보팅 감지', status: '완료', color: 'text-green-500' },
                                        { label: 'L3 데이터 피딩', status: '준비완료', color: 'text-blue-500' },
                                    ].map((goal, idx) => (
                                        <div key={idx} className="flex flex-col items-center p-3 bg-background rounded-2xl border border-border/40">
                                            <span className="text-[10px] font-bold text-muted-foreground mb-1">{goal.label}</span>
                                            <span className={`text-xs font-black ${goal.color}`}>{goal.status}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>

                        {/* Modal Footer */}
                        <div className="p-6 border-t border-border/40 bg-muted/10 flex justify-end">
                            <button 
                                onClick={() => setShowReportModal(false)}
                                className="px-8 py-3 bg-primary text-primary-foreground font-black rounded-2xl shadow-xl shadow-primary/20 hover:opacity-90 transition-all"
                            >
                                분석 내용 확인 완료
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Transcript Modal */}
            {showTranscriptModal && selectedInsight && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[110] p-6 animate-in fade-in duration-200">
                    <div className="bg-background border border-border/60 w-full max-w-2xl max-h-[80vh] rounded-3xl shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
                        <div className="p-6 border-b border-border/40 flex items-center justify-between">
                            <h3 className="font-bold truncate pr-4">{selectedInsight.title} (자막 원문)</h3>
                            <button onClick={() => setShowTranscriptModal(false)} className="shrink-0 w-8 h-8 flex items-center justify-center hover:bg-muted rounded-full transition-colors">
                                <X size={18} />
                            </button>
                        </div>
                        <div className="flex-1 overflow-y-auto p-6 bg-muted/5">
                            <div className="text-sm leading-relaxed whitespace-pre-wrap font-medium text-muted-foreground">
                                {selectedInsight.transcript || '별도의 자막 데이터가 수집되지 않았습니다.'}
                            </div>
                        </div>
                        <div className="p-4 border-t border-border/40 flex justify-end bg-muted/10">
                            <button onClick={() => setShowTranscriptModal(false)} className="px-5 py-2 bg-muted hover:bg-muted/80 rounded-xl text-xs font-bold transition-all">닫기</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Deep Dive Modal */}
            {showDeepDiveModal && selectedInsight && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[110] p-6 animate-in fade-in duration-200">
                    <div className="bg-background border border-border/60 w-full max-w-3xl max-h-[85vh] rounded-[40px] shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-bottom-8 duration-300">
                        <div className="p-8 border-b border-border/40 flex items-center justify-between bg-primary/5">
                            <div className="flex items-center gap-3">
                                <TrendingUp className="text-primary" size={24} />
                                <h3 className="text-xl font-black tracking-tight italic">AI INSIGHT DEEP DIVE</h3>
                            </div>
                            <button onClick={() => setShowDeepDiveModal(false)} className="shrink-0 w-10 h-10 flex items-center justify-center hover:bg-muted rounded-full transition-colors">
                                <X size={20} />
                            </button>
                        </div>
                        <div className="flex-1 overflow-y-auto p-8 space-y-8">
                            <div className="space-y-2">
                                <h4 className="text-2xl font-black leading-tight">{selectedInsight.title}</h4>
                                <p className="text-xs font-bold text-primary/70">{selectedInsight.channel_name} • {new Date(selectedInsight.published_at).toLocaleString()}</p>
                            </div>

                            {(() => {
                                const s = parseSummary(selectedInsight.summary_json);
                                if (!s || s.status === 'pending') return <div className="p-8 text-center text-muted-foreground font-bold italic">분석 결과가 아직 준비되지 않았습니다.</div>;
                                return (
                                    <div className="space-y-8">
                                        {/* Row 1: Detailed Narrative Analysis */}
                                        <div className="p-8 bg-primary/5 border border-primary/10 rounded-[32px] space-y-4">
                                            <div className="flex items-center gap-2">
                                                <div className="w-1.5 h-4 bg-primary rounded-full" />
                                                <h5 className="text-xs font-black text-primary uppercase tracking-widest">수석 전략가 심층 분석</h5>
                                            </div>
                                            <div className="text-sm font-medium leading-[1.8] text-foreground whitespace-pre-wrap">
                                                {s.detailedAnalysis || s.summary}
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                            <div className="space-y-6">
                                                <div className="space-y-4">
                                                    <h5 className="text-[10px] font-black text-muted-foreground uppercase tracking-widest flex items-center gap-2">
                                                        <Activity size={12} /> 주요 섹터 진단
                                                    </h5>
                                                    <div className="space-y-4">
                                                        {s.topSectors?.map((ts: any, idx: number) => (
                                                            <div key={idx} className="bg-muted/10 p-5 rounded-3xl border border-border/40 space-y-3">
                                                                <div className="flex justify-between items-center">
                                                                    <span className="font-black text-sm">{ts.sector}</span>
                                                                    <span className={`px-2 py-0.5 rounded text-[8px] font-black ${ts.bias > 0.5 ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'}`}>
                                                                        {ts.bias > 0.5 ? 'BULLISH' : 'CAUTION'}
                                                                    </span>
                                                                </div>
                                                                {ts.reasoning && <p className="text-[11px] text-muted-foreground font-medium leading-relaxed">{ts.reasoning}</p>}
                                                                <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                                                                    <div className={`h-full ${ts.bias > 0.5 ? 'bg-green-500' : 'bg-red-500'} transition-all`} style={{ width: `${ts.bias * 100}%` }} />
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="space-y-6">
                                                <div className="space-y-4">
                                                    <h5 className="text-[10px] font-black text-muted-foreground uppercase tracking-widest flex items-center gap-2">
                                                        <TrendingUp size={12} /> 내러티브 지표
                                                    </h5>
                                                    <div className="grid grid-cols-2 gap-4">
                                                        <div className="bg-muted/10 p-5 rounded-3xl border border-border/40 text-center">
                                                            <span className="text-[10px] text-muted-foreground block mb-2 font-bold">Sentiment</span>
                                                            <span className="text-2xl font-black text-primary">{(s.sentiment * 100).toFixed(0)}%</span>
                                                        </div>
                                                        <div className="bg-muted/10 p-5 rounded-3xl border border-border/40 text-center">
                                                            <span className="text-[10px] text-muted-foreground block mb-2 font-bold">Impact</span>
                                                            <span className="text-2xl font-black text-amber-500">{s.impactScore}/10</span>
                                                        </div>
                                                    </div>
                                                </div>
                                                <div className="space-y-4">
                                                    <h5 className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">추천 키워드</h5>
                                                    <div className="flex flex-wrap gap-2">
                                                        {s.keywords?.map((k: string) => (
                                                            <span key={k} className="px-3 py-2 bg-background border border-border/60 text-muted-foreground text-[10px] font-bold rounded-xl hover:border-primary/40 hover:text-primary transition-all cursor-default">#{k}</span>
                                                        ))}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })()}
                        </div>
                        <div className="p-8 border-t border-border/40 bg-muted/5 flex items-center justify-between">
                            <button 
                                onClick={() => handleReanalyze(selectedInsight.video_id)}
                                disabled={isReanalyzing}
                                className="flex items-center gap-2 px-6 py-3 border border-border hover:bg-muted rounded-2xl text-[13px] font-bold transition-all disabled:opacity-50"
                            >
                                <RefreshCw size={14} className={isReanalyzing ? 'animate-spin' : ''} />
                                {isReanalyzing ? '분석 중...' : '다시 분석하기'}
                            </button>
                            <button onClick={() => setShowDeepDiveModal(false)} className="px-10 py-3 bg-primary text-primary-foreground font-black rounded-2xl shadow-xl shadow-primary/20 hover:opacity-90 transition-all">확인</button>
                        </div>
                    </div>
                </div>
            )}
            {/* Add Channel Modal */}
            {showAddModal && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[130] p-6 animate-in fade-in duration-300">
                    <div className="bg-background border border-border p-8 rounded-[32px] shadow-2xl w-full max-w-md space-y-6 animate-in zoom-in-95 duration-300">
                        <div className="flex items-center justify-between">
                            <h3 className="text-xl font-bold">새 분석 채널 추가</h3>
                            <button onClick={() => setShowAddModal(false)} className="w-8 h-8 flex items-center justify-center hover:bg-muted rounded-full transition-all">
                                <X size={18} />
                            </button>
                        </div>
                        
                        <form onSubmit={handleAddChannel} className="space-y-4">
                            <div className="space-y-2">
                                <label className="text-xs font-bold text-muted-foreground ml-1">채널 ID 또는 핸들 (@name)</label>
                                <input 
                                    type="text" 
                                    required
                                    className="w-full bg-muted/40 border border-border/40 rounded-xl px-4 py-3 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all outline-none"
                                    placeholder="예: @expert_channel 또는 UC..."
                                    value={newChannelId}
                                    onChange={(e) => setNewChannelId(e.target.value)}
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-xs font-bold text-muted-foreground ml-1">채널 표시 이름</label>
                                <input 
                                    type="text" 
                                    required
                                    className="w-full bg-muted/40 border border-border/40 rounded-xl px-4 py-3 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all outline-none"
                                    placeholder="예: 매경 월가월부"
                                    value={newChannelName}
                                    onChange={(e) => setNewChannelName(e.target.value)}
                                />
                            </div>
                            
                            <div className="pt-4 flex gap-3">
                                <button 
                                    type="button"
                                    onClick={() => setShowAddModal(false)}
                                    className="flex-1 py-3 bg-muted hover:bg-muted/80 rounded-xl font-bold text-sm transition-all"
                                >취소</button>
                                <button 
                                    type="submit"
                                    className="flex-1 py-3 bg-primary text-primary-foreground rounded-xl font-bold text-sm shadow-lg shadow-primary/20 hover:opacity-90 transition-all"
                                >채널 추가</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
            {/* Youtube Settings Modal */}
            {showYtSettingsModal && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[120] p-6 animate-in fade-in duration-300">
                    <div className="bg-background border border-border p-8 rounded-[32px] shadow-2xl w-full max-w-md space-y-8 animate-in zoom-in-95 duration-300">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-red-600/10 rounded-xl">
                                    <SettingsIcon className="text-red-600" size={24} />
                                </div>
                                <h3 className="text-2xl font-black">유튜브 수집 설정</h3>
                            </div>
                            <button onClick={() => setShowYtSettingsModal(false)} className="w-10 h-10 flex items-center justify-center hover:bg-muted rounded-full transition-all">
                                <X size={20} />
                            </button>
                        </div>

                        <div className="space-y-6">
                            <div className="flex items-center justify-between p-4 bg-muted/20 rounded-2xl border border-border/40">
                                <div className="space-y-0.5">
                                    <label className="text-sm font-bold">자동 수집 활성화</label>
                                    <p className="text-[10px] text-muted-foreground">정해진 시간에 자동으로 영상을 수집합니다.</p>
                                </div>
                                <button 
                                    onClick={() => setYtSettings({...ytSettings, enabled: !ytSettings.enabled})}
                                    className={`w-12 h-6 rounded-full transition-all relative ${ytSettings.enabled ? 'bg-primary shadow-lg shadow-primary/20' : 'bg-muted'}`}
                                >
                                    <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${ytSettings.enabled ? 'left-7' : 'left-1'}`} />
                                </button>
                            </div>

                            <div className="space-y-3">
                                <label className="text-xs font-black text-muted-foreground uppercase tracking-widest ml-1">Daily 수집 시점</label>
                                <div className="relative">
                                    <Clock className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
                                    <input 
                                        type="time"
                                        className="w-full bg-muted/40 border border-border/40 rounded-xl pl-12 pr-4 py-3 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all outline-none"
                                        value={ytSettings.collectTime}
                                        onChange={(e) => setYtSettings({...ytSettings, collectTime: e.target.value})}
                                    />
                                </div>
                                <p className="text-[10px] text-amber-500 font-medium px-1">* 장 전(08:30경) 수집을 권장합니다.</p>
                            </div>

                            <button 
                                onClick={() => {
                                    setShowYtSettingsModal(false);
                                    setActiveView('management');
                                }}
                                className="w-full py-3 bg-muted/30 hover:bg-muted/50 border border-dashed border-border/60 rounded-xl text-xs font-bold text-muted-foreground transition-all flex items-center justify-center gap-2"
                            >
                                <Users size={14} /> 구독 채널 리스트 관리로 이동
                            </button>
                        </div>

                        <div className="pt-4 flex gap-3">
                            <button 
                                onClick={() => setShowYtSettingsModal(false)}
                                className="flex-1 py-4 bg-muted hover:bg-muted/80 rounded-2xl font-black text-sm transition-all"
                            >취소</button>
                            <button 
                                onClick={async () => {
                                    const res = await (window.electronAPI as any).saveYoutubeSettings(ytSettings);
                                    if (res.success) {
                                        setShowYtSettingsModal(false);
                                        alert('유튜브 수집 설정이 저장되었습니다.');
                                    }
                                }}
                                className="flex-1 py-4 bg-primary text-primary-foreground rounded-2xl font-black text-sm shadow-xl shadow-primary/20 hover:opacity-90 transition-all"
                            >설정 저장</button>
                        </div>
                    </div>
                </div>
            )}

            {/* News Settings Modal */}
            {showNewsSettingsModal && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[120] p-6 animate-in fade-in duration-300">
                    <div className="bg-background border border-border p-8 rounded-[32px] shadow-2xl w-full max-w-lg space-y-8 animate-in zoom-in-95 duration-300">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-primary/10 rounded-xl">
                                    <SettingsIcon className="text-primary" size={24} />
                                </div>
                                <h3 className="text-2xl font-black">시장 뉴스 수집 설정</h3>
                            </div>
                            <button onClick={() => setShowNewsSettingsModal(false)} className="w-10 h-10 flex items-center justify-center hover:bg-muted rounded-full transition-all">
                                <X size={20} />
                            </button>
                        </div>

                        <div className="space-y-6">
                            <div className="space-y-4">
                                <div className="flex items-center justify-between">
                                    <label className="text-sm font-bold flex items-center gap-2"><Search size={16}/> 분석 키워드</label>
                                    <span className="text-[10px] text-muted-foreground font-medium">{newsSettings.keywords.length}개 등록됨</span>
                                </div>
                                
                                <div className="flex gap-2">
                                    <input 
                                        type="text"
                                        className="flex-1 bg-muted/40 border border-border/40 rounded-xl px-4 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all outline-none"
                                        placeholder="추가할 키워드 입력..."
                                        value={newKeyword}
                                        onChange={(e) => setNewKeyword(e.target.value)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter' && newKeyword.trim()) {
                                                if (!newsSettings.keywords.includes(newKeyword.trim())) {
                                                    setNewsSettings({
                                                        ...newsSettings,
                                                        keywords: [...newsSettings.keywords, newKeyword.trim()]
                                                    });
                                                }
                                                setNewKeyword('');
                                            }
                                        }}
                                    />
                                    <button 
                                        onClick={() => {
                                            if (newKeyword.trim()) {
                                                if (!newsSettings.keywords.includes(newKeyword.trim())) {
                                                    setNewsSettings({
                                                        ...newsSettings,
                                                        keywords: [...newsSettings.keywords, newKeyword.trim()]
                                                    });
                                                }
                                                setNewKeyword('');
                                            }
                                        }}
                                        className="p-2 bg-primary text-primary-foreground rounded-xl hover:opacity-90 transition-all"
                                    >
                                        <Plus size={20} />
                                    </button>
                                </div>

                                <div className="flex flex-wrap gap-2 max-h-40 overflow-y-auto p-2 bg-muted/20 border border-border/40 rounded-2xl">
                                    {newsSettings.keywords.length === 0 ? (
                                        <p className="text-[11px] text-muted-foreground p-2 italic w-full text-center">등록된 키워드가 없습니다.</p>
                                    ) : (
                                        newsSettings.keywords.map((kw: string, i: number) => (
                                            <div key={i} className="flex items-center gap-2 px-3 py-1.5 bg-background border border-border/60 rounded-xl text-xs font-bold group">
                                                <span>{kw}</span>
                                                <button 
                                                    onClick={() => {
                                                        setNewsSettings({
                                                            ...newsSettings,
                                                            keywords: newsSettings.keywords.filter((_: any, index: number) => index !== i)
                                                        });
                                                    }}
                                                    className="text-muted-foreground hover:text-destructive transition-colors"
                                                >
                                                    <X size={14} />
                                                </button>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </div>

                            <div className="space-y-4">
                                <h5 className="text-[11px] font-black text-primary/70 uppercase tracking-widest flex items-center gap-2">
                                    <BrainCircuit size={14} /> AI 추적 키워드 (Pool)
                                </h5>
                                <div className="p-4 bg-primary/5 border border-primary/20 rounded-2xl space-y-3">
                                    {(!newsSettings.ai_keywords_pool || newsSettings.ai_keywords_pool.length === 0) ? (
                                        <p className="text-[11px] text-muted-foreground italic text-center py-2">아직 발견된 이슈가 없습니다. 브리핑 생성 시 업데이트됩니다.</p>
                                    ) : (
                                        <div className="flex flex-wrap gap-2">
                                            {newsSettings.ai_keywords_pool.map((aiK: any, i: number) => (
                                                <div key={i} className="px-2.5 py-1.5 bg-background border border-primary/20 rounded-xl text-[10px] font-bold flex items-center gap-2" title={aiK.reason}>
                                                    <span className="text-primary">#{aiK.keyword}</span>
                                                    <span className="text-muted-foreground opacity-50">{Math.round(aiK.score * 100)}%</span>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                    <p className="text-[9px] text-muted-foreground leading-relaxed">AI가 최근 브리핑을 분석해 지속성이 높은 키워드를 자동 발굴하고 점수화합니다. 점수가 낮아지면 자동으로 삭제됩니다.</p>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <label className="text-xs font-bold text-muted-foreground ml-1">최대 키워드 수 (User+AI)</label>
                                    <input 
                                        type="number" 
                                        min="3"
                                        max="10"
                                        className="w-full bg-muted/40 border border-border/40 rounded-xl px-4 py-3 text-sm font-bold focus:outline-none"
                                        value={newsSettings.max_total_keywords || 5}
                                        onChange={(e) => setNewsSettings({ ...newsSettings, max_total_keywords: parseInt(e.target.value) })}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-xs font-bold text-muted-foreground ml-1">리포트 자동 생성 시간</label>
                                    <input 
                                        type="time" 
                                        className="w-full bg-muted/40 border border-border/40 rounded-xl px-4 py-3 text-sm font-bold focus:outline-none"
                                        value={newsSettings.reportTime}
                                        onChange={(e) => setNewsSettings({ ...newsSettings, reportTime: e.target.value })}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-xs font-bold text-muted-foreground ml-1">텔레그램 전송 시간</label>
                                    <input 
                                        type="time" 
                                        className="w-full bg-muted/40 border border-border/40 rounded-xl px-4 py-3 text-sm font-bold focus:outline-none"
                                        value={newsSettings.telegramTime}
                                        onChange={(e) => setNewsSettings({ ...newsSettings, telegramTime: e.target.value })}
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="pt-4 flex gap-3">
                            <button 
                                onClick={() => setShowNewsSettingsModal(false)}
                                className="flex-1 py-4 bg-muted hover:bg-muted/80 rounded-2xl font-bold transition-all"
                            >닫기</button>
                            <button 
                                onClick={async () => {
                                    await (window.electronAPI as any).saveNewsSettings(newsSettings);
                                    alert('설정이 저장되었습니다.');
                                    setShowNewsSettingsModal(false);
                                }}
                                className="flex-1 py-4 bg-primary text-primary-foreground rounded-2xl font-bold shadow-lg shadow-primary/20 hover:opacity-90 transition-all"
                            >저장하기</button>
                        </div>
                    </div>
                </div>
            )}

            {/* News Source Modal */}
            {showNewsSourceModal && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[120] p-6 animate-in fade-in duration-300">
                    <div className="bg-background border border-border w-full max-w-2xl max-h-[80vh] rounded-[32px] shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-300">
                        <div className="p-8 border-b border-border/40 flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-muted rounded-xl">
                                    <MessageSquare size={20} />
                                </div>
                                <h3 className="text-xl font-bold">분석 대상 뉴스 리스트</h3>
                            </div>
                            <button onClick={() => setShowNewsSourceModal(false)} className="w-10 h-10 flex items-center justify-center hover:bg-muted rounded-full transition-all">
                                <X size={20} />
                            </button>
                        </div>
                        <div className="flex-1 overflow-y-auto p-8 space-y-3">
                            {selectedBriefingSources.length === 0 ? (
                                <p className="text-center text-muted-foreground py-10 font-medium">수집된 뉴스 소스가 없습니다.</p>
                            ) : (
                                selectedBriefingSources.map((news, idx) => (
                                    <div key={idx} className="p-4 bg-muted/10 border border-border/40 rounded-2xl hover:bg-muted/20 transition-all group flex items-start gap-4">
                                        <div className="w-8 h-8 shrink-0 flex items-center justify-center bg-muted rounded-xl text-[10px] font-bold text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary transition-colors">
                                            {idx + 1}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-bold leading-snug mb-1" dangerouslySetInnerHTML={{ __html: news.title }} />
                                            <div className="flex items-center gap-2 text-[10px] text-muted-foreground font-medium">
                                                <span>{new Date(news.pubDate).toLocaleString()}</span>
                                                {news.url && (
                                                    <button 
                                                        onClick={() => window.open(news.url)}
                                                        className="text-primary hover:underline"
                                                    >링크 보기</button>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                        <div className="p-6 border-t border-border/40 bg-muted/10 flex justify-end">
                            <button 
                                onClick={() => setShowNewsSourceModal(false)}
                                className="px-6 py-2.5 bg-background border border-border hover:bg-muted rounded-xl text-xs font-bold transition-all"
                            >닫기</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
