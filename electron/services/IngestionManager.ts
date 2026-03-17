import { DatabaseService } from './DatabaseService'
import { DataProvider, IngestionResult } from './adapters/DataProvider'
import { NewsProvider } from './adapters/NewsProvider'
import { DisclosureProvider } from './adapters/DisclosureProvider'
import { YoutubeProvider } from './adapters/YoutubeProvider'
import { MacroProvider } from './adapters/MacroProvider'

export interface IngestionTask {
    data_key: string
    source_api: string
    category: 'NEWS' | 'MACRO' | 'FINANCIAL' | 'MARKET' | 'PRICE' | 'SYSTEM'
    refresh_interval_sec: number
}

export class IngestionManager {
    private static instance: IngestionManager
    private db = DatabaseService.getInstance()
    private providers: Map<string, DataProvider> = new Map()

    private constructor() {
        IngestionManager.instance = this
        this.initInventory()
        this.registerDefaultProviders()
    }

    public static getInstance() {
        if (!IngestionManager.instance) {
            IngestionManager.instance = new IngestionManager()
        }
        return IngestionManager.instance
    }

    private registerDefaultProviders() {
        this.registerProvider(new NewsProvider())
        this.registerProvider(new DisclosureProvider())
        this.registerProvider(new YoutubeProvider())
        this.registerProvider(new MacroProvider())
    }

    public registerProvider(provider: DataProvider) {
        this.providers.set(provider.providerId, provider)
        console.log(`[IngestionManager] Registered provider: ${provider.providerId}`)
    }

    private initInventory() {
        // Essential MAIIS feeds initialization
        const initialTasks: IngestionTask[] = [
            { data_key: 'naver_news_top50', source_api: 'Naver Open API', category: 'NEWS', refresh_interval_sec: 86400 },
            { data_key: 'yahoo_global_macro', source_api: 'Yahoo Finance', category: 'MACRO', refresh_interval_sec: 86400 },
            { data_key: 'yahoo_historical_stock', source_api: 'Yahoo Finance', category: 'PRICE', refresh_interval_sec: 86400 },
            { data_key: 'dart_corporate_actions', source_api: 'OpenDART API', category: 'FINANCIAL', refresh_interval_sec: 86400 },
            { data_key: 'dart_corp_codes', source_api: 'OpenDART API', category: 'SYSTEM', refresh_interval_sec: 604800 },
            { data_key: 'dart_financial_statement', source_api: 'OpenDART API', category: 'FINANCIAL', refresh_interval_sec: 86400 * 30 },
            { data_key: 'kiwoom_daily_master', source_api: 'Kiwoom REST API', category: 'MARKET', refresh_interval_sec: 86400 },
            { data_key: 'kiwoom_sector_performance', source_api: 'Kiwoom REST API', category: 'MARKET', refresh_interval_sec: 3600 },
            { data_key: 'kiwoom_sector_flow', source_api: 'Kiwoom REST API', category: 'MARKET', refresh_interval_sec: 3600 },
            { data_key: 'youtube_narrative', source_api: 'YouTube Collector', category: 'NEWS', refresh_interval_sec: 86400 },
        ]

        const existing = this.db.getMaiisInventory() || []
        for (const task of initialTasks) {
            const isExist = existing.some((r: any) => r.data_key === task.data_key)
            if (!isExist) {
                this.db.upsertMaiisInventory({
                    ...task,
                    last_freshness_at: this.db.getKstTimestamp(new Date(0)),
                    next_check_at: this.db.getKstTimestamp(),
                    status: 'IDLE',
                    meta_json: {}
                })
            }
        }
    }

    /**
     * Trigger a manual sync for a specific provider
     */
    public async triggerSync(providerId: string, options?: any) {
        const provider = this.providers.get(providerId)
        if (!provider) {
            throw new Error(`Provider not found: ${providerId}`)
        }

        console.log(`[IngestionManager] Triggering sync for ${providerId}...`)
        
        // Update status to RUNNING
        this.updateItemStatus(providerId, 'RUNNING')

        try {
            const result: IngestionResult = await provider.fetch(options)
            
            if (result.success) {
                this.recordIngestion(
                    providerId, 
                    provider.providerId, 
                    result.stats.startTime, 
                    200, 
                    result.stats.sizeKb
                )
                this.markAsSuccess(providerId)
                return { success: true, count: result.stats.count }
            } else {
                this.recordIngestion(
                    providerId, 
                    provider.providerId, 
                    result.stats.startTime, 
                    500, 
                    0, 
                    result.error
                )
                this.updateItemStatus(providerId, 'ERROR')
                return { success: false, error: result.error }
            }
        } catch (e: any) {
            this.updateItemStatus(providerId, 'ERROR')
            return { success: false, error: e.message }
        }
    }

    private updateItemStatus(dataKey: string, status: 'IDLE' | 'RUNNING' | 'SUCCESS' | 'ERROR') {
        const inventory = this.db.getMaiisInventory() || []
        const item = inventory.find((r: any) => r.data_key === dataKey)
        if (item) {
            this.db.upsertMaiisInventory({
                ...item,
                status
            })
        }
    }

    /**
     * API 요청 직후 결과를 기록하고 인벤토리 상태를 업데이트합니다.
     */
    public async recordIngestion(dataKey: string, apiName: string, startTime: number, statusCode: number, sizeKb: number, errorMsg?: string) {
        const latency = Date.now() - startTime
        
        this.db.recordIngestionStat({
            data_key: dataKey,
            api_name: apiName,
            latency_ms: latency,
            status_code: statusCode,
            data_size_kb: sizeKb,
            error_msg: errorMsg
        })

        console.log(`[IngestionManager] Recorded ${dataKey} from ${apiName} (Status: ${statusCode}, Latency: ${latency}ms)`)
    }

    public getInventory() {
        return this.db.getMaiisInventory()
    }

    public getRecentStats(limit = 100) {
        return this.db.getRecentMaiisStats(limit)
    }

    /**
     * 특정 데이터 키의 상태를 'SUCCESS'로 수동 업데이트하고 신선도를 갱신합니다.
     */
    public markAsSuccess(dataKey: string) {
        const inventory = this.db.getMaiisInventory() || []
        const item = inventory.find((r: any) => r.data_key === dataKey)
        if (item) {
            this.db.upsertMaiisInventory({
                ...item,
                status: 'SUCCESS',
                last_freshness_at: this.db.getKstTimestamp(),
                next_check_at: this.db.getKstTimestamp(new Date(Date.now() + item.refresh_interval_sec * 1000))
            })
        }
    }
}
