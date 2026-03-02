import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface Note {
    id: string
    stockCode: string
    stockName?: string
    content: string
    targetDate?: string
    reminderType?: string
    isNotified?: boolean
    createdAt?: number
    updatedAt?: number
}

interface NoteState {
    notes: Note[]
    addNote: (stockCode: string, stockName: string, content: string, targetDate?: string, reminderType?: string) => void
    updateNote: (id: string, content: string, targetDate?: string, reminderType?: string, isNotified?: boolean) => void
    deleteNote: (id: string) => void
    syncNotes: () => void
}

export const useNoteStore = create<NoteState>()(
    persist(
        (set) => ({
            notes: [],
            addNote: (stockCode, stockName, content, targetDate, reminderType) => set((state) => {
                const newNote = {
                    id: Math.random().toString(36).substring(7),
                    stockCode,
                    stockName,
                    content,
                    targetDate,
                    reminderType,
                    isNotified: false,
                    createdAt: Date.now(),
                    updatedAt: Date.now(),
                }
                const updatedNotes = [newNote, ...state.notes]

                // Sync to SQLite (Background notification logic needs this)
                if (window.electronAPI?.syncSchedules) {
                    const schedules = updatedNotes.filter(n => n.targetDate).map(n => ({
                        id: n.id,
                        title: n.stockName || '종목 메모',
                        description: n.content,
                        target_date: n.targetDate,
                        stock_code: n.stockCode,
                        reminder_type: n.reminderType,
                        is_notified: n.isNotified ? 1 : 0,
                        is_market_event: 0
                    }))
                    window.electronAPI.syncSchedules(schedules)
                }

                return { notes: updatedNotes }
            }),
            updateNote: (id, content, targetDate, reminderType, isNotified) => set((state) => {
                const updatedNotes = state.notes.map((n) =>
                    n.id === id ? { ...n, content, targetDate, reminderType, isNotified: isNotified !== undefined ? isNotified : n.isNotified, updatedAt: Date.now() } : n
                )

                if (window.electronAPI?.syncSchedules) {
                    const schedules = updatedNotes.filter(n => n.targetDate).map(n => ({
                        id: n.id,
                        title: n.stockName || '종목 메모',
                        description: n.content,
                        target_date: n.targetDate,
                        stock_code: n.stockCode,
                        reminder_type: n.reminderType,
                        is_notified: n.isNotified ? 1 : 0,
                        is_market_event: 0
                    }))
                    window.electronAPI.syncSchedules(schedules)
                }

                return { notes: updatedNotes }
            }),
            deleteNote: (id) => set((state) => {
                const updatedNotes = state.notes.filter((n) => n.id !== id)

                if (window.electronAPI?.syncSchedules) {
                    const schedules = updatedNotes.filter(n => n.targetDate).map(n => ({
                        id: n.id,
                        title: n.stockName || '종목 메모',
                        description: n.content,
                        target_date: n.targetDate,
                        stock_code: n.stockCode,
                        reminder_type: n.reminderType,
                        is_notified: n.isNotified ? 1 : 0,
                        is_market_event: 0
                    }))
                    window.electronAPI.syncSchedules(schedules)
                }

                return { notes: updatedNotes }
            }),
            syncNotes: () => {
                const state = useNoteStore.getState()
                if (window.electronAPI?.syncSchedules) {
                    const schedules = state.notes.filter(n => n.targetDate).map(n => ({
                        id: n.id,
                        title: n.stockName || '종목 메모',
                        description: n.content,
                        target_date: n.targetDate,
                        stock_code: n.stockCode,
                        reminder_type: n.reminderType,
                        is_notified: n.isNotified ? 1 : 0,
                        is_market_event: 0
                    }))
                    window.electronAPI.syncSchedules(schedules)
                }
            }
        }),
        {
            name: 'kiwoom-trader-notes',
            onRehydrateStorage: () => (state) => {
                if (state) {
                    state.syncNotes()
                }
            }
        }
    )
)
