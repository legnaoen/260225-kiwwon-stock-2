import React, { useState, useEffect, useCallback } from 'react';
import { Database, Play, CheckCircle2, XCircle, Clock, Server, FileJson, FileText, Bug, Plus, Trash2, Youtube, Settings as SettingsIcon, Radio, RefreshCw, ExternalLink, ChevronDown, ChevronRight, Newspaper } from 'lucide-react';
import { cn } from '../../utils';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

type PipelineStatus = 'idle' | 'running' | 'success' | 'failed';

const PIPELINES = [
    { id: 'PL-MarketDaily', name: 'Market Daily (All OHLCV)', description: '전 종목 60봉 데이터 캐싱 펌프', status: 'idle', lastRun: '--:--:--', timeMs: 0 },
    { id: 'PL-Macro', name: 'Macro & Global', description: '글로벌 지수, 환율, VIX 및 이평선 가공', status: 'success', lastRun: '14:20:00', timeMs: 340 },
    { id: 'PL-LocalFlow', name: 'Domestic Flow', description: '코스피/코스닥 외인·기관 누적 수급', status: 'idle', lastRun: '--:--:--', timeMs: 0 },
    { id: 'PL-RisingStock', name: 'Rising Stocks', description: '당일 특징주 및 급등주 리스트 픽업', status: 'success', lastRun: '15:30:10', timeMs: 80 },
    { id: 'PL-NewsKeyword', name: 'News Hot Keywords', description: '네이버 시황 메가 키워드 TOP 5 압축', status: 'failed', lastRun: '09:12:35', timeMs: 1250 },
    { id: 'PL-NewsFlow', name: 'Naver Market News', description: '네이버 증권 핵심 뉴스 (주요/해외) 수집', status: 'idle', lastRun: '--:--:--', timeMs: 0 },
    { id: 'PL-NaverFlow', name: 'Sector/Theme Context', description: '네이버 증권 업종/테마 분석 및 주도주 태깅', status: 'idle', lastRun: '--:--:--', timeMs: 0 },
    { id: 'PL-InvestorFlow', name: 'Intraday Investor Flow', description: '실시간 현선물 외인/기관 주체별 수급 (네이버 모바일)', status: 'idle', lastRun: '--:--:--', timeMs: 0 },
    { id: 'PL-Research', name: 'Naver Research (Top 3)', description: '최근 1주간 애널리스트 집중 산업 및 리포트 본문', status: 'idle', lastRun: '--:--:--', timeMs: 0 },
    { id: 'PL-NaverSearch', name: 'Dynamic Naver Search', description: '키워드 기반 맞춤형 동적 네이버 뉴스 검색 (테스트/디버깅용)', status: 'idle', lastRun: '--:--:--', timeMs: 0 },
    { id: 'PL-FinanceInfo', name: 'Naver Finance (coinfo)', description: '종목명 기반 재무제표 및 기업개요 (md_browse)', status: 'idle', lastRun: '--:--:--', timeMs: 0 }
];

