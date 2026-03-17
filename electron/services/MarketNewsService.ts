import { DatabaseService } from './DatabaseService';
import { NaverNewsService } from './NaverNewsService';
import { AiService } from './AiService';
import Store from 'electron-store';
import { JsonUtils } from '../utils/JsonUtils';

const store = new Store();

export interface MarketBriefingResult {
    date: string;
    summary: string | string[];
    themes: any[];
    sentiment: number;
    pivot: string;
    outlook?: {
        forecast: string;
        sectors: string[];
    };
    keywords: string[];
}

export interface AIKeyword {
    keyword: string;
    score: number;
    reason: string;
    updated_at: string;
}

export class MarketNewsService {
    private static instance: MarketNewsService;
    private db = DatabaseService.getInstance();
    private naverNews = NaverNewsService.getInstance();
    private ai = AiService.getInstance();

    private constructor() {}

    public static getInstance() {
        if (!MarketNewsService.instance) {
            MarketNewsService.instance = new MarketNewsService();
        }
        return MarketNewsService.instance;
    }

    private async evolveAiKeywordsPool(currentAiPool: AIKeyword[]): Promise<AIKeyword[]> {
        try {
            const lastThreeDays = this.db.getLatestMarketNewsConsensus(3);
            if (lastThreeDays.length === 0) return currentAiPool;

            const contextText = lastThreeDays.map((b: any) => {
                try {
                    const p = JSON.parse(b.summary_json);
                    return `날짜: ${b.date}, 요약: ${p.summary}, 키워드: ${b.keywords_used}`;
                } catch (e) { return ''; }
            }).join('\n');

            const prompt = `
당신은 대한민국 거시 경제 및 주식 시장의 핵심 내러티브를 추적하는 AI 전략가입니다.
최근 시장 상황을 바탕으로, "지속적으로 시장에 영향을 줄 핵심 이슈(키워드)"를 추출하십시오.

[최근 시장 맥락]
${contextText}

[현재 AI 키워드 풀]
${JSON.stringify(currentAiPool)}

[수행 지시]
1. 위 맥락에서 중장기적으로(최소 1주일 이상) 시장 주도권을 쥐거나 강력한 리스크가 될 수 있는 키워드를 2~3개 추출하십시오. (예: '중동 전쟁', '연준 금리 인하', 'HBM 수급')
2. [현재 AI 키워드 풀]에 있는 키워드가 더 이상 유효하지 않거나 중요도가 낮아졌다면 점수를 낮게 책정하십시오.
3. 반드시 [ { "keyword": "...", "score": 0.0~1.0, "reason": "..." }, ... ] 형식의 JSON 배열만 반환하십시오.
4. 최대 10개까지의 후보를 유지하되, 가장 중요한 이슈가 높은 점수를 갖게 하십시오.
`;

            const response = await this.ai.askGemini(prompt, "순수 JSON 배열만 반환하세요.");
            const cleanJson = response.replace(/```json|```/gi, '').trim();
            const newSuggestions = JSON.parse(cleanJson) as AIKeyword[];

            const updatedPoolMap = new Map<string, AIKeyword>();
            if (Array.isArray(currentAiPool)) {
                currentAiPool.forEach(k => {
                    if (k && k.keyword) updatedPoolMap.set(k.keyword, k);
                });
            }
            if (Array.isArray(newSuggestions)) {
                newSuggestions.forEach(s => {
                    if (s && s.keyword) {
                        updatedPoolMap.set(s.keyword, {
                            ...s,
                            updated_at: new Date().toISOString()
                        });
                    }
                });
            }

            const evolved = Array.from(updatedPoolMap.values())
                .sort((a, b) => (b.score || 0) - (a.score || 0))
                .slice(0, 10);
                
            return evolved;
        } catch (e) {
            console.error('[MarketNewsService] Failed to evolve AI keywords pool:', e);
            return Array.isArray(currentAiPool) ? currentAiPool : [];
        }
    }

