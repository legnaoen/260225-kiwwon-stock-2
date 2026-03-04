import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface TagState {
    tags: Record<string, string[]>
    addTag: (stockCode: string, tag: string) => void
    removeTag: (stockCode: string, tag: string) => void
    getAllTags: () => string[]
}

export const useTagStore = create<TagState>()(
    persist(
        (set, get) => ({
            tags: {},
            addTag: (stockCode, tag) => set((state) => {
                const currentTags = state.tags[stockCode] || []
                if (!currentTags.includes(tag)) {
                    return {
                        tags: {
                            ...state.tags,
                            [stockCode]: [...currentTags, tag]
                        }
                    }
                }
                return state
            }),
            removeTag: (stockCode, tag) => set((state) => {
                const currentTags = state.tags[stockCode] || []
                return {
                    tags: {
                        ...state.tags,
                        [stockCode]: currentTags.filter(t => t !== tag)
                    }
                }
            }),
            getAllTags: () => {
                const state = get()
                const allTags = new Set<string>()
                Object.values(state.tags).forEach(tagsArray => {
                    tagsArray.forEach(tag => allTags.add(tag))
                })
                return Array.from(allTags).sort()
            }
        }),
        {
            name: 'kiwoom-trader-tags'
        }
    )
)
