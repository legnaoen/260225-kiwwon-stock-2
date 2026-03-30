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
                    allParsedItems.push(...top20);

                    for (const p of top20.slice(0, 10)) {
                        const arrow = p.change_rate > 0 ? '🔴' : (p.change_rate < 0 ? '🔵' : '⚫');
                        lines.push(`| ${p.rank_num} | **${p.name}** | ${arrow} ${p.change_rate > 0 ? '+' : ''}${p.change_rate}% |`);
                    }
                    lines.push('');

                    // Phase 2: 알파 추출 (Top 3의 상세 페이지에서 주도주 추출)
                    lines.push(`\n**🔍 핵심 선도주 (Alpha) 발굴 (Top 3 ${typeNameKOR} 기준)**`);
                    lines.push('> 해당 그룹 평균 등락률을 상회하는 진짜 주도주 추출 및 자동 태깅');
                    lines.push('');

                    const top3 = top20.slice(0, 3);
                    for (const topItem of top3) {
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
                                // 그룹 평균 등락률 상회 종목만 추출 (진짜 주도주)
                                const alphaStocks = stocks.filter((s: any) => {
                                    const rate = parseFloat(s.fluctuationsRatio || '0');
                                    return rate > topItem.change_rate;
                                });

                                if (alphaStocks.length > 0) {
                                    lines.push(`- **[${topItem.name}] 대표 주도주** (그룹 평균 ${topItem.change_rate}%)`);
                                    const tagPayloads = [];

                                    for (const s of alphaStocks.slice(0, 10)) { // 최대 10개
                                        const stockCode = s.itemCode || '000000';
                                        const stockName = s.stockName || s.stockNameEng || '?';
                                        const changeRate = parseFloat(s.fluctuationsRatio || '0');

                                        tagPayloads.push({
                                            stock_code: stockCode,
                                            stock_name: stockName,
                                            tag_name: topItem.name,
                                            is_auto_tagged: 1,
                                            change_rate: changeRate,
                                            added_date: dateStr
                                        });
                                        const arrow = changeRate > 0 ? '+' : '';
                                        lines.push(`  - ${stockName} (${stockCode}): **${arrow}${changeRate}%**`);
                                    }

                                    if (tagPayloads.length > 0) {
                                        this.dbService.upsertStockThemeTags(tagPayloads);
                                        lines.push(`    *(💡 DB에 ${tagPayloads.length}개 주도주 태그 자동 등록 완료)*`);
                                    }
                                } else {
                                    lines.push(`- **[${topItem.name}]** 조건 상회 주도주 발견 안 됨 (${stocks.length}개 종목 중)`);
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
}