    public async generateMarketBriefing(): Promise<{ success: boolean; data?: MarketBriefingResult; error?: string }> {
        const settings = store.get('market_briefing_settings') as any || {
            keywords: ['코스피 코스닥 시황', '뉴욕증시 마감', '미국 금리 환율'],
            ai_keywords_pool: [],
            max_total_keywords: 5,
            enabled: true
        };

        const today = this.db.getKstDate();
        try {
            const currentAiPool = settings.ai_keywords_pool || [];
            const evolvedPool = await this.evolveAiKeywordsPool(currentAiPool);
            store.set('market_briefing_settings.ai_keywords_pool', evolvedPool);

            const maxTotal = settings.max_total_keywords || 5;
            const finalKeywords = [...(settings.keywords || [])];
            for (const aiK of evolvedPool) {
                if (finalKeywords.length >= maxTotal) break;
                if (!finalKeywords.includes(aiK.keyword)) finalKeywords.push(aiK.keyword);
            }

            const lastBriefing = this.db.getLatestMarketNewsConsensus(1)[0];
            let allNewsText = '';
            const sourceNews: { title: string, url: string, pubDate: string }[] = [];
            const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;

            for (const keyword of finalKeywords) {
                const items = await this.naverNews.searchNews(keyword, 20);
                const recentItems = items.filter(item => new Date(item.pubDate).getTime() > oneDayAgo);
                
                if (recentItems.length > 0) {
                    allNewsText += `\n### 키워드: ${keyword}\n`;
                    allNewsText += recentItems.map(item => `- ${item.title}: ${item.description}`).join('\n');
                    recentItems.forEach(item => sourceNews.push({ title: item.title, url: item.link, pubDate: item.pubDate }));
                }
            }

            if (!allNewsText) return { success: false, error: '최근 24시간 내 수집된 뉴스가 없습니다.' };

            const prompt = `
당신은 대한민국 거시 경제와 주식 시장의 내러티브 변화를 추적하는 '메가 뉴스 분석 AI'입니다. 
제공된 "최근 24시간 시장 뉴스"를 바탕으로 오늘의 시장 분위기를 진단하고, 핵심 키워드를 정량화하십시오.

[과거 분석 맥락 (연속성 확보용)]
${lastBriefing ? lastBriefing.summary_json : '정보 없음'}

[최근 24시간 뉴스 데이터]
${allNewsText}

[분석 지침 - 중요]
1. 키워드 일관성: 새로운 키워드를 생성할 때, 이미 과거 맥락에서 사용된 키워드와 의미가 같다면 반드시 동일한 단어를 사용하십시오.
2. 시장 심리: 전반적인 시장의 온도를 -1.0 (극심한 공포)에서 1.0 (극도의 탐욕) 사이의 실수로 책정하십시오.
3. 핵심 키워드 랭킹 (Key Narratives): 오늘 뉴스에서 가장 비중 있게 다뤄진 키워드 3~5개를 선정하고, 각각의 영향력 점수(0~100)와 해당 키워드에 대한 '한 줄 핵심 요약'을 작성하십시오.
4. 변화 분석: 어제 대비 변화(Pivot)를 2줄 이내로 매우 핵심만 요약하십시오.
5. 향후 전망: 앞으로의 시황 전망과 가장 유망해 보이는 섹터 3개를 선정하십시오.

[출력 요구사항 (JSON 형식)]
{
  "pivot": "어제 대비 변화점 (2줄 내외)",
  "sentiment_score": 0.45,
  "hot_keywords": [
    { "keyword": "키워드1", "score": 95, "summary": "이 키워드와 관련된 오늘의 핵심 내러티브 한 줄 요약" },
    { "keyword": "키워드2", "score": 85, "summary": "이 키워드와 관련된 오늘의 핵심 내러티브 한 줄 요약" }
  ],
  "future_outlook": {
    "forecast": "앞으로의 시장 전망 요약",
    "sectors": ["섹터1", "섹터2", "섹터3"]
  },
  "themes": [
    { "theme_name": "테마명", "reason": "이유..." }
  ]
}
`;

            const aiResponse = await this.ai.askGemini(prompt, "반드시 순수 JSON 형식으로만 응답해 주세요.");
            const parsed = JsonUtils.extractAndParse(aiResponse);

            // hot_keywords의 요약들을 합쳐서 기존 summary 필드 유지 (하위 호환성)
            const combinedSummary = (parsed.hot_keywords || [])
                .map((k: any) => k.summary)
                .filter(Boolean);

            const result: MarketBriefingResult = {
                date: today,
                summary: combinedSummary as any, // Array for consistency
                themes: parsed.themes || [],
                sentiment: Number(parsed.sentiment_score || 0),
                pivot: parsed.pivot || '',
                outlook: parsed.future_outlook,
                keywords: finalKeywords
            };

            this.db.saveMarketNewsConsensus({
                date: today,
                summary_json: JSON.stringify(result),
                pivot_analysis: result.pivot,
                keywords_used: JSON.stringify(finalKeywords),
                source_news: JSON.stringify(sourceNews),
                sentiment_score: result.sentiment,
                hot_keywords_json: JSON.stringify(parsed.hot_keywords || [])
            });

            return { success: true, data: result };
        } catch (error: any) {
            console.error('[MarketNewsService] Briefing Generation Failed:', error);
            return { success: false, error: error.message };
        }
    }

    public getLatestBriefings(limit: number = 10) {
        return this.db.getLatestMarketNewsConsensus(limit);
    }
}
