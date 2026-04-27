import { DatabaseService } from '../DatabaseService';
import { getPastDateKst } from '../../utils/DateUtils';

export interface MarketLeaderItem {
    stockCode: string;
    stockName: string;
    totalChangeRate: number;      // 누적 수익률 (%)
    marketAlpha: number;          // 시장대비 알파 (%)
    avgTradingValue: number;      // 평균 거래대금
    score: number;                // 최종 순위 산정용 점수
    relatedThemes: string[];      // 테마/섹터 키워드
    alphaTimeline?: (boolean | null)[];
    inverseRiseCount?: number;
    // Phase v3
    phase?: string | null;
    peakoutWarning?: boolean;     // 피크아웃 의심 (v3 홈환)
    peakoutScore?: number;        // v4: 패턴 합산 점수
    peakoutLevel?: 'NONE' | 'ALERT' | 'CONFIRMED'; // v4: 2단계 경보
    drawdownFromPeak?: number;
    recentTrend?: 'UP' | 'DOWN' | 'FLAT';
    validAlphaDays?: number;
    /** 해당 기간 내 전체 순위 (1=1등, 300=꼴등). getMarketLeaders(topN=300) 기준. 미포함 시 undefined */
    rank?: number;
}

/** 피크아웃 패널 설정값 (UI 설정 패널에서 전달) */
export interface PeakoutSettings {
    p1BuyingClimax: boolean;      // P1: 바이잊 클라이맥스
    p2ShootingStar: boolean;      // P2: 위꼼리 장대봉
    p3GapReversal: boolean;       // P3: 갭업 키리버샄
    p4ConsecBearish: boolean;     // P4: 연속 음봉+거래량 증가
    p5Divergence: boolean;        // P5: 신고가 다이버전스
    drawdownThreshold: number;    // 낙폭 기준 % (default 10)
    alertThreshold: number;       // ⚠️ 경보 하한 점수 (default 2)
    confirmedThreshold: number;   // ☠️ 확정 하한 점수 (default 5)
}

export const DEFAULT_PEAKOUT_SETTINGS: PeakoutSettings = {
    p1BuyingClimax: true,
    p2ShootingStar: true,
    p3GapReversal: true,
    p4ConsecBearish: true,
    p5Divergence: false,
    drawdownThreshold: 10,
    alertThreshold: 2,
    confirmedThreshold: 5,
};

export class MarketLeaderDiscoveryService {
    private static instance: MarketLeaderDiscoveryService;
    private dbService: DatabaseService;
    private globalThemeFrequency = new Map<string, number>();

    private constructor() {
        this.dbService = DatabaseService.getInstance();
    }

    public static getInstance(): MarketLeaderDiscoveryService {
        if (!MarketLeaderDiscoveryService.instance) {
            MarketLeaderDiscoveryService.instance = new MarketLeaderDiscoveryService();
        }
        return MarketLeaderDiscoveryService.instance;
    }

    /** 
     * KODEX 200 (069500)을 기준으로 실제 영업일(캔들 기준) n봉 전의 날짜를 계산
     */
    public getTradingDateCutoff(targetCandles: number): string {
        const db = (this.dbService as any).db;
        try {
            // DB에 존재하는 전체 시장의 최근 거래일 목록을 추출 (KODEX 200 등 단일 종목 의존도 제거)
            const rows = db.prepare(`
                SELECT DISTINCT date 
                FROM market_ohlcv_history 
                ORDER BY date DESC 
                LIMIT ?
            `).all(targetCandles) as { date: string }[];
            
            if (rows && rows.length > 0) {
                return rows[rows.length - 1].date;
            }
        } catch (e) {
            console.error("Failed to get trading date cutoff", e);
        }
        return getPastDateKst(targetCandles); // fallback (최소한의 달력일 보장)
    }

