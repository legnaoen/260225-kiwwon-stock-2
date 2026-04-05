/**
 * P3-3: 인큐베이터 일일 neglect_score 스캔 엔진
 *
 * 매일 16:30 (전종목 OHLCV 수집 이후) 실행됩니다.
 * PM AI의 개입 없이, 수학적 지표만으로 neglect_score를 산출합니다.
 *
 * [점수 산출 공식 - 총합 100점]
 *  - 거래량 고갈 (40점): 최근 거래량이 20일 평균 대비 낮을수록 고점. 즉 "에너지 응축" 상태.
 *    volume_ratio < 0.5  → 35~40점 (강한 응축)
 *    volume_ratio < 1.0  → 20~35점 (일반 응축)
 *    volume_ratio >= 1.0 → 0~20점  (활성화 중)
 *
 *  - MA60 이격도 (30점): MA60에 가까울수록(눌림목) 고점. 음수(하락) 이격은 감점.
 *    -2% ~ +5%  이내  → 25~30점 (눌림목 구간)
 *    +5% ~ +15%      → 15~25점 (약간 올라온 상태)
 *    > +15% or < -5% → 0~10점  (너무 멀거나 하락 추세)
 *
 *  - AI 추천 이력 (30점): 과거 confidence가 높은 추천 이력이 있을수록 고점.
 *    confidence 80+  → 25~30점
 *    confidence 60+  → 15~25점
 *    없음            → 0점
 */

import { DatabaseService } from '../DatabaseService';
import { KiwoomService } from '../KiwoomService';

export class IncubatorScanEngine {
    private static instance: IncubatorScanEngine;
    private db: DatabaseService;
    private kiwoom: KiwoomService;

    private constructor() {
        this.db = DatabaseService.getInstance();
        this.kiwoom = KiwoomService.getInstance();
    }

    public static getInstance(): IncubatorScanEngine {
        if (!IncubatorScanEngine.instance) {
            IncubatorScanEngine.instance = new IncubatorScanEngine();
        }
        return IncubatorScanEngine.instance;
    }

    public async runDailyScan(): Promise<void> {
        const dateStr = this.db.getKstDate();
        console.log(`[IncubatorScan] 🔬 ${dateStr} 인큐베이터 neglect_score 스캔 시작...`);

        try {
            const watchList = this.db.getIncubatorList('WATCHING') as any[];
            const readyList = this.db.getIncubatorList('READY_TO_IGNITE') as any[];
            const targets = [...watchList, ...readyList];

            if (targets.length === 0) {
                console.log(`[IncubatorScan] ℹ️ 감시 중인 인큐베이터 종목 없음. 스캔 생략.`);
                
                this.db.saveAiExecutionLog({
                    id: `LOG-INCUBATOR-${Date.now()}`,
                    agentId: 'INCUBATOR_SCAN',
                    agentName: '인큐베이터 스캔 엔진',
                    triggerType: 'MANUAL', // or 'CRON' if called via scheduler, but we just leave 'MANUAL'/mixed here, better yet 'SYSTEM'
                    targetType: 'MARKET',
                    status: 'SUCCESS',
                    queuedAt: new Date().toISOString(),
                    startedAt: new Date().toISOString(),
                    finishedAt: new Date().toISOString(),
                    durationMs: 0,
                    error: null,
                    prompt: 'Pool B (인큐베이터) 상태 점검',
                    systemInstruction: '전종목 기술적 지표 및 수급 기반 neglect_score 산출',
                    result: '감시 중인 종목이 없어 스캔 생략'
                });
                return;
            }

            console.log(`[IncubatorScan] 총 ${targets.length}개 종목 스캔 시작...`);
            const startTime = Date.now();
            const rawDb = (this.db as any).db;

            for (const item of targets) {
                try {
                    await this.scanSingleStock(item, rawDb);
                    // API 과부하 방지
                    await new Promise(r => setTimeout(r, 300));
                } catch (e: any) {
                    console.warn(`[IncubatorScan] ${item.stock_name} 스캔 실패:`, e.message);
                }
            }

            // P3-4: IGNITE 후보 확정 및 상태 전환
            this.evaluateIgniteCandidates();

            const endTime = Date.now();
            console.log(`[IncubatorScan] ✅ 인큐베이터 스캔 완료 (${targets.length}개 처리)`);

            this.db.saveAiExecutionLog({
                id: `LOG-INCUBATOR-${Date.now()}`,
                agentId: 'INCUBATOR_SCAN',
                agentName: '인큐베이터 스캔 엔진',
                triggerType: 'MANUAL', 
                targetType: 'MARKET',
                status: 'SUCCESS',
                queuedAt: new Date(startTime).toISOString(),
                startedAt: new Date(startTime).toISOString(),
                finishedAt: new Date(endTime).toISOString(),
                durationMs: endTime - startTime,
                error: null,
                prompt: `Pool B (인큐베이터) ${targets.length}개 종목 스캔 및 상태(IGNITE/DROP) 판정`,
                systemInstruction: '차트 기반 거래량 감소(volume_ratio), MA60 눌림목을 활용한 소외 지수(neglect_score) 자동 채점',
                result: `총 ${targets.length}개 종목 스캔, neglect_score 갱신 완료`
            });

        } catch (e: any) {
            console.error(`[IncubatorScan] 스캔 중 오류:`, e);
            this.db.saveAiExecutionLog({
                id: `LOG-INCUBATOR-${Date.now()}-ERR`,
                agentId: 'INCUBATOR_SCAN',
                agentName: '인큐베이터 스캔 엔진',
                triggerType: 'MANUAL', 
                targetType: 'MARKET',
                status: 'FAILED',
                queuedAt: new Date().toISOString(),
                startedAt: new Date().toISOString(),
                finishedAt: new Date().toISOString(),
                durationMs: 0,
                error: String(e.message || e),
                prompt: 'Pool B (인큐베이터) 상태 점검',
                systemInstruction: '전종목 타점 산출',
                result: '네트워크 또는 데이터베이스 연산 오류'
            });
        }
    }

