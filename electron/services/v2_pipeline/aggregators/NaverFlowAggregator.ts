import { IBaseAggregator } from '../types/PipelineTypes';
import { DatabaseService } from '../../DatabaseService';
import axios from 'axios';

interface MarketFlowItem {
    type: string;
    rank_num: number;
    name: string;
    change_rate: number;
    detail_url: string;
}

export class NaverFlowAggregator implements IBaseAggregator {
    private dbService = DatabaseService.getInstance();
    private proxyUrl = 'http://127.0.0.1:5050/api/fetch_any';
    private proxyJsonUrl = 'http://127.0.0.1:5050/api/proxy_json';

    public async process(rawData: any): Promise<string> {
        if (!rawData || !rawData.rawMarkdownList || rawData.rawMarkdownList.length === 0) {
            return '네이버 흐름 파이프라인에서 추출된 리스트가 없습니다.';
        }

        const dateStr = new Date(rawData.timestamp).toLocaleDateString('sv-SE'); // YYYY-MM-DD
        const allParsedItems: MarketFlowItem[] = [];
        const lines: string[] = ['### 🌊 네이버 마켓 흐름 (업종 및 테마 최상위 트렌드)\n'];

        lines.push(`> 📊 수집 시각: ${new Date(rawData.timestamp).toLocaleString('ko-KR')}\n`);

        for (const item of rawData.rawMarkdownList) {
            const { type, markdown } = item; // 'SECTOR' or 'THEME'
            const typeNameKOR = type === 'SECTOR' ? '업종' : '테마';

            try {
                const parsedList = this.parseNaverSPAMarkdown(markdown, type);

                if (parsedList.length > 0) {
                    const top20 = parsedList.slice(0, 20);

                    lines.push(`#### 🥇 Top 10 ${typeNameKOR}`);
                    lines.push('| 순위 | 이름 | 당일 등락률 |');
                    lines.push('| :---: | :--- | :---: |');

                    const dbPayload = top20.map(p => ({
                        date: dateStr,
                        type: type,
                        rank_num: p.rank_num,
                        name: p.name,
                        change_rate: p.change_rate
                    }));

                    this.dbService.upsertNaverMarketFlow(dbPayload);

                    // ★ 누적 어휘 사전에도 저장 (삭제 없음 - 이슈 AI 정합 기준)
                    this.dbService.upsertNaverVocabulary(
                        top20.map(p => ({ name: p.name, type, date: dateStr }))
                    );

                    allParsedItems.push(...top20);

                    for (const p of top20.slice(0, 10)) {
                        const arrow = p.change_rate > 0 ? '🔴' : (p.change_rate < 0 ? '🔵' : '⚫');
                        lines.push(`| ${p.rank_num} | **${p.name}** | ${arrow} ${p.change_rate > 0 ? '+' : ''}${p.change_rate}% |`);
                    }
                    lines.push('');

                    // Phase 2: 주도주 및 전체 종목 추출 (Top 20 전체 기준)
                    lines.push(`\n**🔍 핵심 선도주 (Alpha) 및 전체 종목 수집 (Top 20 ${typeNameKOR} 기준)**`);
                    lines.push('> UI 표시를 위해 전체 종목을 수집하며, 그룹 평균 등락률을 고려해 대장주를 선별합니다.');
                    lines.push('');

                    const targetGroups = top20;
                    for (const topItem of targetGroups) {
                        if (!topItem.detail_url) continue;

                        try {
                            // detail_url에서 그룹 ID 추출: /market/stock/kr/industry/1?no=294 → 294
                            const noMatch = topItem.detail_url.match(/no=(\d+)/);
                            if (!noMatch) {
                                console.warn(`[NaverFlowAggregator] no= 파라미터 없음: ${topItem.detail_url}`);
                                continue;
                            }
                            const groupId = noMatch[1];
                            const apiType = type === 'SECTOR' ? 'industry' : 'theme';
                            const naverApiUrl = `https://m.stock.naver.com/api/stocks/${apiType}/${groupId}?page=1&pageSize=30`;

                            console.log(`[NaverFlowAggregator] Fetching JSON API: ${naverApiUrl}`);
                            
                            // Python 프록시를 통해 네이버 모바일 JSON API 호출 (Node.js 직접 호출 시 봇 차단됨)
                            const subRes = await axios.get(this.proxyJsonUrl, {
                                params: { url: naverApiUrl },
                                timeout: 15000
                            });

                            const stocks = subRes.data?.stocks || (Array.isArray(subRes.data) ? subRes.data : []);
                            
                            if (stocks.length > 0) {
                                const allStocks = stocks.sort((a: any, b: any) => parseFloat(b.fluctuationsRatio || '0') - parseFloat(a.fluctuationsRatio || '0'));

                                if (allStocks.length > 0) {
                                    lines.push(`- **[${topItem.name}] 주요 종목군 현황**`);
                                    const tagPayloads = [];

                                    for (const s of allStocks.slice(0, 30)) { // 넉넉히 최대 30개 전체 수집
                                        const stockCode = s.itemCode || '000000';
                                        const stockName = s.stockName || s.stockNameEng || '?';
                                        const changeRate = parseFloat(s.fluctuationsRatio || '0');

                                        tagPayloads.push({
                                            stock_code: stockCode,
                                            stock_name: stockName,
                                            tag_name: topItem.name,
                                            tag_type: type,
                                            is_auto_tagged: 1,
                                            change_rate: changeRate,
                                            added_date: dateStr
                                        });
                                    }

                                    // 주도주(알파) 추출 (로깅 및 Price Index 구축용 필터링)
                                    const alphaStocks = tagPayloads.filter((s: any) => {
                                        return s.change_rate >= 1.0 || (s.change_rate > 0 && s.change_rate >= topItem.change_rate * 0.5);
                                    });

                                    for (const s of alphaStocks.slice(0, 5)) {
                                        const arrow = s.change_rate > 0 ? '+' : '';
                                        lines.push(`  - [주도] ${s.stock_name} (${s.stock_code}): **${arrow}${s.change_rate}%**`);
                                    }

                                    if (tagPayloads.length > 0) {
                                        this.dbService.upsertStockThemeTags(tagPayloads);
                                        lines.push(`    *(💡 DB에 ${tagPayloads.length}개 전체 소속 종목 태그 동기화 완료)*`);

                                        // Step 2: 하이브리드 Price Index 구축 및 업데이트 (주도주만 대상)
                                        if (alphaStocks.length > 0) {
                                            await this.buildThemePriceIndex(dateStr, type, topItem.name, alphaStocks, lines);
                                        } else {
                                            lines.push(`    *(⚠️ Price Index 생략: 주도주 조건 만족 종목 없음)*`);
                                        }
                                    }
                                } else {
                                    lines.push(`- **[${topItem.name}]** 상승 유효 종목 발견 안 됨 (${stocks.length}개 종목 중)`);
                                }
                            } else {
                                lines.push(`- **[${topItem.name}]** API 응답에 종목 데이터 없음`);
                            }
                        } catch (subErr: any) {
                            console.warn(`[NaverFlowAggregator] 상세 API 에러 (${topItem.name}):`, subErr.message);
                            lines.push(`- **[${topItem.name}]** 상세 조회 실패: ${subErr.message}`);
                        }
                    }
                } else {
                    lines.push(`> ⚠️ ${typeNameKOR} 데이터를 마크다운에서 찾지 못했습니다.\n`);
                }
            } catch (err: any) {
                console.error(`[NaverFlowAggregator] 파싱 실패 (${type}):`, err.message);
                lines.push(`> ⚠️ ${typeNameKOR} 파싱 오류: ${err.message}\n`);
            }
        }

        return lines.join('\n');
    }

