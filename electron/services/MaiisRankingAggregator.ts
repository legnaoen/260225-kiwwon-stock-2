import { DatabaseService } from './DatabaseService';
import { MaiisDomainService } from './MaiisDomainService';
import { YahooFinanceService } from './YahooFinanceService';
import { normalizeThemeName } from './MaiisThemeConstants';

/**
 * 하위 에이전트(Youtube, News, RisingStocks)의 파편화된 리포트를
 * 하나의 '기계적 객관적 점수'로 취합하여 DB(State)에 영속화하는 파이프라인.
 * 마스터 AI가 기상하기 전(08:45 전)에 실행되어야 합니다.
 */
export class MaiisRankingAggregator {
    private static instance: MaiisRankingAggregator;
    private db = DatabaseService.getInstance();
    private domainService = MaiisDomainService.getInstance();
    private yahooDb = YahooFinanceService.getInstance();

    private constructor() {}

    public static getInstance() {
        if (!MaiisRankingAggregator.instance) {
            MaiisRankingAggregator.instance = new MaiisRankingAggregator();
        }
        return MaiisRankingAggregator.instance;
    }

    /**
     * 메인 취합 파이프라인. 3단계 모두 실행.
     */
    public async runDailyAggregation(targetDate?: string) {
        // 날짜 형식 정규화: UI에서 '2026-03-20' 형태로 올 수 있으므로 DB 형식 'YYYYMMDD'로 통일
        let date = targetDate || this.db.getKstDate();
        date = date.replace(/-/g, ''); // '2026-03-20' -> '20260320'
        console.log(`[MaiisRankingAggregator] ${date} 기준 상태 취합 파이프라인 시작...`);

        const themeRes = await this.aggregateThemes(date);
        const keywordRes = await this.aggregateKeywords(date);
        const pickRes = await this.updateActivePicksProfit(date);

        console.log(`[MaiisRankingAggregator] ${date} 파이프라인 종료.`);
        return {
            themes_aggregated: themeRes,
            keywords_extracted: keywordRes,
            picks_updated: pickRes
        };
    }

    /**
     * 1. 테마 점수 병합 (Youtube + News + RisingStocks)
     */
    private async aggregateThemes(date: string) {
        const insights = this.db.getMaiisDomainInsights(date);
        const youtube = insights.find(i => i.domain_type === 'YOUTUBE');
        const news = insights.find(i => i.domain_type === 'NEWS');
        const rising = this.domainService.getRisingStocksSummary(date);

        const themeScores = new Map<string, { youtube: number, news: number, rising: number }>();
        const themeEvidence = new Map<string, string>(); // 테마별 핵심 설명 수집

        // Parsing Helpers
        const safeParse = (jsonStr: string) => {
            try { return JSON.parse(jsonStr); } catch { return null; }
        };

        const addScore = (theme: string, source: 'youtube' | 'news' | 'rising', score: number, evidence?: string) => {
            const normalizedTheme = normalizeThemeName(theme);
            if (!themeScores.has(normalizedTheme)) themeScores.set(normalizedTheme, { youtube: 0, news: 0, rising: 0 });
            // 동일 표준 테마에 대해 max 값 유지 (같은 소스에서 다른 원본 테마명이 같은 표준으로 매핑될 수 있음)
            themeScores.get(normalizedTheme)![source] = Math.max(themeScores.get(normalizedTheme)![source], score);
            // evidence가 더 상세한(긴) 것으로 교체
            if (evidence && (!themeEvidence.has(normalizedTheme) || evidence.length > (themeEvidence.get(normalizedTheme)?.length || 0))) {
                themeEvidence.set(normalizedTheme, evidence);
            }
        };

        // 1-1. Youtube 파싱
        if (youtube && youtube.generated_json) {
            const data = safeParse(youtube.generated_json);
            if (data?.top_themes) {
                data.top_themes.forEach((t: any) => addScore(t.theme_name, 'youtube', Number(t.intensity) || 0, t.evidence));
            }
        }

        // 1-2. News 파싱
        if (news && news.generated_json) {
            const data = safeParse(news.generated_json);
            if (data?.top_themes) {
                data.top_themes.forEach((t: any) => addScore(t.theme_name, 'news', Number(t.intensity) || 0, t.evidence));
            }
        }

        // 1-3. Rising Stocks (급등주 수급 파싱)
        if (rising && rising.success !== false) {
            if (rising.pure_rising_themes) {
                rising.pure_rising_themes.forEach((t: any) => {
                    // 수급 강도는 스케일이 다르므로 정규화(예: 최고 100점으로 캡)
                    const normScore = Math.min(t.total_strength || 0, 100);
                    addScore(t.theme_name, 'rising', normScore);
                });
            }
        }

        // 1-4. 가중 평균 합산 후 DB에 저장 (ai_reason 포함)
        const stmt = this.db.getDb().prepare(`
            INSERT OR REPLACE INTO maiis_theme_rankings (date, theme_name, base_score, final_score, ai_reason)
            VALUES (?, ?, ?, ?, ?)
        `);
        
        const saveMany = this.db.getDb().transaction((items) => {
            for (const item of items) stmt.run(item.date, item.theme_name, item.score, item.score, item.ai_reason || null);
        });

        const recordsToSave: any[] = [];
        themeScores.forEach((scores, theme) => {
            // (유튜브 30% + 뉴스 40% + 수급 30%) 비중 임시 적용
            const baseScore = (scores.youtube * 0.3) + (scores.news * 0.4) + (scores.rising * 0.3);
            if (baseScore > 0) {
                recordsToSave.push({ 
                    date, 
                    theme_name: theme, 
                    score: baseScore,
                    ai_reason: themeEvidence.get(theme) || ''
                });
            }
        });

        if (recordsToSave.length > 0) {
            saveMany(recordsToSave);
            console.log(`[MaiisRankingAggregator] ${recordsToSave.length}개 테마 Base Score + Evidence 업데이트 완료.`);
        }
        return recordsToSave;
    }

