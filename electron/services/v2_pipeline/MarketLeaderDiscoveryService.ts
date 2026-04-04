import { DatabaseService } from '../DatabaseService';
import { getPastDateKst } from '../../utils/DateUtils';

export interface MarketLeaderItem {
    stockCode: string;
    stockName: string;
    totalChangeRate: number; // 누적 수익률 (%)
    marketAlpha: number;     // 시장대비 알파 (%)
    avgTradingValue: number; // 평균 거래대금
    score: number;           // 최종 순위 산정용 점수 (알파 * 유동성 가중치)
    relatedThemes: string[]; // 중복 제거된 테마/섹터 키워드 배열
}

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
    public getMarketLeaders(targetDays: number = 10, marketIndexChange: number = 0, topN: number = 30): MarketLeaderItem[] {
        const targetDate = getPastDateKst(targetDays);
        const db = (this.dbService as any).db; // SQLite Database 인스턴스

        // 1. market_ohlcv_history 데이터를 호출하여 메모리 Map 적재 (전 종목 파동 데이터)
        const ohlcvRows = db.prepare(`
            SELECT stock_code, date, close, trading_value
            FROM market_ohlcv_history
            WHERE date >= ?
            ORDER BY stock_code, date ASC
        `).all(targetDate) as any[];

        const stockMap = new Map<string, { firstClose: number, lastClose: number, totalTrdVal: number, count: number }>();

        ohlcvRows.forEach(row => {
            const sc = row.stock_code;
            const item = stockMap.get(sc);
            if (!item) {
                stockMap.set(sc, { firstClose: row.close, lastClose: row.close, totalTrdVal: row.trading_value || 0, count: 1 });
            } else {
                item.lastClose = row.close;
                item.totalTrdVal += (row.trading_value || 0);
                item.count += 1;
            }
        });

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

        // 3. 알파(Alpha) 스코어 계산 알고리즘
        const leaders: MarketLeaderItem[] = [];
        
        for (const [stockCode, data] of stockMap.entries()) {
            // 충분한 데이터가 없거나 시작 가격이 0인 오류 종목 제외
            if (data.count < 1 || data.firstClose <= 0) continue;
            
            // 누적 변동률 = (현재가 - 최초기준가) / 최초기준가 * 100
            const totalChangeRate = ((data.lastClose - data.firstClose) / data.firstClose) * 100;
            const alpha = totalChangeRate - marketIndexChange;
            const avgTradingValue = data.totalTrdVal / data.count;

            // 유동성(수급) 로그 스케일 가중치 (로그를 취해 너무 큰 대형주 편향 방지)
            const liquidityWeight = Math.log10(Math.max(avgTradingValue, 1));
            
            // Score 산정 (마이너스 수치일수도 있음. 그럴 경우 음수 처리 보정)
            const score = alpha > 0 ? alpha * liquidityWeight : alpha;

            const meta = themeMap.get(stockCode);
            let stockName = meta?.name;
            if (!stockName || stockName === stockCode || stockName === '') {
                stockName = masterNamesMap.get(stockCode) || stockCode;
            }

            leaders.push({
                stockCode,
                stockName,
                totalChangeRate,
                marketAlpha: alpha,
                avgTradingValue: avgTradingValue,
                score: score,
                relatedThemes: meta ? Array.from(meta.themes) : []
            });
        }

        // 4. 최종 점수(Score) 순으로 내림차순 정렬 후 Top N 반환
        return leaders.sort((a, b) => b.score - a.score).slice(0, topN);
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
