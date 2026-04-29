import React, { useState, useEffect, useMemo } from 'react'
import { FileText, ShieldCheck, BarChart2, TrendingUp, AlertCircle, Loader2, Tag, Plus, X, Trash2, Clipboard, ClipboardCheck, ChevronDown, ChevronUp, Bot } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from '../utils'
import { useTagStore } from '../store/useTagStore'

interface StockAiReportProps {
    symbol: string
    name: string
    refreshTrigger?: number
    hideTitle?: boolean
    pmEvents?: any[] // Added PM events
    gemmaReports?: any[] // Added Gemma Reports
}

interface GemmaReport {
    id: number;
    date: string;
    stock_code: string;
    stock_name: string;
    agent_source: string;
    market_theme_link: string | null;
    theme_durability: string | null;
    catalyst_summary: string | null;
    risk_factors: string | null;
    upside_probability: string | null;
    buy_score: number;
    preliminary_decision: string | null;
    reasoning: string | null;
    injected_context_json: string | null;
    system_prompt: string | null;
    raw_ai_response: string | null;
    created_at: string;
}

// 로데이터 복사 버튼 컴포넌트
function CopyRawDataButton({ report }: { report: GemmaReport }) {
    const [copied, setCopied] = useState(false);

    const handleCopy = React.useCallback(async () => {
        const text = [
            `=== TRACK_B_GEMMA 분석 로데이터 ===`,
            `날짜: ${report.date} | 종목: ${report.stock_name} (${report.stock_code}) | 저장: ${report.created_at}`,
            ``,
            `[파싱된 결과]`,
            `buy_score: ${report.buy_score} / preliminary_decision: ${report.preliminary_decision}`,
            `market_theme_link: ${report.market_theme_link ?? '없음'}`,
            `theme_durability: ${report.theme_durability ?? '없음'}`,
            `catalyst_summary: ${report.catalyst_summary ?? '없음'}`,
            `risk_factors: ${report.risk_factors ?? '없음'}`,
            `upside_probability: ${report.upside_probability ?? '없음'}`,
            `reasoning: ${report.reasoning ?? '없음'}`,
            ``,
            `[주입된 컨텍스트 원문]`,
            report.injected_context_json ?? '(없음)',
            ``,
            `[사용된 시스템 프롬프트]`,
            report.system_prompt ?? '(없음)',
            ``,
            `[AI 응답 원문 (파싱 전)]`,
            report.raw_ai_response ?? '(없음)',
        ].join('\n');

        try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 2500);
        } catch {
            // fallback
        }
    }, [report]);

    return (
        <button
            onClick={handleCopy}
            className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-bold rounded-md border transition-all duration-200
                       text-violet-400 border-violet-500/30 bg-violet-500/5 hover:bg-violet-500/15 hover:border-violet-500/50"
            title="이 분석에 사용된 컨텍스트, 프롬프트, AI 응답 원문을 클립보드에 복사합니다"
        >
            {copied ? <ClipboardCheck size={12} className="text-green-400" /> : <Clipboard size={12} />}
            {copied ? '복사됨!' : '로데이터 복사'}
        </button>
    );
}

