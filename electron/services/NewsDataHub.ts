import Store from 'electron-store';
import axios from 'axios';
import { DEFAULT_NEWS_HUB_SETTINGS, NewsHubSettings, NewsHubKeywordSlot } from '../types/NewsHubSettings';
import { DatabaseService } from './DatabaseService';

const store = new Store();

export interface CachedArticle {
    title: string;
    bodySnippet: string;
    source: string;
    url: string;
    link?: string;
    category: string;        // MAJOR, GLOBAL, STOCK_ANALYSIS, GLOBAL_MARKET, KEYWORD_SEARCH
    searchKeyword?: string;  // Open API 키워드 수집 시 기록
    date: string;
    timeBucket: string;      // "08:00", "09:05" ...
    articleHash: string;     // 중복 제거용 해시 (title+source)
}

export interface HubCache {
    collectedAt: Date;
    bucket: string;
    articles: CachedArticle[];
    totalCount: number;
}

export interface BatchCollectResult {
    success: boolean;
    collected: number;
    bucket: string;
    duration_ms: number;
    warnings?: string[];
    error?: string;
}

/**
 * Central News Data Hub
 *
 * 역할:
 * 1. 설정 기반 뉴스 배치 수집 (Open API + 네이버 증권 JSON)
 * 2. TTL 메모리 캐시 관리 → 에이전트는 HTTP 없이 캐시만 읽음
 * 3. DB time-bucketed 저장 (naver_news_flow 테이블)
 * 4. 이슈 키워드 기반 뉴스 필터링 제공 (IssueTrackerAgent용)
 */
export class NewsDataHub {
    private static instance: NewsDataHub;
    private cache: HubCache | null = null;
    private readonly proxyJsonUrl = 'http://127.0.0.1:5050/api/proxy_json';

    private constructor() {}

    public static getInstance(): NewsDataHub {
        if (!NewsDataHub.instance) {
            NewsDataHub.instance = new NewsDataHub();
            // 백그라운드 딜레이 없이 즉시/동기식(SQLite)으로 캐시 복원 (Race Condition 방지)
            try {
                NewsDataHub.instance.restoreCacheFromDbSync();
            } catch (e) {
                console.error('[NewsDataHub] 초기 캐시 복원 실패:', e);
            }
        }
        return NewsDataHub.instance;
    }

    // ─────────────────────────────────────────────────────
    //  DB에서 마지막 수집 상태 복원 (앱 재시작 시 동기화)
    // ─────────────────────────────────────────────────────
    public restoreCacheFromDbSync(): void {
        try {
            const db = DatabaseService.getInstance();
            const rawDb = (db as any).db;

            // 1. 가장 최근의 date와 time_bucket 찾기
            const latest = rawDb.prepare(`
                SELECT date, time_bucket, collected_at
                FROM naver_news_flow 
                ORDER BY rowid DESC 
                LIMIT 1
            `).get();

            if (!latest || !latest.time_bucket) {
                console.log('[NewsDataHub] 복원할 뉴스 캐시가 없습니다.');
                return;
            }

            // 2. 해당 시점에 수집된 모든 기사 가져오기
            const rows = rawDb.prepare(`
                SELECT * FROM naver_news_flow 
                WHERE date = ? AND time_bucket = ?
            `).all(latest.date, latest.time_bucket);

            if (rows.length === 0) return;

            const articles: CachedArticle[] = rows.map((r: any) => ({
                title: r.title,
                bodySnippet: r.body_snippet,
                source: r.source,
                url: r.url,
                category: r.category,
                searchKeyword: r.search_keyword,
                date: r.date,
                timeBucket: r.time_bucket,
                articleHash: r.article_hash || r.article_id,
            }));

            this.cache = {
                collectedAt: new Date(latest.collected_at || Date.now()),
                bucket: latest.time_bucket,
                articles: articles,
                totalCount: articles.length
            };

            console.log(`[NewsDataHub] DB에서 마지막 보관 뉴스 복원 완료 (${articles.length}건, 버킷: ${latest.time_bucket})`);
        } catch (e: any) {
            console.error('[NewsDataHub] 캐시 복원 중 에러:', e.message);
        }
    }

