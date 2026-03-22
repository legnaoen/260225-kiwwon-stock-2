import React, { useState, useEffect, useCallback } from 'react';
import { Terminal, X, ChevronUp, ChevronDown, Activity, Hash, Layers, Target, Clock, ArrowUpRight, TrendingUp, Database, Sparkles, Brain, Loader2, CheckCircle2, XCircle, Copy, AlertCircle } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { MaiisAgentTester } from './MaiisAgentTester';

function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

/**
 * 참고 이미지 스타일의 멀티 라인 센티먼트 차트
 * sentimentData: number[] (0~1 범위의 sentiment_score 배열, 최신이 마지막)
 * labels: string[] (각 데이터 포인트의 날짜 라벨)
 */
const SentimentTrendChart = ({ sentimentData, labels }: { sentimentData: number[], labels: string[] }) => {
    const W = 240, H = 100, PAD_X = 30, PAD_Y = 15;
    const chartW = W - PAD_X * 2;
    const chartH = H - PAD_Y * 2;
    const n = sentimentData.length;
    if (n === 0) return <div className="flex items-center justify-center h-full text-xs text-muted-foreground">데이터 수집 중...</div>;

    const toX = (i: number) => PAD_X + (i / Math.max(n - 1, 1)) * chartW;
    const toY = (v: number) => PAD_Y + chartH - (v * chartH);

    const points = sentimentData.map((v, i) => `${toX(i)},${toY(v)}`);
    const lineStr = points.join(' ');
    const areaStr = `${toX(0)},${toY(0)} ${lineStr} ${toX(n - 1)},${H - PAD_Y} ${toX(0)},${H - PAD_Y}`;
    
    // 0.5 기준선
    const midY = toY(0.5);

    return (
        <svg className="w-full h-full" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
            <defs>
                <linearGradient id="sentGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.25" />
                    <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.02" />
                </linearGradient>
            </defs>
            {/* 배경 그리드 */}
            <line x1={PAD_X} y1={midY} x2={W - PAD_X} y2={midY} stroke="currentColor" strokeOpacity="0.1" strokeDasharray="3,3" />
            <text x={PAD_X - 4} y={toY(1) + 4} fontSize="7" fill="currentColor" fillOpacity="0.3" textAnchor="end">1.0</text>
            <text x={PAD_X - 4} y={midY + 2} fontSize="7" fill="currentColor" fillOpacity="0.3" textAnchor="end">0.5</text>
            <text x={PAD_X - 4} y={toY(0) + 4} fontSize="7" fill="currentColor" fillOpacity="0.3" textAnchor="end">0.0</text>
            {/* X축 라벨 */}
            {labels.map((label, i) => (
                <text key={i} x={toX(i)} y={H - 2} fontSize="6" fill="currentColor" fillOpacity="0.35" textAnchor="middle">{label}</text>
            ))}
            {/* 영역 + 라인 */}
            <polygon points={areaStr} fill="url(#sentGrad)" />
            <polyline points={lineStr} fill="none" stroke="#3b82f6" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
            {/* 데이터 포인트 */}
            {sentimentData.map((v, i) => (
                <circle key={i} cx={toX(i)} cy={toY(v)} r="3" fill="#3b82f6" stroke="white" strokeWidth="1.5" />
            ))}
            {/* 최신 값 라벨 */}
            {n > 0 && (
                <text x={toX(n - 1) + 6} y={toY(sentimentData[n - 1]) + 3} fontSize="8" fontWeight="bold" fill="#3b82f6">
                    {sentimentData[n - 1]?.toFixed(2)}
                </text>
            )}
        </svg>
    );
};

/** 네러티브 페이지의 Leading Keywords 스타일 멀티라인 트렌드 차트 */
const TREND_COLORS = ['#ef4444', '#3b82f6', '#6366f1', '#22c55e', '#f59e0b', '#ec4899', '#f97316'];

const MultiLineTrendChart = ({ trendData }: { trendData: { dates: string[], series: { name: string, data: number[] }[] } }) => {
    const W = 280, H = 100, PAD_L = 10, PAD_R = 10, PAD_T = 6, PAD_B = 16;
    const chartW = W - PAD_L - PAD_R;
    const chartH = H - PAD_T - PAD_B;
    const { dates, series } = trendData;
    const n = dates.length;

    if (n === 0 || series.length === 0) return <div className="flex items-center justify-center h-full text-xs text-muted-foreground">데이터 수집 중...</div>;

    const allValues = series.flatMap(s => s.data).filter(v => v > 0);
    const maxVal = Math.max(...allValues, 1);

    const toX = (i: number) => PAD_L + (i / Math.max(n - 1, 1)) * chartW;
    const toY = (v: number) => PAD_T + chartH - ((v / maxVal) * chartH);

    return (
        <svg className="w-full h-full" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
            {/* 수평 기준선 */}
            <line x1={PAD_L} y1={PAD_T + chartH} x2={W - PAD_R} y2={PAD_T + chartH} stroke="currentColor" strokeOpacity="0.08" />
            <line x1={PAD_L} y1={PAD_T + chartH / 2} x2={W - PAD_R} y2={PAD_T + chartH / 2} stroke="currentColor" strokeOpacity="0.06" strokeDasharray="3,3" />
            {/* X축 날짜 라벨 */}
            {dates.map((d, i) => (
                <text key={i} x={toX(i)} y={H - 2} fontSize="7" fill="currentColor" fillOpacity="0.4" textAnchor="middle" fontWeight="600">{d}</text>
            ))}
            {/* 라인들 */}
            {series.map((s, si) => {
                const pts = s.data.map((v, i) => ({ x: toX(i), y: toY(v) }));
                const lineStr = pts.map(p => `${p.x},${p.y}`).join(' ');
                const color = TREND_COLORS[si % TREND_COLORS.length];
                return (
                    <g key={si}>
                        <polyline points={lineStr} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" opacity="0.85" />
                        {pts.map((p, pi) => (
                            <circle key={pi} cx={p.x} cy={p.y} r="2.5" fill="white" stroke={color} strokeWidth="1.5" />
                        ))}
                    </g>
                );
            })}
        </svg>
    );
};

// =========================================================================
// Pipeline Monitor Components
// =========================================================================

