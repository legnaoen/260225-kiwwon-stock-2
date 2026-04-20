import { KiwoomService } from '../../KiwoomService';
import { DatabaseService } from '../../DatabaseService';

export class FundamentalCollector {
    public async collect(options?: { keyword?: string; forceFetch?: boolean }): Promise<any> {
        const stk_cd = options?.keyword?.trim() || '005930'; // 기본값 삼성전자
        const cacheKey = `pl_fundamental_${stk_cd}`;
        const db = DatabaseService.getInstance();

        // 1. 캐시 시스템 확인 (강제 수집 옵션이 아닐 때)
        if (!options?.forceFetch) {
            const cachedData = db.getPipelineCache(cacheKey, 24); // 신용비율 등 펀더멘털은 하루 1번 갱신이면 충분함 (24시간 유효)
            if (cachedData) {
                console.log(`[FundamentalCollector] Serving cached data for ${stk_cd}`);
                return cachedData;
            }
        }

        try {
            // 2. 키움 API 호출
            const data = await KiwoomService.getInstance().getFundamentalInfo(stk_cd);
            
            // 3. DB에 캐시 저장
            db.setPipelineCache(cacheKey, data);

            return data;
        } catch (error: any) {
            console.error(`[FundamentalCollector] Error fetching data for ${stk_cd}:`, error);
            throw error;
        }
    }
}