    // ─────────────────────────────────────────────────────
    //  설정 로드
    // ─────────────────────────────────────────────────────
    private getSettings(): NewsHubSettings {
        const saved = store.get('news_hub_settings') as Partial<NewsHubSettings>;
        return {
            ...DEFAULT_NEWS_HUB_SETTINGS,
            ...saved,
            keywords: saved?.keywords || DEFAULT_NEWS_HUB_SETTINGS.keywords,
            scheduleSlots: saved?.scheduleSlots || DEFAULT_NEWS_HUB_SETTINGS.scheduleSlots,
        };
    }

    // ─────────────────────────────────────────────────────
    //  캐시 상태 확인 (UI + 에이전트 공용)
    // ─────────────────────────────────────────────────────
    public getCacheStatus(): {
        isValid: boolean;
        collectedAt: string | null;
        ttlMinutes: number;
        articleCount: number;
        bucket: string | null;
        ageMinutes: number | null;
    } {
        const settings = this.getSettings();
        if (!this.cache) {
            return { isValid: false, collectedAt: null, ttlMinutes: settings.ttlMinutes, articleCount: 0, bucket: null, ageMinutes: null };
        }
        const ageMs = Date.now() - this.cache.collectedAt.getTime();
        const ageMinutes = Math.floor(ageMs / 60000);
        const isValid = ageMinutes < settings.ttlMinutes;
        return {
            isValid,
            collectedAt: this.cache.collectedAt.toISOString(),
            ttlMinutes: settings.ttlMinutes,
            articleCount: this.cache.articles.length,
            bucket: this.cache.bucket,
            ageMinutes,
        };
    }

    // ─────────────────────────────────────────────────────
    //  에이전트/UI 공개 API: 캐시된 기사 목록 반환
    // ─────────────────────────────────────────────────────
    public getCachedArticles(options?: { category?: string; limit?: number }): CachedArticle[] {
        if (!this.cache) return [];
        let articles = this.cache.articles;
        if (options?.category) {
            articles = articles.filter(a => a.category === options.category);
        }
        if (options?.limit) {
            articles = articles.slice(0, options.limit);
        }
        return articles;
    }


    // ─────────────────────────────────────────────────────
    //  에이전트 공개 API: 캐시된 뉴스 → 마크다운 (강화版)
    //  PL-NewsFlow 장전 필터/오후 정렬 + PL-NewsKeyword 키워드빈도 통합
    // ─────────────────────────────────────────────────────
    public getNewsAsMarkdown(options?: { maxPerCategory?: number; skipKeywords?: boolean }): string {
        if (!this.cache || this.cache.articles.length === 0) {
            return '> ⚠️ NewsDataHub 캐시 없음. Hub 배치 수집이 완료되지 않았습니다.';
        }

        const max = options?.maxPerCategory ?? 10;
        const nowHour = new Date().getHours(); // KST 기준 현재 시각

        // ── 시간대별 필터 (PL-NewsFlow 로직 이식) ──────────────
        // 장전(09:00 이전): 전일 마감 후행 기사 제거
        const MORNING_FILTER = /(마감시황|마감 시황|상승 마감|하락 마감|마감|특징주|약세|강세)/;
        // 오후(15:00 이후): 수급/마감/특징주 상단 정렬
        const AFTERNOON_PRIORITY = /(특징주|수급|외국인|상한|코스피 마감|코스닥 마감)/;

        let articles = [...this.cache.articles];

        // 장전 필터
        if (nowHour < 9) {
            articles = articles.filter(a => !MORNING_FILTER.test(a.title));
        }

        // 오후장 우선 정렬: MAJOR 카테고리 내 수급/마감 기사 최상단
        if (nowHour >= 15) {
            articles.sort((a, b) => {
                if (a.category !== 'MAJOR' || b.category !== 'MAJOR') return 0;
                return (AFTERNOON_PRIORITY.test(b.title) ? 1 : 0) - (AFTERNOON_PRIORITY.test(a.title) ? 1 : 0);
            });
        }

        // ── 카테고리별 그룹핑 ────────────────────────────────
        const categoryOrder = ['MAJOR', 'GLOBAL', 'GLOBAL_MARKET', 'STOCK_ANALYSIS', 'KEYWORD_SEARCH'];
        const byCategory: Record<string, CachedArticle[]> = {};
        for (const a of articles) {
            if (!byCategory[a.category]) byCategory[a.category] = [];
            if (byCategory[a.category].length < max) {
                byCategory[a.category].push(a);
            }
        }

        const categoryLabels: Record<string, string> = {
            MAJOR:          '🇰🇷 주요 뉴스',
            GLOBAL:         '🌐 해외 뉴스',
            STOCK_ANALYSIS: '📊 기업·종목 분석',
            GLOBAL_MARKET:  '📈 해외 증시',
            KEYWORD_SEARCH: '🔍 키워드 검색',
        };

        // ── 헤더 ─────────────────────────────────────────────
        const collectedAt = this.cache.collectedAt.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
        const lines: string[] = [
            `> 📡 **NewsHub 캐시** (수집: ${this.cache.bucket} / ${collectedAt} KST | 총 ${articles.length}건)`,
            nowHour < 9  ? '> ⚡ 장전 모드: 마감 후행 기사 필터링 적용' :
            nowHour >= 15 ? '> ⚡ 오후장 모드: 수급/특징주 우선 정렬 적용' : '',
            '',
        ];

        // ── 키워드 빈도 Top10 (PL-NewsKeyword 기능 이식) ────────
        if (!options?.skipKeywords) {
            const wordFreq: Record<string, number> = {};
        const STOP_WORDS = new Set(['및', '등', '의', '이', '가', '은', '는', '에서', '으로', '를', '을', '한', '하다', '대한', '위한', '관련', '통해', '따라', '대해', '기자']);
        for (const a of articles) {
            // 제목에서 단어 추출 (한글 2자 이상)
            const words = a.title.match(/[가-힣]{2,6}/g) || [];
            for (const w of words) {
                if (!STOP_WORDS.has(w)) {
                    wordFreq[w] = (wordFreq[w] || 0) + 1;
                }
            }
        }
        const topKeywords = Object.entries(wordFreq)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10);

        if (topKeywords.length > 0) {
            lines.push('### 🔑 뉴스 헤드라인 키워드 빈도 (Top 10)');
            lines.push('| 키워드 | 언급 횟수 | 비중 |');
            lines.push('| :--- | :---: | :--- |');
            const maxCount = topKeywords[0][1];
            for (const [word, count] of topKeywords) {
                const bar = '█'.repeat(Math.round((count / maxCount) * 8));
                lines.push(`| **${word}** | ${count}회 | ${bar} |`);
            }
            }
            lines.push('');
        }

