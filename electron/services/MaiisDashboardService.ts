import { DatabaseService } from './DatabaseService';

export class MaiisDashboardService {
    private static instance: MaiisDashboardService;
    private db: DatabaseService;

    private constructor() {
        this.db = DatabaseService.getInstance();
    }

    public static getInstance(): MaiisDashboardService {
        if (!MaiisDashboardService.instance) {
            MaiisDashboardService.instance = new MaiisDashboardService();
        }
        return MaiisDashboardService.instance;
    }

    /**
     * 프론트엔드(MaiisCommandCenter.tsx)가 그리기 편한 형태로 데이터를 가공하여 반환합니다.
     * 마스터 AI의 score_adjustments, new_alpha_picks 결과가 반영됩니다.
     */
    public getCommandCenterData(targetDate?: string) {
        // 날짜 형식 정규화: getKstDate()가 '2026-03-20' 형식이므로 DB 형식 '20260320'으로 통일
        const rawDate = targetDate || this.db.getKstDate();
        let date = rawDate.replace(/-/g, '');
        
        // --- Zero-State 방지: 당일 데이터가 없을 경우 가장 최근 영업일 데이터로 Fallback ---
        let isFallbackDate = false;
        try {
            const latestTheme = this.db.getDb().prepare(`SELECT date FROM maiis_theme_rankings WHERE date <= ? ORDER BY date DESC LIMIT 1`).get(date) as any;
            if (latestTheme && latestTheme.date !== date) {
                console.log(`[MaiisDashboard] ⚠️ 당일 데이터 없음. ${date} -> ${latestTheme.date} (가장 최근 영업일) 기준으로 조회합니다.`);
                date = latestTheme.date;
                isFallbackDate = true;
            }
        } catch (e) {
            console.warn(`[MaiisDashboard] Fallback check failed:`, e);
        }

        console.log(`[MaiisDashboard] Fetching dashboard data for date: ${date} (raw: ${rawDate}, fallback: ${isFallbackDate})`);
        
        // ──────────────────────────────────────────────
        // 1. 시황리포트 (Market Reports) -> maiis_world_state_v2
        // ──────────────────────────────────────────────
        const reportsStmt = this.db.getDb().prepare(`
            SELECT date, timing, sentiment_score, market_thesis, 
                   score_adjustments_json, new_alpha_picks_json, drop_alpha_picks_json,
                   self_reflection
            FROM maiis_world_state_v2 
            WHERE date <= ? 
            ORDER BY date DESC, timing DESC LIMIT 7
        `);
        const recentStates = reportsStmt.all(date) as any[];
        console.log(`[MaiisDashboard] Found ${recentStates.length} world states`);
        
        const marketReports = recentStates.map(state => {
            const dateStr = state.date.slice(4,6) + '/' + state.date.slice(6,8);
            let mode = 'Neutral';
            if (state.sentiment_score > 0.6) mode = 'Risk On';
            else if (state.sentiment_score < 0.4) mode = 'Risk Off';
            
            const timingLabel = state.timing === '0845' ? '장전' : state.timing === '0930' ? '장중' : '장마감';
            
            return {
                date: `${dateStr} ${timingLabel}`,
                mode,
                score: state.sentiment_score ? state.sentiment_score.toFixed(2) : '0.00',
                text: state.market_thesis || '데이터 없음'
            };
        });

        // ──────────────────────────────────────────────
        // 2. 섹터 랭킹 -> maiis_theme_rankings + Master AI의 score_adjustments 반영
        // ──────────────────────────────────────────────
        const currentThemes = this.db.getActiveThemeRankings(date) || [];
        
        // 어제 랭킹 구하기 (change 연산을 위해)
        const previousDateStmt = this.db.getDb().prepare(`
            SELECT DISTINCT date FROM maiis_theme_rankings WHERE date < ? ORDER BY date DESC LIMIT 1
        `);
        const prevRow = previousDateStmt.get(date) as { date: string } | undefined;
        const prevThemes = prevRow ? this.db.getActiveThemeRankings(prevRow.date) : [];
        
        // Master AI의 score_adjustments 가져오기
        const todayMasterState = this.db.getMasterWorldState(date, '0845');
        let scoreAdjustments: any[] = [];
        if (todayMasterState && todayMasterState.score_adjustments_json) {
            try { scoreAdjustments = JSON.parse(todayMasterState.score_adjustments_json); } catch(e) {}
        }
        
        const sectorRankings = currentThemes.map((theme, index) => {
            const currentRank = index + 1;
            const prevTheme = prevThemes.find(pt => pt.theme_name === theme.theme_name);
            const prevRank = prevTheme ? prevThemes.indexOf(prevTheme) + 1 : currentRank;
            const change = prevRank - currentRank;
            
            // Master AI의 점수 조정 반영
            const adjustment = scoreAdjustments.find((a: any) => 
                theme.theme_name.includes(a.target_theme) || a.target_theme.includes(theme.theme_name)
            );
            const aiAdjustText = adjustment 
                ? `[AI 조정: ${adjustment.adjustment_point > 0 ? '+' : ''}${adjustment.adjustment_point}] ${adjustment.reason}`
                : '';
            
            return {
                rank: currentRank,
                change: change,
                isUp: change > 0,
                badge: theme.theme_name,
                weight: theme.final_score ? Math.round(theme.final_score) : 0,
                text: aiAdjustText || theme.ai_reason || '알고리즘에 의한 기계적 스코어링'
            };
        });

        // ──────────────────────────────────────────────
        // 2.5 키워드 랭킹 -> maiis_keyword_rankings
        // ──────────────────────────────────────────────
        const keywordsStmt = this.db.getDb().prepare(`
            SELECT keyword, frequency, score, reason FROM maiis_keyword_rankings
            WHERE date = ? ORDER BY score DESC LIMIT 10
        `);
        const currentKeywords = keywordsStmt.all(date) as any[];
        
        const prevKeywordsStmt = this.db.getDb().prepare(`
            SELECT keyword FROM maiis_keyword_rankings WHERE date = ? ORDER BY score DESC
        `);
        const prevKeywords = prevRow ? prevKeywordsStmt.all(prevRow.date) as any[] : [];

        const keywordRankings = currentKeywords.map((kw, index) => {
            const currentRank = index + 1;
            const prevKwIndex = prevKeywords.findIndex(pk => pk.keyword === kw.keyword);
            const prevRank = prevKwIndex >= 0 ? prevKwIndex + 1 : currentRank;
            const change = prevRank - currentRank;
            
            // AI evidence가 있으면 우선 사용, 없으면 폴백
            const reasonText = kw.reason && kw.reason.length > 5 
                ? kw.reason.slice(0, 120) // 너무 길면 잘라냄
                : kw.score >= 70 ? `시장 핵심 주도 키워드 (영향력: ${kw.score}/100)` 
                : kw.score >= 40 ? `주요 시장 키워드 (영향력: ${kw.score}/100)` 
                : `유튜브 및 뉴스 헤드라인에서 ${kw.frequency}회 집중 언급된 키워드입니다.`;

            return {
                rank: currentRank,
                change: change,
                isUp: change > 0,
                badge: `#${kw.keyword}`,
                weight: kw.score,
                text: reasonText
            };
        });

        // ──────────────────────────────────────────────
        // 3. 추천종목 -> daily_rising_stocks (Phase 1) + Master AI 태그 병합
        // ──────────────────────────────────────────────
        
        // 3-1. 오늘의 급등/주도주 분석 결과 (메인 데이터 소스)
        // daily_rising_stocks는 ISO 날짜 ('2026-03-20'), dashboard는 compact ('20260320')
        const isoDate = date.length === 8 
            ? `${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6,8)}` 
            : date;
        
        // 타이밍별 시도 (ISO + compact 모두)
        const timingPriority = ['EVENING', 'MORNING', 'MANUAL'];
        let risingStocks: any[] = [];
        for (const timing of timingPriority) {
            if (risingStocks.length > 0) break;
            risingStocks = this.db.getRisingStocksByDate(isoDate, timing);
            if (risingStocks.length === 0) {
                risingStocks = this.db.getRisingStocksByDate(date, timing);
            }
        }

        // 오늘 데이터가 전혀 없으면, 가장 최근 날짜 데이터로 폴백
        if (risingStocks.length === 0) {
            const latestRow = this.db.getDb().prepare(
                'SELECT date, timing FROM daily_rising_stocks ORDER BY date DESC, timing DESC LIMIT 1'
            ).get() as any;
            if (latestRow) {
                risingStocks = this.db.getRisingStocksByDate(latestRow.date, latestRow.timing);
                console.log(`[MaiisDashboard] Rising stocks fallback to latest: ${latestRow.date} ${latestRow.timing} (${risingStocks.length}건)`);
            }
        }

        console.log(`[MaiisDashboard] Rising stocks for ${isoDate}: ${risingStocks.length}건`);
        const allRisingStocks = risingStocks;

        // 3-2. Master AI 의견 (태그용)
        let masterNewPicks: any[] = [];
        let masterDropPicks: any[] = [];
        if (todayMasterState) {
            if (todayMasterState.new_alpha_picks_json) {
                try { masterNewPicks = JSON.parse(todayMasterState.new_alpha_picks_json); } catch(e) {}
            }
            if (todayMasterState.drop_alpha_picks_json) {
                try { masterDropPicks = JSON.parse(todayMasterState.drop_alpha_picks_json); } catch(e) {}
            }
        }

        // 3-3. 기존 보유 종목 (maiis_active_picks)
        const activePicks = this.db.getActivePicks() || [];
        const activePickNames = new Set(activePicks.map(p => p.stock_name));
        const masterNewNames = new Set(masterNewPicks.map(p => p.stock_name));
        const masterDropNames = new Set(masterDropPicks.map(p => p.stock_name));

        // 3-4. 통합 추천종목 리스트 구성
        const recommendedStocks = allRisingStocks.slice(0, 15).map((stock, index) => {
            // 상태 태그 결정
            let statusTag = '';
            if (masterNewNames.has(stock.stock_name)) {
                statusTag = '⭐ 마스터 추천';
            } else if (masterDropNames.has(stock.stock_name)) {
                statusTag = '⚠️ 매도 검토';
            } else if (activePickNames.has(stock.stock_name)) {
                statusTag = '📌 보유 중';
            }

            // 마스터 추천 사유가 있으면 병합
            const masterPick = masterNewPicks.find(p => p.stock_name === stock.stock_name);
            const masterReason = masterPick ? `[마스터] ${masterPick.reason}` : '';
            const displayReason = masterReason || stock.reason || stock.theme_sector || '';

            return {
                rank: index + 1,
                change: 0,
                isUp: (stock.change_rate || 0) >= 0,
                name: stock.stock_name,
                code: stock.stock_code,
                score: stock.ai_score || 0,
                changeRate: stock.change_rate ? `${stock.change_rate > 0 ? '+' : ''}${stock.change_rate.toFixed(1)}%` : '-',
                theme: stock.theme_sector || '',
                statusTag,
                profit: statusTag === '📌 보유 중' 
                    ? (() => {
                        const held = activePicks.find(p => p.stock_name === stock.stock_name);
                        return held ? `${held.profit_rate >= 0 ? '+' : ''}${(held.profit_rate || 0).toFixed(1)}%` : '-';
                    })()
                    : stock.change_rate ? `${stock.change_rate > 0 ? '+' : ''}${stock.change_rate.toFixed(1)}%` : '-',
                days: (() => {
                    if (!activePickNames.has(stock.stock_name)) return '';
                    const held = activePicks.find(p => p.stock_name === stock.stock_name);
                    if (!held) return '';
                    try {
                        const rd = held.recommend_date;
                        const recoDate = new Date(`${rd.slice(0,4)}-${rd.slice(4,6)}-${rd.slice(6,8)}`);
                        const today = new Date(`${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6,8)}`);
                        return `${Math.max(0, Math.ceil((today.getTime() - recoDate.getTime()) / (1000 * 60 * 60 * 24)))}d`;
                    } catch { return ''; }
                })(),
                reason: displayReason
            };
        });

        // 3-5. 마스터가 추천했지만 rising_stocks에 없는 종목도 추가
        masterNewPicks.forEach(pick => {
            if (!recommendedStocks.find(r => r.name === pick.stock_name)) {
                recommendedStocks.push({
                    rank: recommendedStocks.length + 1,
                    change: 0,
                    isUp: true,
                    name: pick.stock_name,
                    code: pick.stock_code || '',
                    score: 95,
                    changeRate: '-',
                    theme: '',
                    statusTag: '⭐ 마스터 추천',
                    profit: 'NEW',
                    days: '0d',
                    reason: `[마스터 편입] ${pick.reason || 'Master AI 추천'}`
                });
            }
        });

        // 3-6. 점수순 정렬 후 rank 재부여
        recommendedStocks.sort((a, b) => b.score - a.score);
        recommendedStocks.forEach((item, i) => { item.rank = i + 1; });

        // ──────────────────────────────────────────────
        // 4. 마스터 AI 요약 (오늘의 대전제)
        // ──────────────────────────────────────────────
        const masterSummary = todayMasterState ? {
            thesis: todayMasterState.market_thesis || '',
            sentiment: todayMasterState.sentiment_score || 0,
            timing: todayMasterState.timing || '0845'
        } : null;

        console.log(`[MaiisDashboard] Reports: ${marketReports.length}, Sectors: ${sectorRankings.length}, Keywords: ${keywordRankings.length}, Stocks: ${recommendedStocks.length}`);

        // ──────────────────────────────────────────────
        // 5. 테마/키워드 트렌드 히스토리 (최근 5일간 Top 5 추이)
        // ──────────────────────────────────────────────
        const trendDatesStmt = this.db.getDb().prepare(`
            SELECT DISTINCT date FROM maiis_theme_rankings WHERE date <= ? ORDER BY date DESC LIMIT 5
        `);
        const trendDates = (trendDatesStmt.all(date) as any[]).map(r => r.date).reverse();
        
        // TOP 5 테마의 이름 목록 (오늘 기준)
        const top5Themes = sectorRankings.slice(0, 5).map(s => s.badge);
        
        const themeHistStmt = this.db.getDb().prepare(`
            SELECT theme_name, final_score FROM maiis_theme_rankings WHERE date = ? ORDER BY final_score DESC
        `);
        
        const themeTrend = {
            dates: trendDates.map(d => `${d.slice(4,6)}-${d.slice(6,8)}`),
            series: top5Themes.map(name => ({
                name,
                data: trendDates.map(d => {
                    const rows = themeHistStmt.all(d) as any[];
                    const found = rows.find(r => r.theme_name === name);
                    return found ? Math.round(found.final_score) : 0;
                })
            }))
        };
        
        // TOP 5 키워드 트렌드
        const kwTrendDatesStmt = this.db.getDb().prepare(`
            SELECT DISTINCT date FROM maiis_keyword_rankings WHERE date <= ? ORDER BY date DESC LIMIT 5
        `);
        const kwTrendDates = (kwTrendDatesStmt.all(date) as any[]).map(r => r.date).reverse();
        const top5Keywords = keywordRankings.slice(0, 5).map(k => k.badge);
        
        const kwHistStmt = this.db.getDb().prepare(`
            SELECT keyword, score FROM maiis_keyword_rankings WHERE date = ? ORDER BY score DESC
        `);
        
        const keywordTrend = {
            dates: kwTrendDates.map(d => `${d.slice(4,6)}-${d.slice(6,8)}`),
            series: top5Keywords.map(name => ({
                name,
                data: kwTrendDates.map(d => {
                    const rows = kwHistStmt.all(d) as any[];
                    const found = rows.find(r => r.keyword === name);
                    return found ? Math.round(found.score) : 0;
                })
            }))
        };

        // ──────────────────────────────────────────────
        // 6. PM 포트폴리오 (maiis_portfolio)
        // ──────────────────────────────────────────────
        const portfolio = this.db.getPortfolio();

        return {
            isFallbackDate,
            activeDate: date,
            marketReports,
            sectorRankings,
            keywordRankings,
            recommendedStocks,
            portfolio,
            masterSummary,
            sentimentChart: recentStates.map(r => r.sentiment_score || 0).reverse(),
            sentimentLabels: recentStates.map(r => {
                const d = r.date;
                const timingLabel = r.timing === '0845' ? '아침' : r.timing === '0930' ? '장중' : '마감';
                return `${d.slice(4,6)}/${d.slice(6,8)} ${timingLabel}`;
            }).reverse(),
            themeTrend,
            keywordTrend
        };
    }
}
