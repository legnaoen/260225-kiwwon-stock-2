"use strict";
const electron = require("electron");
electron.contextBridge.exposeInMainWorld("electronAPI", {
  on: (channel, callback) => {
    electron.ipcRenderer.on(channel, (_event, ...args) => callback(...args));
  },
  send: (channel, ...args) => {
    electron.ipcRenderer.send(channel, ...args);
  },
  // Window controls
  minimize: () => electron.ipcRenderer.send("window-controls:minimize"),
  maximize: () => electron.ipcRenderer.send("window-controls:maximize"),
  close: () => electron.ipcRenderer.send("window-controls:close"),
  // API Key Management
  saveApiKeys: (keys) => electron.ipcRenderer.invoke("kiwoom:save-keys", keys),
  getApiKeys: () => electron.ipcRenderer.invoke("kiwoom:get-keys"),
  // Data Fetching (REAL mode is handled by backend internally)
  getAccountList: () => electron.ipcRenderer.invoke("kiwoom:get-accounts"),
  getHoldings: (options) => electron.ipcRenderer.invoke("kiwoom:get-holdings", options),
  getDeposit: (options) => electron.ipcRenderer.invoke("kiwoom:get-deposit", options),
  getAllStocks: (marketType) => electron.ipcRenderer.invoke("kiwoom:get-all-stocks", { marketType }),
  getWatchlist: (symbols) => electron.ipcRenderer.invoke("kiwoom:get-watchlist", { symbols }),
  getChartData: (options) => electron.ipcRenderer.invoke("kiwoom:get-chart-data", options),
  wsRegister: (symbols) => electron.ipcRenderer.invoke("kiwoom:ws-register", symbols),
  onRealTimeData: (callback) => {
    const listener = (_event, data) => callback(data);
    electron.ipcRenderer.on("kiwoom:real-time-data", listener);
    return () => electron.ipcRenderer.removeListener("kiwoom:real-time-data", listener);
  },
  saveWatchlistSymbols: (symbols) => electron.ipcRenderer.invoke("kiwoom:save-watchlist-symbols", symbols),
  getWatchlistSymbols: () => electron.ipcRenderer.invoke("kiwoom:get-watchlist-symbols"),
  getConnectionStatus: () => electron.ipcRenderer.invoke("kiwoom:get-connection-status")
});
