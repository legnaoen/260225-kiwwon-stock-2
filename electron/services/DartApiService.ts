import axios from 'axios'
import Store from 'electron-store'
import { DatabaseService } from './DatabaseService'

const store = new Store()
const DART_BASE_URL = 'https://opendart.fss.or.kr/api'

export class DartApiService {
    private static instance: DartApiService
    private db = DatabaseService.getInstance().getDb()
    private isSyncing = false

    private constructor() {
        // Initialize logic can go here
    }

    public static getInstance(): DartApiService {
        if (!DartApiService.instance) {
            DartApiService.instance = new DartApiService()
        }
        return DartApiService.instance
    }

    private getApiKey(): string | null {
        // Assuming user saves dart API key in electron-store under settings
        const keys = store.get('dart_api_key') as string | undefined
        return keys || null
    }

    /**
     * Download and extract CORPCODE.xml into SQLite
     */
    public async syncCorpCodes() {
        const apiKey = this.getApiKey()
        if (!apiKey) {
            console.warn('[DartApiService] No API key found for DART. Skipping corp_code sync.')
            return
        }

        if (this.isSyncing) return
        this.isSyncing = true

        try {
            console.log('[DartApiService] Starting corp_code sync from DART...')
            const url = `${DART_BASE_URL}/corpCode.xml?crtfc_key=${apiKey}`

            const response = await axios({
                method: 'get',
                url: url,
                responseType: 'arraybuffer'
            })

            // Dynamic require for build-time safety with Vite/Rollup
            const unzipper = require('unzipper')
            const { XMLParser } = require('fast-xml-parser')

            const buffer = Buffer.from(response.data)
            const directory = await unzipper.Open.buffer(buffer)
            const xmlFile = directory.files.find((d: any) => d.path === 'CORPCODE.xml')

            if (xmlFile) {
                const xmlBuffer = await xmlFile.buffer()
                const parser = new XMLParser()
                const jsonObj = parser.parse(xmlBuffer.toString())

                let list = jsonObj?.result?.list || []

                // If list is not an array (single item), wrap it
                if (!Array.isArray(list)) {
                    list = [list]
                }

                console.log(`[DartApiService] Found ${list.length} raw records. Filtering listed companies...`)

                // Mapping and filtering (Only companies with stock_code are listed companies)
                const validCodes = list
                    .filter((item: any) => item.stock_code && String(item.stock_code).trim() !== '')
                    .map((item: any) => ({
                        corp_code: String(item.corp_code).trim(),
                        corp_name: String(item.corp_name).trim(),
                        stock_code: String(item.stock_code).trim(),
                        modify_date: String(item.modify_date).trim()
                    }))

                DatabaseService.getInstance().insertCorpCodes(validCodes)
                console.log(`[DartApiService] Successfully synced ${validCodes.length} listed corp codes to DB.`)
            }
        } catch (err: any) {
            console.error('[DartApiService] Failed to sync corp codes:', err.message)
        } finally {
            this.isSyncing = false
        }
    }

    /**
     * Fetch upcoming earnings or dividend disclosures for given symbols
     */
    public async fetchDisclosures(corpCodes: string[], bgnDe: string, endDe: string) {
        const apiKey = this.getApiKey()
        if (!apiKey) return []

        let results = []
        for (const code of corpCodes) {
            try {
                // Throttle requests strictly: 1 per 2 seconds to not get banned. (Limit is 10k/day)
                await new Promise(resolve => setTimeout(resolve, 2000))

                const url = `${DART_BASE_URL}/list.json?crtfc_key=${apiKey}&corp_code=${code}&bgn_de=${bgnDe}&end_de=${endDe}&pblntf_ty=A` // A: 정기공시
                const res = await axios.get(url)

                if (res.data.status === '013') {
                    // No disclosures found. Not an error, just empty.
                    continue
                } else if (res.data.status !== '000') {
                    console.log(`[DartApiService] Warning for ${code}: ${res.data.message}`)
                    continue
                }

                if (res.data.list) {
                    results.push(...res.data.list)
                }
            } catch (err: any) {
                console.error(`[DartApiService] Failed to fetch disclosures for ${code}:`, err.message)
            }
        }

        return results
    }
}
