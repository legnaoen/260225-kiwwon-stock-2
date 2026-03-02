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
}

interface ScheduleState {
    events: ScheduleEvent[]
    addEvent: (event: Omit<ScheduleEvent, 'id' | 'isNotified'>) => void
    updateEvent: (id: string, event: Partial<ScheduleEvent>) => void
    deleteEvent: (id: string) => void
    getEventsByDate: (date: string) => ScheduleEvent[]
    syncAllSchedules: () => void
}

export const useScheduleStore = create<ScheduleState>()(
    persist(
        (set, get) => ({
            events: [
                {
                    id: '1',
                    title: '삼성전자 실적발표 (예상)',
                    date: new Date().toISOString().split('T')[0],
                    code: '005930',
                    reminderType: '1일 전',
                    isNotified: false,
                    isMarketEvent: true
                }
            ],
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
                // Need an explicit IPC for delete to remove from DB if we don't clear DB every time
                if (window.electronAPI?.deleteSchedule) {
                    window.electronAPI.deleteSchedule(id)
                }
                return { events: newEvents }
            }),
            getEventsByDate: (date) => {
                return get().events.filter(e => e.date === date)
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
                        reminder_type: e.reminderType === '당일' ? 'same_day' : e.reminderType,
                        is_notified: e.isNotified ? 1 : 0,
                        is_market_event: e.isMarketEvent ? 1 : 0
                    }))
                    window.electronAPI.syncSchedules(schedules)
                }
            }
        }),
        {
            name: 'kiwoom-trader-schedules',
            onRehydrateStorage: () => (state) => {
                if (state) {
                    state.syncAllSchedules()
                }
            }
        }
    )
)
