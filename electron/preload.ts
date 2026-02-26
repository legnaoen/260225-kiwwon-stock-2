import { contextBridge, ipcRenderer } from 'electron'

// --------- Expose some API to the Renderer process ---------
contextBridge.exposeInMainWorld('electronAPI', {
    on: (channel: string, callback: (...args: any[]) => void) => {
        ipcRenderer.on(channel, (_event, ...args) => callback(...args))
    },
    send: (channel: string, ...args: any[]) => {
        ipcRenderer.send(channel, ...args)
    },
    // Window controls
    minimize: () => ipcRenderer.send('window-controls:minimize'),
    maximize: () => ipcRenderer.send('window-controls:maximize'),
    close: () => ipcRenderer.send('window-controls:close'),
    // API Key Management
    saveApiKeys: (keys: { appkey: string, secretkey: string }) => ipcRenderer.invoke('kiwoom:save-keys', keys),
    getApiKeys: () => ipcRenderer.invoke('kiwoom:get-keys'),
    // Data Fetching (REAL mode is handled by backend internally)
    getAccountList: () => ipcRenderer.invoke('kiwoom:get-accounts'),
    getHoldings: (options: { accountNo: string, nextKey?: string }) => ipcRenderer.invoke('kiwoom:get-holdings', options),
    getDeposit: (options: { accountNo: string }) => ipcRenderer.invoke('kiwoom:get-deposit', options),
    getAllStocks: (marketType: string) => ipcRenderer.invoke('kiwoom:get-all-stocks', { marketType }),
    getWatchlist: (symbols: string[]) => ipcRenderer.invoke('kiwoom:get-watchlist', { symbols }),
    getChartData: (options: { stk_cd: string, base_dt?: string }) => ipcRenderer.invoke('kiwoom:get-chart-data', options),
    wsRegister: (symbols: string[]) => ipcRenderer.invoke('kiwoom:ws-register', symbols),
    onRealTimeData: (callback: (data: any) => void) => {
        const listener = (_event: any, data: any) => callback(data)
        ipcRenderer.on('kiwoom:real-time-data', listener)
        return () => ipcRenderer.removeListener('kiwoom:real-time-data', listener)
    },
    saveWatchlistSymbols: (symbols: string[]) => ipcRenderer.invoke('kiwoom:save-watchlist-symbols', symbols),
    getWatchlistSymbols: () => ipcRenderer.invoke('kiwoom:get-watchlist-symbols'),
    getConnectionStatus: () => ipcRenderer.invoke('kiwoom:get-connection-status'),
})