        // ── 카테고리별 기사 목록 ──────────────────────────────
        for (const cat of categoryOrder) {
            const catArticles = byCategory[cat];
            if (!catArticles || catArticles.length === 0) continue;

            lines.push(`### ${categoryLabels[cat] ?? cat} (${catArticles.length}건)`);
            for (const a of catArticles) {
                // 발행 시각 포맷 (date 필드: "YYYY-MM-DD HH:mm" 형태 가정)
                const timeTag = a.date ? `[${a.date.slice(11, 16) || a.date.slice(0, 10)}]` : '';
                const kwTag = a.searchKeyword ? ` #${a.searchKeyword}` : '';
                lines.push(`- ${timeTag}**[${a.source}]**${kwTag} ${a.title}`);
                if (a.bodySnippet) {
                    lines.push(`  > ${a.bodySnippet.substring(0, 120).replace(/\n/g, ' ')}`);
                }
            }
            lines.push('');
        }

        lines.push('---');
        lines.push(`*※ NewsDataHub 캐시 기반 — 수집: ${this.cache.bucket} 버킷*`);

        return lines.join('\n');
    }

    // ─────────────────────────────────────────────────────
    //  에이전트 공개 API: 이슈 키워드 매칭 뉴스 필터 (DB 풀스캔)
    // ─────────────────────────────────────────────────────
    public getNewsForIssue(issueName: string, keywords: string[]): CachedArticle[] {
        const rawKeywords = [issueName, ...keywords]
            .map(k => k.trim())
            .filter(k => k.length > 1); // 1글자짜리 키워드 제외 (노이즈 방지)

        if (rawKeywords.length === 0) return [];

        try {
            const dbRaw = (DatabaseService.getInstance() as any).db;
            
            // 최근 3일치 뉴스 (안전범위)
            const rows = dbRaw.prepare(`
                SELECT title, body_snippet, source, url, category, date, time_bucket
                FROM naver_news_flow 
                WHERE date >= date('now', '-3 days', 'localtime')
                ORDER BY rowid DESC
            `).all();

            const lowerKeywords = rawKeywords.map(k => k.toLowerCase());

            const matched = rows.filter((r: any) => {
                const text = `${r.title} ${r.body_snippet ?? ''}`.toLowerCase();
                return lowerKeywords.some(kw => text.includes(kw));
            });

            return matched.map((r: any) => ({
                title: r.title,
                bodySnippet: r.body_snippet,
                source: r.source,
                url: r.url,
                category: r.category,
                date: r.date,
                timeBucket: r.time_bucket,
                articleHash: ''
            }));
            
        } catch (e: any) {
            console.error('[NewsDataHub] DB 뉴스 검색 실패:', e.message);
            return [];
        }
    }

    // ─────────────────────────────────────────────────────
    //  핵심: 배치 수집
    // ─────────────────────────────────────────────────────
    public async runBatchCollect(): Promise<BatchCollectResult> {
        const startMs = Date.now();
        const settings = this.getSettings();

        if (!settings.enabled) {
            return { success: false, collected: 0, bucket: '', duration_ms: 0, error: 'Hub 비활성화됨' };
        }

        const now = new Date();
        const bucket = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
        const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        const collectedAt = now.toISOString();

        console.log(`[NewsDataHub] 🗞️  배치 수집 시작 (버킷: ${bucket})`);

        const allArticles: CachedArticle[] = [];
        const seenHashes = new Set<string>();

        // ── 1. Open API 키워드 검색 ────────────────────────────────
        const enabledKeywords = settings.keywords.filter(k => k.enabled);
        for (const kw of enabledKeywords) {
            try {
                const apiKey = (store.get('naver_api_keys') as any) || {};
                if (!apiKey.clientId || !apiKey.clientSecret) {
                    console.warn('[NewsDataHub] 네이버 API 키 미설정, Open API 스킵');
                    break;
                }
                const resp = await axios.get('https://openapi.naver.com/v1/search/news.json', {
                    params: { query: kw.keyword, display: kw.maxResults, sort: 'date' },
                    headers: {
                        'X-Naver-Client-Id': apiKey.clientId,
                        'X-Naver-Client-Secret': apiKey.clientSecret,
                    },
                    timeout: 10000,
                });

                const items: any[] = resp.data?.items ?? [];
                for (const item of items) {
                    const title = (item.title ?? '').replace(/<[^>]+>/g, '');
                    const hash = this.simpleHash(title + (item.originallink ?? item.link ?? ''));
                    if (seenHashes.has(hash)) continue;
                    seenHashes.add(hash);

                    allArticles.push({
                        title,
                        bodySnippet: (item.description ?? '').replace(/<[^>]+>/g, ''),
                        source: this.extractDomain(item.originallink ?? item.link ?? ''),
                        url: item.originallink ?? item.link ?? '',
                        link: item.link,
                        category: 'KEYWORD_SEARCH',
                        searchKeyword: kw.keyword,
                        date: dateStr,
                        timeBucket: bucket,
                        articleHash: hash,
                    });
                }
                console.log(`[NewsDataHub] 키워드 [${kw.keyword}] → ${items.length}건`);
            } catch (err: any) {
                console.error(`[NewsDataHub] 키워드 [${kw.keyword}] 실패:`, err.message);
            }
        }

        // ── 2. 네이버 증권 JSON API (PL-NewsFlow 방식) ─────────────
        if (settings.useJsonApi) {
            const todayNum = dateStr.replace(/-/g, '');
            const categoryApiSources: Array<{ category: string; url: string }> = [];

            if (settings.jsonApiCategories.includes('MAJOR')) {
                categoryApiSources.push({
                    category: 'MAJOR',
                    url: 'https://m.stock.naver.com/front-api/news/category?category=mainnews&pageSize=20&page=1',
                });
            }
            if (settings.jsonApiCategories.includes('GLOBAL')) {
                categoryApiSources.push({
                    category: 'GLOBAL',
                    url: 'https://m.stock.naver.com/front-api/news/worldnews?pageSize=20&page=1',
                });
            }
            if (settings.jsonApiCategories.includes('STOCK_ANALYSIS')) {
                categoryApiSources.push({
                    category: 'STOCK_ANALYSIS',
                    url: `https://stock.naver.com/api/domestic/news/focus?sid=402&page=1&pageSize=15&date=${todayNum}&enableFallback=true`,
                });
            }
            if (settings.jsonApiCategories.includes('GLOBAL_MARKET')) {
                categoryApiSources.push({
                    category: 'GLOBAL_MARKET',
                    url: `https://stock.naver.com/api/domestic/news/focus?sid=403&page=1&pageSize=15&date=${todayNum}&enableFallback=true`,
                });
            }

            for (const src of categoryApiSources) {
                try {
                    const resp = await axios.get(this.proxyJsonUrl, {
                        params: { url: src.url },
                        timeout: 15000,
                    });
                    const articles: any[] = resp.data?.result ?? resp.data?.articles ?? resp.data ?? [];
                    if (!Array.isArray(articles)) continue;

                    for (const item of articles) {
                        const title = item.title ?? item.headline ?? '';
                        if (!title) continue;
                        const hash = this.simpleHash(title + (item.oid ?? src.category));
                        if (seenHashes.has(hash)) continue;
                        seenHashes.add(hash);

                        allArticles.push({
                            title,
                            bodySnippet: item.summary ?? item.leadText ?? item.body ?? '',
                            source: item.officeName ?? item.source ?? src.category,
                            url: item.url ?? '',
                            category: src.category,
                            date: dateStr,
                            timeBucket: bucket,
                            articleHash: hash,
                        });
                    }
                    console.log(`[NewsDataHub] JSON [${src.category}] → ${articles.length}건`);
                } catch (err: any) {
                    console.error(`[NewsDataHub] JSON [${src.category}] 실패:`, err.message);
                }
            }
        }

        // ── 3. 메모리 캐시 갱신 ───────────────────────────────────
        this.cache = {
            collectedAt: now,
            bucket,
            articles: allArticles,
            totalCount: allArticles.length,
        };

        // ── 4. DB 저장 (INSERT OR IGNORE + time_bucket) ─────────
        this.saveToDb(allArticles, dateStr, bucket, collectedAt);

        // ── 5. 오래된 데이터 정리 ─────────────────────────────────
        this.cleanOldData(settings.retentionDays);

        const duration_ms = Date.now() - startMs;
        console.log(`[NewsDataHub] ✅ 수집 완료: ${allArticles.length}건, ${duration_ms}ms`);

        return { success: true, collected: allArticles.length, bucket, duration_ms };
    }

    // ─────────────────────────────────────────────────────
    //  DB 저장
    // ─────────────────────────────────────────────────────
    private saveToDb(articles: CachedArticle[], date: string, timeBucket: string, collectedAt: string) {
        try {
            const db = DatabaseService.getInstance();

            // time_bucket, article_hash, search_keyword 컬럼 마이그레이션 (없으면 추가)
            const dbRaw = (db as any).db;
            for (const col of ['time_bucket', 'article_hash', 'search_keyword']) {
                try { dbRaw.exec(`ALTER TABLE naver_news_flow ADD COLUMN ${col} TEXT`); } catch {}
            }

            const stmt = dbRaw.prepare(`
                INSERT OR IGNORE INTO naver_news_flow
                    (date, category, title, body_snippet, source, article_id, url, collected_at, time_bucket, article_hash, search_keyword)
                VALUES
                    (@date, @category, @title, @body_snippet, @source, @article_id, @url, @collected_at, @time_bucket, @article_hash, @search_keyword)
            `);

            const insertMany = dbRaw.transaction((items: any[]) => {
                for (const item of items) stmt.run(item);
            });

            const rows = articles.map(a => ({
                date,
                category: a.category,
                title: a.title,
                body_snippet: a.bodySnippet ?? '',
                source: a.source ?? '',
                article_id: a.articleHash,
                url: a.url ?? '',
                collected_at: collectedAt,
                time_bucket: timeBucket,
                article_hash: a.articleHash,
                search_keyword: a.searchKeyword ?? null,
            }));

            insertMany(rows);
            console.log(`[NewsDataHub] DB 저장: ${rows.length}건 (INSERT OR IGNORE)`);
        } catch (err: any) {
            console.error('[NewsDataHub] DB 저장 실패:', err.message);
        }
    }

    // ─────────────────────────────────────────────────────
    //  오래된 데이터 정리
    // ─────────────────────────────────────────────────────
    private cleanOldData(retentionDays: number) {
        try {
            const dbRaw = (DatabaseService.getInstance() as any).db;
            dbRaw.prepare(`DELETE FROM naver_news_flow WHERE date < date('now', '-${retentionDays} days')`).run();
        } catch {}
    }

    // ─────────────────────────────────────────────────────
    //  유틸리티
    // ─────────────────────────────────────────────────────
    private simpleHash(str: string): string {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            hash = (Math.imul(31, hash) + str.charCodeAt(i)) | 0;
        }
        return Math.abs(hash).toString(36);
    }

    private extractDomain(url: string): string {
        try {
            return new URL(url).hostname.replace('www.', '');
        } catch {
            return url.substring(0, 20);
        }
    }
}
