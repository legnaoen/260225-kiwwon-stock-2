import React, { useState, useEffect } from 'react'
import { Calendar, AlertCircle, Info, ExternalLink } from 'lucide-react'
import { cn } from '../utils'

interface StockSchedulesProps {
    stockCode: string
    stockName: string
}

interface ScheduleItem {
    id: string
    title: string
    description: string
    target_date: string
    source: string
    origin_id?: string
}

export const StockSchedules: React.FC<StockSchedulesProps> = ({ stockCode, stockName }) => {
    const [schedules, setSchedules] = useState<ScheduleItem[]>([])
    const [isLoading, setIsLoading] = useState(false)

    useEffect(() => {
        const fetchSchedules = async () => {
            if (!stockCode || !window.electronAPI.getSchedulesByStock) return
            setIsLoading(true)
            try {
                const res = await window.electronAPI.getSchedulesByStock(stockCode)
                if (res.success) {
                    // Filter only DART schedules for this component
                    const dartSchedules = (res.data || []).filter((s: any) => s.source === 'DART')
                    setSchedules(dartSchedules)
                }
            } catch (error) {
                console.error('Failed to fetch schedules for stock:', error)
            } finally {
                setIsLoading(false)
            }
        }
        fetchSchedules()
    }, [stockCode])

    const openDartLink = (originId: string) => {
        if (originId) {
            window.open(`https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${originId}`, '_blank', 'width=1200,height=1000')
        }
    }

    if (isLoading) {
        return (
            <div className="flex-1 flex flex-col items-center justify-center py-12 text-muted-foreground animate-pulse">
                <Calendar className="mb-2 animate-bounce opacity-20" size={32} />
                <p className="text-xs">DART 일정을 불러오는 중...</p>
            </div>
        )
    }

    return (
        <div className="flex-1 flex flex-col space-y-4">
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold flex items-center gap-2">
                    <Calendar size={16} className="text-green-600" />
                    DART
                </h3>
                <span className="text-[10px] text-muted-foreground bg-muted/50 px-2 py-0.5 rounded-full border border-border">
                    최근 14일 공시
                </span>
            </div>

            {schedules.length === 0 ? (
                <div className="bg-muted/30 border border-dashed border-border rounded-2xl py-12 flex flex-col items-center justify-center text-center px-6">
                    <Calendar size={28} className="text-muted-foreground/30 mb-3" />
                    <p className="text-xs font-semibold text-muted-foreground">확인된 주요일정이 없습니다.</p>
                    <p className="text-[10px] text-muted-foreground/60 mt-1">DART 설정에서 수집 항목을 조절하거나<br />코드 동기화를 실행해보세요.</p>
                </div>
            ) : (
                <div className="space-y-3">
                    {schedules.map((schedule) => (
                        <div
                            key={schedule.id}
                            className={cn(
                                "group bg-card border border-border/60 rounded-2xl p-4 shadow-sm hover:shadow-md hover:border-green-500/30 transition-all",
                                schedule.source === 'DART' ? "border-l-4 border-l-green-500" : "border-l-4 border-l-amber-500"
                            )}
                        >
                            <div className="flex justify-between items-start mb-2">
                                <span className="text-[11px] font-bold text-muted-foreground/80 flex items-center gap-1">
                                    <Info size={12} className="text-primary/50" />
                                    {schedule.target_date}
                                </span>
                                {schedule.source === 'DART' && schedule.origin_id && (
                                    <button
                                        onClick={() => openDartLink(schedule.origin_id!)}
                                        className="text-[10px] text-primary/60 hover:text-primary flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                                    >
                                        원문보기 <ExternalLink size={10} />
                                    </button>
                                )}
                            </div>

                            <h4 className="text-[13px] font-extrabold leading-tight mb-2 group-hover:text-green-700 transition-colors">
                                {schedule.title.replace(`[${stockName}]`, '').trim()}
                            </h4>

                            {schedule.description && (
                                <div className="bg-green-50 dark:bg-green-900/10 border border-green-100 dark:border-green-900/30 rounded-xl p-3 flex gap-2.5 items-start">
                                    <AlertCircle size={14} className="text-green-600 shrink-0 mt-0.5" />
                                    <div className="space-y-0.5">
                                        <p className="text-[10px] font-bold text-green-700/80">투자 주의사항</p>
                                        <p className="text-[11px] text-green-900/80 dark:text-green-400/80 leading-relaxed">
                                            {schedule.description}
                                        </p>
                                    </div>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}
