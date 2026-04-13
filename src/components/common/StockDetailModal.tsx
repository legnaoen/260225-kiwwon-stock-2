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

interface StockThemeTag {
    tag_name: string;
    tag_type: string;
    added_date: string;
    change_rate: number;
}

// 로데이터 복사 버튼 컴포넌트
function CopyRawDataButton({ report }: { report: GemmaReport }) {
    const [copied, setCopied] = useState(false);

    const handleCopy = useCallback(async () => {
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
        <div className="border border-violet-500/20 bg-violet-500/5 rounded-lg overflow-hidden">
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

export function StockDetailModal({ stockCode, stockName, relatedTheme, relatedIssues, aiReason, aiRisk, onClose }: StockDetailModalProps) {
    const [gemmaReports, setGemmaReports] = useState<GemmaReport[]>([]);
    const [stockTags, setStockTags] = useState<StockThemeTag[]>([]);
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

                            {/* Gemma 4 리서치 분석 이력 (영구 타임라인) */}
                            {gemmaReports.length > 0 && (
                                <div className="space-y-3 mt-6">
                                    <h4 className="text-[11px] font-bold text-violet-400 flex items-center gap-1.5 uppercase tracking-wider">
                                        <Bot size={13} /> Gemma 4 리서치 분석 이력
                                        <span className="ml-auto text-[10px] font-normal text-muted-foreground normal-case">
                                            총 {gemmaReports.length}건 — 각 카드 우측 [로데이터 복사]로 검증 가능
                                        </span>
                                    </h4>
                                    <div className="space-y-2">
                                        {gemmaReports.map(report => (
                                            <GemmaReportCard key={report.id} report={report} />
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* AI Report (기존 종목 AI 리포트) */}
                            <StockAiReport symbol={stockCode} name={stockName} hideTitle={true} />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
