import React, { useEffect, useState, useCallback } from 'react';
import { X, ExternalLink, Sparkles, AlertCircle, Clipboard, ClipboardCheck, ChevronDown, ChevronUp, Bot } from 'lucide-react';
import { StockChart } from '../StockChart';
import { StockAiReport } from '../StockAiReport';
import { cn } from '../../utils';

interface StockDetailModalProps {
    stockCode: string;
    stockName: string;
    relatedTheme?: { type: string; name: string };
    relatedIssues?: any[];
    aiReason?: string;
    aiRisk?: string;
    onClose: () => void;
}

// (Moved Gemma UI components to StockAiReport.tsx)

export function StockDetailModal({ stockCode, stockName, relatedTheme, relatedIssues, aiReason, aiRisk, onClose }: StockDetailModalProps) {
    const [gemmaReports, setGemmaReports] = useState<any[]>([]);
    const [stockTags, setStockTags] = useState<any[]>([]);
    const [stockNarrative, setStockNarrative] = useState<{ narrative: string, updated_at: string } | null>(null);
    const [showAllIssues, setShowAllIssues] = useState(false);

    useEffect(() => {
        const originalStyle = window.getComputedStyle(document.body).overflow;
        document.body.style.overflow = 'hidden';

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', handleKeyDown);

        // Gemma 리서치 이력 로드
        if ((window as any).electronAPI?.getTrackBResearchReports) {
            (window as any).electronAPI.getTrackBResearchReports(stockCode)
                .then((res: any) => {
                    if (res?.success && res.reports) setGemmaReports(res.reports);
                })
                .catch((e: any) => { console.error('Failed to load Gemma reports:', e); });
        }

        // 종목 테그 이력 로드
        if ((window as any).electronAPI?.getStockThemeTags) {
            const normalizedCode = stockCode.replace(/[^0-9]/g, '');
            (window as any).electronAPI.getStockThemeTags(normalizedCode)
                .then((tags: StockThemeTag[]) => {
                    if (tags) setStockTags(tags);
                })
                .catch((e: any) => { console.error('Failed to load stock tags:', e); });
        }

        // 종목 네러티브 로드
        if ((window as any).electronAPI?.getStockNarrative) {
            (window as any).electronAPI.getStockNarrative(stockCode)
                .then((res: any) => {
                    if (res?.success && res.data) {
                        setStockNarrative(res.data);
                    }
                })
                .catch((e: any) => { console.error('Failed to load stock narrative:', e); });
        }

        return () => {
            document.body.style.overflow = originalStyle;
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [stockCode, onClose]);

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6 md:p-12 animate-in fade-in duration-200 bg-background/80 backdrop-blur-sm">
            {/* Backdrop click to close */}
            <div className="absolute inset-0" onClick={onClose} />

            {/* Modal Container */}
            <div className="relative flex flex-col w-full max-w-6xl h-full max-h-[90vh] bg-card border shadow-2xl rounded-2xl overflow-hidden shadow-glow">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b bg-muted/20 shrink-0">
                    <div className="flex items-center gap-3">
                        <h2 className="text-xl font-black text-foreground">{stockName}</h2>
                        <span className="px-2 py-0.5 mt-0.5 text-xs font-mono font-bold text-muted-foreground bg-muted border rounded">
                            {stockCode}
                        </span>
                        <a
                            href={`https://finance.naver.com/item/main.naver?code=${stockCode.replace(/[^0-9]/g, '')}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-muted-foreground hover:text-primary transition-colors flex items-center gap-1 text-xs font-bold"
                            title="네이버 증권 열기"
                        >
                            <ExternalLink size={12} />
                        </a>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-full transition-colors"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Body Content */}
                <div className="flex flex-col lg:flex-row flex-1 overflow-hidden">
                    {/* Left: Chart */}
                    <div className="w-full lg:w-[45%] h-[40vh] lg:h-full border-b lg:border-b-0 lg:border-r border-border bg-background/50 flex flex-col shrink-0">
                        <div className="p-3 bg-muted/10 border-b flex items-center justify-between shrink-0">
                            <span className="text-xs font-bold text-muted-foreground tracking-wider uppercase">일봉 차트 (Daily)</span>
                        </div>
                        <div className="flex-1 min-h-0 relative p-2">
                            <StockChart stockCode={stockCode} stockName={stockName} />
                        </div>
                    </div>

                    {/* Right: Context & AI Report */}
                    <div className="flex-1 w-full h-[50vh] lg:h-full overflow-y-auto min-h-0 bg-card custom-scrollbar">
                        <div className="p-6 space-y-6 max-w-4xl mx-auto">

                            {/* ── 모의매매 AI 추천 근거 (Gemini 최종 선정 결과) ── */}
                            {(aiReason || aiRisk) && (
                                <div className="space-y-4 bg-muted/5 border border-border/50 p-4 rounded-xl mb-6">
                                    <div className="space-y-2 pb-4 border-b border-border/40">
                                        <h4 className="text-[11px] font-bold text-indigo-500 flex items-center gap-1.5 uppercase tracking-wider">
                                            <Sparkles size={13} /> 모의매매 AI 선정 사유 (Gemini 최종 판단)
                                        </h4>
                                        <div className="flex flex-col gap-2">
                                            {aiReason && (
                                                <div className="p-3 bg-indigo-500/10 border border-indigo-500/20 rounded-lg">
                                                    <div className="text-xs font-bold text-indigo-400 mb-1">👍 추천 근거</div>
                                                    <div className="text-sm font-semibold">{aiReason}</div>
                                                </div>
                                            )}
                                            {aiRisk && (
                                                <div className="p-3 bg-red-500/5 border border-red-500/20 rounded-lg">
                                                    <div className="text-xs font-bold text-red-400 mb-1">⚠️ 리스크 인지</div>
                                                    <div className="text-[13px] text-muted-foreground font-medium">{aiRisk}</div>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* ── 종목 서사 (Narrative) ── */}
                            {stockNarrative && (
                                <div className="bg-gradient-to-br from-indigo-500/5 to-purple-500/5 border border-indigo-500/10 rounded-xl p-4 mb-6 shadow-inner">
                                    <h4 className="text-[11px] font-bold text-indigo-400 flex items-center gap-1.5 uppercase tracking-wider mb-2">
                                        <Sparkles size={13} className="text-indigo-500" /> Company Narrative
                                    </h4>
                                    <p className="text-[14px] leading-relaxed text-foreground/90 font-medium whitespace-pre-wrap">
                                        {stockNarrative.narrative}
                                    </p>
                                </div>
                            )}

                            <div className="space-y-6">
                                {/* 연관 테마/섹터 (상단 배치) */}
                                <div className="space-y-3">
                                    <h4 className="text-[11px] font-bold text-muted-foreground flex items-center gap-1.5 uppercase tracking-wider">
                                        <Sparkles size={13} className="text-amber-500" /> Tag
                                    </h4>
                                    {stockTags.length > 0 ? (
                                        <div className="flex flex-col gap-2">
                                            {/* 섹터 라인 */}
                                            {stockTags.filter(t => t.tag_type === 'SECTOR').length > 0 && (
                                                <div className="flex flex-wrap items-center gap-1.5">
                                                    {stockTags.filter(t => t.tag_type === 'SECTOR').map((tag, idx) => (
                                                        <div 
                                                            key={`sector-${tag.tag_name}-${tag.added_date}`} 
                                                            className={cn(
                                                                "text-[12px] font-semibold px-3 py-1 rounded-full border transition-all cursor-default",
                                                                idx === 0 ? "bg-blue-500/10 border-blue-500/40 text-foreground shadow-sm ring-1 ring-blue-500/20" : "bg-transparent border-blue-500/20 text-foreground/80 hover:bg-blue-500/5 hover:text-foreground"
                                                            )}
                                                            title={`업데이트일: ${tag.added_date}`}
                                                        >
                                                            {tag.tag_name}
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                            
                                            {/* 테마 라인 */}
                                            {stockTags.filter(t => t.tag_type === 'THEME').length > 0 && (
                                                <div className="flex flex-wrap items-center gap-1.5">
                                                    {stockTags.filter(t => t.tag_type === 'THEME').map((tag, idx) => (
                                                        <div 
                                                            key={`theme-${tag.tag_name}-${tag.added_date}`} 
                                                            className={cn(
                                                                "text-[12px] font-semibold px-3 py-1 rounded-full border transition-all cursor-default",
                                                                idx === 0 ? "bg-amber-500/10 border-amber-500/40 text-foreground shadow-sm ring-1 ring-amber-500/20" : "bg-transparent border-amber-500/20 text-foreground/80 hover:bg-amber-500/5 hover:text-foreground"
                                                            )}
                                                            title={`업데이트일: ${tag.added_date}`}
                                                        >
                                                            {tag.tag_name}
                                                        </div>
                                                    ))}
                                                </div>
                                            )}

                                            {/* AI 테마 라인 */}
                                            {stockTags.filter(t => t.tag_type === 'AI_THEME').length > 0 && (
                                                <div className="flex flex-wrap items-center gap-1.5">
                                                    {stockTags.filter(t => t.tag_type === 'AI_THEME').map((tag, idx) => (
                                                        <div 
                                                            key={`ai-${tag.tag_name}-${tag.added_date}`} 
                                                            className={cn(
                                                                "text-[12px] font-semibold px-3 py-1 rounded-full border transition-all cursor-default",
                                                                idx === 0 ? "bg-violet-500/10 border-violet-500/40 text-foreground shadow-sm ring-1 ring-violet-500/20" : "bg-transparent border-violet-500/20 text-foreground/80 hover:bg-violet-500/5 hover:text-foreground"
                                                            )}
                                                            title={`업데이트일: ${tag.added_date}`}
                                                        >
                                                            {tag.tag_name}
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    ) : relatedTheme ? (
                                        <div className="flex items-center gap-2">
                                            <div className="text-[13px] font-medium text-foreground bg-amber-500/5 border border-amber-500/20 px-3 py-1.5 rounded-full">
                                                {relatedTheme.name}
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="text-[12px] text-muted-foreground italic px-2 py-1 bg-muted/30 rounded border border-dashed border-border/60">
                                            관련 테마/섹터 정보가 없습니다.
                                        </div>
                                    )}
                                </div>

                                {/* 연관 이슈 섹션 (하단 배치 & 최신 2개 표시 & 더보기) */}
                                <div className="space-y-3 pt-4">
                                    <h4 className="text-[11px] font-bold text-muted-foreground flex items-center gap-1.5 uppercase tracking-wider">
                                        <AlertCircle size={13} className="text-red-500" /> Issue
                                    </h4>
                                    {relatedIssues && relatedIssues.length > 0 ? (
                                        <div className="flex flex-col gap-3">
                                            {relatedIssues.slice(0, showAllIssues ? undefined : 2).map((edge: any, i: number) => {
                                                const chainNodes: string[] = edge.logical_path
                                                    ? edge.logical_path.split(/→|->/).map((s: string) => s.trim()).filter(Boolean)
                                                    : [];
                                                
                                                const displayDate = edge.added_date || edge.mapped_date || edge.created_at || edge.date;

                                                return (
                                                    <div key={edge.id || i} className="flex flex-col gap-2 py-3">
                                                        <div className="flex items-center justify-between">
                                                            <div className="text-[12px] font-bold text-red-500/80">
                                                                {displayDate ? displayDate.split(' ')[0] : (edge.issue_name || edge.source_id)}
                                                            </div>
                                                        </div>
                                                        {chainNodes.length > 0 && (
                                                            <div className="flex flex-wrap items-center gap-1.5">
                                                                {chainNodes.map((node, ni) => (
                                                                    <React.Fragment key={ni}>
                                                                        <span className="text-[12px] font-semibold text-foreground bg-muted/10 border border-border/50 px-2 py-0.5 rounded-md">
                                                                            {node}
                                                                        </span>
                                                                        {ni < chainNodes.length - 1 && (
                                                                            <span className="text-red-400/60 text-[11px] font-bold">→</span>
                                                                        )}
                                                                    </React.Fragment>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                            {relatedIssues.length > 2 && (
                                                <button 
                                                    onClick={() => setShowAllIssues(!showAllIssues)}
                                                    className="w-full text-[11px] font-bold text-muted-foreground py-2 mt-2 rounded-lg border border-border/40 hover:bg-muted/30 transition-colors"
                                                >
                                                    {showAllIssues ? '접기 ▲' : `더보기 (${relatedIssues.length - 2}개 더 있음) ▼`}
                                                </button>
                                            )}
                                        </div>
                                    ) : (
                                        <div className="text-[12px] text-muted-foreground italic px-2 py-1 bg-muted/30 rounded border border-dashed border-border/60">
                                            관련된 거시 이슈가 감지되지 않았습니다.
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* AI Report (기존 종목 AI 리포트 및 통합 타임라인) */}
                            <StockAiReport symbol={stockCode} name={stockName} hideTitle={true} gemmaReports={gemmaReports} />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
