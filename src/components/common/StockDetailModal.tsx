import React, { useEffect } from 'react';
import { X, ExternalLink, Link2, Sparkles, AlertCircle } from 'lucide-react';
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

export function StockDetailModal({ stockCode, stockName, relatedTheme, relatedIssues, aiReason, aiRisk, onClose }: StockDetailModalProps) {
    // 팝업 띄워질 때 스크롤 방지 등 처리
    useEffect(() => {
        const originalStyle = window.getComputedStyle(document.body).overflow;  
        document.body.style.overflow = 'hidden';
        
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', handleKeyDown);
        
        return () => {
            document.body.style.overflow = originalStyle;
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [onClose]);

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
                        {/* 네이버 금융 링크 */}
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
                    {/* Left: Chart (일봉 차트) */}
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
                        <div className="p-6 space-y-8 max-w-4xl mx-auto">
                            {/* 상단 맥락 (이슈 -> 테마/섹터) */}
                            <div className="space-y-4 bg-muted/5 border border-border/50 p-4 rounded-xl">
                                {/* 모의매매 AI 추천 근거 (있을 경우만 렌더링) */}
                                {(aiReason || aiRisk) && (
                                    <div className="space-y-2 mb-2 pb-4 border-b border-border/40">
                                        <h4 className="text-[11px] font-bold text-indigo-500 flex items-center gap-1.5 uppercase tracking-wider">
                                            <Sparkles size={13} /> 모의매매 AI 선정 사유
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
                                )}

                                {/* 연관 이슈 섹션 */}
                                <div className="space-y-2">
                                    <h4 className="text-[11px] font-bold text-muted-foreground flex items-center gap-1.5 uppercase tracking-wider">
                                        <AlertCircle size={13} className="text-red-500" /> 연관된 핵심 이슈
                                    </h4>
                                    {relatedIssues && relatedIssues.length > 0 ? (
                                        <div className="flex flex-col gap-2">
                                            {relatedIssues.map((edge: any, i: number) => {
                                                const chainNodes: string[] = edge.logical_path
                                                    ? edge.logical_path.split(/→|->/).map((s: string) => s.trim()).filter(Boolean)
                                                    : [];
                                                
                                                return (
                                                    <div key={edge.id || i} className="flex flex-col gap-1.5 bg-red-500/5 border border-red-500/20 px-3 py-2.5 rounded-lg">
                                                        <div className="text-[12px] font-bold text-red-500/80">
                                                            {edge.issue_name || edge.source_id}
                                                        </div>
                                                        {chainNodes.length > 0 && (
                                                            <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                                                                {chainNodes.map((node, ni) => (
                                                                    <React.Fragment key={ni}>
                                                                        <span className="text-[12px] font-semibold text-foreground bg-background border border-border/50 px-2 py-0.5 rounded-md">
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
                                        </div>
                                    ) : (
                                        <div className="text-[12px] text-muted-foreground italic px-2 py-1 bg-muted/30 rounded border border-dashed border-border/60">
                                            관련된 거시 이슈가 감지되지 않았습니다.
                                        </div>
                                    )}
                                </div>

                                {/* 연관 테마/섹터 섹션 */}
                                <div className="space-y-2 pt-2">
                                    <h4 className="text-[11px] font-bold text-muted-foreground flex items-center gap-1.5 uppercase tracking-wider">
                                        <Sparkles size={13} className="text-amber-500" /> 
                                        연관 {relatedTheme?.type === 'THEME' ? '테마' : '섹터'}
                                    </h4>
                                    {relatedTheme ? (
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
                            </div>

                            <div className="h-[1px] w-full bg-border/40" />

                            {/* AI Report & Tags (종목명은 타이틀로 중복 렌더링되지 않도록 패싱) */}
                            <StockAiReport symbol={stockCode} name={stockName} hideTitle={true} />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
