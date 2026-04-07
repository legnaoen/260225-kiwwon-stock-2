import React, { useState, useEffect, useMemo } from 'react'
import { FileText, ShieldCheck, BarChart2, TrendingUp, AlertCircle, Loader2, Tag, Plus, X } from 'lucide-react'
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
}

export function StockAiReport({ symbol, name, refreshTrigger, hideTitle, pmEvents }: StockAiReportProps) {
    const [reports, setReports] = useState<any[]>([])
    const [loading, setLoading] = useState(true)
    const [tagInput, setTagInput] = useState('')
    const [showTagInput, setShowTagInput] = useState(false)

    const numericCode = symbol?.replace(/[^0-9]/g, '') || symbol || ''
    const { tags, addTag, removeTag, getAllTags } = useTagStore()
    const stockTags = useMemo(() => tags[numericCode] || [], [tags, numericCode])
    const allExistingTags = useMemo(() => getAllTags(), [tags])

    useEffect(() => {
        const fetchReports = async () => {
            setLoading(true)
            try {
                const result = await (window as any).electronAPI.getStockAnalysis(symbol)
                if (result.success && result.data) {
                    setReports(result.data)
                    // AI가 생성한 태그 동기화 (가장 최신 리포트 기준)
                    if (result.data.length > 0 && result.data[0].tags) {
                        try {
                            const aiTags: string[] = typeof result.data[0].tags === 'string'
                                ? JSON.parse(result.data[0].tags)
                                : result.data[0].tags
                            aiTags.forEach(t => addTag(numericCode, t))
                        } catch {}
                    }
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

    const handleAddTag = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter' && tagInput.trim()) {
            tagInput.split(',').map(t => t.trim()).filter(Boolean).forEach(t => addTag(numericCode, t))
            setTagInput('')
        }
    }

    const [filterType, setFilterType] = useState<'ALL'|'AI_REPORT'|'PM_EVENT'>('ALL')

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

        let filtered = combined;
        if (filterType === 'AI_REPORT') filtered = combined.filter(x => x._type === 'AI_REPORT');
        if (filterType === 'PM_EVENT') filtered = combined.filter(x => x._type === 'PM_EVENT');

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
                    <div className="flex-1 min-w-[200px]">
                        <TagPanel
                            stockTags={stockTags}
                            allExistingTags={allExistingTags}
                            tagInput={tagInput}
                            setTagInput={setTagInput}
                            showInput={showTagInput}
                            setShowInput={setShowTagInput}
                            onAddTag={handleAddTag}
                            onRemoveTag={(t) => removeTag(numericCode, t)}
                            onQuickAdd={(t) => addTag(numericCode, t)}
                        />
                    </div>
                </div>
                <div className="h-[1px] w-full bg-border/40 mb-8" />
            </div>

            {/* 타임라인 필터 */}
            <div className="flex items-center gap-2 mb-6 border-b border-border/40 pb-4">
                <button 
                    onClick={() => setFilterType('ALL')}
                    className={cn("px-3 py-1.5 text-xs font-bold rounded-lg transition-colors border", filterType === 'ALL' ? "bg-primary/10 text-primary border-primary/30" : "bg-transparent text-muted-foreground border-transparent hover:bg-muted/50")}
                >
                    전체 보기
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
            </div>

            {/* 리포트/이벤트 통합 타임라인 목록 */}
            <div className="space-y-10 pl-2">
                {unifiedTimeline.length > 0 ? unifiedTimeline.map((item, idx) => {
                    const isPM = item._type === 'PM_EVENT';
                    
                    if (isPM) {
                        const log = item;
                        return (
                            <div key={`pm-${idx}`} className="relative pl-8 border-l-2 border-border/40 hover:border-rose-500/30 transition-colors pb-2">
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
                                        <span className="text-[12px] font-mono font-black text-foreground ml-1">
                                            @ {log.price?.toLocaleString()}원
                                        </span>
                                    )}
                                    {log.profit_rate != null && log.profit_rate !== 0 && (
                                        <span className={cn("text-[12px] font-black font-mono ml-1", log.profit_rate > 0 ? "text-rose-500" : "text-blue-500")}>
                                            ({log.profit_rate > 0 ? '+' : ''}{log.profit_rate.toFixed(2)}%)
                                        </span>
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
                        <div key={`ai-${idx}`} className="relative pl-8 border-l-2 border-border/40 hover:border-primary/30 transition-colors pb-4">
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

// ─── 태그 패널 서브 컴포넌트 ────────────────────────────────────────────────────
interface TagPanelProps {
    stockTags: string[]
    allExistingTags: string[]
    tagInput: string
    setTagInput: (v: string) => void
    showInput: boolean
    setShowInput: (v: boolean) => void
    onAddTag: (e: React.KeyboardEvent<HTMLInputElement>) => void
    onRemoveTag: (tag: string) => void
    onQuickAdd: (tag: string) => void
}

function TagPanel({ stockTags, allExistingTags, tagInput, setTagInput, showInput, setShowInput, onAddTag, onRemoveTag, onQuickAdd }: TagPanelProps) {
    const suggestedTags = allExistingTags.filter(t => !stockTags.includes(t) && t.toLowerCase().includes(tagInput.toLowerCase())).slice(0, 6)

    return (
        <div className="flex flex-wrap items-center gap-1.5 relative">
            {stockTags.map(tag => (
                <span
                    key={tag}
                    className="flex items-center gap-1 bg-muted/60 text-muted-foreground border border-border/40 px-2 py-0.5 rounded-md text-[10px] font-bold transition-all hover:bg-muted"
                >
                    #{tag}
                    <button
                        onClick={() => onRemoveTag(tag)}
                        className="opacity-40 hover:opacity-100 hover:text-destructive transition-colors ml-0.5"
                    >
                        <X size={8} />
                    </button>
                </span>
            ))}
            
            <button 
                onClick={() => setShowInput(!showInput)}
                className={cn(
                    "w-5 h-5 flex items-center justify-center rounded-md border transition-all hover:bg-primary/10 hover:border-primary/50 text-muted-foreground hover:text-primary",
                    showInput ? "bg-primary border-primary text-white" : "border-border/60"
                )}
            >
                <Plus size={10} />
            </button>

            {/* Popover 입럭 폼 */}
            {showInput && (
                <div className="absolute top-7 left-0 z-[100] w-64 bg-background border border-border rounded-xl shadow-2xl p-4 animate-in fade-in zoom-in-95 duration-200">
                    <div className="flex items-center gap-2 mb-3">
                        <Tag size={12} className="text-primary" />
                        <span className="text-[10px] font-bold">태그 추가</span>
                        <button onClick={() => setShowInput(false)} className="ml-auto opacity-40 hover:opacity-100"><X size={12} /></button>
                    </div>
                    
                    <input
                        type="text"
                        autoFocus
                        placeholder="태그 입력 (Enter)"
                        className="w-full px-3 py-1.5 bg-muted/30 border border-border rounded-lg text-xs outline-none focus:border-primary transition-all mb-3 text-foreground"
                        value={tagInput}
                        onChange={e => setTagInput(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                onAddTag(e);
                                setShowInput(false);
                            }
                        }}
                    />

                    {suggestedTags.length > 0 && (
                        <div className="space-y-1.5">
                            <span className="text-[9px] font-bold text-muted-foreground uppercase opacity-50">자주 쓰는 테그</span>
                            <div className="flex flex-wrap gap-1">
                                {suggestedTags.map(t => (
                                    <button
                                        key={t}
                                        onClick={() => {
                                            onQuickAdd(t);
                                            setShowInput(false);
                                        }}
                                        className="text-[10px] px-2 py-0.5 rounded bg-muted/50 border border-border/40 hover:bg-primary/10 hover:border-primary/30 transition-all text-muted-foreground hover:text-primary"
                                    >
                                        {t}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}
