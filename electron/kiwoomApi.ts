import axios from 'axios'
import Store from 'electron-store'

const store = new Store()

interface KiwoomToken {
    token: string
    expires_in: number
    token_type: string
    issued_at: number
}

export class KiwoomTokenManager {
    private static instance: KiwoomTokenManager
    private realToken: KiwoomToken | null = null
    private baseUrl = 'https://api.kiwoom.com'

    private constructor() { }

    public static getInstance(): KiwoomTokenManager {
        if (!KiwoomTokenManager.instance) {
            KiwoomTokenManager.instance = new KiwoomTokenManager()
        }
        return KiwoomTokenManager.instance
    }

    private getStoredKeys() {
        return store.get('kiwoom_keys') as { appkey: string, secretkey: string } | undefined
    }

    public async getAccessToken(forceRefresh = false): Promise<string> {
        const keys = this.getStoredKeys()
        if (!keys) {
            throw new Error('API Keys not found in settings.')
        }

        // Check if current token is valid and not forced refresh
        if (!forceRefresh && this.realToken && this.realToken.token && !this.isTokenExpired(this.realToken)) {
            return this.realToken.token
        }

        try {
            const url = `${this.baseUrl}/oauth2/token`
            const response = await axios.post(url, {
                grant_type: 'client_credentials',
                appkey: keys.appkey,
                secretkey: keys.secretkey
            }, {
                headers: {
                    'Content-Type': 'application/json;charset=UTF-8'
                }
            })

            const newToken: KiwoomToken = {
                ...response.data,
                token: response.data.token || response.data.access_token,
                issued_at: Date.now()
            }

            if (!newToken.token || newToken.token === 'undefined') {
                throw new Error('서버로부터 유효한 토큰을 받지 못했습니다.')
            }

            this.realToken = newToken
            console.log('Real token successfully acquired:', newToken.token.substring(0, 10) + '...')
            return newToken.token
        } catch (error: any) {
            const errorData = error?.response?.data || error.message
            console.error(`Failed to get Real access token:`, errorData)
            throw new Error(`인증에 실패했습니다. API 키를 확인해주세요. (서버응답: ${JSON.stringify(errorData)})`)
        }
    }

    private isTokenExpired(token: KiwoomToken): boolean {
        // Buffer of 60 seconds
        const expirationTime = token.issued_at + (token.expires_in * 1000) - 60000
        return Date.now() > expirationTime
    }

    public async getConnectionStatus() {
        // Attempt to get token once to verify connection if keys exist
        if (!this.realToken) {
            try {
                const keys = this.getStoredKeys()
                if (keys && keys.appkey && keys.secretkey) {
                    await this.getAccessToken()
                }
            } catch (e) {
                // Ignore error, just means not connected
            }
        }

        return {
            connected: !!this.realToken && !this.isTokenExpired(this.realToken),
            realConnected: !!this.realToken && !this.isTokenExpired(this.realToken),
            mockConnected: false // Deprecated
        }
    }

    public clearTokens() {
        this.realToken = null
    }
}
