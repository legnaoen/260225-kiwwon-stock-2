import React, { useState } from 'react'
import CalendarView from './CalendarView'
import ListView from './ListView'
import { Calendar, AlignJustify } from 'lucide-react'

type ViewMode = 'monthly' | 'list'

export default function Schedule() {
    const [viewMode, setViewMode] = useState<ViewMode>('monthly')

    return (
        <div className={`h-full flex flex-col overflow-hidden ${viewMode === 'list' ? 'p-0' : 'p-6 space-y-4'}`}>
            <div className={`flex items-center justify-between shrink-0 ${viewMode === 'list' ? 'px-6 py-4 border-b border-border bg-background' : ''}`}>
                <h1 className="text-2xl font-black">일정 캘린더</h1>

                <div className="flex bg-muted/30 p-1 rounded-xl">
                    <button
                        onClick={() => setViewMode('monthly')}
                        className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all ${viewMode === 'monthly' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-muted/50'}`}
                    >
                        <Calendar size={16} /> 월간
                    </button>
                    <button
                        onClick={() => setViewMode('list')}
                        className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all ${viewMode === 'list' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-muted/50'}`}
                    >
                        <AlignJustify size={16} /> 목록
                    </button>
                </div>
            </div>

            <div className={`flex-1 overflow-hidden flex flex-col ${viewMode !== 'list' ? 'bg-muted/10 border border-border rounded-2xl' : ''}`}>
                {viewMode === 'monthly' && <CalendarView />}
                {viewMode === 'list' && <ListView />}
            </div>
        </div>
    )
}