    /**
     * stock.naver.com SPA 마크다운 구조 파싱
     * 
     * 실제 마크다운 구조 (멀티라인 링크):
     * 1. [**1**
     * 컴퓨터와주변기기
     * 상승12보합2하락8
     * +5.59%](/market/stock/kr/industry/1?no=293)
     */
    private parseNaverSPAMarkdown(markdown: string, type: string): MarketFlowItem[] {
        const results: MarketFlowItem[] = [];

        // 핵심: 멀티라인 마크다운 링크를 dotAll(s) 플래그로 매칭
        // [**순위** 이름 상승N보합N하락N +X.XX%](URL)
        const urlPattern = type === 'SECTOR' ? 'industry' : 'theme';
        const multiLineRegex = new RegExp(
            `\\[\\*\\*(\\d+)\\*\\*\\s*([^\\n]+?)\\s*상승(\\d+)보합(\\d+)하락(\\d+)\\s*([+-]?\\d+\\.?\\d*)%\\s*\\]\\(([^)]*${urlPattern}[^)]*)\\)`,
            'g'
        );

        let match;
        while ((match = multiLineRegex.exec(markdown)) !== null) {
            const rank_num = parseInt(match[1]);
            const name = match[2].replace(/\n/g, '').trim();
            const change_rate = parseFloat(match[6]);
            const detail_url = match[7];

            results.push({ type, rank_num, name, change_rate, detail_url });
        }

        // 정렬 (이미 순위대로 되어있긴 하지만, 확실하게)
        results.sort((a, b) => a.rank_num - b.rank_num);

        console.log(`[NaverFlowAggregator] ${type} 파싱 결과: ${results.length}개 항목 (Regex 방식)`);
        if (results.length > 0) {
            console.log(`[NaverFlowAggregator] 1위: ${results[0].name} (${results[0].change_rate}%)`);
        }

        return results;
    }