    private async scanSingleStock(item: any, rawDb: any): Promise<void> {
        const stockCode = item.stock_code;
        const stockName = item.stock_name;

        // 1. 현재가 + 차트 데이터 조회
        let currentPrice = item.current_price || 0;
        let volumeRatio = 1.0;
        let ma60Disparity = 0;

        try {
            const chartData = await this.kiwoom.getDailyChartData(stockCode, 80);
            if (chartData && chartData.length >= 20) {
                // 현재가
                const latest = chartData[0];
                currentPrice = Math.abs(parseFloat(String(latest.cur_prc || latest.prpr || latest.close || currentPrice).replace(/[^0-9-]/g, ''))) || currentPrice;

                // 거래량: 최근 5일 평균 / 20일 평균 비율
                const parsedVolumes = chartData.slice(0, 60).map((d: any) =>
                    parseInt(String(d.trde_qty || d.vol || d.volume || '0').replace(/[^0-9]/g, '')) || 0
                );
                const recentAvgVol = parsedVolumes.slice(0, 5).reduce((a: number, b: number) => a + b, 0) / 5;
                const ma20Vol = parsedVolumes.slice(0, 20).reduce((a: number, b: number) => a + b, 0) / 20;
                volumeRatio = ma20Vol > 0 ? recentAvgVol / ma20Vol : 1.0;

                // MA60 이격도
                if (chartData.length >= 60) {
                    const prices = chartData.slice(0, 60).map((d: any) =>
                        Math.abs(parseFloat(String(d.cur_prc || d.prpr || d.close || '0').replace(/[^0-9-]/g, ''))) || 0
                    );
                    const ma60 = prices.reduce((a: number, b: number) => a + b, 0) / 60;
                    ma60Disparity = ma60 > 0 ? ((currentPrice - ma60) / ma60) * 100 : 0;
                }
            }
        } catch (e) {
            console.warn(`[IncubatorScan] ${stockName} 차트 데이터 조회 실패`);
        }

        // 2. AI 추천 이력에서 최고 confidence 조회
        let maxConfidence = 0;
        try {
            const pick = rawDb.prepare(`
                SELECT MAX(confidence) as max_conf FROM ai_analyst_picks
                WHERE stock_code = ?
            `).get(stockCode) as any;
            maxConfidence = pick?.max_conf || 0;
        } catch { /* ignore */ }

        // 3. neglect_score 산출
        const neglectScore = this.calculateNeglectScore(volumeRatio, ma60Disparity, maxConfidence);

        // 4. DB 갱신
        this.db.updateIncubatorScore(stockCode, {
            current_price: currentPrice,
            neglect_score: neglectScore,
            volume_ratio: Math.round(volumeRatio * 100) / 100,
            ma60_disparity: Math.round(ma60Disparity * 100) / 100
        });

        console.log(`[IncubatorScan] 📊 ${stockName}: score=${neglectScore} | vol_ratio=${volumeRatio.toFixed(2)} | MA60_gap=${ma60Disparity.toFixed(1)}%`);
    }

