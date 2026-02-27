import { BrowserWindow } from 'electron'
import WebSocket from 'ws'

const SOCKET_URL = 'wss://api.kiwoom.com:10000/api/dostk/websocket'

export class KiwoomWebSocketManager {
    private ws: WebSocket | null = null
    private mainWindow: BrowserWindow | null = null
    private accessToken: string | null = null
    private registeredItems: Set<string> = new Set()
    private isConnected = false
    private pingInterval: NodeJS.Timeout | null = null

    constructor(mainWindow: BrowserWindow) {
        this.mainWindow = mainWindow
    }

    public async connect(token: string) {
        if (this.isConnected) return

        this.accessToken = token
        this.ws = new WebSocket(SOCKET_URL)

        this.ws.on('open', () => {
            console.log('WebSocket Connected to Kiwoom')
            this.isConnected = true
            this.login()
            this.startPing()
        })

        this.ws.on('message', (data) => {
            try {
                const msgStr = data.toString()
                const parsed = JSON.parse(msgStr)
                this.handleMessage(parsed, msgStr)
            } catch (error) {
                console.error('WS Message Parse Error:', error)
            }
        })

        this.ws.on('close', () => {
            console.log('WebSocket Disconnected')
            this.isConnected = false
            this.stopPing()
        })

        this.ws.on('error', (error) => {
            console.error('WebSocket Error:', error)
        })
    }

    private login() {
        if (!this.ws || !this.accessToken) return

        const loginPacket = {
            trnm: 'LOGIN',
            token: this.accessToken
        }
        const msg = JSON.stringify(loginPacket)
        this.ws.send(msg)
    }

    private startPing() {
        this.stopPing()
        this.pingInterval = setInterval(() => {
            if (this.ws && this.isConnected) {
                // Send PING if required, or wait for server PING and respond
                // Based on Python example, we respond to server PING with the same message
            }
        }, 30000)
    }

    private stopPing() {
        if (this.pingInterval) {
            clearInterval(this.pingInterval)
            this.pingInterval = null
        }
    }

    public registerItems(symbols: string[]) {
        // 새로운 종목 추가
        symbols.forEach(s => this.registeredItems.add(s))

        if (!this.ws || !this.isConnected) {
            console.log('WS not connected yet. Symbols added to queue:', symbols)
            return
        }

        // Kiwoom WebSocket requires only the 6-digit numeric code.
        // Filter out any invalid length symbols (e.g., if a typo resulted in 5 digits).
        let allSymbols = Array.from(this.registeredItems)
            .map(sym => sym.replace(/[^0-9]/g, ''))
            .filter(sym => sym.length === 6)

        // Add Samsung Electronics (005930) to guarantee high-frequency trades for testing.
        if (!allSymbols.includes('005930')) {
            allSymbols.push('005930')
        }

        if (allSymbols.length === 0) return

        const regPacket = {
            trnm: 'REG',
            grp_no: '1',
            refresh: '1',
            data: [{ // <- List format
                item: allSymbols,
                type: ['0B'] // 주식체결 (현재가 실시간)
            }]
        }
        const msg = JSON.stringify(regPacket)
        this.ws.send(msg)
    }

    private handleMessage(data: any, rawStr: string) {

        // Handle LOGIN response
        if (data.trnm === 'LOGIN') {
            if (data.return_code !== '0' && data.return_code !== 0) {
                console.error('WS Login Failed:', data.return_msg)
            } else {
                console.log('WS Login Success')
                // Re-register items if any
                if (this.registeredItems.size > 0) {
                    this.registerItems(Array.from(this.registeredItems))
                }
            }
            return
        }

        // Handle PING
        if (data.trnm === 'PING') {
            this.ws?.send(rawStr)
            return
        }

        // Handle Real-time data
        if (data.trnm === 'REAL') {
            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                const realData = data.data
                if (Array.isArray(realData)) {
                    realData.forEach(d => {
                        // Map the raw websocket FID format to our UI's expected format
                        if (d.item && d.values) {
                            // Find the original registered symbol (e.g. "A005930") that matches the numeric item ("005930")
                            const originalSymbol = Array.from(this.registeredItems).find(s => s.replace(/[^0-9]/g, '') === d.item) || d.item;

                            const mappedData = {
                                stk_cd: originalSymbol,
                                cur_prc: d.values["10"], // 현재가
                                prdy_vrss: d.values["11"], // 전일대비
                                prdy_ctrt: d.values["12"], // 등락율
                                acml_vol: d.values["13"]   // 누적거래량
                            }
                            this.mainWindow!.webContents.send('kiwoom:real-time-data', mappedData)
                        } else {
                            this.mainWindow!.webContents.send('kiwoom:real-time-data', d)
                        }
                    })
                } else if (realData) {
                    this.mainWindow.webContents.send('kiwoom:real-time-data', realData)
                } else {
                    this.mainWindow.webContents.send('kiwoom:real-time-data', data) // fallback
                }
            }
        } else if (data.stk_cd) { // fallback
            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                this.mainWindow.webContents.send('kiwoom:real-time-data', data)
            }
        }
    }

    public disconnect() {
        this.ws?.close()
        this.stopPing()
        this.isConnected = false
    }
}
