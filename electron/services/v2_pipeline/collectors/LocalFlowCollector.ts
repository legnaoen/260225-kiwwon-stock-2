import { IBaseCollector } from '../types/PipelineTypes';
import { KiwoomService } from '../../KiwoomService';

export class LocalFlowCollector implements IBaseCollector {
    private kiwoom = KiwoomService.getInstance();

    public async collect(options?: { forceFetch?: boolean }): Promise<any> {
        try {
            // 현재 한국 시간(KST) 및 장 상태 판별
            const now = new Date();
            const utcTime = now.getTime() + (now.getTimezoneOffset() * 60000);
            const kstTime = new Date(utcTime + (9 * 60 * 60 * 1000));
            const hour = kstTime.getHours();
            const minute = kstTime.getMinutes();
            const dayOfWeek = kstTime.getDay();

            let marketStatus = '당일 실시간';
            if (dayOfWeek === 0 || dayOfWeek === 6) {
                marketStatus = '주말(휴장) 직전 장마감 기준';
            } else if (hour < 9) {
                marketStatus = '장 개장 전 (직전 영업일 장마감 기준)';
            } else if (hour > 15 || (hour === 15 && minute >= 30)) {
                marketStatus = '오늘 장마감 기준';
            } else {
                marketStatus = '오늘 장중 실시간 진행 중';
            }

            const flowData: any[] = [];

            // KRX 표준 업종코드 리스트
            const sectorCodes = this.kiwoom.getSectorCodes();

            // 각 업종에 대해 ka20002 (업종별주가요청) 순차 호출
            // Rate Limit 방어를 위해 주요 15개만 조회
            const targetSectors = sectorCodes.slice(0, 15);

            for (let i = 0; i < targetSectors.length; i++) {
                const sector = targetSectors[i];
                try {
                    const raw = await this.kiwoom.getSectorDetail(sector.code, '0');

                    // 첫 번째 업종에서만 디버그 로그
                    if (i === 0) {
                        console.log('[LocalFlowCollector] ka20002 응답 키:', Object.keys(raw || {}));
                        for (const key of Object.keys(raw || {})) {
                            if (Array.isArray(raw[key]) && raw[key].length > 0) {
                                console.log(`[LocalFlowCollector] ka20002 배열 키: '${key}' (${raw[key].length}건)`);
                                console.log('[LocalFlowCollector] ka20002 첫 항목:', JSON.stringify(raw[key][0]));
                                break;
                            }
                        }
                        // 비배열 데이터도 확인
                        for (const key of Object.keys(raw || {})) {
                            if (!Array.isArray(raw[key]) && typeof raw[key] !== 'string') {
                                console.log(`[LocalFlowCollector] ka20002 기타 키 '${key}':`, JSON.stringify(raw[key]).slice(0, 200));
                            }
                        }
                    }

                    // ka20002 응답 구조: { inds_stkpc: [{stk_cd, stk_nm, cur_prc, flu_rt, ...}, ...] }
                    // inds_stkpc = 해당 업종의 구성종목 리스트 (100건)
                    let sectorChangeRate = 0;
                    let constituents: any[] = [];

                    if (raw) {
                        // 배열 키 'inds_stkpc'에서 구성종목 추출
                        const stockList: any[] = raw?.inds_stkpc ?? [];
                        
                        if (stockList.length > 0) {
                            // 구성종목 top 10
                            constituents = stockList.slice(0, 10).map((s: any) => ({
                                code: s.stk_cd || '',
                                name: s.stk_nm || '',
                                changeRate: parseFloat(s.flu_rt || '0'),
                                price: (s.cur_prc || '').replace(/[^0-9]/g, '')
                            }));

                            // 업종 등락률 = 구성종목 등락률의 평균
                            const rates = stockList.map((s: any) => parseFloat(s.flu_rt || '0')).filter((r: number) => !isNaN(r));
                            if (rates.length > 0) {
                                sectorChangeRate = rates.reduce((a: number, b: number) => a + b, 0) / rates.length;
                            }
                        }
                    }

                    flowData.push({
                        type: 'SECTOR',
                        name: sector.name,
                        sectorCode: sector.code,
                        changeRate: sectorChangeRate,
                        constituents: constituents,
                        totalStocks: raw?.inds_stkpc?.length || 0,
                    });

                } catch (err: any) {
                    console.warn(`[LocalFlowCollector] ka20002 조회 실패 (${sector.name}):`, err.message);
                    flowData.push({
                        type: 'SECTOR',
                        name: sector.name,
                        sectorCode: sector.code,
                        changeRate: 0,
                        constituents: [],
                        totalStocks: 0,
                    });
                }
            }

            console.log(`[LocalFlowCollector] 업종 수집 완료: ${flowData.length}개 업종`);

            return { 
                flows: flowData, 
                timestamp: now.toISOString(),
                targetDateStr: now.toLocaleDateString('ko-KR'),
                marketStatus 
            };

        } catch (error: any) {
            console.error('[LocalFlowCollector] Pipeline Error:', error);
            return { flows: [], timestamp: new Date().toISOString(), targetDateStr: '에러', marketStatus: '수집 실패', error: error.message };
        }
    }
}