const useUpcomingPipelineSchedules = (count: number = 2) => {
    const [upcoming, setUpcoming] = useState<Array<any>>([]);

    const computeNext = useCallback(async () => {
        try {
            const aiSettings = await window.electronAPI.getAiScheduleSettings();
            const pmSettings = await window.electronAPI.getReviewSchedule();
            
            const schedules = [];
            if (aiSettings?.enabled !== false) {
                schedules.push({ name: 'PRE_MARKET', time: aiSettings?.preMarketTime || '08:30' });
                schedules.push({ name: 'MORNING', time: aiSettings?.morningTime || '09:30' });
                schedules.push({ name: 'EVENING', time: aiSettings?.eveningTime || '15:40' });
            }
            if (pmSettings?.autoEnabled) {
                schedules.push({ name: 'INTRADAY', time: pmSettings?.intradayTime || '14:50' });
                schedules.push({ name: 'CLOSING', time: pmSettings?.closingTime || '15:45' });
            }

            if (schedules.length === 0) return setUpcoming([]);

            schedules.sort((a, b) => a.time.localeCompare(b.time));

            const now = new Date();
            const curDay = now.getDay(); // 0: Sun, 1: Mon, ..., 6: Sat
            const todayStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

            let results: any[] = [];
            
            const getSchedulesForDay = (dateObj: Date, startIdx: number = 0) => {
                const dayOfWeek = dateObj.getDay();
                if (dayOfWeek === 0 || dayOfWeek === 6) return []; // Weekend
                
                let dayResults = [];
                for(let i=startIdx; i<schedules.length; i++) {
                    const sc = schedules[i];
                    const [h, m] = sc.time.split(':').map(Number);
                    const d = new Date(dateObj);
                    d.setHours(h, m, 0, 0);
                    
                    dayResults.push({
                        id: `upcoming-${d.getTime()}-${sc.name}`,
                        pipeline: sc.name,
                        status: 'UPCOMING',
                        startedAt: d.toISOString(),
                        date: d
                    });
                }
                return dayResults;
            };

            let todayStartIdx = schedules.length;
            if (curDay >= 1 && curDay <= 5) {
                todayStartIdx = schedules.findIndex(s => s.time > todayStr);
                if (todayStartIdx !== -1) {
                    results.push(...getSchedulesForDay(now, todayStartIdx));
                }
            }

            let daysToAdd = 1;
            while (results.length < count && daysToAdd < 7) {
                const nextDate = new Date();
                nextDate.setDate(now.getDate() + daysToAdd);
                results.push(...getSchedulesForDay(nextDate, 0));
                daysToAdd++;
            }

            setUpcoming(results.slice(0, count));
        } catch (e) {
            console.error(e);
        }
    }, [count]);

    useEffect(() => {
        computeNext();
        const interval = setInterval(computeNext, 60000);
        return () => clearInterval(interval);
    }, [computeNext]);

    return upcoming;
};

const useNextPipelineSchedule = () => {
    const upcoming = useUpcomingPipelineSchedules(1);
    if (!upcoming || upcoming.length === 0) return null;
    return { name: upcoming[0].pipeline, date: upcoming[0].date };
};

const formatTimeLeft = (targetDate: Date) => {
    const diff = targetDate.getTime() - Date.now();
    if (diff <= 0) return '곧 실행됨';
    
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
    const mins = Math.floor((diff / 1000 / 60) % 60);

    let parts = [];
    if (days > 0) parts.push(`${days}일`);
    if (hours > 0) parts.push(`${hours}시간`);
    if (mins > 0 && days === 0) parts.push(`${mins}분`);

    return parts.length > 0 ? `${parts.join(' ')} 후` : '1분 이내';
};

const PipelineStatusIndicator = ({ latestRun, onClick }: { latestRun: any, onClick: () => void }) => {
    const nextSchedule = useNextPipelineSchedule();
    
    // 만약 실행 이력이 아예 없다면 (앱 켰을 때 등) 대기 상태를 다음 스케줄로 표현
    if (!latestRun) {
        return (
            <button onClick={onClick} className="flex items-center gap-2 px-4 py-2 bg-muted/20 border border-border rounded-lg text-sm font-semibold hover:bg-muted/50 transition-colors shadow-sm">
                <Clock size={16} className="text-muted-foreground" />
                <span className="text-muted-foreground">
                    파이프라인 대기 중 
                    {nextSchedule ? ` · 다음: ${nextSchedule.name} (${formatTimeLeft(nextSchedule.date)})` : ''}
                </span>
                <ChevronDown size={14} className="text-muted-foreground/50 ml-1" />
            </button>
        );
    }
    
    const isRunning = latestRun.status === 'RUNNING';
    const isSuccess = latestRun.status === 'SUCCESS';
    const isFailed = latestRun.status === 'FAILED' || latestRun.status === 'PARTIAL';
    
    const Icon = isRunning ? Loader2 : (isSuccess ? CheckCircle2 : AlertCircle);
    const colorClass = isRunning ? 'text-blue-500' : (isSuccess ? 'text-green-500' : 'text-orange-500');
    const bgClass = isRunning ? 'bg-blue-500/10 border-blue-500/30' : (isSuccess ? 'bg-green-500/10 border-green-500/30' : 'bg-orange-500/10 border-orange-500/30');

    const duration = latestRun.durationMs ? `(${(latestRun.durationMs / 1000).toFixed(1)}s)` : '';
    const timeStr = new Date(latestRun.startedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });

    return (
        <div className="flex items-center gap-3">
            <button onClick={onClick} className={cn("flex items-center gap-2 px-4 py-2 border rounded-lg text-sm font-semibold hover:opacity-80 transition-colors shadow-sm", bgClass)}>
                <Icon size={16} className={cn(isRunning && "animate-spin", colorClass)} />
                <span className={cn(colorClass)}>
                    {timeStr} {latestRun.pipeline} 파이프라인 {isRunning ? '실행 중' : (isSuccess ? '완료' : '부분 성/실패')} {duration}
                </span>
                <ChevronDown size={14} className={cn(colorClass, "opacity-70 ml-1")} />
            </button>
            {!isRunning && nextSchedule && (
                <div className="text-xs text-muted-foreground font-medium flex items-center gap-1.5 opacity-80 bg-background/50 px-2 py-1 rounded-md border border-border/50">
                    <Clock size={12} />
                    <span>다음: {nextSchedule.name} ({nextSchedule.date.toLocaleTimeString('ko-KR', {hour: '2-digit', minute:'2-digit'})}) · <span className="text-foreground">{formatTimeLeft(nextSchedule.date)}</span></span>
                </div>
            )}
        </div>
    );
};

