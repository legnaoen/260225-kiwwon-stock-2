import { BrowserWindow } from 'electron'

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

        this.ws.onopen = () => {
            console.log('WebSocket Connected to Kiwoom')
            this.isConnected = true
            this.login()
            this.startPing()
        }

        this.ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data as string)
                this.handleMessage(data)
            } catch (error) {
                console.error('WS Message Parse Error:', error)
            }
        }

        this.ws.onclose = () => {
            console.log('WebSocket Disconnected')
            this.isConnected = false
            this.stopPing()
            // Optional: Reconnect logic
        }

        this.ws.onerror = (error) => {
            console.error('WebSocket Error:', error)
        }
    }

    private login() {
        if (!this.ws || !this.accessToken) return

        const loginPacket = {
            trnm: 'LOGIN',
            token: this.accessToken
        }
        this.ws.send(JSON.stringify(loginPacket))
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

        const allSymbols = Array.from(this.registeredItems)
        const regPacket = {
            trnm: 'REG',
            grp_no: '1',
            refresh: '1',
            data: [{
                item: allSymbols,
                type: ['0B'] // 실시간 체결 데이터
            }]
        }
        this.ws.send(JSON.stringify(regPacket))
        console.log('WS Registered All Items:', allSymbols)
    }

    private handleMessage(data: any) {
        // Handle LOGIN response
        if (data.trnm === 'LOGIN') {
            if (data.return_code !== 0) {
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
            this.ws?.send(JSON.stringify(data))
            return
        }

        // Handle Real-time data (Type 0B or others)
        // Usually contains stk_cd, cur_prc, prdy_ctrt etc.
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send('kiwoom:real-time-data', data)
        }
    }

    public disconnect() {
        this.ws?.close()
        this.stopPing()
        this.isConnected = false
    }
}
