import { DataProvider, IngestionResult, StandardData } from './DataProvider';
import { DartApiService } from '../DartApiService';
import { DatabaseService } from '../DatabaseService';

export class DisclosureProvider implements DataProvider {
    public readonly providerId = 'dart_corporate_actions';
    public readonly category = 'FINANCIAL';
    private dartService = DartApiService.getInstance();
    private db = DatabaseService.getInstance();

    async fetch(options?: { force?: boolean }): Promise<IngestionResult> {
        const startTime = Date.now();
        
        try {
            // DART API service logic already records to ingestionManager inside
            // but we wrap it for the standardized interface
            await this.dartService.syncWatchlistSchedules(options?.force || false);
            
            // Note: DartApiService currently returns processed schedules, 
            // In a full refactor, it should return StandardData[].
            // For now, we fetch the recently generated schedules to return them.
            
            const schedules = this.db.getAllSchedules();
            const recentSchedules = schedules.filter((s: any) => 
                s.source === 'DART' && 
                new Date(s.target_date) >= new Date(Date.now() - 24 * 60 * 60 * 1000)
            );

            const standardData: StandardData[] = recentSchedules.map((s: any) => ({
                id: s.id,
                source: 'DART',
                category: 'FINANCIAL',
                title: s.title,
                content: s.description,
                timestamp: this.db.getKstTimestamp(new Date(s.target_date)),
                metadata: {
                    stock_code: s.stock_code,
                    origin_id: s.origin_id
                }
            }));

            return {
                success: true,
                data: standardData,
                stats: {
                    startTime,
                    endTime: Date.now(),
                    sizeKb: 0, // DART service records its own stats
                    count: standardData.length
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
