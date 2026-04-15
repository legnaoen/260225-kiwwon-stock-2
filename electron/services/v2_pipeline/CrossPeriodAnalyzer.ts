import { DatabaseService } from '../DatabaseService';
import {
    MarketLeaderDiscoveryService,
    MarketLeaderItem,
    PeakoutSettings,
    DEFAULT_PEAKOUT_SETTINGS,
} from './MarketLeaderDiscoveryService';
import { getPastDateKst } from '../../utils/DateUtils';

// ────────────────────────────────────────────────────────────
// 타입 정의
// ────────────────────────────────────────────────────────────

export type CrossCategory =
    | 'EXHAUSTED'
    | 'TRUE_LEADER'
    | 'EMERGING_STAR'
    | 'PULLBACK_REBOUND'
    | 'PULLBACK_DIP'
    | 'INTRADAY_SURGE'
    | 'SHORT_TERM_CONSOLIDATION'
    | 'UNCLASSIFIED';

/** 시그널: 주 카테고리와 독립적으로 복수 부여 가능한 보조 특성 */
export type CrossSignal =
    | 'RANK_CLIMBER'       // 순위 꾸준 상승 구서 (5일 단위 선형회귀)
    | 'HIGH_CONSISTENCY'   // 10일 6구간 중 4구간 이상 LEADER
    | 'BREAKOUT_CANDIDATE' // 최근 2구간 연속 LEADER 진입
    | 'VOLUME_SURGE';      // 5d 거래대금 > 20d 대비 2배 이상

export interface SegmentSlot {
    index: number;         // 1~6 (10일 단위)
    phase: 'LEADER' | 'CANDIDATE' | 'NONE';
    alpha: number;
}

export interface RankSlot {
    index: number;         // 1~12 (5일 단위)
    rank: number;          // 전체 종목 중 순위 (낮을수록 상위)
    percentile: number;    // 상위 몇 % (0=1등, 100=꼴등)
    alpha: number;
}

export interface SegmentProfile {
    // 5일 단위: RANK_CLIMBER 감지용
    rankTrajectory: RankSlot[];
    rankSlope: number;         // 선형회귀 기울기 (음수 = 순위 상승 중)
    rankRSquared: number;      // 일관성 (0~1)
    isRankClimber: boolean;

    // 10일 단위: 시각화용 흐름 바
    segments: SegmentSlot[];
    trend: 'EARLY_STRONG' | 'LATE_STRONG' | 'CONSISTENT' | 'RANK_RISING' | 'INCONSISTENT';
    consistencyScore: number;  // LEADER 구간 수 / 전체 구간 수
}

export interface CrossPeriodCandidate {
    stockCode: string;
    stockName: string;
    relatedThemes: string[];
    category: CrossCategory;
    signals: CrossSignal[];    // 보조 시그널 (복수 관독 가능)
    convictionScore: number;
    reason: string;

    // 4기간 프로필
    period_5d: MarketLeaderItem;
    period_10d: MarketLeaderItem;
    period_20d: MarketLeaderItem;
    period_60d: MarketLeaderItem;

    // 세그먼트 분석
    segmentProfile: SegmentProfile;
}

export interface CrossPeriodResult {
    success: boolean;
    candidates: CrossPeriodCandidate[];
    themes: { theme: string; count: number }[];
    stats: {
        total: number;
        byCategory: Record<CrossCategory, number>;
    };
    error?: string;
}

// ────────────────────────────────────────────────────────────
// CrossPeriodAnalyzer 서비스
// ────────────────────────────────────────────────────────────

export class CrossPeriodAnalyzer {
    private static instance: CrossPeriodAnalyzer;
    private svc: MarketLeaderDiscoveryService;
    private db: DatabaseService;

    private constructor() {
        this.svc = MarketLeaderDiscoveryService.getInstance();
        this.db = DatabaseService.getInstance();
    }

    public static getInstance(): CrossPeriodAnalyzer {
        if (!CrossPeriodAnalyzer.instance) {
            CrossPeriodAnalyzer.instance = new CrossPeriodAnalyzer();
        }
        return CrossPeriodAnalyzer.instance;
    }

    // ─── 메인 진입점 ─────────────────────────────────────────

