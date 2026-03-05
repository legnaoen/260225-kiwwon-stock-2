import React, { useState, useEffect } from 'react'
import { BrainCircuit, Play, CheckCircle2, TrendingUp, X, Settings2, Info, Clock, PlayCircle, Trash2 } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface StrategyHistory {
    date: string;
    return: number;
}

interface StrategyDetail {
    id: string;
    version: string;
    name: string;
    created_at: string;
    reasonToPropose: string;
    isActive: boolean;
    win_rate: number;
    avg_hold_time: string;
    history: StrategyHistory[];
    targetProfit: number;
    stopLoss: number;
    minAiScore: number;
    maxPositions: number;
    scoringWeights: { vwap: number; velocity: number; trend: number; gap: number; leader: number };
    masterPrompt: string;
}

export default function StrategyReviewTab() {
    const [selectedStrategy, setSelectedStrategy] = useState<StrategyDetail | null>(null);
    const [isMarketOpen, setIsMarketOpen] = useState(false);
    const [isAnalyzed, setIsAnalyzed] = useState(false);
    const [currentTime, setCurrentTime] = useState(new Date());
    const [strategies, setStrategies] = useState<StrategyDetail[]>([]);
    const [isSimulating, setIsSimulating] = useState(false);

    const loadStrategies = async () => {
        try {
            const data = await window.electronAPI.getAiStrategies();
            // v1을 항상 리스트 상단이나 정해진 위치에 노출하기 위해 정렬 보정 가능
            const sortedData = data ? [...data].sort((a, b) => {
                if (a.version === 'v1') return -1;
                if (b.version === 'v1') return 1;
                return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
            }) : [];

            setStrategies(sortedData);
            // If strategies exist created today, mark as analyzed
            const today = new Date().toISOString().split('T')[0];
            const analyzedToday = data?.some((s: StrategyDetail) => s.created_at.startsWith(today) && s.version !== 'v1');
            setIsAnalyzed(analyzedToday);
        } catch (error) {
            console.error('Failed to load strategies:', error);
        }
    };

    useEffect(() => {
        loadStrategies();

        const timer = setInterval(() => setCurrentTime(new Date()), 1000);

        // Market Hour Logic (09:00 - 15:30)
        const hours = currentTime.getHours();
        const minutes = currentTime.getMinutes();
        const timeVal = hours * 100 + minutes;
        setIsMarketOpen(timeVal >= 900 && timeVal <= 1530);

        return () => clearInterval(timer);
    }, []);

    // Generate last 8 days for table header
    const dates = Array.from({ length: 8 }, (_, i) => {
        const d = new Date();
        d.setDate(d.getDate() - i);
        return d.toISOString().split('T')[0]; // YYYY-MM-DD
    });

    const formattedDate = `${currentTime.getMonth() + 1}월 ${currentTime.getDate()}일`;

    const handleDeleteStrategy = async (id: string) => {
        const strat = strategies.find(s => s.id === id);
        if (strat?.version === 'v1') {
            alert("공장 설정(v1) 전략은 삭제할 수 없습니다.");
            return;
        }
        if (strat?.isActive) {
            alert("현재 가동 중인 메인 전략은 삭제할 수 없습니다.");
            return;
        }
        if (confirm("정말로 이 전략을 삭제하시겠습니까? 관련 백테스트 데이터가 모두 소실됩니다.")) {
            await window.electronAPI.deleteAiStrategy(id);
            setSelectedStrategy(null);
            loadStrategies();
        }
    };

    const handleRunRetrospective = async () => {
        setIsSimulating(true);
        try {
            await window.electronAPI.runAiRetrospective();
            await loadStrategies();
        } catch (error) {
            console.error(error);
            alert('분석 중 오류가 발생했습니다.');
        } finally {
            setIsSimulating(false);
        }
    };

    const handleSetActiveStrategy = async (id: string) => {
        await window.electronAPI.setAiActiveStrategy(id);
        await window.electronAPI.syncStrategyConfig(); // Sync runtime config
        setSelectedStrategy(null);
        loadStrategies();
    };

    return (
        <div className="flex flex-col h-full overflow-hidden text-sm w-full relative">
            {/* Header Area */}
            <div className="p-4 shrink-0 flex items-center justify-between border-b border-border bg-muted/5">
                <div>
                    <h2 className="font-bold flex items-center gap-2 text-foreground">
                        <BrainCircuit className="text-primary w-4 h-4" />
                        AI 자가 진화 및 전략 연구소
                    </h2>
                    <p className="text-xs text-muted-foreground mt-1 font-medium">
                        매일 장 마감 후 발생한 매매 데이터를 복기하고 신규 최적 파라미터를 도출합니다.
                    </p>
                </div>
                <button
                    onClick={handleRunRetrospective}
                    disabled={isSimulating}
                    className="bg-primary text-primary-foreground px-4 py-2 font-bold flex items-center gap-2 hover:bg-primary/90 transition-all text-xs active:scale-95 shadow-sm disabled:opacity-50"
                >
                    <Play size={14} fill="currentColor" />
                    {isSimulating ? '데이터 분석 및 구동 중...' : '야간 시뮬레이션 일괄 구동'}
                </button>
            </div>

            <div className="flex flex-col lg:flex-row flex-1 min-h-0 w-full overflow-hidden">
                {/* AI Commentary Column */}
                <div className="w-full lg:w-1/3 flex flex-col border-b lg:border-b-0 lg:border-r border-border min-h-0 overflow-hidden bg-background">
                    <div className="border-b border-border bg-muted/20 p-3 font-semibold text-xs shrink-0 select-none cursor-default">
                        {formattedDate} 당일 종합 분석
                    </div>

                    <div className="flex-1 flex flex-col overflow-hidden">
                        {isAnalyzed && strategies.length > 0 ? (
                            <div className="p-4 overflow-y-auto space-y-4 flex-1 custom-scrollbar">
                                <div className="p-3 bg-green-500/5 border-l-4 border-green-500 text-green-700 dark:text-green-400">
                                    <span className="font-bold flex items-center gap-1 mb-2">
                                        <TrendingUp size={14} /> 최신 분석 브리핑
                                    </span>
                                    <div className="prose prose-xs dark:prose-invert max-w-none">
                                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                            {strategies.find(s => s.version !== 'v1')?.reasonToPropose || strategies[0].reasonToPropose}
                                        </ReactMarkdown>
                                    </div>
                                </div>
                                <div className="pt-2">
                                    <button
                                        disabled
                                        className="w-full py-2 border border-primary/50 text-primary font-bold bg-primary/5 flex items-center justify-center gap-2 text-xs opacity-80 cursor-default"
                                    >
                                        <CheckCircle2 size={12} /> 최신 모델 ({strategies[0].version}) 리더보드 등재 완료
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <div className="flex-1 flex flex-col items-center justify-center p-6 text-center space-y-4 bg-muted/5">
                                <div className="p-4 rounded-full bg-muted/20 border border-border">
                                    <Clock size={32} className="text-muted-foreground opacity-50" />
                                </div>
                                <div>
                                    <p className="font-bold text-foreground">16:00에 통계 기반 AI 리뷰 예정</p>
                                    <p className="text-[10px] text-muted-foreground mt-1">장 마감 후 데이터를 수집하여<br />당일 매매를 복기하고 신규 모델을 제안합니다.</p>
                                </div>
                                <button
                                    onClick={handleRunRetrospective}
                                    disabled={isMarketOpen || isSimulating}
                                    className={`w-full py-2.5 font-bold flex items-center justify-center gap-2 text-xs transition-all active:scale-95 ${isMarketOpen || isSimulating
                                        ? 'bg-muted text-muted-foreground cursor-not-allowed opacity-50 border border-border'
                                        : 'bg-amber-500 text-white hover:bg-amber-600 shadow-md'
                                        }`}
                                >
                                    <PlayCircle size={14} />
                                    {isSimulating ? '분석 중...' : `AI 분석 매뉴얼 시작 ${isMarketOpen ? '(장 중 비활성)' : ''}`}
                                </button>
                            </div>
                        )}
                    </div>
                </div>

                {/* Strategy Leaderboard Column */}
                <div className="flex-1 flex flex-col min-h-0 overflow-hidden bg-background">
                    <div className="border-b border-border bg-muted/20 p-3 font-semibold text-xs flex justify-between items-center shrink-0">
                        <span>전역 전략별 수익 이력 (Leaderboard History)</span>
                        <span className="text-[10px] text-muted-foreground font-normal italic">분석 승인 시 신규 전략 자동 추가</span>
                    </div>

                    <div className="flex-1 overflow-auto w-full relative">
                        <table className="w-full text-xs text-left border-separate border-spacing-0 min-w-max">
                            <thead className="sticky top-0 z-30">
                                <tr className="bg-background/95 backdrop-blur text-muted-foreground border-b border-border font-semibold">
                                    <th className="w-[30px] min-w-[30px] max-w-[30px] border-b border-border sticky left-0 z-40 bg-background"></th>
                                    <th className="w-[100px] min-w-[100px] max-w-[100px] p-3 border-b border-border sticky left-[30px] z-40 bg-background text-center">버전</th>
                                    <th className="w-[80px] min-w-[80px] max-w-[80px] p-3 border-b border-border sticky left-[130px] z-40 bg-background shadow-[2px_0_0_0_rgba(0,0,0,0.05)] text-center">승률</th>
                                    {dates.map(date => {
                                        const shortDate = date.split('-').slice(1).join('/'); // MM/DD
                                        return <th key={date} className="p-3 border-b border-border text-center min-w-[60px]">{shortDate}</th>;
                                    })}
                                </tr>
                            </thead>
                            <tbody>
                                {strategies.length === 0 && (
                                    <tr>
                                        <td colSpan={dates.length + 3} className="text-center p-8 text-muted-foreground">
                                            등록된 전략이 없습니다. 분석을 실행하여 첫 번째 버전을 생성하세요.
                                        </td>
                                    </tr>
                                )}
                                {strategies.map((strat) => (
                                    <tr key={strat.id} className={`hover:bg-muted/5 transition-colors group ${strat.isActive ? 'bg-primary/5' : ''}`}>
                                        <td className="w-[30px] min-w-[30px] max-w-[30px] p-3 text-center sticky left-0 z-20 bg-background border-b border-border/50">
                                            {strat.isActive && <Play size={10} fill="currentColor" className="text-primary" />}
                                        </td>
                                        <td
                                            className="w-[100px] min-w-[100px] max-w-[100px] p-3 font-bold text-primary sticky left-[30px] z-20 bg-background border-b border-border/50 cursor-pointer hover:underline text-center"
                                            onClick={() => setSelectedStrategy(strat)}
                                        >
                                            {strat.version}
                                        </td>
                                        <td className="w-[80px] min-w-[80px] max-w-[80px] p-3 font-bold sticky left-[130px] z-20 bg-background shadow-[2px_0_0_0_rgba(0,0,0,0.05)] border-b border-border/50 text-center">
                                            {strat.win_rate}%
                                        </td>
                                        {dates.map((date) => {
                                            const hist = strat.history?.find(h => h.date === date);
                                            const pnlValue = hist?.return || 0;
                                            const pnlStr = hist ? (pnlValue > 0 ? `+${pnlValue}%` : `${pnlValue}%`) : '—';

                                            return (
                                                <td key={date} className={`p-3 text-center border-b border-border/50 font-mono ${pnlValue > 0 ? 'text-green-500/90' : pnlValue < 0 ? 'text-red-500/90' : 'text-muted-foreground/30'}`}>
                                                    {pnlStr}
                                                </td>
                                            );
                                        })}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            {/* Strategy Detail Modal Overlay */}
            {selectedStrategy && (
                <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-300">
                    <div className="bg-background border border-border shadow-2xl w-full max-w-lg animate-in slide-in-from-bottom-4 duration-300">
                        <div className="flex items-center justify-between p-4 border-b border-border bg-muted/20">
                            <div className="flex items-center gap-2 font-bold text-foreground">
                                <Settings2 size={16} className="text-primary" />
                                {selectedStrategy.version} 전략 스펙 및 진화 사유
                            </div>
                            <button onClick={() => setSelectedStrategy(null)} className="p-1 hover:bg-muted rounded-full transition-colors text-muted-foreground">
                                <X size={20} />
                            </button>
                        </div>

                        <div className="p-5 space-y-6 text-sm overflow-y-auto max-h-[80vh]">
                            {/* Summary Rows */}
                            <div className="grid grid-cols-2 gap-4">
                                <div className="p-3 bg-muted/20 border border-border">
                                    <span className="text-[10px] text-muted-foreground block border-b border-border/50 pb-1 mb-2 uppercase font-bold tracking-wider">승률 (Win Rate)</span>
                                    <span className="text-xl font-bold font-mono text-primary">{selectedStrategy.win_rate}%</span>
                                </div>
                                <div className="p-3 bg-muted/20 border border-border">
                                    <span className="text-[10px] text-muted-foreground block border-b border-border/50 pb-1 mb-2 uppercase font-bold tracking-wider">평균 포지션 시간</span>
                                    <span className="text-xl font-bold font-mono">{selectedStrategy.avg_hold_time}</span>
                                </div>
                            </div>

                            {/* Detail Params and Weights */}
                            <div className="space-y-4">
                                <h4 className="text-[10px] font-bold text-muted-foreground uppercase border-b border-border pb-1">AI 제안 상세 파라미터</h4>
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="p-3 bg-muted/10 border border-border">
                                        <div className="text-[10px] text-muted-foreground mb-1">목표 수익률</div>
                                        <div className="text-sm font-bold text-green-500">+{selectedStrategy.targetProfit}%</div>
                                    </div>
                                    <div className="p-3 bg-muted/10 border border-border">
                                        <div className="text-[10px] text-muted-foreground mb-1">손절 제한선</div>
                                        <div className="text-sm font-bold text-red-500">{selectedStrategy.stopLoss}%</div>
                                    </div>
                                    <div className="p-3 bg-muted/10 border border-border">
                                        <div className="text-[10px] text-muted-foreground mb-1">진입 최소 AI 점수</div>
                                        <div className="text-sm font-bold">{selectedStrategy.minAiScore}점</div>
                                    </div>
                                    <div className="p-3 bg-muted/10 border border-border">
                                        <div className="text-[10px] text-muted-foreground mb-1">최대 보유 종목</div>
                                        <div className="text-sm font-bold">{selectedStrategy.maxPositions}개</div>
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <h4 className="text-[10px] font-bold text-muted-foreground uppercase border-b border-border pb-1">핵심 채점 가중치 (Scoring Weights)</h4>
                                    <div className="space-y-2 pt-1">
                                        {Object.entries(selectedStrategy.scoringWeights || {}).map(([key, value]) => (
                                            <div key={key} className="flex items-center justify-between text-[11px]">
                                                <span className="capitalize text-muted-foreground">
                                                    {key === 'vwap' ? 'VWAP 타점' :
                                                        key === 'velocity' ? '수급 속도' :
                                                            key === 'trend' ? '추세 돌파' :
                                                                key === 'gap' ? '당일 상승률' :
                                                                    key === 'leader' ? '시장 주도주 (테마)' : '알 수 없음'}
                                                </span>
                                                <div className="flex items-center gap-2 flex-1 ml-4">
                                                    <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                                                        <div className="h-full bg-primary" style={{ width: `${value}%` }}></div>
                                                    </div>
                                                    <span className="font-mono font-bold w-8 text-right text-primary">{value}%</span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                <div className="space-y-3 pt-2">
                                    <div>
                                        <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider flex items-center gap-1 mb-1.5">
                                            <Info size={12} className="text-blue-500" /> 전략 모델 명
                                        </span>
                                        <div className="p-2.5 bg-muted/5 border border-border leading-relaxed font-bold text-foreground">
                                            {selectedStrategy.name}
                                        </div>
                                    </div>

                                    <div>
                                        <span className="text-[10px] text-amber-500 uppercase font-bold tracking-wider flex items-center gap-1 mb-1.5">
                                            <TrendingUp size={12} /> 전략 보정 제안 사유
                                        </span>
                                        <div className="p-3 bg-amber-500/5 border border-amber-500/20 leading-relaxed text-foreground italic border-l-4 text-xs">
                                            {selectedStrategy.reasonToPropose}
                                        </div>
                                    </div>

                                    <div>
                                        <span className="text-[10px] text-primary uppercase font-bold tracking-wider flex items-center justify-between mb-1.5">
                                            <div className="flex items-center gap-1"><BrainCircuit size={12} /> 마스터 프롬프트 (판단 지침)</div>
                                            <button
                                                onClick={() => navigator.clipboard.writeText(selectedStrategy.masterPrompt)}
                                                className="text-[9px] bg-muted px-1 rounded hover:bg-muted/80"
                                            >
                                                COPY
                                            </button>
                                        </span>
                                        <div className="p-3 bg-muted/20 border border-border leading-relaxed text-[10px] font-mono whitespace-pre-wrap max-h-[150px] overflow-y-auto custom-scrollbar">
                                            {selectedStrategy.masterPrompt || "설정된 프롬프트가 없습니다."}
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Action Buttons */}
                            <div className="pt-2 flex gap-3">
                                {selectedStrategy.isActive ? (
                                    <div className="flex-1 py-3 bg-green-500/10 text-green-600 font-bold border border-green-500/20 text-center flex items-center justify-center gap-2">
                                        <CheckCircle2 size={16} /> 현재 가동 중인 메인 전략입니다
                                    </div>
                                ) : (
                                    <>
                                        <button
                                            onClick={() => handleSetActiveStrategy(selectedStrategy.id)}
                                            className="flex-1 py-3 bg-primary text-primary-foreground font-bold hover:bg-primary/90 transition-all active:scale-95 shadow-md flex items-center justify-center gap-2"
                                        >
                                            <PlayCircle size={16} fill="currentColor" /> 이 버전으로 교체 실행
                                        </button>
                                        <button
                                            onClick={() => handleDeleteStrategy(selectedStrategy.id)}
                                            className="px-4 py-3 bg-destructive/10 font-bold text-destructive hover:bg-destructive hover:text-white border border-destructive/20 transition-all active:scale-95 flex items-center justify-center gap-2"
                                        >
                                            <Trash2 size={16} /> 폐기
                                        </button>
                                    </>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