// Gemma 분석 카드 컴포넌트
function GemmaReportCard({ report }: { report: GemmaReport }) {
    const [expanded, setExpanded] = useState(false);

    const decisionColor = report.preliminary_decision === 'BUY'
        ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30'
        : 'text-amber-400 bg-amber-500/10 border-amber-500/30';

    const probColor = report.upside_probability === 'HIGH'
        ? 'text-emerald-400'
        : report.upside_probability === 'MEDIUM'
        ? 'text-yellow-400'
        : 'text-red-400';

    return (
        <div className="border border-violet-500/20 bg-violet-500/5 rounded-lg overflow-hidden mt-1 mb-2">
            {/* 카드 헤더 */}
            <div className="flex items-center justify-between px-3 py-2.5">
                <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[11px] font-mono text-muted-foreground">{report.date}</span>
                    <span className={`text-[11px] font-bold px-2 py-0.5 rounded border ${decisionColor}`}>
                        {report.preliminary_decision ?? 'N/A'}
                    </span>
                    <span className="text-[11px] font-bold text-muted-foreground">
                        점수: <span className="text-violet-300">{report.buy_score}</span>
                    </span>
                    <span className={`text-[11px] font-bold ${probColor}`}>
                        {report.upside_probability ?? 'N/A'}
                    </span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                    <CopyRawDataButton report={report} />
                    <button
                        onClick={() => setExpanded(e => !e)}
                        className="p-1 text-muted-foreground hover:text-foreground transition-colors"
                    >
                        {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </button>
                </div>
            </div>

            {/* 축약 요약 항상 표시 */}
            {report.catalyst_summary && (
                <div className="px-3 pb-2 text-[12px] text-muted-foreground">
                    💡 {report.catalyst_summary.slice(0, 120)}{report.catalyst_summary.length > 120 ? '...' : ''}
                </div>
            )}

            {/* 펼치면 상세 표시 */}
            {expanded && (
                <div className="border-t border-violet-500/10 px-3 py-3 space-y-2 bg-background/30">
                    {report.market_theme_link && (
                        <div>
                            <div className="text-[10px] font-bold text-violet-400 uppercase tracking-wider mb-0.5">시장 테마 연관</div>
                            <div className="text-[12px] text-foreground">{report.market_theme_link}</div>
                        </div>
                    )}
                    {report.theme_durability && (
                        <div>
                            <div className="text-[10px] font-bold text-violet-400 uppercase tracking-wider mb-0.5">테마 지속성</div>
                            <div className="text-[12px] text-foreground">{report.theme_durability}</div>
                        </div>
                    )}
                    {report.risk_factors && (
                        <div>
                            <div className="text-[10px] font-bold text-red-400 uppercase tracking-wider mb-0.5">리스크</div>
                            <div className="text-[12px] text-foreground/80">{report.risk_factors}</div>
                        </div>
                    )}
                    {report.reasoning && (
                        <div>
                            <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-0.5">종합 근거</div>
                            <div className="text-[12px] text-foreground/80 italic">{report.reasoning}</div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

export function StockAiReport({ symbol, name, refreshTrigger, hideTitle, pmEvents, gemmaReports = [] }: StockAiReportProps) {
    const [reports, setReports] = useState<any[]>([])
    const [loading, setLoading] = useState(true)

    const numericCode = symbol?.replace(/[^0-9]/g, '') || symbol || ''

    useEffect(() => {
        const fetchReports = async () => {
            setLoading(true)
            try {
                const result = await (window as any).electronAPI.getStockAnalysis(symbol)
                if (result.success && result.data) {
                    setReports(result.data)
                    setReports(result.data)
                } else {
                    setReports([])
                }
            } catch (err) {
                console.error('[StockAiReport] Failed to fetch reports:', err)
            } finally {
                setLoading(false)
            }
        }
        fetchReports()
    }, [symbol, refreshTrigger])



    const [filterType, setFilterType] = useState<'ALL'|'AI_REPORT'|'PM_EVENT'|'GEMMA_REPORT'>('ALL')

    const unifiedTimeline = useMemo(() => {
        let combined: any[] = [];
        
        const rpts = reports.map(r => ({
            _type: 'AI_REPORT',
            _sortDate: new Date(r.date).getTime() || 0,
            ...r
        }));
        combined = [...combined, ...rpts];

        if (pmEvents && pmEvents.length > 0) {
            const evts = pmEvents.map(e => ({
                _type: 'PM_EVENT',
                _sortDate: new Date(e.created_at).getTime() || 0,
                ...e
            }));
            combined = [...combined, ...evts];
        }

        if (gemmaReports && gemmaReports.length > 0) {
            const gemmas = gemmaReports.map(g => ({
                _type: 'GEMMA_REPORT',
                _sortDate: new Date(g.created_at || g.date).getTime() || 0,
                ...g
            }));
            combined = [...combined, ...gemmas];
        }

        let filtered = combined;
        if (filterType === 'AI_REPORT') filtered = combined.filter(x => x._type === 'AI_REPORT');
        if (filterType === 'PM_EVENT') filtered = combined.filter(x => x._type === 'PM_EVENT');
        if (filterType === 'GEMMA_REPORT') filtered = combined.filter(x => x._type === 'GEMMA_REPORT');

        return filtered.sort((a, b) => b._sortDate - a._sortDate);
    }, [reports, pmEvents, filterType]);

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center h-full py-20 opacity-50 space-y-4">
                <Loader2 className="animate-spin text-primary" size={32} />
                <p className="text-sm font-bold">AI 리포트를 불러오는 중...</p>
            </div>
        )
    }

    // AI 점수에 따른 스타일 결정
    const getScoreStyle = (score: number) => {
        if (score >= 80) return { color: '#22C55E', label: 'Strong Buy' }
        if (score >= 60) return { color: '#EAB308', label: 'Buy' }
        if (score >= 40) return { color: '#F97316', label: 'Hold' }
        return { color: '#EF4444', label: 'Caution' }
    }

    return (
        <div className="space-y-8 max-w-4xl mx-auto animate-in fade-in slide-in-from-bottom-2 duration-300 pb-20">
            {/* 상단 섹션: 종목명 및 태그 */}
            <div className="relative">
                <div className="flex flex-wrap items-center gap-4 mb-2">
                    {!hideTitle && <h3 className="text-3xl font-black tracking-tighter text-foreground">{name}</h3>}
                </div>
                {!hideTitle && <div className="h-[1px] w-full bg-border/40 mb-8" />}
            </div>

            {/* 타임라인 필터 */}
            <div className="flex items-center gap-2 mb-6 border-b border-border/40 pb-4">
                <button 
                    onClick={() => setFilterType('ALL')}
                    className={cn("px-3 py-1.5 text-xs font-bold rounded-lg transition-colors border", filterType === 'ALL' ? "bg-primary/10 text-primary border-primary/30" : "bg-transparent text-muted-foreground border-transparent hover:bg-muted/50")}
                >
                    전체 타임라인
                </button>
                <button 
                    onClick={() => setFilterType('PM_EVENT')}
                    className={cn("px-3 py-1.5 text-xs font-bold rounded-lg transition-colors border", filterType === 'PM_EVENT' ? "bg-rose-500/10 text-rose-500 border-rose-500/30" : "bg-transparent text-muted-foreground border-transparent hover:bg-muted/50")}
                >
                    매니저 판단 이력
                </button>
                <button 
                    onClick={() => setFilterType('AI_REPORT')}
                    className={cn("px-3 py-1.5 text-xs font-bold rounded-lg transition-colors border", filterType === 'AI_REPORT' ? "bg-blue-500/10 text-blue-500 border-blue-500/30" : "bg-transparent text-muted-foreground border-transparent hover:bg-muted/50")}
                >
                    AI 리포트만 보기
                </button>
                <button 
                    onClick={() => setFilterType('GEMMA_REPORT')}
                    className={cn("px-3 py-1.5 text-xs font-bold rounded-lg transition-colors border", filterType === 'GEMMA_REPORT' ? "bg-violet-500/10 text-violet-500 border-violet-500/30" : "bg-transparent text-muted-foreground border-transparent hover:bg-muted/50")}
                >
                    Gemma 리서치
                </button>
            </div>

            {/* 리포트/이벤트 통합 타임라인 목록 */}
            <div className="space-y-10 pl-2">
                {unifiedTimeline.length > 0 ? unifiedTimeline.map((item, idx) => {
                    const isPM = item._type === 'PM_EVENT';
                    const isGemma = item._type === 'GEMMA_REPORT';
                    
                    if (isGemma) {
                        return (
                            <div key={`gemma-${idx}`} className="group relative pl-8 border-l-2 border-border/40 hover:border-violet-500/30 transition-colors pb-4">
                                <div className="absolute -left-[9px] top-1 w-4 h-4 rounded-full border-2 border-background shadow-sm bg-violet-400" />
                                <GemmaReportCard report={item} />
                            </div>
                        )
                    }

                    if (isPM) {
                        const log = item;
                        return (
                            <div key={`pm-${idx}`} className="group relative pl-8 border-l-2 border-border/40 hover:border-rose-500/30 transition-colors pb-2">
                                <div className="absolute -left-[9px] top-1 w-4 h-4 rounded-full border-2 border-background shadow-sm bg-rose-400" />
                                <div className="flex flex-wrap items-center gap-2 mb-3">
                                    <span className="text-[11px] font-mono font-bold text-muted-foreground bg-muted/30 px-2 py-0.5 rounded border border-border/30">
                                        {log.created_at?.slice(0, 16).replace('T', ' ')}
                                    </span>
                                    <span className={cn(
                                        "text-[11px] font-black px-2.5 py-0.5 rounded-full whitespace-nowrap border shadow-sm",
                                        log.event_type === 'WATCHLIST_ADDED' ? 'bg-blue-500 text-white border-blue-600' :
                                            log.event_type === 'BUY_UPGRADED' ? 'bg-rose-500 text-white border-rose-600' :
                                                log.event_type === 'DROPPED' ? 'bg-muted-foreground text-white border-muted-foreground' :
                                                    'bg-amber-500 text-white border-amber-600'
                                    )}>
                                        {log.event_type === 'WATCHLIST_ADDED' ? '👀 관심종목 편입' :
                                        log.event_type === 'BUY_UPGRADED' ? '💰 매수 지시' :
                                        log.event_type === 'DROPPED' ? '❌ 탈락/포기' :
                                        log.event_type}
                                    </span>
                                    {log.price > 0 && (
                                        <div className="flex items-center gap-1.5 ml-1">
                                            <span className="text-[12px] font-mono font-black text-foreground">
                                                @ {log.price?.toLocaleString()}원
                                            </span>
                                            {/* 수동 진입가 동기화 버튼 (매수 관련 이벤트만) */}
                                            {(log.event_type.includes('BUY') || log.event_type.includes('HELD')) && (
                                                <button
                                                    onClick={async (e) => {
                                                        e.stopPropagation();
                                                        if (window.confirm(`이 날짜(${log.created_at.substring(0, 10)})의 가격(${log.price.toLocaleString()}원)을 진입가로 수동 반영하시겠습니까?\n\n추가일(${log.created_at.substring(0, 10)})과 수익률 계산 기준이 변경됩니다.`)) {
                                                            const res = await (window as any).electronAPI.syncEntryPrice(symbol, log.price, log.created_at);
                                                            if (res?.success) alert('진입가가 업데이트 되었습니다. 창을 닫고 리스트를 갱신해 보세요.');
                                                        }
                                                    }}
                                                    className="w-[72px] h-[18px] ml-1 text-[9px] font-bold text-rose-500 border border-rose-500/30 bg-rose-500/5 rounded flex items-center justify-center hover:bg-rose-500 hover:text-white transition-colors"
                                                    title="이 가격을 포트폴리오 진입가로 강제 반영합니다."
                                                >
                                                    진입가로 반영
                                                </button>
                                            )}
                                        </div>
                                    )}
                                    {log.profit_rate != null && log.profit_rate !== 0 && (
                                        <span className={cn("text-[12px] font-black font-mono ml-1", log.profit_rate > 0 ? "text-rose-500" : "text-blue-500")}>
                                            ({log.profit_rate > 0 ? '+' : ''}{log.profit_rate.toFixed(2)}%)
                                        </span>
                                    )}
                                    {/* PM Event 삭제 버튼 */}
                                    {log.id && (
                                        <button
                                            onClick={async (e) => {
                                                e.stopPropagation();
                                                if (window.confirm('이 타임라인 이력을 완전히 삭제하시겠습니까? (삭제 시 복구 불가)')) {
                                                    await (window.electronAPI as any).deleteEventLog(log.id);
                                                    alert('이력이 삭제되었습니다. 화면을 새로고침해주세요.');
                                                }
                                            }}
                                            className="opacity-0 group-hover:opacity-100 ml-auto transition-opacity text-muted-foreground hover:text-rose-500 flex items-center p-1"
                                            title="이력에서 삭제"
                                        >
                                            <Trash2 className="w-3.5 h-3.5" />
                                        </button>
                                    )}
                                </div>
                                <div className="pt-2 pb-1 pl-1">
                                    <div className="text-[14px] text-foreground/90 font-medium leading-relaxed whitespace-pre-wrap">
                                        {log.reason}
                                    </div>
                                </div>
                            </div>
                        )
                    }

                    const rpt = item;
                    const scoreStyle = getScoreStyle(rpt.ai_score ?? rpt.score ?? 50);
                    return (
                        <div key={`ai-${idx}`} className="group relative pl-8 border-l-2 border-border/40 hover:border-primary/30 transition-colors pb-4">
                            {/* 타임라인 포인트 아이콘 */}
                            <div 
                                className="absolute -left-[9px] top-1 w-4 h-4 rounded-full border-2 border-background shadow-sm"
                                style={{ backgroundColor: scoreStyle.color }}
                            />
                            
                            {/* 리포트 헤더 */}
                            <div className="flex items-center gap-3 mb-2">
                                <span className="text-[11px] bg-muted/30 px-2 py-0.5 border border-border/30 rounded font-bold font-mono text-muted-foreground">{rpt.date}</span>
                                <div 
                                    className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase text-white shadow-sm shrink-0"
                                    style={{ backgroundColor: scoreStyle.color }}
                                >
                                    {scoreStyle.label} {rpt.ai_score ?? rpt.score ?? 50}%
                                </div>
                                {rpt.agent_type && (
                                    <div className="px-2.5 py-0.5 rounded-md text-[10px] font-bold bg-muted/60 text-muted-foreground border border-border/50 shrink-0">
                                        📝 {rpt.agent_type}
                                    </div>
                                )}
                                {/* AI Report 삭제 버튼 */}
                                {rpt.id && (
                                    <button
                                        onClick={async (e) => {
                                            e.stopPropagation();
                                            if (window.confirm('이 AI 분석 리포트를 삭제하시겠습니까? (삭제 시 복구 불가)')) {
                                                await (window.electronAPI as any).deleteAnalystPick(rpt.id);
                                                alert('리포트가 삭제되었습니다. 화면을 새로고침해주세요.');
                                            }
                                        }}
                                        className="opacity-0 group-hover:opacity-100 ml-auto transition-opacity text-muted-foreground hover:text-rose-500 flex items-center p-1"
                                        title="리포트 삭제"
                                    >
                                        <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                )}
                            </div>

                            {/* 리포트 본문 (분석 의견) */}
                            <div className="pt-2 pb-1 pl-1">
                                <div className="space-y-3">
                                    {rpt.past_reference && (
                                        <div className="py-2 px-3 bg-muted/10 rounded-lg border-l-2 border-muted-foreground/30 text-muted-foreground text-[12px] font-bold leading-relaxed">
                                            🔍 {rpt.past_reference}
                                        </div>
                                    )}
                                    
                                    {/* 분석 의견 */}
                                    <div className="text-[14px] font-medium text-foreground/90 leading-relaxed whitespace-pre-wrap">
                                        <ReactMarkdown 
                                            remarkPlugins={[remarkGfm]}
                                            components={{ p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p> }}
                                        >
                                            {rpt.reason}
                                        </ReactMarkdown>
                                    </div>

                                    {/* 기술적 진단 첨언 */}
                                    {rpt.chart_insight && rpt.chart_insight.trim().length > 0 && (
                                        <div className="mt-4 pt-4 border-t border-border/40">
                                            <p className="text-[13px] font-bold text-indigo-500/90 leading-relaxed flex items-start gap-2">
                                                <span className="shrink-0">📈</span>
                                                <span>{rpt.chart_insight}</span>
                                            </p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    );
                }) : (
                    <div className="flex flex-col items-center justify-center py-20 opacity-30">
                        <FileText size={48} className="mb-4" />
                        <p className="text-sm font-bold">기록이 없습니다.</p>
                    </div>
                )}
            </div>

            {/* 주의 사항 */}
            <div className="p-4 bg-destructive/5 border border-destructive/10 rounded-2xl opacity-60">
                <h5 className="text-[11px] font-bold text-destructive flex items-center gap-2 mb-1">
                    <AlertCircle size={12} /> 위험 요소 및 주의 사항
                </h5>
                <p className="text-[10px] text-muted-foreground leading-relaxed italic">
                    본 분석은 AI 기술 기반 데이터 분석으로 투자 권유가 아니며, 최종 투자 판단의 책임은 본인에게 있습니다.
                </p>
            </div>
        </div>
    )
}


