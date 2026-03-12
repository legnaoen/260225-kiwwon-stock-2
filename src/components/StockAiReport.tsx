import React, { useState, useEffect, useMemo } from 'react'
import { FileText, ShieldCheck, BarChart2, TrendingUp, AlertCircle, Loader2, Tag, Plus, X } from 'lucide-react'
import { cn } from '../utils'
import { useTagStore } from '../store/useTagStore'

interface StockAiReportProps {
    symbol: string
    name: string
}

export function StockAiReport({ symbol, name }: StockAiReportProps) {
    const [report, setReport] = useState<any>(null)
    const [loading, setLoading] = useState(true)
    const [tagInput, setTagInput] = useState('')

    const numericCode = symbol?.replace(/[^0-9]/g, '') || symbol || ''
    const { tags, addTag, removeTag, getAllTags } = useTagStore()
    const stockTags = useMemo(() => tags[numericCode] || [], [tags, numericCode])
    const allExistingTags = useMemo(() => getAllTags(), [tags])

    useEffect(() => {
        const fetchReport = async () => {
            setLoading(true)
            try {
                const result = await (window as any).electronAPI.getStockAnalysis(symbol)
                if (result.success && result.data && result.data.length > 0) {
                    setReport(result.data[0])
                    // AI가 생성한 태그를 자동으로 태그 스토어에 동기화
                    if (result.data[0].tags) {
                        try {
                            const aiTags: string[] = typeof result.data[0].tags === 'string'
                                ? JSON.parse(result.data[0].tags)
                                : result.data[0].tags
                            aiTags.forEach(t => addTag(numericCode, t))
                        } catch {}
                    }
                } else {
                    setReport(null)
                }
            } catch (err) {
                console.error('[StockAiReport] Failed to fetch report:', err)
            } finally {
                setLoading(false)
            }
        }
        fetchReport()
    }, [symbol])

    const handleAddTag = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter' && tagInput.trim()) {
            tagInput.split(',').map(t => t.trim()).filter(Boolean).forEach(t => addTag(numericCode, t))
            setTagInput('')
        }
    }

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center h-full py-20 opacity-50 space-y-4">
                <Loader2 className="animate-spin text-primary" size={32} />
                <p className="text-sm font-bold">AI 리포트를 불러오는 중...</p>
            </div>
        )
    }

    if (!report) {
        return (
            <div className="space-y-6">
                {/* 태그 패널: 리포트가 없어도 태그는 편집 가능 */}
                <TagPanel
                    stockTags={stockTags}
                    allExistingTags={allExistingTags}
                    tagInput={tagInput}
                    setTagInput={setTagInput}
                    onAddTag={handleAddTag}
                    onRemoveTag={(t) => removeTag(numericCode, t)}
                    onQuickAdd={(t) => addTag(numericCode, t)}
                />
                <div className="flex flex-col items-center justify-center h-full py-16 opacity-40 space-y-4">
                    <FileText size={64} className="text-muted-foreground/30" />
                    <div className="text-center">
                        <p className="text-sm font-bold">생성된 AI 리포트가 없습니다.</p>
                        <p className="text-[11px]">이 종목이 급등주로 포착되면 리포트가 자동으로 생성됩니다.</p>
                    </div>
                </div>
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

    const { color, label } = getScoreStyle(report.ai_score)

    return (
        <div className="space-y-6 max-w-4xl mx-auto animate-in fade-in slide-in-from-bottom-2 duration-300">
            {/* 태그 패널 (AI 리포트 최상단, 항상 노출) */}
            <TagPanel
                stockTags={stockTags}
                allExistingTags={allExistingTags}
                tagInput={tagInput}
                setTagInput={setTagInput}
                onAddTag={handleAddTag}
                onRemoveTag={(t) => removeTag(numericCode, t)}
                onQuickAdd={(t) => addTag(numericCode, t)}
            />

            {/* 리포트 헤더 */}
            <div className="flex items-center justify-between border-b pb-4">
                <div>
                    <h3 className="text-2xl font-black tracking-tight">{name}</h3>
                    <p className="text-xs text-muted-foreground font-mono">
                        {symbol} / {report.date} 분석 리포트
                    </p>
                </div>
                <div className="text-right">
                    <div className="text-xs text-muted-foreground mb-1">AI 지속성 점수 ({label})</div>
                    <div className="text-3xl font-black italic" style={{ color }}>{report.ai_score}%</div>
                </div>
            </div>

            {/* 주요 지표 그리드 */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="p-4 bg-muted/20 border border-border/40 rounded-2xl">
                    <div className="flex items-center gap-2 text-primary font-bold text-xs mb-2">
                        <ShieldCheck size={14} /> 섹터/테마 정보
                    </div>
                    <p className="text-[11px] font-bold text-foreground mb-1">{report.theme_sector}</p>
                    <p className="text-[10px] text-muted-foreground leading-relaxed">시장 흐름과 수급 주체를 기반으로 분석된 섹터입니다.</p>
                </div>
                <div className="p-4 bg-muted/20 border border-border/40 rounded-2xl">
                    <div className="flex items-center gap-2 text-primary font-bold text-xs mb-2">
                        <BarChart2 size={14} /> 상승 사유 요약
                    </div>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">{report.reason}</p>
                </div>
                <div className="p-4 bg-muted/20 border border-border/40 rounded-2xl">
                    <div className="flex items-center gap-2 text-primary font-bold text-xs mb-2">
                        <TrendingUp size={14} /> 차트 기술적 진단
                    </div>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">{report.chart_insight}</p>
                </div>
            </div>

            {/* 상세 분석 엔진 의견 */}
            <div className="space-y-4 pt-4">
                <h4 className="text-base font-bold flex items-center gap-2">
                    <FileText size={18} className="text-primary" />
                    상세 분석 엔진 의견
                </h4>
                <div className="bg-card border border-border/60 rounded-3xl p-6 shadow-sm">
                    <div className="prose prose-sm dark:prose-invert max-w-none text-muted-foreground leading-loose whitespace-pre-wrap">
                        {report.past_reference && (
                            <div className="p-4 bg-indigo-500/5 rounded-xl mb-4 border-l-4 border-indigo-500 text-indigo-700 dark:text-indigo-300 text-[11px]">
                                <strong>[과거 분석 히스토리]</strong><br />
                                {report.past_reference}
                            </div>
                        )}
                        <p>{report.reason}</p>
                        <p className="mt-4">{report.chart_insight}</p>
                    </div>
                </div>
            </div>

            {/* 주의 사항 */}
            <div className="p-4 bg-destructive/5 border border-destructive/10 rounded-2xl">
                <h5 className="text-[11px] font-bold text-destructive flex items-center gap-2 mb-1">
                    <AlertCircle size={12} /> 위험 요소 및 주의 사항
                </h5>
                <p className="text-[10px] text-muted-foreground leading-relaxed">
                    본 분석은 AI 기술 기반 데이터 분석으로 투자 권유가 아니며, 최종 투자 판단의 책임은 본인에게 있습니다.
                    시장 변동에 따라 점수와 의견은 실시간으로 변할 수 있습니다.
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
    onAddTag: (e: React.KeyboardEvent<HTMLInputElement>) => void
    onRemoveTag: (tag: string) => void
    onQuickAdd: (tag: string) => void
}

function TagPanel({ stockTags, allExistingTags, tagInput, setTagInput, onAddTag, onRemoveTag, onQuickAdd }: TagPanelProps) {
    const suggestedTags = allExistingTags.filter(t => !stockTags.includes(t) && t.toLowerCase().includes(tagInput.toLowerCase())).slice(0, 6)

    return (
        <div className="bg-primary/5 border border-primary/15 rounded-2xl p-4 space-y-3">
            <div className="flex items-center gap-2 text-primary font-bold text-xs">
                <Tag size={13} />
                종목 태그
                <span className="text-muted-foreground font-normal text-[10px] ml-1">
                    (섹터·테마·전략 라벨 — AI 분석 시 자동 부여, 수동 추가 가능)
                </span>
            </div>

            {/* 현재 태그 목록 */}
            <div className="flex flex-wrap gap-1.5">
                {stockTags.map(tag => (
                    <span
                        key={tag}
                        className="flex items-center gap-1 bg-primary/10 text-primary border border-primary/20 px-2.5 py-1 rounded-full text-[11px] font-bold transition-all hover:bg-primary/20"
                    >
                        #{tag}
                        <button
                            onClick={() => onRemoveTag(tag)}
                            className="opacity-50 hover:opacity-100 hover:text-destructive transition-colors ml-0.5"
                        >
                            <X size={10} />
                        </button>
                    </span>
                ))}
                {stockTags.length === 0 && (
                    <span className="text-[11px] text-muted-foreground italic">태그 없음 — 아래에서 추가하세요</span>
                )}
            </div>

            {/* 태그 입력 */}
            <div className="flex items-center gap-2">
                <div className="relative flex-1">
                    <Plus size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                    <input
                        type="text"
                        placeholder="태그를 입력하고 Enter (쉼표로 여러 개)"
                        className="w-full pl-7 pr-3 py-1.5 bg-background border border-border/60 rounded-xl text-[11px] outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all text-foreground"
                        value={tagInput}
                        onChange={e => setTagInput(e.target.value)}
                        onKeyDown={onAddTag}
                    />
                </div>
            </div>

            {/* 기존 태그 빠른 추가 */}
            {suggestedTags.length > 0 && (
                <div className="flex flex-wrap gap-1">
                    <span className="text-[10px] text-muted-foreground self-center mr-1">추가:</span>
                    {suggestedTags.map(t => (
                        <button
                            key={t}
                            onClick={() => onQuickAdd(t)}
                            className={cn(
                                "text-[10px] px-2 py-0.5 rounded-full border border-border/50 text-muted-foreground",
                                "hover:border-primary/40 hover:text-primary hover:bg-primary/5 transition-all"
                            )}
                        >
                            +{t}
                        </button>
                    ))}
                </div>
            )}
        </div>
    )
}
