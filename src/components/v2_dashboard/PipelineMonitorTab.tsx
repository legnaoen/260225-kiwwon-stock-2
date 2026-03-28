import React, { useState, useEffect } from 'react';
import { Database, Play, CheckCircle2, XCircle, Clock, Server, FileJson, FileText, Bug, Plus, Trash2, Youtube, Settings as SettingsIcon } from 'lucide-react';
import { cn } from '../../utils';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

type PipelineStatus = 'idle' | 'running' | 'success' | 'failed';

const PIPELINES = [
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

    // YouTube 채널 관리 상태
    const [ytChannels, setYtChannels] = useState<any[]>([]);
    const [newChannelId, setNewChannelId] = useState('');
    const [newChannelName, setNewChannelName] = useState('');
    const [isAddingChannel, setIsAddingChannel] = useState(false);

    // 유튜브 파이프라인 선택 시 채널 목록 로드
    useEffect(() => {
        if (selectedId === 'PL-YoutubeContext') {
            loadYtChannels();
        }
    }, [selectedId]);

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
                            onClick={() => setSelectedId(pl.id)}
                            className={cn(
                                "w-full text-left px-4 py-2 flex flex-col gap-0.5 transition-colors",
                                selectedId === pl.id 
                                    ? "bg-primary/5 border-r-2 border-primary" 
                                    : "hover:bg-muted/50 border-r-2 border-transparent"
                            )}
                        >
                            <div className="flex items-center justify-between">
                                <span className={cn(
                                    "font-medium tracking-tight text-sm",
                                    selectedId === pl.id ? "text-primary font-bold" : "text-foreground/80"
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
                </div>
            </div>

            {/* ====== [Detail] Right Main Content ====== */}
            <div className="flex-1 flex flex-col min-w-0 bg-background">
                {activePipeline ? (
                    <>
                        {/* Header Controller (여백 및 패딩 대폭 축소) */}
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
                                        {pipelineResults[activePipeline.id]?.lastRunTime ? new Date(pipelineResults[activePipeline.id].lastRunTime).toLocaleTimeString() : activePipeline.lastRun} 
                                        ({pipelineResults[activePipeline.id]?.executionTimeMs || activePipeline.timeMs}ms)
                                    </span>
                                </div>
                            </div>
                            
                            <div className="flex items-center gap-4">
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
                                                    {pipelineResults[activePipeline.id]?.aggregatedMarkdown}
                                                </ReactMarkdown>
                                            </div>
                                        )}
                                        
                                    </div>
                                </div>
                            ) : viewTab === 'raw-json' ? (
                                <div className="flex-1 overflow-hidden flex flex-col bg-[#1e1e1e]">
                                    <div className="px-4 py-2 text-xs font-mono text-muted-foreground/50 border-b border-white/10 flex justify-between bg-black/20 shrink-0">
                                        <span>RAW JSON RESPONSE</span>
                                        <span>Size: {pipelineResults[activePipeline.id]?.rawData ? (JSON.stringify(pipelineResults[activePipeline.id].rawData).length / 1024).toFixed(2) : 0} KB</span>
                                    </div>
                                    <pre className="text-sm font-mono text-green-400/90 overflow-auto scrollbar-hide p-4 m-0 flex-1">
                                        {pipelineResults[activePipeline.id] 
                                            ? JSON.stringify(pipelineResults[activePipeline.id].rawData, null, 2)
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
        </div>
    );
}
