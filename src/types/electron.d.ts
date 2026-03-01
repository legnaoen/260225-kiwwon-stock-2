export interface IElectronAPI {
    on: (channel: string, callback: (...args: any[]) => void) => void
    send: (channel: string, ...args: any[]) => void
    minimize: () => void
    maximize: () => void
    close: () => void
    saveApiKeys: (keys: { appkey: string, secretkey: string }) => Promise<{ success: boolean, message?: string, error?: string }>
    getApiKeys: () => Promise<{ appkey: string, secretkey: string } | null>
    getAccountList: () => Promise<any>
    getHoldings: (options: { accountNo: string, nextKey?: string }) => Promise<any>
    getDeposit: (options: { accountNo: string }) => Promise<any>
    getAllStocks: (marketType: string) => Promise<any>
    getWatchlist: (symbols: string[]) => Promise<any>
    getChartData: (options: { stk_cd: string, base_dt?: string }) => Promise<any>
    wsRegister: (symbols: string[]) => Promise<any>
    onRealTimeData: (callback: (data: any) => void) => () => void
    saveWatchlistSymbols: (symbols: string[]) => Promise<any>
    getWatchlistSymbols: () => Promise<string[]>
    getConnectionStatus: () => Promise<{ connected: boolean, mockConnected: boolean, realConnected: boolean }>
    // Telegram
    saveTelegramSettings: (settings: { botToken: string, chatId: string }) => Promise<{ success: boolean, message?: string, error?: string }>
    getTelegramSettings: () => Promise<{ botToken: string, chatId: string } | null>
    sendTelegramTestMessage: () => Promise<{ success: boolean, error?: string }>

    // Capture
    sendChartRenderComplete: (code: string) => void
}

declare global {
    interface Window {
        electronAPI: IElectronAPI
    }
}
