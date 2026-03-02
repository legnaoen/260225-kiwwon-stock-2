import React from 'react'
import { useScheduleStore } from '../../store/useScheduleStore'
import { Clock } from 'lucide-react'

export default function WeeklyView() {
    const { events } = useScheduleStore()

    return (
        <div className="w-full h-full flex flex-col p-4 bg-muted/5 font-sans justify-center items-center text-muted-foreground space-y-4">
            <Clock size={48} className="animate-pulse opacity-50" />
            <h2 className="text-xl font-bold">주간 뷰 화면 준비 중</h2>
            <p>달력 상세 디자인이 적용된 후 주간 플래너가 이곳에 노출됩니다.</p>
        </div>
    )
}
