import axios from 'axios'
import { DatabaseService } from './DatabaseService'
import { IngestionManager } from './IngestionManager'

export class YahooFinanceService {
    private static instance: YahooFinanceService
    private db = DatabaseService.getInstance()
    private get ingestionManager() {
        return IngestionManager.getInstance()
    }

    // Cache TTL (Time to Live) in milliseconds: e.g., 24 hours
    private readonly CACHE_TTL_MS = 24 * 60 * 60 * 1000

    // Typical Browser-like User-Agent to avoid blocking
    private readonly USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

    private constructor() { }

    public static getInstance(): YahooFinanceService {
        if (!YahooFinanceService.instance) {
            YahooFinanceService.instance = new YahooFinanceService()
        }
        return YahooFinanceService.instance
    }

    /**
     * Get historical monthly rates for 10 years
     * Directly calls Yahoo Finance v8 Chart API
     */
    public async getHistoricalRates(code: string, marketType: 'KOSPI' | 'KOSDAQ' | 'OTHER' | string): Promise<any | null> {
        if (!marketType || marketType === 'OTHER') {
            console.log(`[YahooFinanceService] Unsupported market type for ${code}`)
            return null
        }

        const suffix = marketType.includes('KOSPI') ? '.KS' : marketType.includes('KOSDAQ') ? '.KQ' : ''
        if (!suffix) return null

        const symbol = `${code}${suffix}`

        // 1. Check Cache First
        const cached = this.db.getYahooFinanceCache(symbol)
        if (cached && cached.historical_data) {
            const updatedAt = new Date(cached.updated_at).getTime()
            if (Date.now() - updatedAt < this.CACHE_TTL_MS) {
                console.log(`[YahooFinanceService] Returning cached historical data for ${symbol}`)
                try {
                    return JSON.parse(cached.historical_data)
                } catch (e) {
                    console.error(`[YahooFinanceService] Cache parse error for ${symbol}`, e)
                }
            }
        }

        const startTime = Date.now();
        // 2. Fetch via Direct API Call (Yahoo v8 Chart)
        try {
            console.log(`[YahooFinanceService] Fetching historical data from Yahoo API for ${symbol}...`)
            const now = Math.floor(Date.now() / 1000)
            const tenYearsAgo = now - (10 * 365 * 24 * 60 * 60)

            // Interval: 1mo (Monthly), Period: 10 years
            const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?period1=${tenYearsAgo}&period2=${now}&interval=1mo`

            const response = await axios.get(url, {
                headers: { 'User-Agent': this.USER_AGENT },
                timeout: 5000
            })

            const dataSizeKb = JSON.stringify(response.data).length / 1024;

            if (response.data && response.data.chart && response.data.chart.result) {
                const result = response.data.chart.result[0]

                // Map to a consistent format
                const mappedData = {
                    meta: result.meta,
                    quotes: result.timestamp.map((ts: number, i: number) => ({
                        date: new Date(ts * 1000).toISOString(),
                        close: result.indicators.quote[0].close[i],
                        open: result.indicators.quote[0].open[i],
                        high: result.indicators.quote[0].high[i],
                        low: result.indicators.quote[0].low[i],
                        volume: result.indicators.quote[0].volume[i]
                    })).filter((q: any) => q.close !== null)
                }

                // 3. Save to Cache
                this.db.saveYahooFinanceCache(symbol, JSON.stringify(mappedData))
                
                // Record Ingestion (using individual symbol for granularity or generic key)
                this.ingestionManager.recordIngestion('yahoo_historical_stock', 'Yahoo Finance', startTime, 200, dataSizeKb);

                return mappedData
            }

            this.ingestionManager.recordIngestion('yahoo_historical_stock', 'Yahoo Finance', startTime, 404, 0, 'No data in result');
            return null
        } catch (error: any) {
            console.error(`[YahooFinanceService] API Fetch Failed (${symbol}):`, error.message)
            this.ingestionManager.recordIngestion('yahoo_historical_stock', 'Yahoo Finance', startTime, error.response?.status || 500, 0, error.message);
            return null
        }
    }

    /**
     * Fetch Macro Indicators (e.g. ^GSPC, KRW=X, ^TNX)
     */
    public async getMacroIndicator(symbol: string): Promise<any | null> {
        const cached = this.db.getYahooMacroCache(symbol)
        if (cached && cached.macro_data) {
            const updatedAt = new Date(cached.updated_at).getTime()
            if (Date.now() - updatedAt < this.CACHE_TTL_MS) {
                console.log(`[YahooFinanceService] Returning cached macro data for ${symbol}`)
                try {
                    return JSON.parse(cached.macro_data)
                } catch (e) {
                    // fallthrough
                }
            }
        }

        const startTime = Date.now();
        try {
            console.log(`[YahooFinanceService] Fetching macro data from Yahoo API for ${symbol}...`)
            const now = Math.floor(Date.now() / 1000)
            const oneYearAgo = now - (365 * 24 * 60 * 60)

            const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?period1=${oneYearAgo}&period2=${now}&interval=1d`

            const response = await axios.get(url, {
                headers: { 'User-Agent': this.USER_AGENT },
                timeout: 5000
            })

            const dataSizeKb = JSON.stringify(response.data).length / 1024;

            if (response.data && response.data.chart && response.data.chart.result) {
                const result = response.data.chart.result[0]

                const mappedData = {
                    meta: result.meta,
                    quotes: result.timestamp.map((ts: number, i: number) => ({
                        date: new Date(ts * 1000).toISOString(),
                        close: result.indicators.quote[0].close[i]
                    })).filter((q: any) => q.close !== null)
                }

                this.db.saveYahooMacroCache(symbol, JSON.stringify(mappedData))
                
                this.ingestionManager.recordIngestion('yahoo_global_macro', 'Yahoo Finance', startTime, 200, dataSizeKb);
                
                return mappedData
            }
            this.ingestionManager.recordIngestion('yahoo_global_macro', 'Yahoo Finance', startTime, 404, 0, 'No data in result');
            return null
        } catch (error: any) {
            console.error(`[YahooFinanceService] Macro API Fetch Failed (${symbol}):`, error.message)
            this.ingestionManager.recordIngestion('yahoo_global_macro', 'Yahoo Finance', startTime, error.response?.status || 500, 0, error.message);
            return null
        }
    }
}
