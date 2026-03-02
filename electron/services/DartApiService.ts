import axios from 'axios'
import Store from 'electron-store'
import { DatabaseService } from './DatabaseService'
import * as unzipper from 'unzipper'
import { XMLParser } from 'fast-xml-parser'

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

            const buffer = Buffer.from(response.data)
            const directory = await unzipper.Open.buffer(buffer)
            const xmlFile = directory.files.find((d: any) => d.path === 'CORPCODE.xml')

            if (xmlFile) {
                const xmlBuffer = await xmlFile.buffer()
                const parser = new XMLParser({ parseTagValue: false })
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
                        stock_code: String(item.stock_code).trim().padStart(6, '0'),
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
     * Sync disclosures for watchlist stocks and register as schedules
     */
    public async syncWatchlistSchedules() {
        const apiKey = this.getApiKey()
        if (!apiKey) {
            console.error('[DartApiService] No API key found. Aborting schedule sync.')
            return
        }

        const symbols = store.get('watchlist_symbols') as string[] || []
        console.log(`[DartApiService] Watchlist symbols: ${symbols.join(', ')}`)
        if (symbols.length === 0) return

        const dartSettings = store.get('dart_settings') as any || {}
        const options = dartSettings.options || { regular: true, major: true, exchange: true }
        console.log('[DartApiService] Options:', options)

        // Map UI options to DART pblntf_ty
        const types = []
        if (options.regular) types.push('A')
        if (options.major) types.push('B')
        if (options.exchange) types.push('I')
        if (options.issue) types.push('C')

        if (types.length === 0) {
            console.warn('[DartApiService] No disclosure types selected in settings.')
            return
        }

        const stockCorpMap = DatabaseService.getInstance().getCorpCodesByStockCodes(symbols)
        console.log('[DartApiService] Stock-Corp mapping found for:', Object.keys(stockCorpMap))

        // Debugging info: Check total corp codes in DB
        const totalCorpCount = DatabaseService.getInstance().getDb().prepare('SELECT count(*) as cnt FROM dart_corp_code').get() as any
        console.log(`[DartApiService] Total corp codes in DB: ${totalCorpCount?.cnt || 0}`)

        const corpCodes = Object.values(stockCorpMap)

        if (corpCodes.length === 0) {
            console.warn('[DartApiService] No corp codes found in DB for the watchlist symbols. Please sync corp codes first.')
            return
        }

        // Fetch last 14 days of disclosures to catch new ones
        const endDe = new Date().toISOString().slice(0, 10).replace(/-/g, '')
        const bgnDe = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10).replace(/-/g, '')

        console.log(`[DartApiService] Starting sync: ${bgnDe} ~ ${endDe} for ${corpCodes.length} stocks`)

        for (const corpCode of corpCodes) {
            const stockCode = Object.keys(stockCorpMap).find(k => stockCorpMap[k] === corpCode) || ''
            for (const type of types) {
                try {
                    await new Promise(resolve => setTimeout(resolve, 1000)) // Throttling
                    const url = `${DART_BASE_URL}/list.json?crtfc_key=${apiKey}&corp_code=${corpCode}&bgn_de=${bgnDe}&end_de=${endDe}&pblntf_ty=${type}`
                    console.log(`[DartApiService] Fetching ${stockCode}(${corpCode}) type=${type}...`)

                    const res = await axios.get(url)

                    if (res.data.status === '000' && res.data.list) {
                        console.log(`[DartApiService] Found ${res.data.list.length} disclosures for ${stockCode}`)
                        const schedulesToUpsert = res.data.list.map((item: any) => {
                            const smartNote = this.generateSmartNote(item.report_nm)
                            return {
                                id: `DART_${item.rcept_no}`,
                                title: `[${item.corp_name}] ${item.report_nm}`,
                                description: smartNote || '',
                                target_date: item.rcept_dt.slice(0, 4) + '-' + item.rcept_dt.slice(4, 6) + '-' + item.rcept_dt.slice(6, 8),
                                stock_code: stockCode,
                                reminder_type: '당일',
                                is_notified: 0,
                                is_market_event: 1,
                                source: 'DART',
                                origin_id: item.rcept_no
                            }
                        })
                        DatabaseService.getInstance().upsertSchedules(schedulesToUpsert)
                    } else if (res.data.status !== '000' && res.data.status !== '013') {
                        console.error(`[DartApiService] DART API Error (${res.data.status}): ${res.data.message}`)
                    }
                } catch (err: any) {
                    console.error(`[DartApiService] Error fetching for ${stockCode}:`, err.message)
                }
            }
        }
        console.log('[DartApiService] Sync watchlist schedules completed.')
    }

    private generateSmartNote(title: string): string | null {
        // Simple algorithm to generate investment caution notes
        if (title.includes('영업실적') && title.includes('잠정')) {
            return '시장 예상치와의 괴리율을 확인하세요. 실적 발표 후 단기 변동성이 커질 수 있습니다.'
        }
        if (title.includes('배당') && title.includes('결정')) {
            return '배당기준일 전후 주가 흐름에 유의하세요. 고배당주의 경우 배당락 영향이 클 수 있습니다.'
        }
        if (title.includes('유상증자') && title.includes('결정')) {
            return '신주 발행 가액과 상장 예정일을 확인하세요. 물량 부담으로 인한 희석 위험이 있습니다.'
        }
        if (title.includes('전환사채') && title.includes('발행')) {
            return 'CB 발행 목적과 전환가액을 확인하세요. 향후 잠재적 매도 물량(오버행) 리스크가 존재합니다.'
        }
        if (title.includes('추가상장') && (title.includes('전환') || title.includes('스톡옵션'))) {
            return '보호예수가 없는 신규 물량이 시장에 풀리는 날일 수 있습니다. 수급 압박에 주의하세요.'
        }
        if (title.includes('공개매수')) {
            return '매수가격과 기간을 확인하세요. 경영권 분쟁이나 상장폐지 절차의 시작일 수 있습니다.'
        }
        if (title.includes('정기주주총회') || title.includes('임시주주총회')) {
            return '주요 안건(이사 선임, 정관 변경 등)을 확인하세요.'
        }
        return null
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
