import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type ReminderType = '당일' | '1일 전' | '3일 전' | '1주일 전' | '없음'

export interface ScheduleEvent {
    id: string
    title: string
    description?: string
    date: string // ISO string format YYYY-MM-DD
    code?: string // Related stock code
    reminderType: ReminderType
    isNotified: boolean
    isMarketEvent?: boolean // True for DART/Market common events
    source?: string
    originId?: string
    isMemo?: boolean
    originalId?: string
}

interface ScheduleState {
    events: ScheduleEvent[]
    addEvent: (event: Omit<ScheduleEvent, 'id' | 'isNotified'>) => void
    updateEvent: (id: string, event: Partial<ScheduleEvent>) => void
    deleteEvent: (id: string) => void
    getEventsByDate: (date: string) => ScheduleEvent[]
    syncAllSchedules: () => void
    pullSchedules: () => void
}

export const useScheduleStore = create<ScheduleState>()(
    persist(
        (set, get) => ({
            events: [],
            addEvent: (event) => set((state) => {
                const newEvents = [...state.events, { ...event, id: Math.random().toString(36).substr(2, 9), isNotified: false }]
                setTimeout(() => get().syncAllSchedules(), 0)
                return { events: newEvents }
            }),
            updateEvent: (id, updatedFields) => set((state) => {
                const newEvents = state.events.map(event => event.id === id ? { ...event, ...updatedFields } : event)
                setTimeout(() => get().syncAllSchedules(), 0)
                return { events: newEvents }
            }),
            deleteEvent: (id) => set((state) => {
                const newEvents = state.events.filter(event => event.id !== id)
                if (window.electronAPI?.deleteSchedule) {
                    window.electronAPI.deleteSchedule(id)
                }
                return { events: newEvents }
            }),
            getEventsByDate: (date) => {
                return get().events.filter(e => e.date === date)
            },
            pullSchedules: async () => {
                if (window.electronAPI?.getSchedules) {
                    const res = await window.electronAPI.getSchedules()
                    if (res) {
                        const mapped = res.map((row: any) => ({
                            id: row.id,
                            title: row.title,
                            description: row.description,
                            date: row.target_date,
                            code: row.stock_code,
                            reminderType: row.reminder_type,
                            isNotified: !!row.is_notified,
                            isMarketEvent: !!row.is_market_event,
                            source: row.source,
                            originId: row.origin_id
                        }))
                        set({ events: mapped })
                    }
                }
            },
            syncAllSchedules: () => {
                const { events } = get()
                if (window.electronAPI?.syncSchedules) {
                    const schedules = events.map(e => ({
                        id: e.id,
                        title: e.title,
                        description: e.description || '',
                        target_date: e.date,
                        stock_code: e.code || '',
                        reminder_type: e.reminderType,
                        is_notified: e.isNotified ? 1 : 0,
                        is_market_event: e.isMarketEvent ? 1 : 0,
                        source: e.source || 'MANUAL',
                        origin_id: e.originId || null
                    }))
                    window.electronAPI.syncSchedules(schedules)
                }
            }
        }),
        {
            name: 'kiwoom-trader-schedules',
            onRehydrateStorage: () => (state) => {
                if (state) {
                    state.pullSchedules()
                }
            }
        }
    )
)