    /**
     * 2. 핵심 키워드 점수 추출 (AI impact_score 기반)
     */
    private async aggregateKeywords(date: string) {
        const insights = this.db.getMaiisDomainInsights(date);
        // 키워드별 최고 impact_score와 등장 횟수, 설명을 추적
        const keywordScores = new Map<string, { maxImpact: number, frequency: number, reason: string }>();

        const safeParse = (jsonStr: string) => {
            try { return JSON.parse(jsonStr); } catch { return null; }
        };

        insights.forEach(insight => {
            const data = safeParse(insight.generated_json);
            if (data?.top_themes) {
                data.top_themes.forEach((theme: any) => {
                    const themeEvidence = theme.evidence || theme.theme_name || '';
                    if (theme.related_keywords && Array.isArray(theme.related_keywords)) {
                        theme.related_keywords.forEach((k: any) => {
                            // 신규 포맷: { keyword, impact_score } 객체
                            if (typeof k === 'object' && k.keyword) {
                                const word = k.keyword.trim().replace(/^#/, '');
                                const impact = Number(k.impact_score) || 10;
                                const existing = keywordScores.get(word) || { maxImpact: 0, frequency: 0, reason: '' };
                                const newReason = impact > existing.maxImpact ? themeEvidence : existing.reason;
                                keywordScores.set(word, {
                                    maxImpact: Math.max(existing.maxImpact, impact),
                                    frequency: existing.frequency + 1,
                                    reason: newReason
                                });
                            }
                            // 레거시 포맷: 단순 문자열
                            else if (typeof k === 'string') {
                                const word = k.trim().replace(/^#/, '');
                                const existing = keywordScores.get(word) || { maxImpact: 0, frequency: 0, reason: '' };
                                keywordScores.set(word, {
                                    maxImpact: Math.max(existing.maxImpact, 10),
                                    frequency: existing.frequency + 1,
                                    reason: existing.reason || themeEvidence
                                });
                            }
                        });
                    }
                });
            }
        });

        // impact_score 기준으로 정렬, 동점 시 frequency로 2차 정렬
        const sortedKeywords = Array.from(keywordScores.entries())
            .sort((a, b) => b[1].maxImpact - a[1].maxImpact || b[1].frequency - a[1].frequency)
            .slice(0, 20);

        const stmt = this.db.getDb().prepare(`
            INSERT OR REPLACE INTO maiis_keyword_rankings (date, keyword, frequency, score, reason)
            VALUES (?, ?, ?, ?, ?)
        `);

        const saveMany = this.db.getDb().transaction((items) => {
            for (const item of items) stmt.run(item.date, item.keyword, item.frequency, item.score, item.reason || null);
        });

        const records = sortedKeywords.map(([kw, data]) => ({
            date, keyword: kw, frequency: data.frequency, score: data.maxImpact, reason: data.reason
        }));

        if (records.length > 0) {
            saveMany(records);
            console.log(`[MaiisRankingAggregator] ${records.length}개 핵 키워드 (impact_score 기반) 업데이트 완료.`);
        }
        return records;
    }

    /**
     * 3. 알파 픽 수익률 자동 갱신 (Active Picks Update)
     */
    private async updateActivePicksProfit(date: string) {
        // ACTIVE 상태인 모든 보유 종목을 가져옴
        const activePicks = this.db.getDb().prepare(`SELECT * FROM maiis_active_picks WHERE status = 'ACTIVE'`).all() as any[];
        if (activePicks.length === 0) return [];

        console.log(`[MaiisRankingAggregator] ${activePicks.length}개 보유 종목 수익률 업데이트 핑 시작...`);
        const updatedRecords = [];

        for (const pick of activePicks) {
            try {
                // 야후 파이낸스에서 한국 주식 조회를 위해 '.KS' 혹은 '.KQ' 부착 로직이 필요하나,
                // 여기서는 최대한 YahooFinanceService의 getMacroIndicator 호환 코드를 호출한다고 가정
                // 실 서비스 시 키움 Rest 실시간 API 호출로 교체 가능!
                const symbol = pick.stock_code + '.KS'; // 임시 예시
                const data = await this.yahooDb.getMacroIndicator(symbol); 
                
                if (data && data.quotes && data.quotes.length > 0) {
                    const latestClose = data.quotes[data.quotes.length - 1].close;
                    const recoPrice = pick.reco_price || latestClose; // 매수가가 없으면 임시 방어
                    
                    const profitRate = ((latestClose - recoPrice) / recoPrice) * 100;

                    this.db.getDb().prepare(`
                        UPDATE maiis_active_picks 
                        SET current_price = ?, profit_rate = ?, updated_at = ?
                        WHERE stock_code = ?
                    `).run(latestClose, profitRate, new Date().toISOString(), pick.stock_code);
                    
                    updatedRecords.push({ stock_name: pick.stock_name, profit_rate: profitRate.toFixed(2) + '%' });
                }
            } catch (error) {
                console.error(`[MaiisRankingAggregator] ${pick.stock_name} 현재가 갱신 실패:`, error);
            }
        }
        console.log(`[MaiisRankingAggregator] 보유 종목 업데이트 완료.`);
        return updatedRecords;
    }
}