    /**
     * 주도주들의 과거 영업일 주가 데이터를 수집하여 Theme Price Index 생성
     */
    private async buildThemePriceIndex(dateStr: string, type: string, themeName: string, alphaStocks: {stock_code: string, change_rate: number}[], lines: string[]) {
        try {
            // 과거 Index 데이터가 있는지 확인 (최근 1개만)
            const existingHistory = this.dbService.db.prepare(`
                SELECT * FROM theme_price_index WHERE type = ? AND name = ? ORDER BY date DESC LIMIT 1
            `).get(type, themeName) as any;

            if (existingHistory && existingHistory.date === dateStr) {
                // 이미 오늘자가 있다면 스킵
                return;
            }

            // 오늘 당일의 평균 등락률
            const todayAvgChangeRate = alphaStocks.reduce((sum, s) => sum + s.change_rate, 0) / alphaStocks.length;

            if (existingHistory) {
                // 기존 데이터가 있다면 새로 전체를 긁지 않고 오늘치(당일수익률)만 전일 Index에 반영(롤오버)
                const newIndex = existingHistory.price_index * (1 + todayAvgChangeRate / 100);
                
                this.dbService.upsertThemePriceIndex([{
                    date: dateStr,
                    type,
                    name: themeName,
                    price_index: parseFloat(newIndex.toFixed(2)),
                    daily_return: parseFloat(todayAvgChangeRate.toFixed(2))
                }]);
                
                lines.push(`    *(📈 Price Index 롤오버 누적 완료: **${newIndex.toFixed(2)}**)*`);
            } else {
                // 최초 생성하는 테마라면 주도주들의 과거 15거래일치 등락률 평균을 Base 100부터 구축
                // 네이버 일봉 API 연동 (파이프라인 백그라운드이므로 키움 TPS 제한 회피용으로 최적)
                
                const changesByDate: Record<string, number[]> = {};
                let fetchSuccess = false;
                
                for (const stock of alphaStocks) {
                    try {
                        // 사용자 피드백 반영: 네이버/키움 API 대신 이미 수집된 로컬 DB(market_ohlcv_history) 활용
                        const rows = this.dbService.db.prepare(`
                            SELECT date, close
                            FROM market_ohlcv_history
                            WHERE stock_code = ? AND date <= ?
                            ORDER BY date DESC
                            LIMIT 16
                        `).all(stock.stock_code, dateStr) as { date: string; close: number }[];

                        if (rows && rows.length > 1) {
                            fetchSuccess = true;
                            // ASC(과거->현재) 정렬로 뒤집기
                            rows.reverse();
                            for (let i = 1; i < rows.length; i++) {
                                const prev = rows[i - 1];
                                const curr = rows[i];
                                if (prev.close > 0) {
                                    const ratio = ((curr.close - prev.close) / prev.close) * 100;
                                    if (!changesByDate[curr.date]) changesByDate[curr.date] = [];
                                    changesByDate[curr.date].push(ratio);
                                }
                            }
                        }
                    } catch (e: any) {
                         // 하나 실패해도 나머지 종목들 평균으로 대체 가능
                         console.warn(`[NaverFlowAggregator] DB history fetch failed for ${stock.stock_code}: ${e.message}`);
                    }
                }

                if (fetchSuccess) {
                    const sortedDates = Object.keys(changesByDate).sort(); // 오름차순
                    let currentIndex = 100.0;
                    const indexPayload = [];
                    
                    for (let i = 0; i < sortedDates.length; i++) {
                        const d = sortedDates[i];
                        const dailyRates = changesByDate[d];
                        // 해당일 주도주들 수익률 평균
                        const avgDailyReturn = dailyRates.reduce((a, b) => a + b, 0) / dailyRates.length;
                        
                        if (i === 0) {
                            indexPayload.push({ date: d, type, name: themeName, price_index: 100.0, daily_return: avgDailyReturn });
                        } else {
                            currentIndex = currentIndex * (1 + avgDailyReturn / 100);
                            indexPayload.push({ 
                                date: d, 
                                type, 
                                name: themeName, 
                                price_index: parseFloat(currentIndex.toFixed(2)), 
                                daily_return: parseFloat(avgDailyReturn.toFixed(2)) 
                            });
                        }
                    }
                    
                    if (indexPayload.length > 0) {
                        // 오늘자 데이터가 과거 데이터 응답(어제 기준)에 없다면 오늘치 당장 이어붙이기
                        const lastProcessedDate = sortedDates[sortedDates.length - 1];
                        if (lastProcessedDate < dateStr) {
                            currentIndex = currentIndex * (1 + todayAvgChangeRate / 100);
                            indexPayload.push({
                                date: dateStr,
                                type,
                                name: themeName,
                                price_index: parseFloat(currentIndex.toFixed(2)),
                                daily_return: parseFloat(todayAvgChangeRate.toFixed(2))
                            });
                        }
                        
                        this.dbService.upsertThemePriceIndex(indexPayload);
                        lines.push(`    *(✨ 신규 Price Index Base 100부터 15일치 소급 구축 ➔ **${currentIndex.toFixed(2)}**)*`);
                    }
                } else {
                    lines.push(`    *(⚠️ Price Index 구축 실패: 시계열 데이터 누락)*`);
                }
            }
        } catch (e: any) {
            console.error(`[NaverFlowAggregator] buildThemePriceIndex failed for ${themeName}:`, e.message);
            lines.push(`    *(⚠️ Price Index 에러: ${e.message})*`);
        }
    }
}