const PipelineMonitorModal = ({ onClose }: { onClose: () => void }) => {
    const [runs, setRuns] = useState<any[]>([]);
    const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
    const [detail, setDetail] = useState<any>(null);

    const upcomingRuns = useUpcomingPipelineSchedules(2);
    const nextSchedule = useNextPipelineSchedule();

    const loadData = useCallback(async () => {
        const _runs = await window.electronAPI.getAllPipelineRuns();
        setRuns(_runs || []);
    }, []);

    useEffect(() => {
        loadData();
        const interval = setInterval(loadData, 10000);
        return () => clearInterval(interval);
    }, [loadData]);

    useEffect(() => {
        if (!selectedRunId) {
            if (runs.length > 0) {
                setSelectedRunId(runs[0].id);
            } else if (upcomingRuns.length > 0) {
                setSelectedRunId(upcomingRuns[0].id);
            }
        }
    }, [runs, upcomingRuns, selectedRunId]);

    useEffect(() => {
        if (!selectedRunId) return;

        if (selectedRunId.startsWith('upcoming-')) {
            const upc = upcomingRuns.find(u => u.id === selectedRunId);
            if (upc) {
                let phases = [];
                if (upc.pipeline === 'MORNING' || upc.pipeline === 'EVENING') {
                    phases = [
                        { name: '급등주 분석', service: 'RisingStockAnalysis', method: 'analyzeBatchAndSave', status: 'WAITING', result: '테스트용 가상 미리보기: 키움 API를 통해 당일 상승 종목을 조회하고 재무/테마 분석을 융합합니다.' },
                        { name: '마스터 AI 상태 갱신', service: 'MasterAiService', method: 'generateWorldState', status: 'WAITING', result: '시장 전반의 흐름을 정리하여 마스터 지시 사항을 기록합니다.' },
                        { name: 'PM AI 리뷰', service: 'PortfolioManagerService', method: 'runPortfolioReview', status: 'WAITING', result: '도출된 테마/종목을 바탕으로 포트폴리오 편입/청산 룰을 점검합니다.' }
                    ];
                } else if (upc.pipeline === 'INTRADAY' || upc.pipeline === 'CLOSING') {
                    phases = [
                        { name: '현재가 갱신', service: 'PortfolioReviewEngine', method: 'refreshCurrentPrices', status: 'WAITING', result: '보유 종목의 실시간 현재가와 등락률을 업데이트합니다.' },
                        { name: '하드룰 체크 (PM AI)', service: 'PortfolioReviewEngine', method: 'runReviewLoop', status: 'WAITING', result: '수익/손절 기준(하드룰)에 도달한 종목을 스캔하여 우선 강제 청산합니다.' }
                    ];
                } else if (upc.pipeline === 'PRE_MARKET') {
                    phases = [
                        { name: '기초 데이터 수집', service: 'YahooFinance/Youtube', method: 'updateGlobalMacroData', status: 'WAITING', result: '미국 나스닥/S&P500 지수, WTI유가, 환율 매크로 지표와 지정된 증권 유튜버들의 최신 영상 스크립트를 다운로드합니다.' },
                        { name: '서브에이전트 도메인 분석', service: 'MaiisDomainService', method: 'analyzeNews+Youtube', status: 'WAITING', result: '야간 글로벌 뉴스 데이터를 분석하여 주요 팩트를 추출하고, 유튜브 영상 내용을 분석하여 시장 FOMO/FUD 내러티브를 요약합니다.' },
                        { name: '마스터 AI 0845', service: 'MasterAiService', method: 'generateWorldState', status: 'WAITING', result: '위 매크로/뉴스/유튜브 분석 결과를 종합하여 당일 국내장 오픈 시의 대응 전략(대전제)을 수립합니다.' },
                        { name: 'PM AI 리뷰', service: 'PortfolioManagerService', method: 'runPortfolioReview', status: 'WAITING', result: '전일 발생한 매매 신호나 보유 종목의 오버나잇 결과를 점검하여 개장 동시호가 대응 여부를 결정합니다.' }
                    ];
                }
                
                setDetail({
                    id: upc.id,
                    pipeline: upc.pipeline,
                    startedAt: upc.startedAt,
                    status: 'UPCOMING',
                    phases: phases,
                    durationMs: null
                });
            }
        } else {
            window.electronAPI.getPipelineRunDetail(selectedRunId).then(setDetail);
        }
    }, [selectedRunId, runs, upcomingRuns]);

    const handleCopyMarkdown = () => {
        if (!detail) return;
        
        let md = `## 📊 MAIIS Pipeline Execution Log\n`;
        md += `- **Pipeline**: ${detail.pipeline}\n`;
        md += `- **Run ID**: ${detail.id}\n`;
        md += `- **Status**: ${detail.status}\n`;
        md += `- **Started At**: ${new Date(detail.startedAt).toLocaleString('ko-KR')}\n`;
        if (detail.durationMs) md += `- **Total Duration**: ${(detail.durationMs / 1000).toFixed(1)}s\n`;
        md += `\n### 🔄 Phases Detail\n\n`;

        detail.phases?.forEach((phase: any, idx: number) => {
            md += `#### ${idx + 1}. ${phase.name} \`${phase.service}.${phase.method}\`\n`;
            md += `- **Status**: ${phase.status}\n`;
            if (phase.durationMs) md += `- **Duration**: ${(phase.durationMs / 1000).toFixed(1)}s\n`;
            if (phase.error) md += `- **Error**: \`${phase.error}\`\n`;
            if (phase.result) {
                const isJson = phase.result.startsWith('{') || phase.result.startsWith('[');
                md += `- **Result**:\n${isJson ? '```json\n' : '```text\n'}${phase.result}\n\`\`\`\n`;
            }
            md += `\n`;
        });

        navigator.clipboard.writeText(md);
        alert('AI 에이전트와의 디버깅용으로 최적화된 마크다운 텍스트가 클립보드에 복사되었습니다.\n대화창에 바로 붙여넣어 논의를 시작하세요.');
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="bg-card w-full max-w-5xl h-[80vh] rounded-2xl border border-border flex flex-col overflow-hidden shadow-2xl">
                <div className="flex justify-between items-center p-4 border-b border-border bg-muted/20">
                    <div className="flex items-center gap-4">
                        <h2 className="text-lg font-bold flex items-center gap-2"><Activity className="text-primary"/> 파이프라인 실행 현황</h2>
                        {nextSchedule && (
                            <div className="text-xs text-muted-foreground font-medium flex items-center gap-1.5 opacity-80 bg-background/50 px-2.5 py-1.5 rounded-md border border-border/50">
                                <Clock size={12} />
                                <span>다음 실행: <span className="text-primary">{nextSchedule.name}</span> ({nextSchedule.date.toLocaleDateString('ko-KR', {weekday:'short', month:'numeric', day:'numeric'})} {nextSchedule.date.toLocaleTimeString('ko-KR', {hour: '2-digit', minute:'2-digit'})}) · <span className="text-foreground">{formatTimeLeft(nextSchedule.date)}</span></span>
                            </div>
                        )}
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-muted rounded-lg transition-colors"><X size={20} /></button>
                </div>
                
                <div className="flex flex-1 overflow-hidden">
                    {/* Left Panel: List */}
                    <div className="w-64 border-r border-border bg-muted/10 overflow-y-auto p-4 flex flex-col gap-2">
                        {[...upcomingRuns].reverse().map(run => {
                            const isUpcoming = true;
                            const Icon = Clock;
                            const colorClass = 'text-primary/70';
                            const timeStr = new Date(run.startedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
                            
                            return (
                                <button 
                                    key={run.id}
                                    onClick={() => setSelectedRunId(run.id)}
                                    className={cn(
                                        "flex flex-col text-left p-3 rounded-lg border transition-all",
                                        selectedRunId === run.id 
                                            ? "bg-primary/10 border-primary" 
                                            : "bg-background border-dashed border-border hover:border-primary/50"
                                    )}
                                >
                                    <div className="font-bold text-sm tracking-tight flex items-center justify-between">
                                        {run.pipeline}
                                        <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-full font-semibold">예정</span>
                                    </div>
                                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-1.5">
                                        <Icon size={12} className={colorClass} />
                                        {timeStr}
                                        <span className="ml-auto opacity-70 italic">{formatTimeLeft(new Date(run.startedAt))}</span>
                                    </div>
                                </button>
                            );
                        })}

                        {upcomingRuns.length > 0 && runs.length > 0 && <div className="h-px bg-border my-2 mx-1" />}

                        {runs.map(run => {
                            const isRunning = run.status === 'RUNNING';
                            const isSuccess = run.status === 'SUCCESS';
                            const Icon = isRunning ? Loader2 : (isSuccess ? CheckCircle2 : AlertCircle);
                            const colorClass = isRunning ? 'text-blue-500' : (isSuccess ? 'text-green-500' : 'text-orange-500');
                            const timeStr = new Date(run.startedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
                            
                            return (
                                <button 
                                    key={run.id}
                                    onClick={() => setSelectedRunId(run.id)}
                                    className={cn(
                                        "flex flex-col text-left p-3 rounded-lg border transition-all",
                                        selectedRunId === run.id 
                                            ? "bg-primary/10 border-primary" 
                                            : "bg-card border-border hover:border-primary/50"
                                    )}
                                >
                                    <div className="font-bold text-sm">{run.pipeline}</div>
                                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-1">
                                        <Icon size={12} className={cn(isRunning && "animate-spin", colorClass)} />
                                        {timeStr}
                                        {run.durationMs && <span className="ml-auto opacity-70">{(run.durationMs/1000).toFixed(1)}s</span>}
                                    </div>
                                </button>
                            );
                        })}
                        {runs.length === 0 && upcomingRuns.length === 0 && <div className="text-sm text-muted-foreground p-4 text-center">기록이 없습니다.</div>}
                    </div>

                    {/* Right Panel: Detail */}
                    <div className="flex-1 overflow-y-auto p-6 bg-card relative">
                        {detail ? (
                            <div className="flex flex-col gap-6">
                                <div className="flex justify-between items-start">
                                    <div>
                                        <div className="flex items-center gap-2">
                                            <div className="text-2xl font-black">{detail.pipeline} 파이프라인</div>
                                            {detail.status === 'UPCOMING' && <span className="px-2 py-0.5 mt-0.5 rounded-full bg-primary/10 text-primary text-xs font-bold border border-primary/20">실행 예정 미리보기</span>}
                                        </div>
                                        <div className="text-sm text-muted-foreground mt-1">
                                            {detail.status === 'UPCOMING' ? '미리보기 모드' : `Run ID: ${detail.id}`} · {new Date(detail.startedAt).toLocaleString('ko-KR', {weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'})}
                                        </div>
                                    </div>
                                    {detail.status !== 'UPCOMING' && (
                                        <button 
                                            onClick={handleCopyMarkdown}
                                            className="flex items-center gap-2 px-3 py-1.5 bg-primary text-primary-foreground hover:bg-primary/90 rounded-md text-xs font-semibold shadow-sm transition-colors"
                                        >
                                            <Copy size={14} /> AI 에이전트용 결과 복사
                                        </button>
                                    )}
                                </div>

                                {detail.status === 'UPCOMING' && (
                                    <div className="bg-primary/5 border border-primary/20 rounded-xl p-4 text-sm text-foreground/80 leading-relaxed font-medium flex items-start gap-3">
                                        <AlertCircle size={18} className="text-primary shrink-0 mt-0.5" />
                                        <p>
                                            이 파이프라인은 <b>{new Date(detail.startedAt).toLocaleTimeString('ko-KR', {hour: '2-digit', minute:'2-digit'})}</b>경에 자동 실행될 예정입니다.<br/>
                                            다음과 같은 단계(Phase)를 거쳐 시스템 상태를 갱신하게 됩니다. 정상 동작 시 이 프로세스들이 순차적으로 실행되며 기록됩니다.
                                        </p>
                                    </div>
                                )}

                                <div className="flex flex-col gap-3">
                                    {detail.phases?.map((phase: any, idx: number) => {
                                        const isWaiting = phase.status === 'WAITING';
                                        const isRunning = phase.status === 'RUNNING';
                                        const isSuccess = phase.status === 'SUCCESS';
                                        
                                        const Icon = isWaiting ? Clock : (isRunning ? Loader2 : (isSuccess ? CheckCircle2 : AlertCircle));
                                        const colorClass = isWaiting ? 'text-primary' : (isRunning ? 'text-blue-500' : (isSuccess ? 'text-green-500' : 'text-orange-500'));

                                        return (
                                            <div key={idx} className={cn("flex flex-col p-4 rounded-xl border border-border transition-colors", isWaiting ? "bg-background border-dashed" : "bg-muted/5")}>
                                                <div className="flex items-center gap-3">
                                                    <Icon size={18} className={cn(colorClass, isRunning && "animate-spin")} />
                                                    <span className="font-bold text-sm tracking-tight">{phase.name}</span>
                                                    <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">{phase.service}.{phase.method}</span>
                                                    {phase.durationMs && <span className="text-xs text-muted-foreground ml-auto whitespace-nowrap">{(phase.durationMs/1000).toFixed(1)}s</span>}
                                                </div>
                                                {phase.result && (
                                                    <div className={cn("text-xs mt-2 pl-8 whitespace-pre-wrap leading-relaxed border-l-2", isWaiting ? "text-muted-foreground italic border-primary/30" : "text-foreground/80 border-border/50")}>
                                                        {phase.result}
                                                    </div>
                                                )}
                                                {phase.error && (
                                                    <div className="text-xs text-red-400 mt-2 pl-8 font-mono bg-red-500/5 p-2 rounded">
                                                        ERROR: {phase.error}
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        ) : (
                            <div className="flex h-full items-center justify-center text-muted-foreground">파이프라인을 선택하세요.</div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

// =========================================================================

export default function MaiisCommandCenter() {
    const [isTerminalOpen, setIsTerminalOpen] = useState(false);
    const [isTesterOpen, setIsTesterOpen] = useState(false);
    const [isPipelineModalOpen, setIsPipelineModalOpen] = useState(false);
    const [activeTab, setActiveTab] = useState<'theme' | 'keyword'>('theme');
    const [stockTab, setStockTab] = useState<'portfolio' | 'rising'>('portfolio');
    const [isPmRunning, setIsPmRunning] = useState(false);
    const [latestPipelineRun, setLatestPipelineRun] = useState<any>(null);
    const [data, setData] = useState<any>({
        marketReports: [],
        keywordRankings: [],
        sectorRankings: [],
        recommendedStocks: [],
        masterSummary: null,
        sentimentChart: []
    });

    const fetchPipelineStatus = useCallback(async () => {
        try {
            const res = await window.electronAPI.getLatestPipelineRuns();
            if (res) {
                const latests = Object.values(res).filter(Boolean) as any[];
                if (latests.length > 0) {
                    latests.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
                    setLatestPipelineRun(latests[0]);
                }
            }
        } catch (e) { console.error('Failed to fetch pipeline status:', e); }
    }, []);

    useEffect(() => {
        fetchPipelineStatus();
        const interval = setInterval(fetchPipelineStatus, 30000);
        return () => clearInterval(interval);
    }, [fetchPipelineStatus]);

    React.useEffect(() => {
        const fetchDashboardData = async () => {
            try {
                const res = await window.electronAPI.getCommandCenterDashboard();
                if (res.success && res.data) {
                    console.log('[Dashboard] Data loaded:', res.data);
                    setData(res.data);
                } else {
                    console.error("Dashboard data load failed:", res.error);
                }
            } catch (error) {
                console.error("IPC error:", error);
            }
        };
        if (!isTesterOpen) {
            fetchDashboardData();
        }
    }, [isTesterOpen]);

    const { marketReports, keywordRankings, sectorRankings, recommendedStocks, portfolio, masterSummary } = data;

    const handleRunPm = async () => {
        if (isPmRunning) return;
        setIsPmRunning(true);
        try {
            const res = await window.electronAPI.runPortfolioReview();
            if (res.success) {
                console.log('[PM AI] Review completed:', res.data);
                // 대시보드 새로고침
                const dashRes = await window.electronAPI.getCommandCenterDashboard();
                if (dashRes.success && dashRes.data) setData(dashRes.data);
            } else {
                console.error('[PM AI] Review failed:', res.error);
            }
        } catch (error) {
            console.error('[PM AI] Error:', error);
        } finally {
            setIsPmRunning(false);
        }
    };

    return (
        <div className="flex flex-col h-full w-full bg-background overflow-hidden relative text-foreground">
            
            {/* Header (Top Row) */}
            <header className="flex-none p-4 px-6 border-b border-border bg-card/40 backdrop-blur-md flex justify-between items-center z-20">
                <div className="flex items-center gap-3">
                    <PipelineStatusIndicator 
                        latestRun={latestPipelineRun} 
                        onClick={() => setIsPipelineModalOpen(true)} 
                    />
                </div>
                <div className="flex gap-2">
                    <button 
                        onClick={() => setIsTesterOpen(true)}
                        className="flex items-center gap-2 px-4 py-2 bg-primary/10 border border-primary text-primary rounded-lg text-sm font-bold shadow-sm hover:bg-primary/20 transition-colors"
                    >
                        <Database size={16} /> 에이전트 품질 인스펙터
                    </button>
                    <button 
                        onClick={() => setIsTerminalOpen(true)}
                        className="flex items-center gap-2 px-4 py-2 bg-zinc-900 border border-zinc-700 text-zinc-100 rounded-lg text-sm font-bold shadow-sm hover:bg-zinc-800 transition-colors"
                    >
                        <Terminal size={16} /> 터미널 로그 보기 (팝업)
                    </button>
                </div>
            </header>

            {/* Main Grid Content */}
            <div className="flex-1 overflow-hidden flex flex-col p-6 bg-muted/10 relative">
                <div className="mx-auto flex flex-col gap-6 max-w-7xl w-full flex-1 min-h-0">
                    {data.isFallbackDate && (
                        <div className="bg-amber-500/10 border border-amber-500/30 text-amber-600 px-4 py-2.5 rounded-xl flex items-center gap-3 shadow-sm">
                            <AlertCircle size={18} />
                            <div className="flex flex-col">
                                <span className="text-[13px] font-bold">휴무일 자동 전환 모드 작동 중</span>
                                <span className="text-[11px] text-amber-600/80 font-medium mt-0.5">당일 시장 수집 데이터가 존재하지 않아, <b>가장 최근 영업일({data.activeDate?.slice(4,6)}월 {data.activeDate?.slice(6,8)}일)</b> 데이터 기준으로 화면을 표시하고 있습니다.</span>
                            </div>
                        </div>
                    )}


                    {/* Middle Row: Charts & Summary Panels (3 Columns) */}
                    <div className="grid grid-cols-3 gap-6">
                        {/* 1. 마켓 센티먼트 - 멀티라인 차트 */}
                        <div className="flex flex-col gap-2">
                            <h2 className="text-sm font-bold flex items-center gap-1.5 h-[26px]"><Activity size={16} className="text-primary"/> 마켓 센티먼트</h2>
                            <div className="bg-card border border-border rounded-xl p-4 h-[160px] shadow-sm flex flex-col overflow-hidden">
                                <div className="flex-1 w-full">
                                    <SentimentTrendChart 
                                        sentimentData={data.sentimentChart || []} 
                                        labels={(data.sentimentLabels || data.sentimentChart?.map((_: any, i: number) => `D-${(data.sentimentChart?.length || 1) - 1 - i}`) || [])}
                                    />
                                </div>
                            </div>
                        </div>

                        {/* 2. 테마/섹터 & 키워드 멀티라인 트렌드 차트 (Tabbed) */}
                        <div className="flex flex-col gap-2">
                            <div className="flex items-center gap-4 h-[26px]">
                                <button 
                                    onClick={() => setActiveTab('theme')} 
                                    className={cn("text-sm font-bold flex items-center gap-1.5 cursor-pointer pb-1 transition-colors border-b-2", activeTab === 'theme' ? "text-amber-500 border-amber-500" : "text-muted-foreground border-transparent hover:text-foreground")}
                                >
                                    <Layers size={16}/> 테마/섹터 유동성
                                </button>
                                <button 
                                    onClick={() => setActiveTab('keyword')} 
                                    className={cn("text-sm font-bold flex items-center gap-1.5 cursor-pointer pb-1 transition-colors border-b-2", activeTab === 'keyword' ? "text-pink-500 border-pink-500" : "text-muted-foreground border-transparent hover:text-foreground")}
                                >
                                    <Hash size={16}/> 키워드 집중도
                                </button>
                            </div>
                            <div className="bg-card border border-border rounded-xl p-3 h-[160px] shadow-sm overflow-hidden">
                                {activeTab === 'theme' ? (
                                    data.themeTrend && data.themeTrend.series.length > 0 ? (
                                        <MultiLineTrendChart trendData={data.themeTrend} />
                                    ) : (
                                        <div className="flex items-center justify-center h-full text-xs text-muted-foreground">데이터 없음 — Data Aggregation을 수행하세요</div>
                                    )
                                ) : (
                                    data.keywordTrend && data.keywordTrend.series.length > 0 ? (
                                        <MultiLineTrendChart trendData={data.keywordTrend} />
                                    ) : (
                                        <div className="flex items-center justify-center h-full text-xs text-muted-foreground">데이터 없음 — Data Aggregation을 수행하세요</div>
                                    )
                                )}
                            </div>
                        </div>

                        {/* 3. 추천종목 퍼포먼스 */}
                        <div className="flex flex-col gap-2">
                            <h2 className="text-sm font-bold flex items-center gap-1.5 h-[26px]"><Target size={16} className="text-green-500"/> 추천종목 요약</h2>
                            <div className="bg-card border border-border rounded-xl p-5 h-[160px] shadow-sm flex flex-col justify-center gap-3">
                                <div className="flex justify-between items-center text-sm border-b border-border/50 pb-2">
                                    <span className="text-muted-foreground font-medium">분석 종목 수</span>
                                    <span className="font-bold">{recommendedStocks.length} 건</span>
                                </div>
                                <div className="flex justify-between items-center text-sm border-b border-border/50 pb-2">
                                    <span className="text-muted-foreground font-medium">마스터 추천</span>
                                    <span className="font-bold text-amber-500">{recommendedStocks.filter(s => s.statusTag?.includes('마스터')).length} 건</span>
                                </div>
                                <div className="flex justify-between items-center text-sm border-b border-border/50 pb-2">
                                    <span className="text-muted-foreground font-medium">센티먼트 지수</span>
                                    <span className={cn("font-bold", (masterSummary?.sentiment || 0.5) > 0.5 ? "text-red-500" : "text-blue-500")}>
                                        {masterSummary ? masterSummary.sentiment?.toFixed(2) : 'N/A'}
                                    </span>
                                </div>
                                <div className="flex justify-between items-center text-sm">
                                    <span className="text-muted-foreground font-medium">보유 중</span>
                                    <span className="font-bold text-blue-500">{recommendedStocks.filter(s => s.statusTag?.includes('보유')).length} 건</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Bottom Row: Detailed Lists (3 Columns) — 개별 스크롤 */}
                    <div className="grid grid-cols-3 gap-12 mt-4 flex-1 min-h-0">
                        
                        {/* 1. 시황리포트 */}
                        <div className="flex flex-col gap-4 min-h-0 overflow-hidden">
                            <div className="flex items-center gap-6 border-b-[3px] border-border pb-2">
                                <h2 className="text-lg font-extrabold flex items-center gap-2 text-foreground relative after:absolute after:bottom-[-11px] after:left-0 after:w-full after:h-[3px] after:bg-foreground">
                                    시황리포트 (Master)
                                </h2>
                            </div>
                            <div className="flex flex-col gap-6 pt-2 flex-1 min-h-0 overflow-y-auto scrollbar-hide">
                                {(() => {
                                    return marketReports.length > 0 ? marketReports.map((item: any, i: number) => (
                                        <div key={i} className="flex flex-col gap-2 pb-5 border-b border-border/50 last:border-0 hover:bg-card/50 px-2 -mx-2 rounded-lg transition-colors group">
                                            <div className="flex justify-between items-center">
                                                <div className="flex items-center gap-2">
                                                    <span className="font-extrabold text-[15px] tabular-nums whitespace-nowrap">{item.date}</span>
                                                    <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-sm uppercase tracking-wider", 
                                                        item.mode === 'Risk On' ? "bg-green-500/20 text-green-600" : 
                                                        item.mode === 'Risk Off' ? "bg-red-500/20 text-red-600" : "bg-muted text-foreground"
                                                    )}>
                                                        {item.mode}
                                                    </span>
                                                </div>
                                                <span className="font-mono text-sm font-bold text-muted-foreground">{item.score}</span>
                                            </div>
                                            <p className="text-[13px] leading-relaxed text-foreground font-medium line-clamp-3 mt-1">
                                                {item.text}
                                            </p>
                                        </div>
                                    )) : (
                                        <div className="text-sm text-muted-foreground py-6 text-center">
                                            <p className="mb-2">시황 리포트가 없습니다.</p>
                                            <p className="text-xs">마스터 AI를 실행하면 자동으로 상성됩니다.</p>
                                        </div>
                                    );
                                })()}
                            </div>
                        </div>

                        {/* 2. 테마 & 키워드 랭킹 (Tabbed) */}
                        <div className="flex flex-col gap-4 min-h-0 overflow-hidden">
                            <div className="flex items-center gap-6 border-b-[3px] border-border pb-2">
                                <h2 
                                    onClick={() => setActiveTab('theme')} 
                                    className={cn("text-lg font-extrabold cursor-pointer transition-colors flex items-center gap-2", activeTab === 'theme' ? "text-foreground relative after:absolute after:bottom-[-11px] after:left-0 after:w-full after:h-[3px] after:bg-foreground" : "text-muted-foreground hover:text-foreground")}
                                >
                                    섹터 랭킹
                                </h2>
                                <h2 
                                    onClick={() => setActiveTab('keyword')} 
                                    className={cn("text-lg font-extrabold cursor-pointer transition-colors flex items-center gap-2", activeTab === 'keyword' ? "text-foreground relative after:absolute after:bottom-[-11px] after:left-0 after:w-full after:h-[3px] after:bg-foreground" : "text-muted-foreground hover:text-foreground")}
                                >
                                    키워드 랭킹
                                </h2>
                            </div>
                            <div className="flex flex-col gap-6 pt-2 flex-1 min-h-0 overflow-y-auto scrollbar-hide">
                                {(activeTab === 'theme' ? sectorRankings : keywordRankings).length > 0 ? (activeTab === 'theme' ? sectorRankings : keywordRankings).map((item, i) => (
                                    <div key={i} className="flex flex-col gap-2 pb-5 border-b border-border/50 last:border-0 hover:bg-card/50 px-2 -mx-2 rounded-lg transition-colors animate-in fade-in duration-200">
                                        <div className="flex justify-between items-start pt-1">
                                            <div className="flex items-center gap-1 flex-1 min-w-0 pr-2">
                                                <span className="font-extrabold text-[15px] w-[14px] tabular-nums">{item.rank}</span>
                                                <div className="flex items-center w-[20px] justify-start">
                                                    {item.change !== 0 ? (
                                                        <span className={cn("text-[10px] font-bold flex items-center", item.isUp ? "text-red-500" : "text-blue-500")}>
                                                            {item.isUp ? <ChevronUp size={12} strokeWidth={4}/> : <ChevronDown size={12} strokeWidth={4}/>}
                                                            {Math.abs(item.change)}
                                                        </span>
                                                    ) : (
                                                        <span className="text-muted-foreground font-bold text-lg leading-none mb-1">-</span>
                                                    )}
                                                </div>
                                                <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: i < 5 ? TREND_COLORS[i % TREND_COLORS.length] : '#94a3b8' }} />
                                                <span className="px-2 py-0.5 bg-muted rounded text-[11px] font-bold truncate shrink-0 max-w-[140px] border border-border shadow-sm">
                                                    {item.badge}
                                                </span>
                                            </div>
                                            <span className="font-mono text-[11px] font-bold text-muted-foreground tabular-nums shrink-0 pt-0.5 w-5 text-right bg-muted/30 p-1 rounded">
                                                {item.weight}
                                            </span>
                                        </div>
                                        <p className="text-[13px] leading-relaxed text-foreground font-medium line-clamp-2 mt-1">
                                            {item.text}
                                        </p>
                                    </div>
                                )) : (
                                    <div className="text-sm text-muted-foreground py-8 text-center">
                                        아직 {activeTab === 'theme' ? '섹터' : '키워드'} 랭킹 데이터가 없습니다.<br/>
                                        <span className="text-xs">인스펙터에서 서브에이전트 실행 → Data Aggregation을 수행하세요.</span>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* 3. 종목 (탭: PM 포트폴리오 / 급등주 분석) */}
                        <div className="flex flex-col gap-4 min-h-0 overflow-hidden">
                            <div className="flex justify-between items-end border-b-[3px] border-border pb-2 relative">
                                <div className="flex items-center gap-3">
                                    <h2 
                                        onClick={() => setStockTab('portfolio')}
                                        className={cn("text-base font-extrabold cursor-pointer transition-colors pb-1 -mb-[11px] border-b-[3px]",
                                            stockTab === 'portfolio' ? 'text-foreground border-foreground' : 'text-muted-foreground border-transparent hover:text-foreground/70'
                                        )}
                                    >PM 포트폴리오</h2>
                                    <h2 
                                        onClick={() => setStockTab('rising')}
                                        className={cn("text-base font-extrabold cursor-pointer transition-colors pb-1 -mb-[11px] border-b-[3px]",
                                            stockTab === 'rising' ? 'text-foreground border-foreground' : 'text-muted-foreground border-transparent hover:text-foreground/70'
                                        )}
                                    >급등주 분석</h2>
                                    {stockTab === 'portfolio' && (
                                        <button
                                            onClick={handleRunPm}
                                            disabled={isPmRunning}
                                            className={cn(
                                                "flex items-center gap-1.5 px-3 py-1 rounded-lg text-[11px] font-bold border transition-colors",
                                                isPmRunning
                                                    ? "bg-primary/10 border-primary/30 text-primary cursor-wait"
                                                    : "bg-violet-500/10 border-violet-500/30 text-violet-500 hover:bg-violet-500/20"
                                            )}
                                        >
                                            {isPmRunning ? <Loader2 size={12} className="animate-spin" /> : <Brain size={12} />}
                                            {isPmRunning ? '분석 중...' : 'PM 실행'}
                                        </button>
                                    )}
                                </div>
                                <div className="text-[10px] text-muted-foreground flex gap-3 font-semibold mb-0.5">
                                    {stockTab === 'portfolio' ? (
                                        <span className="flex items-center gap-1">
                                            <span className="text-violet-500 font-bold">{(portfolio || []).length}</span>종목
                                        </span>
                                    ) : (
                                        <>
                                            <span className="hover:text-foreground cursor-pointer flex items-center gap-0.5">AI점수순 <ChevronDown size={12}/></span>
                                            <span>등락률</span>
                                        </>
                                    )}
                                </div>
                            </div>
                            
                            <div className="flex flex-col gap-3 pt-1 flex-1 min-h-0 overflow-y-auto scrollbar-hide">
                                {stockTab === 'portfolio' ? (
                                    /* ── PM 포트폴리오 탭 ── */
                                    (portfolio || []).length > 0 ? (portfolio || []).map((item: any, i: number) => {
                                        const getPhysicalState = (item: any) => {
                                            if (item.entry_shares > 0 || item.status === 'HOLDING') return { label: `📦 보유중`, cls: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' };
                                            if (item.entry_pending === 1) return { label: '⏳ 매수 대기', cls: 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-400' };
                                            return { label: '👀 관심', cls: 'bg-muted text-muted-foreground border border-border/50' };
                                        };
                                        const getLogicalSignal = (item: any) => {
                                            const sig = (item.last_signal || '').toUpperCase();
                                            if (sig.includes('BUY')) return { label: '🤖 PM: 강력 매수', cls: 'text-red-500 bg-red-500/15' };
                                            if (sig.includes('SELL')) return { label: '🤖 PM: 청산 권고', cls: 'text-blue-500 bg-blue-500/15' };
                                            if (sig.includes('HOLD')) return { label: '🤖 PM: 유지 (HOLD)', cls: 'text-amber-500 bg-amber-500/15' };
                                            return { label: `🤖 PM: ${sig || '관망'}`, cls: 'text-muted-foreground bg-muted' };
                                        };

                                        const physical = getPhysicalState(item);
                                        const logical = getLogicalSignal(item);

                                        return (
                                            <div key={item.stock_code} className="flex flex-col gap-1.5 pb-3 border-b border-border/50 last:border-0 hover:bg-card/50 px-2 -mx-2 rounded-lg transition-colors">
                                                <div className="flex justify-between items-center w-full pt-1">
                                                    <div className="flex items-center gap-1.5 min-w-0 pr-2">
                                                        <span className="font-extrabold text-[14px] w-[16px] tabular-nums text-muted-foreground">{i + 1}</span>
                                                        <span className="font-bold text-[14px] truncate">{item.stock_name}</span>
                                                        <span className="ml-0.5 px-2 h-[18px] flex items-center justify-center bg-violet-500/15 text-violet-600 dark:text-violet-400 font-extrabold text-[11px] rounded-full tabular-nums shrink-0">
                                                            {item.conviction_score}
                                                        </span>
                                                    </div>
                                                    <div className="flex items-center gap-1.5 shrink-0">
                                                        <span className={cn("text-[9.5px] font-black px-2 py-0.5 rounded-md whitespace-nowrap", physical.cls)}>
                                                            {physical.label}
                                                        </span>
                                                        <span className={cn("text-[9.5px] font-black px-2 py-0.5 rounded-md whitespace-nowrap", logical.cls)}>
                                                            {logical.label}
                                                        </span>
                                                    </div>
                                                </div>
                                                {item.last_signal_reason && (
                                                    <p className="text-[11.5px] leading-relaxed text-muted-foreground font-medium line-clamp-2 ml-[22px]">
                                                        {item.last_signal_reason}
                                                    </p>
                                                )}
                                            </div>
                                        );
                                    }) : (
                                        <div className="text-sm text-muted-foreground py-4 text-center">
                                            <Brain size={20} className="mx-auto mb-2 text-violet-500/40" />
                                            <p className="font-semibold text-foreground/60">PM 포트폴리오가 비어있습니다</p>
                                            <p className="text-xs mt-1">[PM 실행] 버튼을 눌러 AI 포트폴리오 리뷰를 시작하세요.</p>
                                        </div>
                                    )
                                ) : (
                                    /* ── 급등주 분석 탭 (기존) ── */
                                    recommendedStocks.length > 0 ? recommendedStocks.map((item: any, i: number) => (
                                        <div key={i} className="flex flex-col gap-1 pb-4 border-b border-border/50 last:border-0 hover:bg-card/50 px-2 -mx-2 rounded-lg transition-colors">
                                            <div className="flex justify-between items-center w-full pt-1">
                                                <div className="flex items-center gap-1 min-w-0 pr-2">
                                                    <span className="font-extrabold text-[15px] w-[14px] tabular-nums">{item.rank}</span>
                                                    <div className="flex items-center w-[20px] justify-start">
                                                        {item.change !== 0 ? (
                                                            <span className={cn("text-[10px] font-bold flex items-center", item.isUp ? "text-red-500" : "text-blue-500")}>
                                                                {item.isUp ? <ChevronUp size={12} strokeWidth={4}/> : <ChevronDown size={12} strokeWidth={4}/>}
                                                                {Math.abs(item.change)}
                                                            </span>
                                                        ) : (
                                                            <span className="text-muted-foreground font-bold text-lg leading-none mb-1">-</span>
                                                        )}
                                                    </div>
                                                    <span className="font-bold text-[14px] truncate">{item.name}</span>
                                                    <span className="ml-1 px-2 h-[18px] flex items-center justify-center bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 font-extrabold text-[10px] rounded-full tabular-nums shrink-0">{item.score}</span>
                                                </div>
                                                <div className="flex items-center gap-2 shrink-0">
                                                    {item.statusTag && (
                                                        <span className={cn("text-[9px] font-bold px-1.5 py-0.5 rounded-md whitespace-nowrap",
                                                            item.statusTag.includes('마스터') ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400' :
                                                            item.statusTag.includes('보유') ? 'bg-blue-500/15 text-blue-600 dark:text-blue-400' :
                                                            item.statusTag.includes('매도') ? 'bg-red-500/15 text-red-500' :
                                                            'bg-muted text-muted-foreground'
                                                        )}>{item.statusTag}</span>
                                                    )}
                                                    <span className={cn("font-bold font-mono text-sm min-w-[50px] text-right", 
                                                        (item.profit || '').startsWith('-') ? "text-blue-500" : 
                                                        (item.profit || '') === '-' ? "text-muted-foreground" : "text-red-500"
                                                    )}>
                                                        {item.profit}
                                                    </span>
                                                    {item.days && (
                                                        <span className="font-mono text-xs font-bold text-muted-foreground w-6 text-right tabular-nums bg-muted/30 px-1 py-0.5 rounded">{item.days}</span>
                                                    )}
                                                </div>
                                            </div>
                                            {item.theme && (
                                                <span className="text-[10px] text-muted-foreground font-semibold ml-[35px]">{item.theme}</span>
                                            )}
                                            <p className="text-[13px] leading-relaxed text-foreground font-medium line-clamp-2 ml-[35px]">
                                                {item.reason}
                                            </p>
                                        </div>
                                    )) : (
                                        <div className="text-sm text-muted-foreground py-4">
                                            <div className="text-center mb-4">
                                                <Sparkles size={20} className="mx-auto mb-2 text-primary/40" />
                                                <p className="font-semibold text-foreground/60">아직 분석된 종목이 없습니다</p>
                                            </div>
                                            <div className="text-xs space-y-2 bg-muted/30 rounded-lg p-3">
                                                <p className="font-semibold text-foreground/70 mb-1">종목 목록이 생성되려면:</p>
                                                <p>1. 급등주/주도주 분석 실행 (장중 수급 스캔)</p>
                                                <p>2. AI 종목 분석 완료</p>
                                                <p className="text-primary/70 font-medium mt-2">→ 분석된 종목이 AI 점수 순으로 자동 표시됩니다.</p>
                                            </div>
                                        </div>
                                    )
                                )}
                            </div>
                        </div>

                    </div>
                </div>
            </div>

            {/* Terminal Log Modal/Popup */}
            {isTerminalOpen && (
                <div className="absolute inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-8 animate-in fade-in duration-200">
                    <div className="bg-[#1e1e1e] w-full max-w-4xl h-[600px] shadow-2xl rounded-2xl border border-zinc-800 flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
                        <div className="bg-zinc-900 border-b border-zinc-800 p-3 flex justify-between items-center shrink-0 shadow-sm">
                            <div className="flex gap-2 items-center">
                                <div className="flex gap-1.5 ml-1">
                                    <div className="w-3 h-3 rounded-full bg-red-500/80 border border-red-500"></div>
                                    <div className="w-3 h-3 rounded-full bg-amber-500/80 border border-amber-500"></div>
                                    <div className="w-3 h-3 rounded-full bg-green-500/80 border border-green-500"></div>
                                </div>
                                <span className="text-zinc-400 font-mono text-xs ml-4 font-semibold tracking-widest uppercase">MAIIS // Active Agent Swarm Console</span>
                            </div>
                            <button onClick={() => setIsTerminalOpen(false)} className="text-zinc-500 hover:text-white transition-colors bg-zinc-800 hover:bg-zinc-700 p-1 rounded-md">
                                <X size={16} strokeWidth={3}/>
                            </button>
                        </div>
                        <div className="flex-1 overflow-y-auto p-4 font-mono text-[13px] leading-relaxed text-zinc-300">
                            <div className="text-blue-400 opacity-80 mb-1">=== SWARM INITIALIZATION ===</div>
                            <div className="mb-1"><span className="text-emerald-400">[MarketScanner]</span> Scanning 2,500 tickers... <span className="text-zinc-500">Done (245ms)</span></div>
                            <div className="mb-1"><span className="text-amber-400">[NaverNews]</span> Extracting daily keywords...</div>
                            <div className="mb-1 text-zinc-500 pl-4">▸ Found 124 articles mentioning "금리 인하"</div>
                            <div className="mb-1 text-zinc-500 pl-4">▸ Found 85 articles mentioning "로보틱스"</div>
                            <div className="mb-4"><span className="text-fuchsia-400">[MasterAgent]</span> Synthesizing macro & news... <span className="text-rose-400 font-bold bg-rose-500/20 px-1 rounded ml-1">RISK-ON DECLARED</span></div>
                            
                            <div className="text-blue-400 opacity-80 mb-1">=== ANALYSIS PIPELINE ===</div>
                            <div className="mb-1"><span className="text-cyan-400">[SectorAgent]</span> Weighting IT Hardware: 95, Finance: 82.</div>
                            <div className="mb-1"><span className="text-purple-400">[AnalystAgent]</span> Running fundamental checks on Q1 candidate: "한미반도체"</div>
                            <div className="mb-1 text-zinc-500 pl-4">▸ PE: 45.2, PB: 6.1 (Premium applied)</div>
                            <div className="mb-1 text-zinc-500 pl-4">▸ Foreign Ownership: +2.1% WoW</div>
                            <div className="mb-1"><span className="text-emerald-400 bg-emerald-500/10 text-emerald-300 px-1 rounded ml-1 border border-emerald-500/20">[ACTION]</span> <span className="text-white font-bold">Buy Signal Generated for 042700.KS</span></div>
                            <div className="mt-6 text-zinc-600 animate-pulse">_ Awaiting next tick...</div>
                        </div>
                    </div>
                </div>
            )}
            {isPipelineModalOpen && <PipelineMonitorModal onClose={() => setIsPipelineModalOpen(false)} />}
            {isTesterOpen && <MaiisAgentTester onClose={() => setIsTesterOpen(false)} />}
        </div>
    );
}
