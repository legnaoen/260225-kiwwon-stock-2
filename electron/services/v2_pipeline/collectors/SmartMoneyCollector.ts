import { KiwoomService } from '../../KiwoomService';
import { DatabaseService } from '../../DatabaseService';

export class SmartMoneyCollector {
    public async collect(options?: { keyword?: string; forceFetch?: boolean }): Promise<any> {
        const stk_cd = options?.keyword?.trim() || '005930'; // 기본값 삼성전자
        const cacheKey = `pl_smartmoney_${stk_cd}`;
        const db = DatabaseService.getInstance();
        
        // 1. 캐시 시스템 확인 (강제 수집 옵션이 아닐 때)
        if (!options?.forceFetch) {
            const cachedData = db.getPipelineCache(cacheKey, 1); // 1시간 유효 (장중 업데이트 반영)
            if (cachedData) {
                console.log(`[SmartMoneyCollector] Serving cached data for ${stk_cd}`);
                return cachedData;
            }
        }

        try {
            // 2. 키움 API 호출
            const data = await KiwoomService.getInstance().getSmartMoneyFlow(stk_cd);
            
            const result = {
                stk_cd,
                flowData: data
            };

            // 3. DB에 캐시 저장
            db.setPipelineCache(cacheKey, result);

            return result;
        } catch (error: any) {
            console.error(`[SmartMoneyCollector] Error fetching data for ${stk_cd}:`, error);
            throw error;
        }
    }
}
