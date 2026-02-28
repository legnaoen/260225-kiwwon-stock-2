import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface Note {
    id: string
    stockCode: string
    content: string
    createdAt: number
    updatedAt: number
}

interface NoteState {
    notes: Note[]
    addNote: (stockCode: string, content: string) => void
    updateNote: (id: string, content: string) => void
    deleteNote: (id: string) => void
}

export const useNoteStore = create<NoteState>()(
    persist(
        (set) => ({
            notes: [],
            addNote: (stockCode, content) => set((state) => ({
                notes: [
                    {
                        id: Math.random().toString(36).substring(7),
                        stockCode,
                        content,
                        createdAt: Date.now(),
                        updatedAt: Date.now(),
                    },
                    ...state.notes,
                ],
            })),
            updateNote: (id, content) => set((state) => ({
                notes: state.notes.map((n) =>
                    n.id === id ? { ...n, content, updatedAt: Date.now() } : n
                ),
            })),
            deleteNote: (id) => set((state) => ({
                notes: state.notes.filter((n) => n.id !== id),
            })),
        }),
        {
            name: 'kiwoom-trader-notes',
        }
    )
)
