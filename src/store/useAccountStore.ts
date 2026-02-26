import { create } from 'zustand'

interface AccountState {
    selectedAccount: string
    accountList: string[]
    setSelectedAccount: (account: string) => void
    setAccountList: (list: string[]) => void
}

export const useAccountStore = create<AccountState>((set) => ({
    selectedAccount: '',
    accountList: [],
    setSelectedAccount: (account) => set({ selectedAccount: account }),
    setAccountList: (list) => set({ accountList: list }),
}))
