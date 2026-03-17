import { DataProvider, IngestionResult, StandardData } from './DataProvider';
import { YahooFinanceService } from '../YahooFinanceService';
import { DatabaseService } from '../DatabaseService';

export class MacroProvider implements DataProvider {
    public readonly providerId = 'yahoo_global_macro';
    public readonly category = 'MACRO';
    private yahooService = YahooFinanceService.getInstance();
    private db = DatabaseService.getInstance();

    async fetch(options?: { symbols?: string[] }): Promise<IngestionResult> {
        const startTime = Date.now();
        const symbols = options?.symbols || ['^GSPC', 'KRW=X', '^TNX', '^N225', '000001.SS'];
        
        try {
            const results = await Promise.all(symbols.map(s => this.yahooService.getMacroIndicator(s)));
            const validResults = results.filter(r => r !== null);
            
            const standardData: StandardData[] = validResults.map(res => ({
                id: res.meta.symbol,
                source: 'Yahoo Finance',
                category: 'MACRO',
                title: `Macro Indicator: ${res.meta.symbol}`,
                content: `Latest Close: ${res.quotes[res.quotes.length - 1]?.close}`,
                timestamp: this.db.getKstTimestamp(),
                metadata: {
                    symbol: res.meta.symbol,
                    currency: res.meta.currency,
                    regularMarketPrice: res.meta.regularMarketPrice
                }
            }));

            return {
                success: true,
                data: standardData,
                stats: {
                    startTime,
                    endTime: Date.now(),
                    sizeKb: 0, // Recorded internally
                    count: validResults.length
                }
            };
        } catch (error: any) {
            return {
                success: false,
                error: error.message,
                stats: {
                    startTime,
                    endTime: Date.now(),
                    sizeKb: 0,
                    count: 0
                }
            };
        }
    }
}
