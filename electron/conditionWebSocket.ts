import { BrowserWindow } from 'electron'
import WebSocket from 'ws'
import { eventBus, SystemEvent } from './utils/EventBus'

const CONDITION_SOCKET_URL = 'wss://api.kiwoom.com:10000/api/dostk/websocket'

export class KiwoomConditionWebSocketManager {
    private ws: WebSocket | null = null
    private mainWindow: BrowserWindow | null = null
    private accessToken: string | null = null
    private isConnected = false
    private conditions: any[] = []

    constructor(mainWindow: BrowserWindow) {
        this.mainWindow = mainWindow
    }

    public async connect(token: string) {
        if (this.isConnected || (this.ws && (this.ws.readyState === WebSocket.CONNECTING || this.ws.readyState === WebSocket.OPEN))) return

        this.accessToken = token
        this.ws = new WebSocket(CONDITION_SOCKET_URL)

        this.ws.on('open', () => {
            console.log('Condition WebSocket Connected to Kiwoom')
            this.isConnected = true
            this.login()
        })

        this.ws.on('message', (data) => {
            try {
                const msgStr = data.toString()
                const parsed = JSON.parse(msgStr)
                this.handleMessage(parsed, msgStr)
            } catch (error) {
                console.error('Condition WS Message Parse Error:', error)
            }
        })

        this.ws.on('close', () => {
            console.log('Condition WebSocket Disconnected')
            this.isConnected = false
        })

        this.ws.on('error', (error) => {
            console.error('Condition WebSocket Error:', error)
        })
    }

    private login() {
        if (!this.ws || !this.accessToken || this.ws.readyState !== WebSocket.OPEN) return

        const loginPacket = {
            trnm: 'LOGIN',
            token: this.accessToken
        }
        this.ws.send(JSON.stringify(loginPacket))
    }

    public requestConditionList() {
        if (!this.ws || !this.isConnected || this.ws.readyState !== WebSocket.OPEN) return
        this.ws.send(JSON.stringify({ trnm: 'CNSRLST' }))
    }

    public requestConditionSearch(seq: string, isRealtime: boolean = false) {
        if (!this.ws || !this.isConnected || this.ws.readyState !== WebSocket.OPEN) return
        this.ws.send(JSON.stringify({
            trnm: 'CNSRREQ',
            seq: seq,
            search_type: isRealtime ? '1' : '0',
            stex_tp: 'K',
            cont_yn: 'N',
            next_key: ''
        }))
    }

    public stopConditionSearch(seq: string) {
        if (!this.ws || !this.isConnected || this.ws.readyState !== WebSocket.OPEN) return
        this.ws.send(JSON.stringify({
            trnm: 'CNSRCLR',
            seq: seq
        }))
    }

    private handleMessage(data: any, rawStr: string) {
        if (data.trnm === 'LOGIN') {
            if (data.return_code !== '0' && data.return_code !== 0) {
                console.error('Condition WS Login Failed:', data.return_msg)
            } else {
                console.log('Condition WS Login Success')
                this.requestConditionList() // 로그인 성공 시 즉시 리스트 요청
            }
            return
        }

        if (data.trnm === 'PING') {
            this.ws?.send(rawStr)
            return
        }

        if (data.trnm === 'CNSRLST') {
            if (data.return_code === '0' || data.return_code === 0) {
                this.conditions = data.data || []
                console.log('Condition List Received:', this.conditions)
                // UI로 목록 전송
                if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                    this.mainWindow.webContents.send('kiwoom:condition-list', this.conditions)
                }
            }
            return
        }

        if (data.trnm === 'CNSRREQ') {
            if (data.return_code === '0' || data.return_code === 0) {
                // 특정 조건식을 충족하는 종목 리스트 수신 (초기 1회 조회 + 실시간 편입/편출)
                const stocks = data.data || []
                console.log(`Condition Search Result [${data.seq || ''}]:`, stocks.length, 'items')

                // EventBus를 통해 AutoTradeService 등으로 종목 포착 시그널 전송
                eventBus.emit(SystemEvent.CONDITION_MATCHED, stocks.map((s: any) => ({
                    code: Object.keys(s).find(k => k.length === 4 && s[k].startsWith('A')) ? s[Object.keys(s).find(k => k.length === 4 && s[k].startsWith('A'))!] : s['9001'],
                    name: s['302'],
                    price: s['10'] ? Math.abs(Number(s['10'])) : 0,
                    type: s['1001'] // 편입('1') / 편출('2') 여부 판단 가능
                })))
            } else {
                console.error('Condition Search Failed:', data.return_msg)
            }
            return
        }
    }

    public getConditions() {
        return this.conditions
    }

    public disconnect() {
        this.ws?.close()
        this.isConnected = false
    }
}