    /**
     * JSON 배열 문자열 형태의 태그 필드를 파싱하고 노이즈를 필터링하는 유틸리티
     */
    public static parseTagField(fieldValue: any): string[] {
        if (!fieldValue) return [];
        let parsed: string[] = [];
        
        try {
            // "[\"테마1\", \"테마2\"]" 형태의 문자열인지 확인
            if (typeof fieldValue === 'string' && fieldValue.startsWith('[')) {
                parsed = JSON.parse(fieldValue);
            } else if (typeof fieldValue === 'string') {
                // 단순 콤마 분리 문자열인 경우
                parsed = fieldValue.split(',');
            } else if (Array.isArray(fieldValue)) {
                parsed = fieldValue;
            }
        } catch (e) {
            // 파싱 실패시 단순 콤마 분리로 폴백
            parsed = String(fieldValue).split(',');
        }

        return parsed
            .map(t => {
                let cleaned = String(t).trim();
                // 불필요한 기호(따옴표, 대괄호 등) 전역 제거
                cleaned = cleaned.replace(/["'\[\]]+/g, ''); 
                return cleaned.trim();
            })
            // null, undefined, 빈 문자열, 1글자 등 노이즈 제거
            .filter(t => t && t !== 'null' && t !== 'undefined' && t !== '[]' && t !== '""' && t.length > 1);
    }

    /**
     * Phase 1 & 2: 기계적 알파 랭킹 연산 및 Reverse Theme Lookup 수행
     * 과거 급등주 DB 조회가 아닌, 전종목 OHLCV (market_ohlcv_history)를 활용한 
     * 진정한 의미의 시장 초과 수익률(Alpha) 랭킹 산출 엔진.
     * 
     * @param targetDays 과거 며칠 동안의 데이터를 분석할지 (예: 5, 10, 20, 60)
     * @param marketIndexChange 기간 내 시장(코스피/지수) 누적 변동률 (알파 계산용)
     * @param topN 상위 몇 개의 주도주를 뽑을지
     */
    public getMarketLeaders(
        targetDays: number = 10,
        marketIndexChange: number = 0,
        topN: number = 30,
        peakoutSettings: PeakoutSettings = DEFAULT_PEAKOUT_SETTINGS
    ): MarketLeaderItem[] {
        const targetDate = this.getTradingDateCutoff(targetDays);
        const db = (this.dbService as any).db;

        // 1. OHLCV 데이터 로드 — open/high/low 포함
        const ohlcvRows = db.prepare(`
            SELECT stock_code, date, open, high, low, close, trading_value
            FROM market_ohlcv_history
            WHERE date >= ?
            ORDER BY stock_code, date ASC
        `).all(targetDate) as any[];

        // history에 ohlc 전체 포함
        type HistoryItem = { date: string; open: number; high: number; low: number; close: number; trading_value: number; };
        const stockMap = new Map<string, {
            firstClose: number; lastClose: number; totalTrdVal: number; count: number;
            history: HistoryItem[];
        }>();
        const uniqueDates = new Set<string>();

        ohlcvRows.forEach(row => {
            const sc = row.stock_code;
            const hItem: HistoryItem = {
                date: row.date,
                open: row.open || row.close,
                high: row.high || row.close,
                low: row.low || row.close,
                close: row.close,
                trading_value: row.trading_value || 0,
            };
            uniqueDates.add(row.date);

            const item = stockMap.get(sc);
            if (!item) {
                stockMap.set(sc, { firstClose: row.close, lastClose: row.close, totalTrdVal: row.trading_value || 0, count: 1, history: [hItem] });
            } else {
                item.lastClose = row.close;
                item.totalTrdVal += (row.trading_value || 0);
                item.count += 1;
                item.history.push(hItem);
            }
        });

        // 1.5 60일(장기) 저점 + 20일 고점 데이터 로드 (heat_60 및 drawdown20 산출용)
        const targetDate60 = this.getTradingDateCutoff(60);
        const low60Rows = db.prepare(`
            SELECT stock_code, MIN(close) as min_close
            FROM market_ohlcv_history
            WHERE date >= ?
            GROUP BY stock_code
        `).all(targetDate60) as any[];

        const min60Map = new Map<string, number>();
        low60Rows.forEach(r => min60Map.set(r.stock_code, r.min_close));

        // 최근 20일 고점 (drawdown20: 고점 대비 현재가 하락률 계산용)
        const targetDate20 = this.getTradingDateCutoff(20);
        const high20Rows = db.prepare(`
            SELECT stock_code, MAX(close) as max_close
            FROM market_ohlcv_history
            WHERE date >= ?
            GROUP BY stock_code
        `).all(targetDate20) as any[];

        const max20Map = new Map<string, number>();
        high20Rows.forEach(r => max20Map.set(r.stock_code, r.max_close));

        const sortedDates = Array.from(uniqueDates).sort();
        
        // KODEX 200 (069500) 을 시장 대용 지수로 사용
        const marketData = stockMap.get('069500');
        const marketDailyChange = new Map<string, number>();
        
        if (marketData && marketData.history.length > 1) {
            for (let i = 1; i < marketData.history.length; i++) {
                const prev = marketData.history[i-1].close;
                const curr = marketData.history[i].close;
                const pct = prev > 0 ? ((curr - prev) / prev) * 100 : 0;
                marketDailyChange.set(marketData.history[i].date, pct);
            }
        }

        // 2. 테마 & 태그 딕셔너리 구성 (역산출을 위한 매핑. 시계열 관계 없이 최신 정보 병합)
        const themeRows = db.prepare(`
            SELECT 
                stock_code,
                MAX(stock_name) as stock_name,
                GROUP_CONCAT(theme_sector) as themes,
                GROUP_CONCAT(tags) as tags
            FROM daily_rising_stocks
            GROUP BY stock_code
        `).all() as any[];

        const themeMap = new Map<string, { name: string, themes: Set<string> }>();
        themeRows.forEach(row => {
            const sc = row.stock_code;
            const themeSet = new Set<string>();
            const parsedThemes = MarketLeaderDiscoveryService.parseTagField(row.themes);
            const parsedTags   = MarketLeaderDiscoveryService.parseTagField(row.tags);
            parsedThemes.forEach(t => themeSet.add(t));
            parsedTags.forEach(t => themeSet.add(t));
            
            themeMap.set(sc, { name: row.stock_name, themes: themeSet });
        });

        // (선택) stock_theme_tags 등의 추가 태그 정보가 있다면 보강
        try {
            const tagsRows = db.prepare(`SELECT stock_code, stock_name, tag_name FROM stock_theme_tags`).all() as any[];
            tagsRows.forEach(row => {
                const item = themeMap.get(row.stock_code);
                if (item) {
                    item.themes.add(row.tag_name);
                } else {
                    const themeSet = new Set<string>();
                    themeSet.add(row.tag_name);
                    themeMap.set(row.stock_code, { name: row.stock_name || '', themes: themeSet });
                }
            });
        } catch(e) { }

        // (신규) Theme Ontology 매핑: 파편화된 태그를 대분류로 필터링 치환
        try {
            const ontologyRows = db.prepare(`SELECT raw_tag, macro_category as macro FROM theme_ontology`).all() as any[];
            const ontologyMap = new Map<string, string>();
            ontologyRows.forEach(row => ontologyMap.set(row.raw_tag, row.macro));

            for (const meta of themeMap.values()) {
                const standardizedSet = new Set<string>();
                for (const t of meta.themes) {
                    // 사전에 등록된 대분류가 있으면 대분류로 치환, 없으면 원본 유지
                    const mapped = ontologyMap.get(t);
                    standardizedSet.add(mapped ? mapped : t);
                }
                meta.themes = standardizedSet;
            }
        } catch(e) { console.error("[MarketLeader] Ontology Mapping Error:", e) }

        // (추가) stocks_master 에서 전 종목명 동기화 (관련 테마 레코드가 없는 종목의 이름 확보)
        const masterNamesMap = new Map<string, string>();
        try {
            const masterRows = db.prepare(`SELECT stock_code, stock_name FROM stocks_master`).all() as any[];
            masterRows.forEach(row => masterNamesMap.set(row.stock_code, row.stock_name));
        } catch(e) {}

        // 테마 글로벌 카운트 계산
        this.globalThemeFrequency.clear();
        for (const meta of themeMap.values()) {
            meta.themes.forEach(theme => {
                const current = this.globalThemeFrequency.get(theme) || 0;
                this.globalThemeFrequency.set(theme, current + 1);
            });
        }

        // 3. 알파(Alpha) 스코어 계산 알고리즘 및 일간 역상관 연산
        const leaders: MarketLeaderItem[] = [];
        const recent5Dates = sortedDates.slice(-5); // 최근 5일 (알파 타임라인용)

        // 기간 내 고점 (drawdownFromPeak 계산용 — 조회 기간 전체 window)
        const periodHighMap = new Map<string, number>();
        for (const [sc, data] of stockMap.entries()) {
            const maxClose = data.history.reduce((m, h) => Math.max(m, h.close), 0);
            periodHighMap.set(sc, maxClose);
        }
        
        for (const [stockCode, data] of stockMap.entries()) {
            // 충분한 데이터가 없거나 시작 가격이 0인 오류 종목 제외
            if (data.count < 1 || data.firstClose <= 0) continue;

            const meta = themeMap.get(stockCode);
            let stockName = meta?.name;
            if (!stockName || stockName === stockCode || stockName === '') {
                stockName = masterNamesMap.get(stockCode) || stockCode;
            }

            // --- 엄격한 스팩/파생/부동산/우선주 필터링 (DB 찌꺼기 방어벽) ---
            const upperName = stockName.toUpperCase();
            if (
                upperName.includes('스팩') || upperName.includes('SPAC') ||
                upperName.includes('ETN') || upperName.includes('ETF') ||
                upperName.includes('레버리지') || upperName.includes('인버스') || upperName.includes('선물') ||
                upperName.includes('리츠') || upperName.includes('맥쿼리인프라') || upperName.includes('맵스') ||
                /우[A-Z]?$|우\(기\)$|우\(전환\)$/i.test(upperName)
            ) {
                continue;
            }
            
            // 기존 전통 ETF 브랜드 추가 방어
            const etfBrands = ['KODEX', 'TIGER', 'KBSTAR', 'KINDEX', 'ARIRANG', 'KOSEF', 'HANARO', 'ACE', 'SOL', 'TIMEFOLIO', '히어로즈', '마이티', 'TREX', 'FOCUS', 'HK', '파워', 'PLUS', 'RISE'];
            const isEtfBrand = etfBrands.some(brand => upperName.startsWith(brand));
            if (isEtfBrand) continue;
            
            // 누적 변동률 = (현재가 - 최초기준가) / 최초기준가 * 100
            const totalChangeRate = ((data.lastClose - data.firstClose) / data.firstClose) * 100;
            const alpha = totalChangeRate - marketIndexChange;
            const avgTradingValue = data.totalTrdVal / data.count;

            // 유동성(수급) 로그 스케일 가중치
            const liquidityWeight = Math.log10(Math.max(avgTradingValue, 1));
            const score = alpha > 0 ? alpha * liquidityWeight : alpha;

            // ─── 일간 알파 타임라인 + 역상관 계산 (거래정지일 보정) ───
            let inverseRiseCount = 0;
            // null = 거래정지일, true/false = 알파 승/패
            const dateAlphaMap = new Map<string, boolean | null>();

            if (data.history.length > 1 && marketDailyChange.size > 0) {
                for (let i = 1; i < data.history.length; i++) {
                    const dt = data.history[i].date;
                    const trdVal = (data.history[i] as any).trading_value ?? -1;
                    const prev = data.history[i-1].close;
                    const curr = data.history[i].close;

                    // ★ 거래정지일 감지: 거래대금 0 또는 가격 변동 전혀 없고 거래량 없는 날
                    const isHaltDay = trdVal === 0 || (curr === prev && trdVal === 0);
                    if (isHaltDay) {
                        dateAlphaMap.set(dt, null); // 판정 제외
                        continue;
                    }

                    const stockDailyPct = prev > 0 ? ((curr - prev) / prev) * 100 : 0;
                    const marketPct = marketDailyChange.get(dt) || 0;
                    const dailyAlpha = stockDailyPct - marketPct;

                    // 시장 하락인데 주가 상승 → 역상관
                    if (marketPct < 0 && stockDailyPct > 0) inverseRiseCount++;

                    dateAlphaMap.set(dt, dailyAlpha > 0);
                }
            }

            // alphaTimeline: null(거래정지) 포함 5자리
            const alphaTimeline: (boolean | null)[] = recent5Dates.map(dt => {
                const v = dateAlphaMap.get(dt);
                return v === undefined ? null : v; // 데이터 자체가 없는 날도 null
            });
            const validAlphaDays = alphaTimeline.filter(v => v !== null).length;

            // ─── 최근 5봉 추세 (recentTrend) ───
            const recent5history = data.history.slice(-6); // 직전 포함 최대 6개
            let recentChanges: number[] = [];
            for (let i = 1; i < recent5history.length; i++) {
                const p = recent5history[i-1].close;
                const c = recent5history[i].close;
                if (p > 0) recentChanges.push(((c - p) / p) * 100);
            }
            const recentAvg = recentChanges.length > 0
                ? recentChanges.reduce((a, b) => a + b, 0) / recentChanges.length : 0;
            const recentTrend: 'UP' | 'DOWN' | 'FLAT' =
                recentAvg > 0.3 ? 'UP' : recentAvg < -0.3 ? 'DOWN' : 'FLAT';

            // ─── 기간 내 고점 대비 낙폭 (drawdownFromPeak) ───
            const periodHigh = periodHighMap.get(stockCode) || data.lastClose;
            const drawdownFromPeak = periodHigh > 0
                ? ((periodHigh - data.lastClose) / periodHigh) * 100 : 0;

            // ─── 피크아웃 의심 배지 (Add-on) ───
            // 조건: 기간 내 고점 대비 -15% 이상 하락 AND 최근 추세도 DOWN/FLAT
            const peakoutWarning = drawdownFromPeak >= 15 && recentTrend !== 'UP';

            leaders.push({
                stockCode,
                stockName,
                totalChangeRate,
                marketAlpha: alpha,
                avgTradingValue,
                score,
                relatedThemes: meta ? Array.from(meta.themes) : [],
                alphaTimeline,
                inverseRiseCount,
                phase: 'PENDING',
                peakoutWarning,
                drawdownFromPeak,
                recentTrend,
                validAlphaDays,
                _history: data.history, // 피크아웃 스코어링용, 정렬 후 제거
            } as any);
        }

        // 4. 알파 점수순 정렬 후 Top N 분리
        const sorted = leaders.sort((a, b) => b.score - a.score).slice(0, topN);

        // 5. Phase v3 확정 + 피크아웃 v4 스코어링
        const total = sorted.length;
        const leaderCutoff    = Math.ceil(total / 3);
        const candidateCutoff = Math.ceil((total * 2) / 3);
        const s = peakoutSettings; // 야비

        return sorted.map((item, idx) => {
            const rank = idx + 1;
            let finalPhase: string | null = null;
            if (rank <= leaderCutoff)         finalPhase = 'LEADER';
            else if (rank <= candidateCutoff) finalPhase = 'CANDIDATE';

            // ── 피크아웃 5패턴 스코어링 ──
            const hist: any[] = (item as any)._history || [];
            const n = hist.length;
            let peakoutScore = 0;

            if (n >= 2) {
                // 기간 평균 거래대금 (전체 기간 window 기준)
                const avgTv = hist.reduce((s: number, h: any) => s + h.trading_value, 0) / n;
                const periodHigh = (item as any).drawdownFromPeak !== undefined
                    ? item.avgTradingValue  // 이미 계산됨
                    : 0;
                // 철저한 고점 연동
                const maxHigh = hist.reduce((m: number, h: any) => Math.max(m, h.high), 0);

                // P1: 바이잊 클라이맥스 (+3)
                // 기간 내 평균 거래대금 3배+ 음봉 + 고점 85% 굼어
                if (s.p1BuyingClimax) {
                    const today = hist[n - 1];
                    if (
                        today.trading_value >= avgTv * 3 &&
                        today.close < today.open &&     // 음봉
                        today.high >= maxHigh * 0.85    // 고점 근처
                    ) peakoutScore += 3;
                }

                // P2: 위꼼리 장대봉 (+2)
                // 위꼼리 = (high-close)/(high-low) > 60%, 거래대금 2배+, 고점 85%굼어
                if (s.p2ShootingStar) {
                    const today = hist[n - 1];
                    const range = today.high - today.low;
                    const upperShadow = range > 0 ? (today.high - today.close) / range : 0;
                    if (
                        upperShadow > 0.6 &&
                        today.trading_value >= avgTv * 2 &&
                        today.high >= maxHigh * 0.85
                    ) peakoutScore += 2;
                }

                // P3: 갭업 키리버샄 (+3)
                // 시가 > 전일종가 AND 종가 < 전일종가 AND 거래대금 1.5배+
                if (s.p3GapReversal && n >= 2) {
                    const today = hist[n - 1];
                    const prev  = hist[n - 2];
                    if (
                        today.open > prev.close &&
                        today.close < prev.close &&
                        today.trading_value >= avgTv * 1.5
                    ) peakoutScore += 3;
                }

                // P4: 연속 3일 음봉 + 거래대금 증가 (+2)
                if (s.p4ConsecBearish && n >= 6) {
                    const last3 = hist.slice(n - 3);
                    const prev3 = hist.slice(n - 6, n - 3);
                    const last3bearish = last3.every((h: any) => h.close < h.open);
                    const avgLast3tv   = last3.reduce((sum: number, h: any) => sum + h.trading_value, 0) / 3;
                    const avgPrev3tv   = prev3.reduce((sum: number, h: any) => sum + h.trading_value, 0) / 3;
                    if (last3bearish && avgLast3tv > avgPrev3tv) peakoutScore += 2;
                }

                // P5: 신고가 다이버전스 (+2)
                // 가장 최근 고점이 현재이면서 거래대금이 직전 고점 당시보다 70% 미만
                if (s.p5Divergence && n >= 3) {
                    const today = hist[n - 1];
                    // 평균 거래대금 기준 최고점 날 찾기
                    const prevHighDay = hist.slice(0, n - 1).reduce(
                        (best: any, h: any) => h.high > best.high ? h : best, hist[0]
                    );
                    if (
                        today.high >= prevHighDay.high &&         // 신고가 돌파 시도
                        today.trading_value < prevHighDay.trading_value * 0.7 && // 기래량 70% 미만
                        today.close < today.high * 0.95           // 고점에서 눈맀려짐
                    ) peakoutScore += 2;
                }

                // 낙폭 보너스
                const ddp = item.drawdownFromPeak || 0;
                if (ddp >= s.drawdownThreshold) peakoutScore += 1;
                if (ddp >= 20)                  peakoutScore += 1;
            }

            // 레벨 판정
            const peakoutLevel: 'NONE' | 'ALERT' | 'CONFIRMED' =
                peakoutScore >= s.confirmedThreshold ? 'CONFIRMED' :
                peakoutScore >= s.alertThreshold     ? 'ALERT' : 'NONE';

            const { _history: _, ...cleanItem } = item as any;
            return {
                ...cleanItem,
                phase: finalPhase,
                rank,          // 기간 내 순위 (1~topN) — CrossPeriodAnalyzer 가중 점수 계산용
                peakoutScore,
                peakoutLevel,
                peakoutWarning: peakoutLevel !== 'NONE', // 호환성 유지
            } as MarketLeaderItem;
        });
    }

    /**
     * 특정 주도주 리스트를 바탕으로 [현 시점 1대장 주도 테마] 랭킹을 추출 (Reverse Theme Lookup)
     */
    public discoverMainThemes(leaders: MarketLeaderItem[]): { theme: string, count: number }[] {
        const themeCounter: Record<string, number> = {};

        leaders.forEach(leader => {
            leader.relatedThemes.forEach(theme => {
                themeCounter[theme] = (themeCounter[theme] || 0) + 1;
            });
        });

        // 리더 내 빈도 역순 정렬하고, 실제 반환하는 count는 해당 테마의 전체 시장 종목 수로 할당
        return Object.entries(themeCounter)
            .sort((a, b) => b[1] - a[1]) 
            .map(([theme, leaderCount]) => {
                // UI에서 보여줄 때는 시장 전체 종목수 반환
                const totalCount = this.globalThemeFrequency.get(theme) || leaderCount;
                return { theme, count: totalCount };
            });
    }
}