    /**
     * P3-3: neglect_score 산출 공식
     *  - 거래량 고갈 점수 (40점): 에너지 응축 상태
     *  - MA60 이격도 점수 (30점): 눌림목 구간 여부
     *  - AI 추천 이력 점수 (30점): 과거 신뢰도
     */
    private calculateNeglectScore(volumeRatio: number, ma60Disparity: number, maxConfidence: number): number {
        // (A) 거래량 고갈 점수 (낮을수록 응축 = 높은 점수)
        let volumeScore = 0;
        if (volumeRatio < 0.3) volumeScore = 40;
        else if (volumeRatio < 0.5) volumeScore = 35;
        else if (volumeRatio < 0.7) volumeScore = 28;
        else if (volumeRatio < 1.0) volumeScore = 20;
        else if (volumeRatio < 1.5) volumeScore = 10;
        else volumeScore = 0;

        // (B) MA60 이격도 점수 (눌림목 구간일수록 높은 점수)
        let maScore = 0;
        if (ma60Disparity >= -2 && ma60Disparity <= 5) maScore = 30;       // 눌림목 핵심 구간
        else if (ma60Disparity > 5 && ma60Disparity <= 10) maScore = 22;
        else if (ma60Disparity > 10 && ma60Disparity <= 20) maScore = 12;
        else if (ma60Disparity >= -5 && ma60Disparity < -2) maScore = 15;  // 약간 하락, 반등 여지
        else if (ma60Disparity < -5) maScore = 3;                           // 하락 추세 경고
        else maScore = 5;

        // (C) AI 추천 이력 점수
        let historyScore = 0;
        if (maxConfidence >= 85) historyScore = 30;
        else if (maxConfidence >= 70) historyScore = 22;
        else if (maxConfidence >= 60) historyScore = 15;
        else if (maxConfidence > 0) historyScore = 8;
        else historyScore = 0;

        return Math.min(100, volumeScore + maScore + historyScore);
    }

    /**
     * P3-4: neglect_score 기준으로 IGNITE 후보 상태 전환
     * score >= 80 → READY_TO_IGNITE
     * score < 20 이고 60일 이상 감시 → DROPPED (테마 소멸)
     */
    private evaluateIgniteCandidates(): void {
        const rawDb = (this.db as any).db;
        const all = this.db.getIncubatorList() as any[];

        let igniteCount = 0;
        let dropCount = 0;

        for (const item of all) {
            if (item.neglect_score >= 80 && item.status !== 'READY_TO_IGNITE') {
                this.db.updateIncubatorStatus(item.stock_code, 'READY_TO_IGNITE',
                    `🔥 neglect_score ${item.neglect_score} 도달 → IGNITE 대기중`);
                igniteCount++;
                console.log(`[IncubatorScan] 🔥 IGNITE 대기: ${item.stock_name} (score: ${item.neglect_score})`);
            } else if (item.neglect_score < 15 && item.days_watched >= 60) {
                // 60일 이상 감시했는데 score도 낮으면 완전 탈락
                this.db.updateIncubatorStatus(item.stock_code, 'DROPPED',
                    `60일 초과 감시 + neglect_score ${item.neglect_score} < 15 → 테마 소멸 판정`);
                dropCount++;
                console.log(`[IncubatorScan] 💀 테마 소멸 탈락: ${item.stock_name} (${item.days_watched}일 감시)`);
            }
        }

        if (igniteCount > 0 || dropCount > 0) {
            console.log(`[IncubatorScan] 📋 평가 결과: IGNITE 대기 ${igniteCount}개, 탈락 ${dropCount}개`);
        }
    }
}
