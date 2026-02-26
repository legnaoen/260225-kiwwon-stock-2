"use strict";
var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
const electron = require("electron");
const path = require("node:path");
const Store = require("electron-store");
const axios = require("axios");
const store$1 = new Store();
const _KiwoomTokenManager = class _KiwoomTokenManager {
  constructor() {
    __publicField(this, "realToken", null);
    __publicField(this, "baseUrl", "https://api.kiwoom.com");
  }
  static getInstance() {
    if (!_KiwoomTokenManager.instance) {
      _KiwoomTokenManager.instance = new _KiwoomTokenManager();
    }
    return _KiwoomTokenManager.instance;
  }
  getStoredKeys() {
    return store$1.get("kiwoom_keys");
  }
  async getAccessToken(forceRefresh = false) {
    var _a;
    const keys = this.getStoredKeys();
    if (!keys) {
      throw new Error("API Keys not found in settings.");
    }
    if (!forceRefresh && this.realToken && this.realToken.token && !this.isTokenExpired(this.realToken)) {
      return this.realToken.token;
    }
    try {
      const url = `${this.baseUrl}/oauth2/token`;
      const response = await axios.post(url, {
        grant_type: "client_credentials",
        appkey: keys.appkey,
        secretkey: keys.secretkey
      }, {
        headers: {
          "Content-Type": "application/json;charset=UTF-8"
        }
      });
      const newToken = {
        ...response.data,
        token: response.data.token || response.data.access_token,
        issued_at: Date.now()
      };
      if (!newToken.token || newToken.token === "undefined") {
        throw new Error("서버로부터 유효한 토큰을 받지 못했습니다.");
      }
      this.realToken = newToken;
      console.log("Real token successfully acquired:", newToken.token.substring(0, 10) + "...");
      return newToken.token;
    } catch (error) {
      const errorData = ((_a = error == null ? void 0 : error.response) == null ? void 0 : _a.data) || error.message;
      console.error(`Failed to get Real access token:`, errorData);
      throw new Error(`인증에 실패했습니다. API 키를 확인해주세요. (서버응답: ${JSON.stringify(errorData)})`);
    }
  }
  isTokenExpired(token) {
    const expirationTime = token.issued_at + token.expires_in * 1e3 - 6e4;
    return Date.now() > expirationTime;
  }
  async getConnectionStatus() {
    if (!this.realToken) {
      try {
        const keys = this.getStoredKeys();
        if (keys && keys.appkey && keys.secretkey) {
          await this.getAccessToken();
        }
      } catch (e) {
      }
    }
    return {
      connected: !!this.realToken && !this.isTokenExpired(this.realToken),
      realConnected: !!this.realToken && !this.isTokenExpired(this.realToken),
      mockConnected: false
      // Deprecated
    };
  }
  clearTokens() {
    this.realToken = null;
  }
};
__publicField(_KiwoomTokenManager, "instance");
let KiwoomTokenManager = _KiwoomTokenManager;
const SOCKET_URL = "wss://api.kiwoom.com:10000/api/dostk/websocket";
class KiwoomWebSocketManager {
  constructor(mainWindow) {
    __publicField(this, "ws", null);
    __publicField(this, "mainWindow", null);
    __publicField(this, "accessToken", null);
    __publicField(this, "registeredItems", /* @__PURE__ */ new Set());
    __publicField(this, "isConnected", false);
    __publicField(this, "pingInterval", null);
    this.mainWindow = mainWindow;
  }
  async connect(token) {
    if (this.isConnected) return;
    this.accessToken = token;
    this.ws = new WebSocket(SOCKET_URL);
    this.ws.onopen = () => {
      console.log("WebSocket Connected to Kiwoom");
      this.isConnected = true;
      this.login();
      this.startPing();
    };
    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        this.handleMessage(data);
      } catch (error) {
        console.error("WS Message Parse Error:", error);
      }
    };
    this.ws.onclose = () => {
      console.log("WebSocket Disconnected");
      this.isConnected = false;
      this.stopPing();
    };
    this.ws.onerror = (error) => {
      console.error("WebSocket Error:", error);
    };
  }
  login() {
    if (!this.ws || !this.accessToken) return;
    const loginPacket = {
      trnm: "LOGIN",
      token: this.accessToken
    };
    this.ws.send(JSON.stringify(loginPacket));
  }
  startPing() {
    this.stopPing();
    this.pingInterval = setInterval(() => {
      if (this.ws && this.isConnected) ;
    }, 3e4);
  }
  stopPing() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }
  registerItems(symbols) {
    symbols.forEach((s) => this.registeredItems.add(s));
    if (!this.ws || !this.isConnected) {
      console.log("WS not connected yet. Symbols added to queue:", symbols);
      return;
    }
    const allSymbols = Array.from(this.registeredItems);
    const regPacket = {
      trnm: "REG",
      grp_no: "1",
      refresh: "1",
      data: [{
        item: allSymbols,
        type: ["0B"]
        // 실시간 체결 데이터
      }]
    };
    this.ws.send(JSON.stringify(regPacket));
    console.log("WS Registered All Items:", allSymbols);
  }
  handleMessage(data) {
    var _a;
    if (data.trnm === "LOGIN") {
      if (data.return_code !== 0) {
        console.error("WS Login Failed:", data.return_msg);
      } else {
        console.log("WS Login Success");
        if (this.registeredItems.size > 0) {
          this.registerItems(Array.from(this.registeredItems));
        }
      }
      return;
    }
    if (data.trnm === "PING") {
      (_a = this.ws) == null ? void 0 : _a.send(JSON.stringify(data));
      return;
    }
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send("kiwoom:real-time-data", data);
    }
  }
  disconnect() {
    var _a;
    (_a = this.ws) == null ? void 0 : _a.close();
    this.stopPing();
    this.isConnected = false;
  }
}
const store = new Store();
const tokenManager = KiwoomTokenManager.getInstance();
const BASE_URL = "https://api.kiwoom.com";
process.env.DIST = path.join(__dirname, "../dist");
process.env.VITE_PUBLIC = electron.app.isPackaged ? process.env.DIST : path.join(process.env.DIST, "../public");
let win;
let wsManager = null;
function createWindow() {
  win = new electron.BrowserWindow({
    width: 1200,
    height: 800,
    frame: false,
    // Custom title bar usage
    webPreferences: {
      preload: path.join(__dirname, "preload.js")
    }
  });
  wsManager = new KiwoomWebSocketManager(win);
  win.webContents.on("did-finish-load", () => {
    win == null ? void 0 : win.webContents.send("main-process-message", (/* @__PURE__ */ new Date()).toLocaleString());
  });
  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(process.env.DIST, "index.html"));
  }
}
electron.app.on("window-all-closed", () => {
  if (wsManager) {
    wsManager.disconnect();
  }
  if (process.platform !== "darwin") {
    electron.app.quit();
    win = null;
  }
});
electron.app.on("activate", () => {
  if (electron.BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
electron.app.whenReady().then(createWindow);
electron.ipcMain.on("window-controls:minimize", () => {
  win == null ? void 0 : win.minimize();
});
electron.ipcMain.on("window-controls:maximize", () => {
  if (win == null ? void 0 : win.isMaximized()) {
    win.unmaximize();
  } else {
    win == null ? void 0 : win.maximize();
  }
});
electron.ipcMain.on("window-controls:close", () => {
  win == null ? void 0 : win.close();
});
electron.ipcMain.handle("kiwoom:save-keys", async (_event, keys) => {
  try {
    store.set("kiwoom_keys", keys);
    tokenManager.clearTokens();
    await tokenManager.getAccessToken(true);
    return {
      success: true,
      message: "키움증권 서버 연결에 성공했습니다!"
    };
  } catch (error) {
    return {
      success: false,
      error: error.message || "인증에 실패했습니다. 키를 다시 확인해주세요."
    };
  }
});
electron.ipcMain.handle("kiwoom:get-keys", () => {
  return store.get("kiwoom_keys") || null;
});
electron.ipcMain.handle("kiwoom:get-accounts", async () => {
  var _a, _b;
  try {
    const token = await tokenManager.getAccessToken();
    const url = `${BASE_URL}/api/dostk/acnt`;
    const response = await axios.post(url, {}, {
      headers: {
        "Content-Type": "application/json;charset=UTF-8",
        "authorization": `Bearer ${token}`,
        "api-id": "ka00001"
      }
    });
    console.log("IPC get-accounts: Success", response.data ? "Data length: " + JSON.stringify(response.data).length : "No data");
    return { success: true, data: response.data };
  } catch (error) {
    console.error("IPC get-accounts error:", ((_a = error == null ? void 0 : error.response) == null ? void 0 : _a.data) || error.message);
    return {
      success: false,
      error: ((_b = error == null ? void 0 : error.response) == null ? void 0 : _b.data) || { message: error.message }
    };
  }
});
electron.ipcMain.handle("kiwoom:get-holdings", async (_event, { accountNo, nextKey = "" }) => {
  var _a, _b, _c, _d;
  try {
    let token = await tokenManager.getAccessToken();
    const url = `${BASE_URL}/api/dostk/acnt`;
    const makeRequest = (t) => axios.post(url, {
      account_no: accountNo,
      qry_tp: "1",
      dmst_stex_tp: "KRX"
    }, {
      headers: {
        "Content-Type": "application/json;charset=UTF-8",
        "authorization": `Bearer ${t}`,
        "api-id": "kt00018",
        "cont-yn": nextKey ? "Y" : "N",
        "next-key": nextKey || ""
      }
    });
    let response;
    try {
      response = await makeRequest(token);
    } catch (err) {
      if (((_a = err.response) == null ? void 0 : _a.status) === 401 || JSON.stringify((_b = err.response) == null ? void 0 : _b.data).includes("Token")) {
        token = await tokenManager.getAccessToken(true);
        response = await makeRequest(token);
      } else {
        throw err;
      }
    }
    if (wsManager) wsManager.connect(token);
    console.log(`IPC get-holdings: Success for ${accountNo}`);
    return {
      success: true,
      data: response.data,
      headers: response.headers
    };
  } catch (error) {
    console.error(`IPC get-holdings error for ${accountNo}:`, ((_c = error == null ? void 0 : error.response) == null ? void 0 : _c.data) || error.message);
    return {
      success: false,
      error: ((_d = error == null ? void 0 : error.response) == null ? void 0 : _d.data) || { message: error.message }
    };
  }
});
electron.ipcMain.handle("kiwoom:get-deposit", async (_event, { accountNo }) => {
  var _a, _b;
  try {
    const token = await tokenManager.getAccessToken();
    const url = `${BASE_URL}/api/dostk/acnt`;
    const todayDate = /* @__PURE__ */ new Date();
    const today = todayDate.toISOString().split("T")[0].replace(/-/g, "");
    const sevenDaysAgoDate = /* @__PURE__ */ new Date();
    sevenDaysAgoDate.setDate(todayDate.getDate() - 7);
    const sevenDaysAgo = sevenDaysAgoDate.toISOString().split("T")[0].replace(/-/g, "");
    const response = await axios.post(url, {
      account_no: accountNo,
      fr_dt: sevenDaysAgo,
      to_dt: today
    }, {
      headers: {
        "Content-Type": "application/json;charset=UTF-8",
        "authorization": `Bearer ${token}`,
        "api-id": "kt00016"
      }
    });
    console.log(`IPC get-deposit (kt00016): Success for ${accountNo}`);
    return { success: true, data: response.data };
  } catch (error) {
    console.error(`IPC get-deposit error for ${accountNo}:`, ((_a = error == null ? void 0 : error.response) == null ? void 0 : _a.data) || error.message);
    return {
      success: false,
      error: ((_b = error == null ? void 0 : error.response) == null ? void 0 : _b.data) || { message: error.message }
    };
  }
});
electron.ipcMain.handle("kiwoom:get-connection-status", async () => {
  try {
    const status = await tokenManager.getConnectionStatus();
    return status;
  } catch (error) {
    return { connected: false, mode: "none" };
  }
});
electron.ipcMain.handle("kiwoom:get-all-stocks", async (_event, { marketType }) => {
  var _a, _b;
  try {
    const token = await tokenManager.getAccessToken();
    const url = `${BASE_URL}/api/dostk/stkinfo`;
    let allStocks = [];
    let hasMore = true;
    let nextKey = "";
    while (hasMore) {
      const response = await axios.post(url, {
        mrkt_tp: marketType
      }, {
        headers: {
          "Content-Type": "application/json;charset=UTF-8",
          "authorization": `Bearer ${token}`,
          "api-id": "ka10099",
          "cont-yn": nextKey ? "Y" : "N",
          "next-key": nextKey
        }
      });
      const data = response.data;
      const list = (data == null ? void 0 : data.Body) || (data == null ? void 0 : data.list) || [];
      allStocks = allStocks.concat(list);
      nextKey = response.headers["next-key"] || "";
      hasMore = response.headers["cont-yn"] === "Y" && !!nextKey;
      if (hasMore) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return { success: true, data: allStocks };
  } catch (error) {
    console.error("IPC get-all-stocks error:", ((_a = error == null ? void 0 : error.response) == null ? void 0 : _a.data) || error.message);
    return {
      success: false,
      error: ((_b = error == null ? void 0 : error.response) == null ? void 0 : _b.data) || { message: error.message }
    };
  }
});
electron.ipcMain.handle("kiwoom:save-watchlist-symbols", async (_event, symbols) => {
  store.set("watchlist_symbols", symbols);
  return { success: true };
});
electron.ipcMain.handle("kiwoom:get-watchlist-symbols", () => {
  return store.get("watchlist_symbols") || [];
});
electron.ipcMain.handle("kiwoom:get-watchlist", async (_event, { symbols }) => {
  var _a, _b;
  try {
    const token = await tokenManager.getAccessToken();
    const url = `${BASE_URL}/api/dostk/stkinfo`;
    const response = await axios.post(url, {
      stk_cd: symbols.join("|")
    }, {
      headers: {
        "Content-Type": "application/json;charset=UTF-8",
        "authorization": `Bearer ${token}`,
        "api-id": "ka10095"
      }
    });
    return { success: true, data: response.data };
  } catch (error) {
    console.error("IPC get-watchlist error:", ((_a = error == null ? void 0 : error.response) == null ? void 0 : _a.data) || error.message);
    return {
      success: false,
      error: ((_b = error == null ? void 0 : error.response) == null ? void 0 : _b.data) || { message: error.message }
    };
  }
});
electron.ipcMain.handle("kiwoom:get-chart-data", async (_event, { stk_cd, base_dt }) => {
  var _a, _b;
  try {
    const token = await tokenManager.getAccessToken();
    const url = `${BASE_URL}/api/dostk/chart`;
    const today = (/* @__PURE__ */ new Date()).toISOString().split("T")[0].replace(/-/g, "");
    const response = await axios.post(url, {
      stk_cd,
      base_dt: base_dt || today,
      upd_stkpc_tp: "1"
      // 수정주가 구분 (1: 수정주가)
    }, {
      headers: {
        "Content-Type": "application/json;charset=UTF-8",
        "authorization": `Bearer ${token}`,
        "api-id": "ka10081"
      }
    });
    return { success: true, data: response.data };
  } catch (error) {
    console.error("IPC get-chart-data error:", ((_a = error == null ? void 0 : error.response) == null ? void 0 : _a.data) || error.message);
    return {
      success: false,
      error: ((_b = error == null ? void 0 : error.response) == null ? void 0 : _b.data) || { message: error.message }
    };
  }
});
electron.ipcMain.handle("kiwoom:ws-register", async (_event, symbols) => {
  if (wsManager) {
    wsManager.registerItems(symbols);
    return { success: true };
  }
  return { success: false, error: "WebSocket not initialized" };
});
