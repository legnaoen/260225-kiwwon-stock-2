import { useState, useEffect } from 'react'
import { Minus, Square, X, Sun, Moon, RefreshCw } from 'lucide-react'
import { useAccountStore } from '../store/useAccountStore'

interface TitleBarProps {
    isDarkMode: boolean
    onToggleTheme: () => void
}

export default function TitleBar({ isDarkMode, onToggleTheme }: TitleBarProps) {
    const [isRefreshing, setIsRefreshing] = useState(false)
    const { selectedAccount, setSelectedAccount, accountList, setAccountList } = useAccountStore()

    useEffect(() => {
        const loadAccounts = async () => {
            if (accountList.length > 0) return
            try {
                if (window.electronAPI?.getAccountList) {
                    const result = await window.electronAPI.getAccountList()
                    if (result.success) {
                        const rawData = result.data?.Body || result.data
                        let list: string[] = []
                        if (Array.isArray(rawData)) list = rawData
                        else if (Array.isArray(rawData?.acctNo)) list = rawData.acctNo
                        else if (typeof rawData?.acctNo === 'string') list = [rawData.acctNo]
                        else if (Array.isArray(rawData?.acct_no)) list = rawData.acct_no
                        else if (typeof rawData?.acct_no === 'string') list = [rawData.acct_no]

                        const cleaned = list.map(a => String(a).trim()).filter(Boolean)
                        setAccountList(cleaned)
                        if (cleaned.length > 0 && !selectedAccount) {
                            setSelectedAccount(cleaned[0])
                        }
                    }
                }
            } catch (err) {
                console.error('Failed to load accounts in TitleBar:', err)
            }
        }
        loadAccounts()
    }, [])

    const handleRefresh = () => {
        setIsRefreshing(true)
        // Dispatch custom event for components to listen to
        window.dispatchEvent(new CustomEvent('kiwoom:refresh-data'))

        // Visual feedback time
        setTimeout(() => setIsRefreshing(false), 1000)
    }
    return (
        <header className="titlebar flex items-center justify-between h-10 px-4 bg-muted/50 border-b border-white/5 select-none">
            <div className="flex items-center gap-2">
                <div className="w-5 h-5 bg-primary rounded-md flex items-center justify-center">
                    <span className="text-[10px] font-bold text-primary-foreground">K</span>
                </div>
                <span className="text-xs font-semibold tracking-tight uppercase">Kiwoom Trader</span>
            </div>

            <div className="no-drag flex items-center gap-3">
                {accountList.length > 0 && (
                    <div className="flex items-center gap-2 px-2 py-1 bg-background/50 rounded-lg border border-white/5 mr-2">
                        <select
                            value={selectedAccount}
                            onChange={(e) => setSelectedAccount(e.target.value)}
                            className="bg-transparent text-[11px] font-mono font-black focus:outline-none appearance-none cursor-pointer pr-1"
                        >
                            {accountList.map(acc => (
                                <option key={acc} value={acc} className="bg-card text-foreground">{acc}</option>
                            ))}
                        </select>
                    </div>
                )}

                <button
                    onClick={handleRefresh}
                    disabled={isRefreshing}
                    className="p-1.5 hover:bg-muted rounded-md transition-colors group"
                    title="데이터 새로고침"
                >
                    <RefreshCw
                        size={14}
                        className={isRefreshing ? "animate-spin text-primary" : "text-muted-foreground group-hover:text-foreground"}
                    />
                </button>
                <div className="w-px h-4 bg-border mx-0.5" />
                <button
                    onClick={onToggleTheme}
                    className="p-1.5 hover:bg-muted rounded-md transition-colors"
                >
                    {isDarkMode ? <Sun size={14} /> : <Moon size={14} />}
                </button>
                <div className="w-px h-4 bg-border mx-1" />
                <button
                    onClick={() => window.electronAPI?.minimize()}
                    className="p-1.5 hover:bg-muted rounded-md transition-colors"
                >
                    <Minus size={14} />
                </button>
                <button
                    onClick={() => window.electronAPI?.maximize()}
                    className="p-1.5 hover:bg-muted rounded-md transition-colors"
                >
                    <Square size={14} />
                </button>
                <button
                    onClick={() => window.electronAPI?.close()}
                    className="p-1.5 hover:bg-destructive hover:text-destructive-foreground rounded-md transition-colors"
                >
                    <X size={14} />
                </button>
            </div>
        </header>
    )
}