export default function PipelineMonitorTab() {
    const [selectedId, setSelectedId] = useState<string>('PL-Macro');
    const [viewTab, setViewTab] = useState<'agent-view' | 'raw-json' | 'source-data'>('agent-view');
    const [isExecuting, setIsExecuting] = useState(false);
    const [pipelineResults, setPipelineResults] = useState<Record<string, any>>({});
    const [forceFetch, setForceFetch] = useState(false);
    const [searchKeyword, setSearchKeyword] = useState<string>('');

    // ── News Hub 상태 ──
    const [newsHubSelected, setNewsHubSelected] = useState(false);
    const [hubStatus, setHubStatus] = useState<any>(null);
    const [hubArticles, setHubArticles] = useState<any[]>([]);
    const [hubCollecting, setHubCollecting] = useState(false);
    const [hubExpandedCategories, setHubExpandedCategories] = useState<Record<string, boolean>>({ MAJOR: true, GLOBAL: true, KEYWORD_SEARCH: false, STOCK_ANALYSIS: false, GLOBAL_MARKET: false });

    // YouTube 채널 관리 상태
    const [ytChannels, setYtChannels] = useState<any[]>([]);
    const [newChannelId, setNewChannelId] = useState('');
    const [newChannelName, setNewChannelName] = useState('');
    const [isAddingChannel, setIsAddingChannel] = useState(false);

    // NaverFlow 설정 상태
    const [showNfSettings, setShowNfSettings] = useState(false);
    const [nfSettings, setNfSettings] = useState({ enabled: false, scheduleSlots: [{ time: '09:30', enabled: true }, { time: '15:30', enabled: true }] });

    // 파이프라인 선택 시 관련 데이터 로드
    useEffect(() => {
        if (selectedId === 'PL-YoutubeContext') {
            loadYtChannels();
        } else if (selectedId === 'PL-NaverFlow') {
            const api = window.electronAPI as any;
            if (api.getNaverFlowSettings) {
                api.getNaverFlowSettings().then((s: any) => setNfSettings(s));
            }
        }
    }, [selectedId]);

    // News Hub 선택 시 데이터 로드
    const loadNewsHubData = useCallback(async () => {
        try {
            const api = window.electronAPI as any;
            const [status, articles] = await Promise.all([
                api.getNewsHubCacheStatus(),
                api.getNewsHubArticles()
            ]);
            setHubStatus(status);
            setHubArticles(articles || []);
        } catch (e) { console.error('[NewsHub] 데이터 로드 실패:', e); }
    }, []);

    useEffect(() => {
        if (newsHubSelected) {
            loadNewsHubData();
            const interval = setInterval(loadNewsHubData, 30000); // 30초 자동 갱신
            return () => clearInterval(interval);
        }
    }, [newsHubSelected, loadNewsHubData]);

    const handleNewsHubCollectNow = async () => {
        setHubCollecting(true);
        try {
            const api = window.electronAPI as any;
            const res = await api.collectNewsHubNow();
            if (res && res.success === false) {
                alert(`[Hub 수집 실패]: ${res.error || '알 수 없는 오류'}`);
            } else if (res && res.collected === 0) {
                alert(`수집 결과 0건. (네이버 API 키가 없거나, proxy_json 서버가 에러를 반환했을 수 있습니다.)`);
            }
            await loadNewsHubData();
        } catch (e: any) { alert(`수집 실행 에러: ${e.message}`); }
        finally { setHubCollecting(false); }
    };

    const toggleCategory = (cat: string) => {
        setHubExpandedCategories(prev => ({ ...prev, [cat]: !prev[cat] }));
    };


    const loadYtChannels = async () => {
        try {
            const api = window.electronAPI as any;
            if (api.getYoutubeChannels) {
                const data = await api.getYoutubeChannels();
                setYtChannels(data || []);
            }
        } catch (e) { console.error(e); }
    };

    const handleAddYtChannel = async () => {
        if (!newChannelId.trim() || !newChannelName.trim()) return;
        try {
            const api = window.electronAPI as any;
            const result = await api.addYoutubeChannel({ id: newChannelId.trim(), name: newChannelName.trim() });
            if (result?.success) {
                setNewChannelId('');
                setNewChannelName('');
                setIsAddingChannel(false);
                await loadYtChannels();
            } else {
                alert('채널 추가 실패');
            }
        } catch (e: any) { alert(`오류: ${e.message}`); }
    };

    const handleRemoveYtChannel = async (id: string) => {
        if (!confirm('이 채널을 삭제하시겠습니까?')) return;
        try {
            const api = window.electronAPI as any;
            const result = await api.removeYoutubeChannel(id);
            if (result?.success) await loadYtChannels();
        } catch (e: any) { alert(`오류: ${e.message}`); }
    };

    const activePipeline = PIPELINES.find(p => p.id === selectedId);

    // PL 선택 시 News Hub 해제, News Hub 선택 시 PL 해제
    const handlePipelineSelect = (id: string) => {
        setNewsHubSelected(false);
        setSelectedId(id);
    };
    const handleNewsHubSelect = () => {
        setNewsHubSelected(true);
        setSelectedId('');
    };

    const handleRunClick = async () => {
        if (!activePipeline) return;
        
        setIsExecuting(true);
        try {
            const options: any = { forceFetch };
            if (activePipeline.id === 'PL-NaverSearch' || activePipeline.id === 'PL-FinanceInfo') {
                if (!searchKeyword.trim()) {
                    alert('검색 텍스트 필드에 테스트할 종목명/키워드를 입력하세요.');
                    setIsExecuting(false);
                    return;
                }
                options.keyword = searchKeyword.trim();
            }

            const res = await window.electronAPI.runV2Pipeline(activePipeline.id, options);
            if (res.success && res.data) {
                setPipelineResults(prev => ({
                    ...prev,
                    [activePipeline.id]: res.data
                }));
            } else {
                alert(`Error: ${res.error}`);
            }
        } catch (error) {
            console.error(error);
            alert('Pipeline execution failed.');
        } finally {
            setIsExecuting(false);
        }
    };

    const handleSaveNfSettings = async () => {
        try {
            const api = window.electronAPI as any;
            if (api.saveNaverFlowSettings) {
                const res = await api.saveNaverFlowSettings(nfSettings);
                if (res.success) {
                    alert('설정이 저장되었으며 백그라운드 스케줄러가 재시작 되었습니다.');
                    setShowNfSettings(false);
                } else {
                    alert('설정 저장 실패: ' + res.error);
                }
            }
        } catch (e: any) { alert(`오류: ${e.message}`); }
    };

    return (
        <div className="flex w-full h-full bg-background overflow-hidden text-sm">
            
            {/* ====== [Master] Left Sidebar (고밀도 트리뷰 형태) ====== */}
            <div className="w-64 border-r flex flex-col bg-muted/10 shrink-0">
                <div className="px-4 py-3 border-b flex items-center justify-between">
                    <h2 className="text-sm font-bold flex items-center gap-2 tracking-tight">
                        <Server className="text-primary" size={16} />
                        Data Pipelines
                    </h2>
                    <span className="text-xs text-muted-foreground bg-muted border px-2 py-0.5 rounded">V2</span>
                </div>
                
                <div className="flex-1 overflow-y-auto py-2">
                    {PIPELINES.map(pl => (
                        <button
                            key={pl.id}
                            onClick={() => handlePipelineSelect(pl.id)}
                            className={cn(
                                "w-full text-left px-4 py-2 flex flex-col gap-0.5 transition-colors",
                                selectedId === pl.id && !newsHubSelected
                                    ? "bg-primary/5 border-r-2 border-primary" 
                                    : "hover:bg-muted/50 border-r-2 border-transparent"
                            )}
                        >
                            <div className="flex items-center justify-between">
                                <span className={cn(
                                    "font-medium tracking-tight text-sm",
                                    selectedId === pl.id && !newsHubSelected ? "text-primary font-bold" : "text-foreground/80"
                                )}>
                                    {pl.id}
                                </span>
                                {pl.status === 'success' && <CheckCircle2 size={14} className="text-green-500" />}
                                {pl.status === 'failed' && <XCircle size={14} className="text-red-500" />}
                                {pl.status === 'idle' && <Database size={14} className="text-muted-foreground/30" />}
                            </div>
                            <div className="text-xs text-muted-foreground line-clamp-1">{pl.name}</div>
                        </button>
                    ))}

                    {/* ── News Hub 구분선 ── */}
                    <div className="mx-4 my-2 border-t border-border/50" />
                    <div className="px-4 py-1">
                        <span className="text-[10px] font-bold tracking-widest text-muted-foreground uppercase">Watchtower</span>
                    </div>
                    <button
                        onClick={handleNewsHubSelect}
                        className={cn(
                            "w-full text-left px-4 py-2 flex flex-col gap-0.5 transition-colors",
                            newsHubSelected
                                ? "bg-amber-500/5 border-r-2 border-amber-500"
                                : "hover:bg-muted/50 border-r-2 border-transparent"
                        )}
                    >
                        <div className="flex items-center justify-between">
                            <span className={cn(
                                "font-medium tracking-tight text-sm flex items-center gap-1.5",
                                newsHubSelected ? "text-amber-500 font-bold" : "text-foreground/80"
                            )}>
                                <Radio size={13} className={newsHubSelected ? "text-amber-500" : "text-muted-foreground"} />
                                NEWS_HUB
                            </span>
                            {hubStatus?.isValid
                                ? <CheckCircle2 size={14} className="text-amber-400" />
                                : <XCircle size={14} className="text-muted-foreground/30" />}
                        </div>
                        <div className="text-xs text-muted-foreground line-clamp-1">중앙 뉴스 감시탑</div>
                    </button>
                </div>
            </div>

            {/* ====== [Detail] Right Main Content ====== */}
            <div className="flex-1 flex flex-col min-w-0 bg-background">
                {/* ── News Hub 상세 뷰 ── */}
                {newsHubSelected ? (
                    <NewsHubDetailView
                        status={hubStatus}
                        articles={hubArticles}
                        collecting={hubCollecting}
                        expandedCategories={hubExpandedCategories}
                        onCollectNow={handleNewsHubCollectNow}
                        onRefresh={loadNewsHubData}
                        onToggleCategory={toggleCategory}
                    />
                ) : activePipeline ? (
                    <>
                        <div className="px-4 py-3 border-b flex items-center justify-between bg-muted/5">
                            <div className="flex items-center gap-4">
                                <h1 className="text-lg font-bold tracking-tight text-foreground flex items-center gap-3">
                                    {activePipeline.name}
                                    <span className={cn(
                                        "text-xs px-2 py-0.5 rounded font-medium border uppercase tracking-wider",
                                        (pipelineResults[activePipeline.id]?.status || activePipeline.status) === 'success' ? "bg-green-500/10 text-green-600 border-green-500/20" :
                                        (pipelineResults[activePipeline.id]?.status || activePipeline.status) === 'failed' ? "bg-red-500/10 text-red-600 border-red-500/20" :
                                        "bg-muted text-muted-foreground border-border"
                                    )}>
                                        {pipelineResults[activePipeline.id]?.status || activePipeline.status}
                                    </span>
                                </h1>
                                <div className="text-xs text-muted-foreground flex items-center gap-3 border-l pl-4">
                                    <span>{activePipeline.description}</span>
                                    <span className="flex items-center gap-1 opacity-70"><Clock size={10}/> 
                                        {pipelineResults[activePipeline.id]?.exec_time_ms !== undefined ? activePipeline.lastRun : activePipeline.lastRun} 
                                        ({pipelineResults[activePipeline.id]?.exec_time_ms || activePipeline.timeMs}ms)
                                    </span>
                                </div>
                            </div>
                            
                            <div className="flex items-center gap-4">
                                {activePipeline.id === 'PL-NaverFlow' && (
                                    <button
                                        onClick={() => setShowNfSettings(true)}
                                        className="flex items-center gap-1.5 px-3 py-1.5 border rounded text-xs font-semibold hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                                    >
                                        <SettingsIcon size={12} /> 설정
                                    </button>
                                )}
                                {(activePipeline.id === 'PL-NaverSearch' || activePipeline.id === 'PL-FinanceInfo') && (
                                    <div className="flex items-center gap-2">
                                        <input 
                                            type="text" 
                                            value={searchKeyword}
                                            onChange={(e) => setSearchKeyword(e.target.value)}
                                            placeholder="검색어 (예: 삼성전자)" 
                                            className="px-2 py-1 text-xs border border-muted-foreground/30 bg-background/50 rounded w-40 text-foreground focus:outline-none focus:border-primary"
                                        />
                                    </div>
                                )}
                                <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                                    <input 
                                        type="checkbox" 
                                        checked={forceFetch}
                                        onChange={(e) => setForceFetch(e.target.checked)}
                                        className="rounded-sm border-muted w-3 h-3 bg-background" 
                                    />
                                    캐시 무시
                                </label>
                                <button
                                    onClick={handleRunClick}
                                    disabled={isExecuting}
                                    className="flex items-center gap-1.5 bg-primary text-primary-foreground px-3 py-1.5 rounded text-xs font-semibold hover:opacity-90 transition-opacity disabled:opacity-50"
                                >
                                    {isExecuting ? (
                                        <Server className="animate-spin" size={12} />
                                    ) : (
                                        <Play size={12} fill="currentColor" />
                                    )}
                                    {isExecuting ? '수집 중...' : '실행'}
                                </button>
                            </div>
                        </div>

                        {/* Inner Tabs Navigation (밀도있게 컴팩트화) */}
                        <div className="flex items-center px-4 border-b bg-muted/5 pt-1 gap-1">
                            <button
                                onClick={() => setViewTab('agent-view')}
                                className={cn(
                                    "px-3 py-2 text-xs font-medium border-b-2 transition-colors flex items-center gap-1.5",
                                    viewTab === 'agent-view' 
                                        ? "border-primary text-foreground" 
                                        : "border-transparent text-muted-foreground hover:text-foreground"
                                )}
                            >
                                <FileText size={14} />
                                1차 가공 완료
                            </button>
                            <button
                                onClick={() => setViewTab('raw-json')}
                                className={cn(
                                    "px-3 py-2 text-xs font-medium border-b-2 transition-colors flex items-center gap-1.5",
                                    viewTab === 'raw-json' 
                                        ? "border-primary text-foreground" 
                                        : "border-transparent text-muted-foreground hover:text-foreground"
                                )}
                            >
                                <FileJson size={14} />
                                로우 데이터
                            </button>
                            {selectedId === 'PL-YoutubeContext' && (
                                <button
                                    onClick={() => setViewTab('source-data')}
                                    className={cn(
                                        "px-3 py-2 text-xs font-medium border-b-2 transition-colors flex items-center gap-1.5",
                                        viewTab === 'source-data' 
                                            ? "border-primary text-foreground" 
                                            : "border-transparent text-muted-foreground hover:text-foreground"
                                    )}
                                >
                                    <Youtube size={14} />
                                    소스 데이터
                                </button>
                            )}
                        </div>

                        {/* Detail Content Viewer (불필요한 카드/패딩 완전 제거) */}
                        <div className="flex-1 overflow-hidden relative flex flex-col">
                            {viewTab === 'agent-view' ? (
                                <div className="flex-1 overflow-y-auto p-6">
                                    <div className="prose prose-sm dark:prose-invert max-w-full font-sans">
                                        <h3 className="text-base font-bold text-foreground/80 mb-3">{activePipeline.name} 분석 결과 (Aggregated)</h3>
                                        
                                        {!pipelineResults[activePipeline.id] ? (
                                            <div className="flex flex-col items-center justify-center p-12 text-muted-foreground opacity-50 border border-dashed rounded-lg bg-muted/20">
                                                <Database size={32} className="mb-2" />
                                                <p>우측 상단의 `실행` 버튼을 눌러 파이프라인 수집을 시작하세요.</p>
                                            </div>
                                        ) : (
                                            <div className="bg-muted/5 border rounded-lg p-6 overflow-hidden
                                                               prose prose-sm dark:prose-invert max-w-none 
                                                               prose-h3:text-lg prose-h3:font-bold prose-h3:mt-2 prose-h3:mb-4 prose-h3:text-foreground/90 
                                                               prose-h4:text-base prose-h4:font-bold prose-h4:mt-6 prose-h4:mb-3 prose-h4:text-primary 
                                                               prose-ul:my-2 prose-ul:pl-5 
                                                               prose-li:my-1 prose-li:leading-relaxed prose-li:text-sm
                                                               prose-strong:text-foreground/90">
                                                <ReactMarkdown 
                                                    remarkPlugins={[remarkGfm]}
                                                >
                                                    {pipelineResults[activePipeline.id]?.aggregated_markdown}
                                                </ReactMarkdown>
                                            </div>
                                        )}
                                        
                                    </div>
                                </div>
                            ) : viewTab === 'raw-json' ? (
                                <div className="flex-1 overflow-hidden flex flex-col bg-[#1e1e1e]">
                                    <div className="px-4 py-2 text-xs font-mono text-muted-foreground/50 border-b border-white/10 flex justify-between bg-black/20 shrink-0">
                                        <span>RAW JSON RESPONSE</span>
                                        <span>Size: {pipelineResults[activePipeline.id]?.raw_data ? (JSON.stringify(pipelineResults[activePipeline.id].raw_data).length / 1024).toFixed(2) : 0} KB</span>
                                    </div>
                                    <pre className="text-sm font-mono text-green-400/90 overflow-auto scrollbar-hide p-4 m-0 flex-1">
                                        {pipelineResults[activePipeline.id] 
                                            ? JSON.stringify(pipelineResults[activePipeline.id].raw_data, null, 2)
                                            : '// 데이터를 수집해주세요.'}
                                    </pre>
                                </div>
                            ) : viewTab === 'source-data' && selectedId === 'PL-YoutubeContext' ? (
                                <div className="flex-1 overflow-y-auto p-6">
                                    <div className="max-w-3xl">
                                        <div className="flex items-center justify-between mb-4">
                                            <h3 className="text-sm font-bold flex items-center gap-2">
                                                <Youtube size={16} className="text-red-500" />
                                                모니터링 채널 ({ytChannels.length})
                                            </h3>
                                            <button
                                                onClick={() => setIsAddingChannel(!isAddingChannel)}
                                                className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground rounded text-xs font-semibold hover:opacity-90"
                                            >
                                                <Plus size={12} /> 채널 추가
                                            </button>
                                        </div>

                                        {isAddingChannel && (
                                            <div className="mb-4 p-4 border rounded-lg bg-muted/20 space-y-3">
                                                <div className="flex gap-2">
                                                    <input
                                                        type="text"
                                                        placeholder="채널 ID 또는 @핸들 (예: @삼프로TV)"
                                                        value={newChannelId}
                                                        onChange={(e) => setNewChannelId(e.target.value)}
                                                        className="flex-1 px-3 py-2 text-xs border rounded bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                                                    />
                                                    <input
                                                        type="text"
                                                        placeholder="채널 이름"
                                                        value={newChannelName}
                                                        onChange={(e) => setNewChannelName(e.target.value)}
                                                        className="w-40 px-3 py-2 text-xs border rounded bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                                                    />
                                                </div>
                                                <div className="flex gap-2">
                                                    <button
                                                        onClick={handleAddYtChannel}
                                                        className="px-3 py-1.5 bg-primary text-primary-foreground rounded text-xs font-semibold hover:opacity-90"
                                                    >
                                                        추가
                                                    </button>
                                                    <button
                                                        onClick={() => { setIsAddingChannel(false); setNewChannelId(''); setNewChannelName(''); }}
                                                        className="px-3 py-1.5 border rounded text-xs hover:bg-muted"
                                                    >
                                                        취소
                                                    </button>
                                                </div>
                                            </div>
                                        )}

                                        <div className="space-y-2">
                                            {ytChannels.length === 0 ? (
                                                <div className="py-12 text-center text-muted-foreground">
                                                    <Youtube size={32} className="mx-auto mb-2 opacity-20" />
                                                    <p className="text-xs">등록된 채널이 없습니다. 채널을 추가해주세요.</p>
                                                </div>
                                            ) : (
                                                ytChannels.map((ch: any) => (
                                                    <div key={ch.channel_id} className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/30 transition-colors group">
                                                        <div className="flex items-center gap-3">
                                                            <div className="w-8 h-8 rounded bg-red-500/10 flex items-center justify-center text-red-500 font-bold text-xs">
                                                                {ch.channel_name ? ch.channel_name[0] : 'Y'}
                                                            </div>
                                                            <div>
                                                                <div className="text-sm font-medium">{ch.channel_name || ch.channel_id}</div>
                                                                <div className="text-[10px] text-muted-foreground font-mono">
                                                                    {ch.channel_id}
                                                                    {ch.last_collected_at && (
                                                                        <span className="ml-2">· 최종수집: {new Date(ch.last_collected_at).toLocaleDateString('ko-KR')}</span>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </div>
                                                        <button
                                                            onClick={() => handleRemoveYtChannel(ch.channel_id)}
                                                            className="p-1.5 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-all"
                                                            title="채널 삭제"
                                                        >
                                                            <Trash2 size={14} />
                                                        </button>
                                                    </div>
                                                ))
                                            )}
                                        </div>

                                        <div className="mt-6 p-3 border rounded-lg bg-muted/10">
                                            <p className="text-[10px] text-muted-foreground">
                                                 💡 여기에 등록된 채널의 최근 영상이 V2 파이프라인 실행 시 자동으로 수집됩니다.
                                                채널 ID는 YouTube URL의 @핸들 또는 UC로 시작하는 채널 ID를 입력하세요.
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            ) : null}
                        </div>
                    </>
                ) : (
                    <div className="flex-1 flex items-center justify-center flex-col gap-3 text-muted-foreground">
                        <Server size={32} className="opacity-20" />
                        <p className="text-sm">파이프라인을 선택하세요.</p>
                    </div>
                )}
            </div>

            {/* NaverFlow 설정 모달 */}
            {showNfSettings && (
                <div className="fixed inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-50">
                    <div className="bg-card w-[450px] rounded-xl shadow-lg border p-6 flex flex-col">
                        <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
                            <SettingsIcon size={18} />
                            PL-NaverFlow 크론 설정
                        </h2>
                        
                        <div className="space-y-4 flex-1">
                            <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
                                <input 
                                    type="checkbox" 
                                    checked={nfSettings.enabled}
                                    onChange={e => setNfSettings(prev => ({ ...prev, enabled: e.target.checked }))}
                                    className="rounded border-muted w-4 h-4 bg-background"
                                />
                                매일 자동 수집 실행 (크론잡)
                            </label>

                            <div className="p-4 border rounded-lg bg-muted/10 space-y-4">
                                <div className="flex items-center justify-between">
                                    <label className="text-xs font-semibold text-muted-foreground">자동 수집 예약 시간</label>
                                    <button
                                        onClick={() => {
                                            const slots = nfSettings.scheduleSlots || [];
                                            setNfSettings(prev => ({
                                                ...prev,
                                                scheduleSlots: [...slots, { time: '12:00', enabled: true }]
                                            }));
                                        }}
                                        disabled={!nfSettings.enabled}
                                        className="text-[10px] bg-primary/10 text-primary px-2 py-1 rounded hover:bg-primary/20 transition-colors disabled:opacity-50"
                                    >
                                        + 시간 추가
                                    </button>
                                </div>
                                
                                <div className="space-y-2 max-h-[200px] overflow-y-auto pr-1">
                                    {(nfSettings.scheduleSlots || []).map((slot: any, idx: number) => (
                                        <div key={idx} className="flex items-center gap-3 bg-background p-2 rounded border">
                                            <input
                                                type="checkbox"
                                                checked={slot.enabled}
                                                disabled={!nfSettings.enabled}
                                                onChange={(e) => {
                                                    const newSlots = [...nfSettings.scheduleSlots];
                                                    newSlots[idx].enabled = e.target.checked;
                                                    setNfSettings(prev => ({ ...prev, scheduleSlots: newSlots }));
                                                }}
                                                className="rounded border-muted w-3.5 h-3.5"
                                            />
                                            <input
                                                type="time"
                                                value={slot.time}
                                                disabled={!nfSettings.enabled || !slot.enabled}
                                                onChange={(e) => {
                                                    const newSlots = [...nfSettings.scheduleSlots];
                                                    newSlots[idx].time = e.target.value;
                                                    setNfSettings(prev => ({ ...prev, scheduleSlots: newSlots }));
                                                }}
                                                className="px-2 py-1 text-sm border rounded bg-background flex-1 disabled:opacity-50"
                                            />
                                            <button
                                                onClick={() => {
                                                    const newSlots = nfSettings.scheduleSlots.filter((_: any, i: number) => i !== idx);
                                                    setNfSettings(prev => ({ ...prev, scheduleSlots: newSlots }));
                                                }}
                                                disabled={!nfSettings.enabled}
                                                className="p-1 text-muted-foreground hover:text-destructive disabled:opacity-50"
                                                title="삭제"
                                            >
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                    ))}
                                    {(!nfSettings.scheduleSlots || nfSettings.scheduleSlots.length === 0) && (
                                        <div className="text-center py-4 text-xs text-muted-foreground">
                                            등록된 예약 시간이 없습니다.
                                        </div>
                                    )}
                                </div>
                                <div className="text-[11px] text-muted-foreground leading-relaxed p-2 bg-muted/20 rounded">
                                    💡 저장된 시간에 평일(월~금) 기준으로 파이프라인이 자동 실행됩니다.
                                </div>
                            </div>
                        </div>

                        <div className="flex justify-end gap-2 mt-6 border-t pt-4">
                            <button onClick={() => setShowNfSettings(false)} className="px-4 py-2 border rounded font-medium hover:bg-muted text-sm">
                                취소
                            </button>
                            <button onClick={handleSaveNfSettings} className="px-4 py-2 bg-primary text-primary-foreground rounded font-medium shadow-sm hover:opacity-90 text-sm">
                                설정 저장
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

// ═══ News Hub 상세 뷰 컴포넌트 ═══════════════════════════════════════════

const CATEGORY_LABELS: Record<string, { label: string; emoji: string }> = {
    MAJOR: { label: '국내 주요 뉴스', emoji: '📰' },
    GLOBAL: { label: '해외 시장 뉴스', emoji: '🌐' },
    GLOBAL_MARKET: { label: '글로벌 마켓', emoji: '📊' },
    STOCK_ANALYSIS: { label: '종목 분석', emoji: '🔍' },
    KEYWORD_SEARCH: { label: '키워드 검색', emoji: '🔑' },
};

function NewsHubDetailView({
    status, articles, collecting, expandedCategories, onCollectNow, onRefresh, onToggleCategory
}: {
    status: any;
    articles: any[];
    collecting: boolean;
    expandedCategories: Record<string, boolean>;
    onCollectNow: () => void;
    onRefresh: () => void;
    onToggleCategory: (cat: string) => void;
}) {
    // 카테고리별 그룹핑
    const grouped = articles.reduce((acc: Record<string, any[]>, a: any) => {
        const cat = a.category || 'KEYWORD_SEARCH';
        if (!acc[cat]) acc[cat] = [];
        acc[cat].push(a);
        return acc;
    }, {});

    const categoryOrder = ['MAJOR', 'GLOBAL', 'GLOBAL_MARKET', 'STOCK_ANALYSIS', 'KEYWORD_SEARCH'];

    return (
        <>
            {/* 헤더 */}
            <div className="px-4 py-3 border-b flex items-center justify-between bg-amber-500/5">
                <div className="flex items-center gap-3">
                    <h1 className="text-lg font-bold tracking-tight text-foreground flex items-center gap-2">
                        <Radio size={18} className="text-amber-500" />
                        News Watchtower
                    </h1>
                    <span className={cn(
                        "text-xs px-2 py-0.5 rounded font-medium border uppercase tracking-wider",
                        status?.isValid
                            ? "bg-amber-500/10 text-amber-600 border-amber-500/20"
                            : "bg-muted text-muted-foreground border-border"
                    )}>
                        {status?.isValid ? 'LIVE' : 'NO CACHE'}
                    </span>
                    {status?.articleCount > 0 && (
                        <span className="text-xs text-muted-foreground px-2 py-0.5 bg-muted rounded border">
                            총 {status.articleCount}건
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={onRefresh}
                        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded border border-border hover:border-foreground/30 transition-colors"
                    >
                        <RefreshCw size={12} />
                        새로고침
                    </button>
                    <button
                        onClick={onCollectNow}
                        disabled={collecting}
                        className="flex items-center gap-1.5 text-xs bg-amber-500 hover:bg-amber-600 text-white px-3 py-1.5 rounded font-medium transition-colors disabled:opacity-50"
                    >
                        {collecting ? <RefreshCw size={12} className="animate-spin" /> : <Play size={12} />}
                        {collecting ? '수집 중...' : '지금 수집'}
                    </button>
                </div>
            </div>

            {/* 상태 배너 */}
            <div className="px-4 py-2 border-b bg-muted/5 flex items-center gap-6 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                    <Clock size={11} />
                    마지막 수집: {status?.collectedAt
                        ? new Date(status.collectedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                        : '없음'
                    }
                </span>
                {status?.ageMinutes != null && (
                    <span className={cn(
                        "flex items-center gap-1",
                        status.ageMinutes > status.ttlMinutes * 0.8 ? "text-amber-500" : "text-green-500"
                    )}>
                        <CheckCircle2 size={11} />
                        {status.ageMinutes}분 전 ({status.ttlMinutes}분 TTL)
                    </span>
                )}
                <span className="flex items-center gap-1">
                    <Database size={11} />
                    버킷: {status?.bucket || '--'}
                </span>
            </div>

            {/* 기사 목록 */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {articles.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-40 gap-3 text-muted-foreground">
                        <Newspaper size={32} className="opacity-20" />
                        <p className="text-sm">캐시된 뉴스가 없습니다.</p>
                        <p className="text-xs opacity-60">"지금 수집" 버튼을 눌러 뉴스를 가져오세요.</p>
                    </div>
                ) : (
                    categoryOrder.map(cat => {
                        const catArticles = grouped[cat];
                        if (!catArticles || catArticles.length === 0) return null;
                        const { label, emoji } = CATEGORY_LABELS[cat] || { label: cat, emoji: '📄' };
                        const isExpanded = expandedCategories[cat] ?? true;

                        return (
                            <div key={cat} className="border rounded-lg overflow-hidden">
                                {/* 카테고리 헤더 */}
                                <button
                                    onClick={() => onToggleCategory(cat)}
                                    className="w-full flex items-center justify-between px-4 py-2.5 bg-muted/30 hover:bg-muted/50 transition-colors"
                                >
                                    <span className="font-semibold text-sm flex items-center gap-2">
                                        {emoji} {label}
                                        <span className="text-xs font-normal text-muted-foreground bg-muted px-2 py-0.5 rounded">
                                            {catArticles.length}건
                                        </span>
                                    </span>
                                    {isExpanded ? <ChevronDown size={14} className="text-muted-foreground" /> : <ChevronRight size={14} className="text-muted-foreground" />}
                                </button>

                                {/* 기사 목록 */}
                                {isExpanded && (
                                    <div className="divide-y divide-border/50">
                                        {catArticles.map((article: any, idx: number) => (
                                            <div key={idx} className="px-4 py-2.5 hover:bg-muted/20 transition-colors group">
                                                <div className="flex items-start justify-between gap-2">
                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex items-center gap-2 mb-0.5">
                                                            {article.searchKeyword && (
                                                                <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded border border-primary/20 shrink-0">
                                                                    #{article.searchKeyword}
                                                                </span>
                                                            )}
                                                            <p className="text-sm font-medium line-clamp-1 text-foreground/90">
                                                                {article.title}
                                                            </p>
                                                        </div>
                                                        {article.bodySnippet && (
                                                            <p className="text-[11px] text-muted-foreground line-clamp-1 mt-0.5">
                                                                {article.bodySnippet}
                                                            </p>
                                                        )}
                                                        <div className="flex items-center gap-2 mt-1 text-[10px] text-muted-foreground/60">
                                                            <span>{article.source}</span>
                                                            <span>·</span>
                                                            <span>{article.date}</span>
                                                            {article.timeBucket && <span>({article.timeBucket} 버킷)</span>}
                                                        </div>
                                                    </div>
                                                    {(article.url || article.link) && (
                                                        <a
                                                            href="#"
                                                            onClick={(e) => {
                                                                e.preventDefault();
                                                                (window.electronAPI as any).openExternal?.(article.url || article.link);
                                                            }}
                                                            className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-primary shrink-0"
                                                            title="원문 열기"
                                                        >
                                                            <ExternalLink size={13} />
                                                        </a>
                                                    )}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        );
                    })
                )}
            </div>
        </>
    );
}
