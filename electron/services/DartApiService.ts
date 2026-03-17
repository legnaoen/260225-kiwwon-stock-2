import axios from 'axios'
import Store from 'electron-store'
import { DatabaseService } from './DatabaseService'
// @ts-ignore
import * as unzipper from 'unzipper'
import { XMLParser } from 'fast-xml-parser'
import { eventBus, SystemEvent } from '../utils/EventBus'
import { IngestionManager } from './IngestionManager'

const store = new Store()
const DART_BASE_URL = 'https://opendart.fss.or.kr/api'

export class DartApiService {
    private static instance: DartApiService
    private db = DatabaseService.getInstance().getDb()
    private isSyncing = false
    private get ingestionManager() {
        return IngestionManager.getInstance()
    }

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
        const startTime = Date.now();

        try {
            console.log('[DartApiService] Starting corp_code sync from DART...')
            const url = `${DART_BASE_URL}/corpCode.xml?crtfc_key=${apiKey}`

            const response = await axios({
                method: 'get',
                url: url,
                responseType: 'arraybuffer'
            })

            const dataSizeKb = response.data.byteLength / 1024;
            const buffer = Buffer.from(response.data)
            const directory = await unzipper.Open.buffer(buffer)
            const xmlFile = directory.files.find((d: any) => d.path === 'CORPCODE.xml')

            if (xmlFile) {
                const xmlBuffer = await xmlFile.buffer()
                const parser = new XMLParser({ parseTagValue: false })
                const jsonObj = parser.parse(xmlBuffer.toString())

                let list = jsonObj?.result?.list || []
                if (!Array.isArray(list)) list = [list]

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
                
                this.ingestionManager.recordIngestion('dart_corp_codes', 'OpenDART API', startTime, 200, dataSizeKb);
            }
        } catch (err: any) {
            console.error('[DartApiService] Failed to sync corp codes:', err.message)
            this.ingestionManager.recordIngestion('dart_corp_codes', 'OpenDART API', startTime, err.response?.status || 500, 0, err.message);
        } finally {
            this.isSyncing = false
        }
    }

    /**
     * Sync disclosures for watchlist stocks and register as schedules
     */
    public async syncWatchlistSchedules(force: boolean = false) {
        const apiKey = this.getApiKey()
        if (!apiKey) return

        const now = Date.now()
        const lastSyncTime = store.get('dart_last_watchlist_sync') as number || 0
        const diffMin = (now - lastSyncTime) / (1000 * 60)

        if (!force) {
            const kstDay = new Date(now + (9 * 60 * 60 * 1000)).getUTCDay()
            const kstHour = new Date(now + (9 * 60 * 60 * 1000)).getUTCHours()
            const isWeekend = kstDay === 0 || kstDay === 6
            const isMarketTime = !isWeekend && kstHour >= 8 && kstHour <= 17

            if (isMarketTime && diffMin < 15) return
            if (!isMarketTime && diffMin < 120) return
        }

        const symbols = store.get('watchlist_symbols') as string[] || []
        if (symbols.length === 0) return

        const dartSettings = store.get('dart_settings') as any || {}
        const options = dartSettings.options || { regular: true, major: true, exchange: true }
        const types = []
        if (options.regular) types.push('A')
        if (options.major) types.push('B')
        if (options.exchange) types.push('I')
        if (options.issue) types.push('C')

        if (types.length === 0) return

        const stockCorpMap = DatabaseService.getInstance().getCorpCodesByStockCodes(symbols)
        const corpCodes = Object.values(stockCorpMap)
        if (corpCodes.length === 0) return

        const kstDate = DatabaseService.getInstance().getKstDate();
        const todayStr = kstDate.replace(/-/g, '')
        let bgnDe = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10).replace(/-/g, '')
        const lastSyncDateStr = store.get('dart_last_sync_date') as string
        if (lastSyncDateStr && !force) {
            const lastDate = new Date(lastSyncDateStr.slice(0, 4) + '-' + lastSyncDateStr.slice(4, 6) + '-' + lastSyncDateStr.slice(6, 8))
            // Safety string for starting point
            const safetyDate = new Date(lastDate.getTime() - 1 * 24 * 60 * 60 * 1000);
            const safetyStr = DatabaseService.getInstance().getKstDate(safetyDate).replace(/-/g, '')
            if (safetyStr > bgnDe) bgnDe = safetyStr
        }
        const endDe = todayStr

        const startTime = Date.now();
        let totalStats = { sizeKb: 0, count: 0, errors: 0 };

        for (const corpCode of corpCodes) {
            const stockCode = Object.keys(stockCorpMap).find(k => stockCorpMap[k] === corpCode) || ''
            for (const type of types) {
                try {
                    await new Promise(resolve => setTimeout(resolve, 800))
                    const url = `${DART_BASE_URL}/list.json?crtfc_key=${apiKey}&corp_code=${corpCode}&bgn_de=${bgnDe}&end_de=${endDe}&pblntf_ty=${type}`
                    const res = await axios.get(url)
                    
                    totalStats.sizeKb += JSON.stringify(res.data).length / 1024;
                    totalStats.count++;

                    if (res.data.status === '000' && res.data.list) {
                        const schedulesToUpsert = res.data.list.map((item: any) => ({
                            id: `DART_${item.rcept_no}`,
                            title: `[${item.corp_name}] ${item.report_nm}`,
                            description: this.generateSmartNote(item.report_nm) || '',
                            target_date: item.rcept_dt.slice(0, 4) + '-' + item.rcept_dt.slice(4, 6) + '-' + item.rcept_dt.slice(6, 8),
                            stock_code: stockCode,
                            reminder_type: '당일',
                            is_notified: 0,
                            is_market_event: 1,
                            source: 'DART',
                            origin_id: item.rcept_no
                        }))
                        DatabaseService.getInstance().upsertSchedules(schedulesToUpsert)
                    } else if (res.data.status !== '000' && res.data.status !== '013') {
                        totalStats.errors++;
                    }
                } catch (err: any) {
                    totalStats.errors++;
                }
            }
        }

        this.ingestionManager.recordIngestion('dart_corporate_actions', 'OpenDART API', startTime, totalStats.errors === 0 ? 200 : 207, totalStats.sizeKb, totalStats.errors > 0 ? `${totalStats.errors} requests failed` : undefined);
        store.set('dart_last_watchlist_sync', now)
        store.set('dart_last_sync_date', endDe)
    }

    private generateSmartNote(title: string): string | null {
        if (title.includes('영업실적') && title.includes('잠정')) return '시장 예상치와의 괴리율을 확인하세요.'
        if (title.includes('배당')) return '배당기준일 전후 주가 흐름에 유의하세요.'
        if (title.includes('유상증자')) return '신주 발행 가액과 상장 예정일을 확인하세요.'
        if (title.includes('전환사채')) return 'CB 발행 목적과 전환가액을 확인하세요.'
        if (title.includes('추가상장')) return '신규 물량이 시장에 풀리는 날일 수 있습니다.'
        if (title.includes('공개매수')) return '매수가격과 기간을 확인하세요.'
        if (title.includes('주주총회')) return '주요 안건을 확인하세요.'
        return null
    }

    public async fetchDisclosures(corpCodes: string[], bgnDe: string, endDe: string) {
        const apiKey = this.getApiKey()
        if (!apiKey) return []
        let results = []
        for (const code of corpCodes) {
            try {
                await new Promise(resolve => setTimeout(resolve, 1500))
                const url = `${DART_BASE_URL}/list.json?crtfc_key=${apiKey}&corp_code=${code}&bgn_de=${bgnDe}&end_de=${endDe}&pblntf_ty=A`
                const res = await axios.get(url)
                if (res.data.status === '000' && res.data.list) results.push(...res.data.list)
            } catch (err) {}
        }
        return results
    }

    public async syncBatchFinancials(stockCodes: string[], force: boolean = false) {
        const apiKey = this.getApiKey()
        if (!apiKey) return

        const todayKey = DatabaseService.getInstance().getKstDate()
        const financialSyncLog = store.get('financial_sync_log') as Record<string, string> || {}
        const stockCodesToProcess = force ? stockCodes : stockCodes.filter(code => financialSyncLog[code] !== todayKey)

        if (stockCodesToProcess.length === 0) return

        const stockCorpMap = DatabaseService.getInstance().getCorpCodesByStockCodes(stockCodesToProcess)
        const currentYear = new Date().getFullYear()
        let processedCount = 0
        const totalCount = stockCodesToProcess.length
        
        const startTime = Date.now();
        let totalSizeKb = 0;

        for (const stockCode of stockCodesToProcess) {
            const corpCode = stockCorpMap[stockCode]
            if (!corpCode) { processedCount++; continue; }

            eventBus.emit(SystemEvent.AUTO_TRADE_LOG, { type: 'info', message: `[DART] ${stockCode} 10년 재무 데이터 수집 중... (${processedCount + 1}/${totalCount})` })

            for (let i = 0; i <= 10; i++) {
                const year = (currentYear - i).toString()
                const reportCodes = (i <= 2) ? ['11011', '11014', '11012', '11013'] : ['11011']

                for (const rCode of reportCodes) {
                    try {
                        const existing = DatabaseService.getInstance().getDb().prepare('SELECT count(*) as cnt FROM financial_data WHERE stock_code = ? AND year = ? AND reprt_code = ?').get(stockCode, year, rCode) as any
                        if (existing?.cnt > 0) continue

                        await new Promise(resolve => setTimeout(resolve, 600))
                        const url = `${DART_BASE_URL}/fnlttSinglAcntAll.json?crtfc_key=${apiKey}&corp_code=${corpCode}&bsns_year=${year}&reprt_code=${rCode}&fs_div=CFS`
                        const res = await axios.get(url)
                        totalSizeKb += JSON.stringify(res.data).length / 1024;

                        if (res.data.status === '000' && res.data.list) {
                            const financialItems = res.data.list.map((item: any) => ({
                                stock_code: stockCode, year, reprt_code: rCode, account_id: item.account_id || item.account_nm, account_nm: item.account_nm, fs_div: 'CFS', amount: parseFloat(item.thstrm_amount.replace(/,/g, '')) || 0
                            }))
                            DatabaseService.getInstance().insertFinancialData(financialItems)
                        }
                    } catch (err: any) {}
                }
            }
            processedCount++
            financialSyncLog[stockCode] = todayKey
            store.set('financial_sync_log', financialSyncLog)
        }
        
        this.ingestionManager.recordIngestion('dart_financial_statement', 'OpenDART API', startTime, 200, totalSizeKb);
        eventBus.emit(SystemEvent.AUTO_TRADE_LOG, { type: 'success', message: `[DART] ${totalCount}개 종목 데이터 수집 완료.` })
    }

    public async getDisclosuresSummaryForAi(stockCode: string): Promise<string> {
        const apiKey = this.getApiKey()
        if (!apiKey) return 'DART API 키가 없습니다.'
        const corpCodeMap = DatabaseService.getInstance().getCorpCodesByStockCodes([stockCode])
        const corpCode = corpCodeMap[stockCode]
        if (!corpCode) return '법인코드를 찾을 수 없습니다.'
        const kstDate = DatabaseService.getInstance().getKstDate();
        const todayStr = kstDate.replace(/-/g, '')
        const bgnDe = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10).replace(/-/g, '')
        const types = ['A', 'B', 'C', 'I']
        let allDisclosures: any[] = []
        for (const type of types) {
            try {
                await new Promise(resolve => setTimeout(resolve, 500))
                const res = await axios.get(`${DART_BASE_URL}/list.json?crtfc_key=${apiKey}&corp_code=${corpCode}&bgn_de=${bgnDe}&end_de=${todayStr}&pblntf_ty=${type}`)
                if (res.data.status === '000' && res.data.list) allDisclosures.push(...res.data.list)
            } catch (err) {}
        }
        if (allDisclosures.length === 0) return '최근 공시가 없습니다.'
        allDisclosures.sort((a, b) => b.rcept_dt.localeCompare(a.rcept_dt))
        return allDisclosures.slice(0, 10).map((item, idx) => `[${idx + 1}] ${item.rcept_dt.slice(4, 8)} - ${item.report_nm}`).join('\n')
    }

    public async getDisclosuresSummaryForAiWithRaw(stockCode: string): Promise<{ summary: string, items: any[] }> {
        const text = await this.getDisclosuresSummaryForAi(stockCode)
        return { summary: text, items: [] } // simplified for monitoring task
    }
}