    public getCrossPeriodProfile(
        topN: number = 50,
        peakoutSettings: PeakoutSettings = DEFAULT_PEAKOUT_SETTINGS,
    ): CrossPeriodResult {
        try {
            // 1. KODEX200 시장 지수 변동률 계산 (4기간용)
            const mkts = this.calcMarketChanges([5, 10, 20, 60]);

            // 2. 4개 기간 동시 조회 (기존 서비스 재활용)
            const leaders5 = this.svc.getMarketLeaders(5, mkts[5], 300, peakoutSettings);
            const leaders10 = this.svc.getMarketLeaders(10, mkts[10], 300, peakoutSettings);
            const leaders20 = this.svc.getMarketLeaders(20, mkts[20], 300, peakoutSettings);
            const leaders60 = this.svc.getMarketLeaders(60, mkts[60], 300, peakoutSettings);

            // 3. 종목 코드 유니온
            const allCodes = new Set([
                ...leaders5.map(l => l.stockCode),
                ...leaders10.map(l => l.stockCode),
                ...leaders20.map(l => l.stockCode),
                ...leaders60.map(l => l.stockCode),
            ]);

            // 4. 종목별 맵 구성 (O(1) 조회)
            const map5 = new Map(leaders5.map(l => [l.stockCode, l]));
            const map10 = new Map(leaders10.map(l => [l.stockCode, l]));
            const map20 = new Map(leaders20.map(l => [l.stockCode, l]));
            const map60 = new Map(leaders60.map(l => [l.stockCode, l]));

            // 5. 60일 OHLCV 원본 데이터 로드 (세그먼트 분석용, 1회만)
            const ohlcv60 = this.load60dOhlcv();

            // 6. 전 종목 중 60일 기간의 총 유효종목 수 파악 (랭크 계산 기준)
            const totalStocks = ohlcv60.size;

            // [거래정지 종목 필터링 로직 추가]
            // 전체 시장 OHLCV 중 '가장 최근 거래일(today)'을 추출
            let latestMarketDate = '';
            for (const rows of ohlcv60.values()) {
                if (rows.length > 0 && rows[rows.length - 1].date > latestMarketDate) {
                    latestMarketDate = rows[rows.length - 1].date;
                }
            }

            // allCodes(5/10/20/60일 리더 후보) 중 현재 거래정지 상태인 종목 파기
            for (const code of Array.from(allCodes)) {
                const rows = ohlcv60.get(code);
                if (!rows || rows.length === 0) {
                    allCodes.delete(code);
                    continue;
                }
                const lastRow = rows[rows.length - 1];
                // 1) 오늘 날짜 데이터 누락 (상장폐지 등)
                // 2) 오늘 거래대금 0 (거래정지)
                if (lastRow.date !== latestMarketDate || !lastRow.tradingValue || lastRow.tradingValue === 0) {
                    allCodes.delete(code);
                }
            }

            // 7. 종목별 세그먼트 프로파일 생성 (5일×12 + 10일×6)
            const segMap = this.buildAllSegmentProfiles(ohlcv60, mkts, totalStocks);

            // 8. 카테고리 분류 + 추천도 산정
            const candidates: CrossPeriodCandidate[] = [];

            for (const code of allCodes) {
                const p5 = map5.get(code);
                const p10 = map10.get(code);
                const p20 = map20.get(code);
                const p60 = map60.get(code);

                // 4기간 모두 없는 종목은 제외 (데이터 부족)
                if (!p5 && !p10 && !p20 && !p60) continue;

                // 없는 기간은 실제 OHLCV에서 알파 계산 (nullProfile의 0% 표시 문제 해결)
                const ohlcvRows = ohlcv60.get(code);
                const safe5 = p5 ?? this.liteProfile(code, ohlcvRows, 5, mkts[5]);
                const safe10 = p10 ?? this.liteProfile(code, ohlcvRows, 10, mkts[10]);
                const safe20 = p20 ?? this.liteProfile(code, ohlcvRows, 20, mkts[20]);
                const safe60 = p60 ?? this.liteProfile(code, ohlcvRows, 60, mkts[60]);

                const stockName = [p5, p10, p20, p60]
                    .filter((p): p is MarketLeaderItem => !!p && p.stockName !== p.stockCode)
                    .map(p => p.stockName)[0] ?? code;
                const themes = Array.from(new Set([
                    ...safe5.relatedThemes,
                    ...safe10.relatedThemes,
                    ...safe20.relatedThemes,
                    ...safe60.relatedThemes,
                ]));

                // 5d 실제 데이터 존재 여부 (PULLBACK_DIP 가드용)
                const seg = segMap.get(code) ?? this.nullSegmentProfile();
                const has5dData = !!p5;

                const { category, convictionScore, reason } = this.classify(
                    safe5, safe10, safe20, safe60, seg, has5dData, ohlcvRows
                );

                // 시그널 연산 (category와 독립적으로, 복수 제컴 가능)
                let signals = this.computeSignals(safe5, safe10, safe20, safe60, seg);

                // 기존 대장/장기질주 종목은 순위상승형 배제
                if (category === 'TRUE_LEADER') {
                    signals = signals.filter(s => s !== 'RANK_CLIMBER');
                }

                // RANK_CLIMBER 시그널이 있으면 추청돀 가산
                const finalScore = signals.includes('RANK_CLIMBER')
                    ? convictionScore + 10 + seg.rankRSquared * 8
                    : convictionScore;

                // UNCLASSIFIED 는 topN 제한 후 필터링 → 일단 포함
                candidates.push({
                    stockCode: code,
                    stockName,
                    relatedThemes: themes,
                    category,
                    signals,
                    convictionScore: finalScore,
                    reason,
                    period_5d: safe5,
                    period_10d: safe10,
                    period_20d: safe20,
                    period_60d: safe60,
                    segmentProfile: seg,
                });
            }

            // 9. 정렬: EXHAUSTED 모소두 맞, 이외는 충실도 기준 (PRIORITY는 디스플레이 순서만, 슬라이스 기준 아님)
            const DISPLAY_ORDER: Record<CrossCategory, number> = {
                INTRADAY_SURGE: 8, SHORT_TERM_CONSOLIDATION: 7, EMERGING_STAR: 6, PULLBACK_REBOUND: 5, PULLBACK_DIP: 4,
                TRUE_LEADER: 3, EXHAUSTED: 0, UNCLASSIFIED: -1,
            };
            candidates.sort((a, b) => {
                const pd = DISPLAY_ORDER[b.category] - DISPLAY_ORDER[a.category];
                if (pd !== 0) return pd;
                return b.convictionScore - a.convictionScore;
            });

            // 10. EXHAUSTED를 뎒기고, 나머지 카테고리는 모두 포함
            //     topN은 EMERGING_STAR 안에서만 제한 (TRUE_LEADER 같은 핵심 카테고리가 슬라이스되는 문제 방지)
            const nonExhausted = candidates.filter(c => !['UNCLASSIFIED', 'EXHAUSTED'].includes(c.category));
            const exhausted = candidates.filter(c => c.category === 'EXHAUSTED');

            // EMERGING_STAR만 topN으로 제한하되, 타 카테고리가 폭증하더라도 최소 30종목(T/O)은 고정 보장되도록 방어벽 구축
            const starCapped = nonExhausted.filter(c => c.category !== 'EMERGING_STAR');
            const stars = nonExhausted.filter(c => c.category === 'EMERGING_STAR').slice(0, Math.max(30, topN - starCapped.length));
            const filtered = [...starCapped, ...stars, ...exhausted.slice(0, 5)];

            // 11. 테마 집계
            const themeCounter: Record<string, number> = {};
            filtered.forEach(c => {
                c.relatedThemes.forEach(t => { themeCounter[t] = (themeCounter[t] || 0) + 1; });
            });
            const themes = Object.entries(themeCounter)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 30)
                .map(([theme, count]) => ({ theme, count }));

            // 12. 통계
            const byCategory = {} as Record<CrossCategory, number>;
            const cats: CrossCategory[] = ['EXHAUSTED', 'TRUE_LEADER', 'INTRADAY_SURGE', 'SHORT_TERM_CONSOLIDATION', 'EMERGING_STAR', 'PULLBACK_REBOUND', 'PULLBACK_DIP', 'UNCLASSIFIED'];
            cats.forEach(c => { byCategory[c] = filtered.filter(x => x.category === c).length; });

            return { success: true, candidates: filtered, themes, stats: { total: filtered.length, byCategory } };
        } catch (err: any) {
            console.error('[CrossPeriodAnalyzer] Error:', err);
            return { success: false, candidates: [], themes: [], stats: { total: 0, byCategory: {} as any }, error: err.message };
        }
    }

    // ─── 분류 엔진 ────────────────────────────────────────────

    private classify(
        p5: MarketLeaderItem,
        p10: MarketLeaderItem,
        p20: MarketLeaderItem,
        p60: MarketLeaderItem,
        seg: SegmentProfile,
        has5dData: boolean = true,
        ohlcvRows?: { date: string; open: number; high: number; low: number; close: number; tradingValue: number }[]
    ): { category: CrossCategory; convictionScore: number; reason: string } {

        const phase5 = p5.phase;
        const phase10 = p10.phase;
        const phase20 = p20.phase;
        const phase60 = p60.phase;
        const pkLevel = p5.peakoutLevel ?? 'NONE';
        const ddp = p60.drawdownFromPeak ?? p20.drawdownFromPeak ?? p10.drawdownFromPeak ?? p5.drawdownFromPeak ?? 0;

        let paScore = 0;
        let pDipReason = '';
        let isPriceActionPullback = false;
        const isBloodlineLeader = phase60 === 'LEADER' || phase20 === 'LEADER';

        if (ohlcvRows && ohlcvRows.length >= 20) {
            const min60 = Math.min(...ohlcvRows.map(r => r.close));
            const max60 = Math.max(...ohlcvRows.map(r => r.close));
            const riseFromBottom = min60 > 0 ? ((max60 - min60) / min60) * 100 : 0;

            const recent5 = ohlcvRows.slice(-5);
            const min5 = Math.min(...recent5.map(r => r.close));
            const max5 = Math.max(...recent5.map(r => r.close));
            const volatility5 = min5 > 0 ? ((max5 - min5) / min5) * 100 : 0;
            const avgVol5 = recent5.reduce((s, r) => s + r.tradingValue, 0) / recent5.length;

            const recent20 = ohlcvRows.slice(-20);
            const avgVol20 = recent20.length > 0 ? recent20.reduce((s, r) => s + r.tradingValue, 0) / recent20.length : 0;

            // 1. 대장주 혈통 검증 (과거 한 번이라도 시장 주도주였는가)

            // [정통 Price Action 3필터 + 혈통 필터]
            // 2. 저점대비 30% 이상 급등 (대시세 이력)
            // 3. 고점대비 최소 10% 이상 하락 (확실한 가격 조정 진행)
            // 4. 최근 5일 변동성 8% 이하 및 거래량 급감 (바닥 다지기, 매도세 고갈)
            if (isBloodlineLeader && riseFromBottom >= 30 && ddp >= 10 && volatility5 <= 8 && avgVol5 < avgVol20) {
                isPriceActionPullback = true;
                pDipReason = `[정통 눌림목] 고점 대비 -${ddp.toFixed(1)}% | 5일 변동축소(${volatility5.toFixed(1)}%) 및 거래량 감소`;
                paScore = (riseFromBottom * 0.2) + (ddp * 0.5) - (volatility5 * 2);
            }
        }

        // ── 1. EXHAUSTED (위험 최우선 격리)
        const longLeader = phase60 === 'LEADER' || phase20 === 'LEADER';
        const recentNone = !phase5 && !phase10;
        if (longLeader && recentNone && pkLevel === 'CONFIRMED') {
            const score = -((p5.peakoutScore ?? 0) * 5 + ddp);
            return { category: 'EXHAUSTED', convictionScore: score, reason: this.reasonExhausted(p60, p5) };
        }
        // CONFIRMED 2기간 이상이면 EXHAUSTED (ALERT만으로는 눌림목 후보까지 흡수되는 문제 방지)
        const confirmedCount = [p5, p10, p20, p60].filter(p => (p.peakoutLevel ?? 'NONE') === 'CONFIRMED').length;
        if (confirmedCount >= 2) {
            const score = -((p5.peakoutScore ?? 0) * 5 + ddp);
            return { category: 'EXHAUSTED', convictionScore: score, reason: this.reasonExhausted(p60, p5) };
        }

        // ── 2. TRUE_LEADER (4기간 가중 랜크 점수제)
        // 공식: score = Σ (1 - rank/300) × weight × 100
        // 5d:40점 / 10d:30점 / 20d:20점 / 60d:10점 (합계 최대 100점)
        // 임계값 70점: 평균적으로 각 구간 상위 30% 이상 유지
        // → 5d=NONE이면 최대 60점(10d+20d+60d 전부 1위)\uc73c로 자동 탈락
        {
            const rankScore = (rank: number | undefined) =>
                rank != null ? Math.max(0, (300 - rank) / 300) : 0;

            const weightedScore =
                rankScore(p5.rank)  * 40 +   // 5d: 최대 40점
                rankScore(p10.rank) * 30 +   // 10d: 최대 30점
                rankScore(p20.rank) * 20 +   // 20d: 최대 20점
                rankScore(p60.rank) * 10;    // 60d: 최대 10점

            if (weightedScore >= 70) {
                let score = weightedScore - (p5.peakoutScore ?? 0) * 3;
                if (seg.consistencyScore >= 0.8) score += 5;
                return { category: 'TRUE_LEADER', convictionScore: score, reason: this.reasonTruLeader(p5, weightedScore, seg) };
            }
        }

        // ── 3. INTRADAY_SURGE (당일 급등주 종가베팅 대상)
        // 조건: 10% <= 당일 상승률 < 25%, 최소 거래대금 확보, 윗꼬리가 너무 길지 않은 방어 성공
        let intradaySurgePct = 0;
        let p3Reason = '';
        if (ohlcvRows && ohlcvRows.length >= 2) {
            const lastRow = ohlcvRows[ohlcvRows.length - 1];   // 오늘
            const prevRow = ohlcvRows[ohlcvRows.length - 2];   // 어제

            if (prevRow.close > 0) {
                intradaySurgePct = ((lastRow.close - prevRow.close) / prevRow.close) * 100;

                // 오늘 너무 심하게 고점에서 밀리지 않았는지 방어력 평가 (꼬리가 아니라 몸통상단 유지)
                const bodyTop = Math.max(lastRow.open, lastRow.close);
                const high = lastRow.high || bodyTop;
                const low = lastRow.low || Math.min(lastRow.open, lastRow.close);
                const range = high - low;
                // 현재가가 저가 대비 최소 60% 이상 위치에 방어 중
                const closePositionRatio = range > 0 ? (lastRow.close - low) / range : 1.0;

                // 거래대금 최소조건: 오늘 300억 이상이거나 평균 대비 폭증
                const hasVolumeSpike = lastRow.tradingValue >= 30000000000 || (lastRow.tradingValue > (p5.avgTradingValue * 2));

                if (intradaySurgePct >= 10 && intradaySurgePct <= 24.9 && closePositionRatio >= 0.5 && hasVolumeSpike) {
                    p3Reason = `[당일 급등] 전일비 +${intradaySurgePct.toFixed(1)}% 슈팅 | 윗꼬리 방어 (${(closePositionRatio * 100).toFixed(0)}%) | 대량 수급 포착`;
                    let paScore = intradaySurgePct * 2 + (closePositionRatio * 10) + (Math.log10(lastRow.tradingValue) * 2);
                    return { category: 'INTRADAY_SURGE', convictionScore: paScore, reason: p3Reason };
                }
            }
        }



        // ── 4. EMERGING_STAR (최근 5d 대장 신흥, 10d·20d 미증명)
        // ※ LONG_RUNNER 조건 통과 후 → 5d만 LEADER인 신흥 진입주
        if (phase5 === 'LEADER' && pkLevel === 'NONE' && phase60 !== 'LEADER' &&
            p5.marketAlpha > p20.marketAlpha) {

            let score = (p5.marketAlpha * 2) + (p10.marketAlpha * 0.5) +
                Math.log10(Math.max(p5.avgTradingValue, 1)) * 3;
            if (seg.trend === 'LATE_STRONG') score += 5;

            // 추가 조건: 60일 내 고점에서 15% 이상 크게 무너진 이력이 있다면 '신흥'이 아니라 '눌림 반등'으로 격리
            if (ddp >= 15) {
                return { category: 'PULLBACK_REBOUND', convictionScore: score, reason: `낙폭과대(${ddp.toFixed(1)}% 하락) 이후 강력한 모멘텀 턴어라운드 (단기 대장 진입)` };
            }

            return { category: 'EMERGING_STAR', convictionScore: score, reason: this.reasonEmergingStar(p5, p20, seg) };
        }

        // ── 5. PULLBACK_DIP (눌림목 - 절대 가격 차트 / 거래량 기준)
        if (isPriceActionPullback) {
            return { category: 'PULLBACK_DIP', convictionScore: paScore, reason: pDipReason };
        }

        // ── 6. SHORT_TERM_CONSOLIDATION (단기 눌림목)
        // 조건: D-1 ~ D-4 에 15% 이상 첫 급등봉 발생, 종가 대비 10% 이내 횡보, 10일선 지지, 혈통대장(TrackA,C) 아님
        if (ohlcvRows && ohlcvRows.length >= 10 && !isBloodlineLeader) {
            const todayIdx = ohlcvRows.length - 1;
            let spikeIdx = -1;
            let spikePct = 0;
            // D-4 to D-1 (인덱스: length-5 ~ length-2)
            for (let i = todayIdx - 4; i < todayIdx; i++) {
                if (i <= 0) continue;
                const prev = ohlcvRows[i - 1];
                const curr = ohlcvRows[i];
                const pct = prev.close > 0 ? ((curr.close - prev.close) / prev.close) * 100 : 0;
                const bodyPct = curr.open > 0 ? ((curr.close - curr.open) / curr.open) * 100 : 0;

                if (pct >= 15 || bodyPct >= 15) {
                    if (pct > spikePct || bodyPct > spikePct) {
                        spikePct = Math.max(pct, bodyPct);
                        spikeIdx = i;
                    }
                }
            }

            if (spikeIdx !== -1) {
                const spikeDay = ohlcvRows[spikeIdx];
                const today = ohlcvRows[todayIdx];
                const diffFromSpikeClose = spikeDay.close > 0 ? ((today.close - spikeDay.close) / spikeDay.close) * 100 : 0;

                // 단기 이동평균선(최근 10일)
                const recent10 = ohlcvRows.slice(-10);
                const ma10 = recent10.reduce((s, r) => s + r.close, 0) / recent10.length;

                if (
                    diffFromSpikeClose >= -10 && diffFromSpikeClose <= 10 && // 급등봉 종가 대비 ±10% 내
                    today.close >= spikeDay.open && // 시가 훼손 금지 (음봉 투매 금지)
                    today.close >= ma10 * 0.98 // 10일선 살짝 깨는 것까지는 용인 (종가 기준)
                ) {
                    const daysAgo = todayIdx - spikeIdx;
                    const pEReason = `[단기 눌림목] ${daysAgo}일 전 첫 급등(+${spikePct.toFixed(1)}%) | 기준봉 종가대비 ${diffFromSpikeClose > 0 ? '+' : ''}${diffFromSpikeClose.toFixed(1)}% 횡보 | 중장기대장주 이력 없음`;
                    const score = spikePct * 1.5 + (10 - Math.abs(diffFromSpikeClose));

                    return { category: 'SHORT_TERM_CONSOLIDATION', convictionScore: score, reason: pEReason };
                }
            }
        }

        return { category: 'UNCLASSIFIED', convictionScore: 0, reason: '분류 기준 미달' };
    }

    // ─── 시그널 연산 \uc5d4진 (카테고리와 독립) ──────────────────────

    private computeSignals(
        p5: MarketLeaderItem,
        p10: MarketLeaderItem,
        p20: MarketLeaderItem,
        p60: MarketLeaderItem,
        seg: SegmentProfile,
    ): CrossSignal[] {
        const signals: CrossSignal[] = [];

        const ddp = p60.drawdownFromPeak ?? p20.drawdownFromPeak ?? p10.drawdownFromPeak ?? p5.drawdownFromPeak ?? 0;

        // RANK_CLIMBER: 순위가 일관되게 상승 중 (LEADER 권에 진입 안 해도 소당)
        // 단, 60일 내 크게 박살난 이력이 있는 낙폭과대(V자 반등) 종목은 순위상승형 지위를 박탈
        if (seg.isRankClimber && ddp < 15) {
            signals.push('RANK_CLIMBER');
        }

        // HIGH_CONSISTENCY: 10일 6구간 중 4구간 이상 LEADER
        if (seg.consistencyScore >= 0.66) {
            signals.push('HIGH_CONSISTENCY');
        }

        // BREAKOUT_CANDIDATE: 최근 2구간 연속 LEADER 진입 (최근 추세 가속화)
        if (seg.segments.length >= 2) {
            const lastTwo = seg.segments.slice(-2);
            if (lastTwo.every(s => s.phase === 'LEADER')) {
                signals.push('BREAKOUT_CANDIDATE');
            }
        }

        // VOLUME_SURGE: 5d 평균 거래대금이 20d 관대비 2배 이상
        if (p5.avgTradingValue > 0 && p20.avgTradingValue > 0 &&
            p5.avgTradingValue >= p20.avgTradingValue * 2) {
            signals.push('VOLUME_SURGE');
        }

        return signals;
    }

    // ─── 세그먼트 프로파일 빌드 ───────────────────────────────

    /**
     * 60일 OHLCV를 메모리에서 파티셔닝하여 전 종목의 세그먼트 프로파일을 생성.
     * DB 추가 조회 없이 이미 로드된 데이터만 사용.
     */
    private buildAllSegmentProfiles(
        ohlcv60: Map<string, { date: string; close: number; tradingValue: number }[]>,
        mkts: Record<number, number>,
        totalStocks: number,
    ): Map<string, SegmentProfile> {
        const result = new Map<string, SegmentProfile>();

        // 모든 날짜 정렬
        const allDates = new Set<string>();
        for (const rows of ohlcv60.values()) rows.forEach(r => allDates.add(r.date));
        const sortedDates = Array.from(allDates).sort();
        const totalDays = sortedDates.length;

        // 10일 단위 6구간 경계 (시각화용)
        const seg10Boundaries = this.calcSegBoundaries(sortedDates, 6);
        // 5일 단위 12구간 경계 (RANK_CLIMBER 감지용)
        const seg5Boundaries = this.calcSegBoundaries(sortedDates, 12);

        // 각 구간별 전 종목 알파 계산 → 구간 랭킹 산출
        const rankMaps10 = this.buildSegmentAlphaRanks(ohlcv60, seg10Boundaries);
        const rankMaps5 = this.buildSegmentAlphaRanks(ohlcv60, seg5Boundaries);

        // 종목별 프로파일 생성
        for (const [code, rows] of ohlcv60.entries()) {
            // 10일 단위 segments (시각화)
            const segments: SegmentSlot[] = seg10Boundaries.map((bounds, idx) => {
                const rankMap = rankMaps10[idx];
                const rank = rankMap.get(code) ?? totalStocks;
                const alpha = this.calcSegAlpha(rows, bounds.startDate, bounds.endDate);
                const pctTile = rank / totalStocks;
                const phase: 'LEADER' | 'CANDIDATE' | 'NONE' =
                    rank <= totalStocks / 3 ? 'LEADER' :
                        rank <= totalStocks * 2 / 3 ? 'CANDIDATE' : 'NONE';
                return { index: idx + 1, phase, alpha };
            });

            // 5일 단위 rank trajectory (RANK_CLIMBER 감지)
            const rankTrajectory: RankSlot[] = seg5Boundaries.map((bounds, idx) => {
                const rankMap = rankMaps5[idx];
                const rank = rankMap.get(code) ?? totalStocks;
                const percentile = (rank / totalStocks) * 100;
                const alpha = this.calcSegAlpha(rows, bounds.startDate, bounds.endDate);
                return { index: idx + 1, rank, percentile, alpha };
            });

            let isRankClimber = false;
            let slope = 0;
            let rSquared = 0;
            if (rankTrajectory.length >= 4) {
                // 기존 선형회귀 계산 (호환성 및 프로필 저장용)
                const rankValues = rankTrajectory.map(r => r.rank);
                const reg = this.linearRegression(rankValues);
                slope = reg.slope;
                rSquared = reg.rSquared;

                const r4 = rankTrajectory.slice(-4);
                const currentRank = r4[3].rank;
                const alphas = r4.map(r => r.alpha);
                const sumAlpha = alphas.reduce((a, b) => a + b, 0);
                const maxAlpha = Math.max(...alphas);

                // 1. 최근 20봉 내 300위(약 상위 12%) 안 진입 (기존 100위에서 완화)
                const isTop300 = currentRank <= 300;

                // 2. 5봉씩 4개 구간에서 꾸준히 상승
                // 주가 노이즈를 감안하여 완벽한 계단식 대신, 3번의 구간 이동 중 최소 2번은 순위가 상승해야 하고 전체적으로 우상향(r0 > r3)을 요구
                const trendScore = (r4[0].rank > r4[1].rank ? 1 : 0) + (r4[1].rank > r4[2].rank ? 1 : 0) + (r4[2].rank >= r4[3].rank ? 1 : 0);
                const isSteady = trendScore >= 2 && r4[0].rank > r4[3].rank && r4[1].rank > r4[3].rank;

                // 3. 단발성 급등 제외: 4개 구간 합산 수익 중 특정 1개 구간의 비중이 70%를 초과하면 급등주로 간주
                const isNotSpike = sumAlpha > 0 ? (maxAlpha <= sumAlpha * 0.7) : false;

                isRankClimber = isTop300 && isSteady && isNotSpike;
            }

            // Trend 판별 (10일 단위 6구간)
            const leaderCount = segments.filter(s => s.phase === 'LEADER').length;
            const consistencyScore = leaderCount / Math.max(segments.length, 1);
            let trend: SegmentProfile['trend'] = 'INCONSISTENT';

            if (isRankClimber && leaderCount === 0) {
                trend = 'RANK_RISING';
            } else if (consistencyScore >= 0.66) {
                trend = 'CONSISTENT';
            } else {
                const earlyLeaders = segments.slice(0, 3).filter(s => s.phase === 'LEADER').length;
                const lateLeaders = segments.slice(3).filter(s => s.phase === 'LEADER').length;
                if (earlyLeaders >= 2 && lateLeaders === 0) trend = 'EARLY_STRONG';
                else if (earlyLeaders === 0 && lateLeaders >= 2) trend = 'LATE_STRONG';
            }

            result.set(code, {
                rankTrajectory,
                rankSlope: slope,
                rankRSquared: rSquared,
                isRankClimber,
                segments,
                trend,
                consistencyScore,
            });
        }

        return result;
    }

    // ─── 세그먼트 구간 경계 계산 ────────────────────────────

    private calcSegBoundaries(sortedDates: string[], numSegments: number): { startDate: string; endDate: string }[] {
        const total = sortedDates.length;
        if (total === 0) return [];

        const segSize = Math.floor(total / numSegments);
        const boundaries: { startDate: string; endDate: string }[] = [];

        for (let i = 0; i < numSegments; i++) {
            const start = i * segSize;
            const end = i === numSegments - 1 ? total - 1 : (i + 1) * segSize - 1;
            boundaries.push({ startDate: sortedDates[start], endDate: sortedDates[end] });
        }
        return boundaries;
    }

    /** 구간별로 전 종목 알파를 계산하고 순위 맵(code → rank)을 반환 */
    private buildSegmentAlphaRanks(
        ohlcv60: Map<string, { date: string; close: number; tradingValue: number }[]>,
        boundaries: { startDate: string; endDate: string }[],
    ): Map<string, number>[] {
        return boundaries.map(({ startDate, endDate }) => {
            const alphas: { code: string; alpha: number }[] = [];
            for (const [code, rows] of ohlcv60.entries()) {
                const alpha = this.calcSegAlpha(rows, startDate, endDate);
                alphas.push({ code, alpha });
            }
            // 알파 내림차순 정렬 → 순위 부여
            alphas.sort((a, b) => b.alpha - a.alpha);
            const rankMap = new Map<string, number>();
            alphas.forEach(({ code }, idx) => rankMap.set(code, idx + 1));
            return rankMap;
        });
    }

    private calcSegAlpha(
        rows: { date: string; close: number; tradingValue: number }[],
        startDate: string,
        endDate: string,
    ): number {
        const seg = rows.filter(r => r.date >= startDate && r.date <= endDate);
        if (seg.length < 2) return 0;
        const first = seg[0].close;
        const last = seg[seg.length - 1].close;
        return first > 0 ? ((last - first) / first) * 100 : 0;
    }

    // ─── 60일 OHLCV 로드 (DB 단 1회 조회) ────────────────────

    private load60dOhlcv(): Map<string, { date: string; open: number; high: number; low: number; close: number; tradingValue: number }[]> {
        const db = (this.db as any).db;
        const targetDate = this.svc.getTradingDateCutoff(60);
        const rows = db.prepare(
            `SELECT stock_code, date, open, high, low, close, trading_value
             FROM market_ohlcv_history
             WHERE date >= ?
             ORDER BY stock_code, date ASC`
        ).all(targetDate) as any[];

        const map = new Map<string, { date: string; open: number; high: number; low: number; close: number; tradingValue: number }[]>();
        for (const r of rows) {
            const list = map.get(r.stock_code) ?? [];
            list.push({ date: r.date, open: r.open || r.close, high: r.high || r.close, low: r.low || r.close, close: r.close, tradingValue: r.trading_value || 0 });
            map.set(r.stock_code, list);
        }
        return map;
    }

    // ─── 시장 지수 변동률 계산 ──────────────────────────────

    private calcMarketChanges(days: number[]): Record<number, number> {
        const result: Record<number, number> = {};
        const db = (this.db as any).db;
        for (const d of days) {
            try {
                const targetDate = this.svc.getTradingDateCutoff(d);
                const rows = db.prepare(
                    `SELECT close FROM market_ohlcv_history
                     WHERE stock_code='069500' AND date >= ? ORDER BY date ASC`
                ).all(targetDate) as any[];
                if (rows.length >= 2) {
                    result[d] = ((rows[rows.length - 1].close - rows[0].close) / rows[0].close) * 100;
                } else {
                    result[d] = 0;
                }
            } catch { result[d] = 0; }
        }
        return result;
    }

    // ─── 수학 유틸리티 ───────────────────────────────────────

    /** 단순 선형회귀 기울기 및 R² */
    private linearRegression(values: number[]): { slope: number; rSquared: number } {
        const n = values.length;
        if (n < 2) return { slope: 0, rSquared: 0 };

        const xs = values.map((_, i) => i);
        const xMean = (n - 1) / 2;
        const yMean = values.reduce((a, b) => a + b, 0) / n;

        let ssXY = 0, ssXX = 0, ssYY = 0;
        for (let i = 0; i < n; i++) {
            ssXY += (xs[i] - xMean) * (values[i] - yMean);
            ssXX += (xs[i] - xMean) ** 2;
            ssYY += (values[i] - yMean) ** 2;
        }

        const slope = ssXX !== 0 ? ssXY / ssXX : 0;
        const rSquared = ssXX !== 0 && ssYY !== 0 ? (ssXY ** 2) / (ssXX * ssYY) : 0;
        return { slope, rSquared };
    }

    // ─── 추천 사유 생성기 ────────────────────────────────────

    private reasonExhausted(p60: MarketLeaderItem, p5: MarketLeaderItem): string {
        return `과거 대장주(60d α+${p60.marketAlpha.toFixed(1)}%)이나 최근 5일 랭킹 이탈 + 피크아웃 ${p5.peakoutScore ?? 0}점 확정. 추가 하락 위험`;
    }

    private reasonTruLeader(p5: MarketLeaderItem, weightedScore: number, seg: SegmentProfile): string {
        const consistency = `일관성 ${(seg.consistencyScore * 100).toFixed(0)}%`;
        return `가중 랜크 점수 ${weightedScore.toFixed(1)}점 (5d×40+10d×30+20d×20+60d×10, 최대100) | ${consistency}`;
    }

    private reasonEmergingStar(p5: MarketLeaderItem, p20: MarketLeaderItem, seg: SegmentProfile): string {
        const trendLabel = seg.trend === 'LATE_STRONG' ? ' [패턴 일치✓]' : '';
        return `최근 5일 α+${p5.marketAlpha.toFixed(1)}%, 직전 20일 비주도주(α${p20.marketAlpha.toFixed(1)}%) → 급격한 모멘텀 전환 감지${trendLabel}`;
    }

    private reasonRankClimber(seg: SegmentProfile, p5: MarketLeaderItem): string {
        const latest = seg.rankTrajectory.at(-1);
        const oldest = seg.rankTrajectory.at(0);
        const pctChange = oldest && latest
            ? `상위 ${oldest.percentile.toFixed(0)}%→${latest.percentile.toFixed(0)}%`
            : '';
        return `최근 30일 순위 꾸준히 상승 (R²=${seg.rankRSquared.toFixed(2)}, ${pctChange}). 아직 대장 미진입 → 선행 포착`;
    }

    private reasonPullback(p60: MarketLeaderItem, p20: MarketLeaderItem, p5: MarketLeaderItem, ddp: number, seg: SegmentProfile): string {
        const longAlpha = Math.max(p60.marketAlpha, p20.marketAlpha);
        const trendLabel = seg.trend === 'EARLY_STRONG' ? ' [눌림목 패턴 확인✓]' : '';
        return `60/20일 대장주(α+${longAlpha.toFixed(1)}%) | 최근 5일 조정(α${p5.marketAlpha.toFixed(1)}%) | 고점 대비 -${ddp.toFixed(1)}%${trendLabel}`;
    }



    // ─── 기본값 헬퍼 ────────────────────────────────────────

    private nullProfile(stockCode: string): MarketLeaderItem {
        return {
            stockCode, stockName: stockCode,
            totalChangeRate: 0, marketAlpha: 0,
            avgTradingValue: 0, score: 0,
            relatedThemes: [], phase: null,
            peakoutWarning: false, peakoutScore: 0,
            peakoutLevel: 'NONE', drawdownFromPeak: 0,
            recentTrend: 'FLAT', validAlphaDays: 0,
        };
    }

    /**
     * 해당 기간의 leaders리스트에 없는 종목에 대해 실제 OHLCV에서 알파를 직접 계산.
     * phase는 랑킹 정보 없으므로 null로 남기지만, marketAlpha는 익어 UI에 적절히 표시.
     */
    private liteProfile(
        stockCode: string,
        rows: { date: string; close: number; tradingValue: number }[] | undefined,
        nDays: number,
        mktChange: number,
    ): MarketLeaderItem {
        if (!rows || rows.length < 2) return this.nullProfile(stockCode);

        // 최근 N 영업일 데이터 취득
        const seg = rows.slice(-nDays);
        if (seg.length < 2) return this.nullProfile(stockCode);

        const first = seg[0].close;
        const last = seg[seg.length - 1].close;
        const maxClose = seg.reduce((m, r) => Math.max(m, r.close), 0);
        const drawdownFromPeak = maxClose > 0 ? ((maxClose - last) / maxClose) * 100 : 0;

        const totalChangeRate = first > 0 ? ((last - first) / first) * 100 : 0;
        const marketAlpha = totalChangeRate - mktChange;
        const avgTradingValue = seg.reduce((s, r) => s + (r.tradingValue || 0), 0) / seg.length;
        const recentTrend: 'UP' | 'DOWN' | 'FLAT' =
            totalChangeRate > 1 ? 'UP' : totalChangeRate < -1 ? 'DOWN' : 'FLAT';

        return {
            stockCode,
            stockName: stockCode,     // 이름은 실제 데이터 없으므로 코드로 (stockName fallback에서 처리됨)
            totalChangeRate,
            marketAlpha,
            avgTradingValue,
            score: 0,
            relatedThemes: [],
            phase: null,              // 랑킹 없으면 phase 판단 불가
            peakoutWarning: false,
            peakoutScore: 0,
            peakoutLevel: 'NONE',
            drawdownFromPeak,
            recentTrend,
            validAlphaDays: seg.length,
        };
    }

    private nullSegmentProfile(): SegmentProfile {
        return {
            rankTrajectory: [], rankSlope: 0, rankRSquared: 0, isRankClimber: false,
            segments: [], trend: 'INCONSISTENT', consistencyScore: 0,
        };
    }
}
