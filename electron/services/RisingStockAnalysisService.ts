import { NaverNewsService } from './NaverNewsService'
import { DartApiService } from './DartApiService'
import { KiwoomService } from './KiwoomService'
import { AiService } from './AiService'
import { DatabaseService as DB } from './DatabaseService'
import { eventBus, SystemEvent } from '../utils/EventBus'
import { SkillsService } from './SkillsService'

export class RisingStockAnalysisService {
    private static instance: RisingStockAnalysisService
    private naverNews = NaverNewsService.getInstance()
    private dartApi = DartApiService.getInstance()
    private kiwoom = KiwoomService.getInstance()
    private db = DB.getInstance()
    private skills = SkillsService.getInstance()

    private constructor() {}

    public static getInstance(): RisingStockAnalysisService {
        if (!RisingStockAnalysisService.instance) {
            RisingStockAnalysisService.instance = new RisingStockAnalysisService()
        }
        return RisingStockAnalysisService.instance
    }

    /**
     * 특정 종목에 대한 모든 원시 데이터를 수집합니다.
     */
    public async collectAllData(stockCodeRaw: string, stockName: string, changeRate: number, date?: string) {
        // 종목 코드 세척 (숫자만 추출)
        const stockCode = String(stockCodeRaw).replace(/[^0-9]/g, '')
        const targetDate = date || this.db.getKstDate()
        
        try {
            // 이미 DB에 데이터가 있는지 먼저 확인
            const existing = this.db.getRawData(targetDate, stockCode)
            
            // 1. 뉴스 raw 목록 수집
            let newsItems: any[] = []
            let newsSummary = ''
            
            // 기존 데이터가 있고 뉴스 정보가 이미 존재하면 재사용 (API 쿼리 절약)
            if (existing && existing.news_json && existing.news_json !== '[]') {
                try {
                    newsItems = JSON.parse(existing.news_json)
                    console.log(`[RisingStockAnalysisService] Using existing news for ${stockName}: ${newsItems.length} items`)
                } catch (e) {
                    console.error('[RisingStockAnalysisService] Failed to parse existing news_json')
                }
            }

            // 뉴스 정보가 없거나 파싱 실패한 경우 새로 수집
            if (newsItems.length === 0) {
                try {
                    // API 속도 제한 방지를 위한 짧은 대기 (300ms)
                    await new Promise(resolve => setTimeout(resolve, 300))
                    newsItems = await this.naverNews.searchNews(stockName, 5)
                    console.log(`[RisingStockAnalysisService] News fetched from Naver for ${stockName}: ${newsItems.length} items`)
                } catch (e) {
                    console.warn(`[RisingStockAnalysisService] News fetch failed for ${stockName}:`, e)
                }
            }
            
            newsSummary = newsItems.length > 0
                ? newsItems.map((item, idx) => `[기사 ${idx + 1}] ${item.title}\n내용: ${this.cleanText(item.description)}`).join('\n\n')
                : '관련 뉴스가 없습니다.'

            // 2. 공시 raw 목록 수집
            let disclosureItems: any[] = []
            let dartSummary = '공시 없음'
            
            // 기존 데이터가 있고 공시 정보가 이미 존재하면 재사용
            if (existing && existing.disclosures_json && existing.disclosures_json !== '[]') {
                try {
                    disclosureItems = JSON.parse(existing.disclosures_json)
                    console.log(`[RisingStockAnalysisService] Using existing disclosures for ${stockName}: ${disclosureItems.length} items`)
                    // 요약 텍스트 재생성
                    if (disclosureItems.length > 0) {
                        dartSummary = disclosureItems.slice(0, 10).map((item, idx) => 
                            `[공시 ${idx + 1}] ${item.rcept_dt.slice(4, 6)}/${item.rcept_dt.slice(6, 8)} - ${item.report_nm}`
                        ).join('\n')
                    }
                } catch (e) {
                    console.error('[RisingStockAnalysisService] Failed to parse existing disclosures_json')
                }
            }

            // 공시 정보가 없는 경우 새로 수집
            if (disclosureItems.length === 0) {
                try {
                    const result = await this.dartApi.getDisclosuresSummaryForAiWithRaw(stockCode)
                    disclosureItems = result.items || []
                    dartSummary = result.summary
                    console.log(`[RisingStockAnalysisService] Disclosures fetched from DART for ${stockName}: ${disclosureItems.length} items`)
                } catch (e) {
                    try {
                        dartSummary = await this.dartApi.getDisclosuresSummaryForAi(stockCode)
                    } catch (e2) {
                        console.warn(`[RisingStockAnalysisService] DART fetch failed for ${stockCode}:`, e2)
                    }
                }
            }
            
            // 3. 차트 데이터 (Kiwoom)
            let chartSummary = '차트 데이터 없음'
            try {
                const chartData = await this.kiwoom.getDailyChartData(stockCode)
                chartSummary = chartData.slice(0, 40).map((d: any) => 
                    `${d.dt || d.date}: 종가 ${d.clpr || d.close}, 거래량 ${d.trqu || d.volume}`
                ).join('\n')
                console.log(`[RisingStockAnalysisService] Chart data found for ${stockName}: ${chartData.length} records`)
            } catch (e) {
                console.warn(`[RisingStockAnalysisService] Chart fetch failed for ${stockCode}:`, e)
            }
            
            return {
                stockCode,
                stockName,
                changeRate,
                news: newsSummary,
                disclosures: dartSummary,
                chart: chartSummary,
                rawNews: newsItems,
                rawDisclosures: disclosureItems,
                collectedAt: existing?.collected_at || new Date().toISOString()
            }
        } catch (error) {
            console.error(`[RisingStockAnalysisService] Critical failure collecting for ${stockName}:`, error)
            throw error
        }
    }

    /**
     * 텍스트 전처리 (HTML 태그 제거 및 길이 압축)
     */
    private cleanText(text: string): string {
        if (!text) return ''
        return text.replace(/<[^>]*>?/gm, '').replace(/\s+/g, ' ').trim().slice(0, 150)
    }

    /**
     * 오전 분석 결과가 신뢰할 만한지 (사유가 불명이 아닌지) 체크합니다.
     */
    private isAnalysisReliable(analysis: any): boolean {
        if (!analysis || !analysis.reason) return false
        const unknownKeywords = ['특이사항 없음', '찾을 수 없음', '이유 없음', '이유를 찾을 수', '뉴스나 공시가 없'];
        const reason = analysis.reason || ''
        
        // 사유가 너무 짧거나 금지된 키워드가 포함된 경우만 비신뢰
        const isHeuristicReliable = !unknownKeywords.some(kw => reason.includes(kw)) && reason.length > 20;
        
        // 점수가 0이라도 사유가 구체적이면 신뢰 (점수는 분석의 결과일 뿐 신뢰도와는 별개일 수 있음)
        return isHeuristicReliable;
    }

    /**
     * 대량의 종목을 배치(Batch) 단위로 분석하여 토큰을 절약합니다.
     * @param targetStocks 분석 대상 종목 리스트
     * @param timing 분석 시점 (MORNING/EVENING/MANUAL)
     */
    public async analyzeBatchAndSave(targetStocks: { code: string; name: string; rate: number }[], timing: string = 'MANUAL', date?: string) {
        const targetDate = date || new Date().toISOString().slice(0, 10)
        
        // 종목 코드 사전 세척
        const cleanedStocks = targetStocks.map(s => ({
            ...s,
            code: String(s.code).replace(/[^0-9]/g, ''),
            trading_value: (s as any).trading_value || 0,
            source: (s as any).source || ''
        }))
        
        const total = cleanedStocks.length
        let completed = 0

        eventBus.emit(SystemEvent.BATCH_PROGRESS, { step: 'DATA', current: 0, total, message: '기존 분석 결과 확인 및 데이터 수집 중...' })

        // 1. 필터링: 이미 신뢰할만한 분석이 있고, Raw 데이터(뉴스/공시)도 이미 수집된 종목은 제외
        // 단, 장 마감(EVENING) 분석 시에는 오전(MORNING) 데이터가 있더라도 재분석을 수행하도록 강제 (업데이트된 차트/등락률 반영)
        const allExisting = this.db.getRisingStocksByDate(targetDate, timing)
        const existingMap = new Map(allExisting.map((s: any) => [s.stock_code, s]))

        const finalTargets = cleanedStocks.filter(s => {
            const existing = existingMap.get(s.code)
            
            // MANUAL 분석이거나 이미 해당 타이밍의 신뢰할만한 분석이 있으면 스킵
            const isReliable = this.isAnalysisReliable(existing)
            const rawData = this.db.getRawData(targetDate, s.code)
            const hasRawData = rawData && (rawData.news_json !== '[]' || rawData.disclosures_json !== '[]')
            
            if (isReliable && hasRawData) {
                completed++
                return false
            }
            return true
        })

        console.log(`[RisingStockAnalysisService] Batch targets (${timing}): Total ${total}, Needs processing: ${finalTargets.length}`)
        
        if (finalTargets.length === 0) {
            eventBus.emit(SystemEvent.BATCH_PROGRESS, { step: 'COMPLETE', current: total, total, message: '모든 종목이 이미 분석되어 있습니다.' })
            return { success: true, count: 0 }
        }

        // 2. 종목별 컨텍스트 수집 (병렬 처리 - 속도 제한 주의: 3개씩 안전하게)
        const BATCH_SIZE = 3
        const stockContexts: any[] = []
        
        for (let i = 0; i < finalTargets.length; i += BATCH_SIZE) {
            const chunk = finalTargets.slice(i, i + BATCH_SIZE)
            
            // 병렬 실행하되 하나가 실패해도 나머지는 계속하도록 개별 try-catch 사용
            const results = (await Promise.all(chunk.map(async s => {
                try {
                    return await this.collectAllData(s.code, s.name, (s as any).rate || (s as any).changeRate || 0, targetDate)
                } catch (e) {
                    console.error(`[RisingStockAnalysisService] Individual collection failed for ${s.name}:`, e)
                    return null
                }
            }))).filter(Boolean) as any[]

            if (results.length > 0) {
                stockContexts.push(...results)
                
                // Raw 데이터 DB 저장
                results.forEach(res => {
                    this.db.saveRawData({
                        date: targetDate,
                        stock_code: res.stockCode,
                        stock_name: res.stockName,
                        news_json: JSON.stringify(res.rawNews),
                        disclosures_json: JSON.stringify(res.rawDisclosures)
                    })
                })
            }
            
            eventBus.emit(SystemEvent.BATCH_PROGRESS, { step: 'DATA', current: Math.min(i + BATCH_SIZE, finalTargets.length), total: finalTargets.length, message: `데이터 수집 중 (${Math.min(i + BATCH_SIZE, finalTargets.length)}/${finalTargets.length})` })

            // 부하 분산
            await new Promise(resolve => setTimeout(resolve, 500))
        }

        // 3. AI 배치 분석 수행 (5개 단위로 묶어서 호출)
        const AI_BATCH_SIZE = 5
        for (let i = 0; i < stockContexts.length; i += AI_BATCH_SIZE) {
            const chunk = stockContexts.slice(i, i + AI_BATCH_SIZE)
            
            eventBus.emit(SystemEvent.BATCH_PROGRESS, { step: 'ANALYSIS', current: completed, total, message: `AI 배치 분석 중 (Batch ${Math.floor(i/AI_BATCH_SIZE) + 1}/${Math.ceil(stockContexts.length/AI_BATCH_SIZE)})...` })

            const systemInstruction = this.skills.buildSystemInstruction() + `
                \n[중요 지시사항]
                - 각 종목별로 '상승 사유(reason)'를 5줄 이내로 핵심만 요약하세요.
                - 반드시 [ {...}, {...} ] 형태의 엄격한 JSON 배열 형식으로만 응답하세요.
            `

            const prompt = `
                다음 ${chunk.length}개 종목의 분석을 한 번에 수행하여 JSON 배열로 반환하세요.
                요구되는 JSON 형식 (Array<Object>): 
                [
                    { 
                        "stock_code": "005930", 
                        "ai_score": 85, 
                        "theme_sector": "섹터", 
                        "tags": ["태그1", "태그2"],
                        "reason": "사유", 
                        "chart_insight": "차트해석", 
                        "past_reference": "과거참고" 
                    }
                ]

                [대상 데이터]
                ${chunk.map((s, idx) => `
                # ${idx+1}. ${s.stockName} (${s.stockCode}) [등락: ${s.changeRate}%]
                - 뉴스: ${s.news}
                - 공시: ${s.disclosures}
                - 차트 요약: ${s.chart.slice(0, 300)}...
                `).join('\n\n')}
            `

            try {
                const aiResponse = await AiService.getInstance().askGemini(prompt, systemInstruction)
                let results;
                try {
                    const cleanJson = aiResponse.replace(/```json|```/gi, '').trim()
                    const jsonToParse = cleanJson.startsWith('[') ? cleanJson : `[${cleanJson}]`
                    results = JSON.parse(jsonToParse)
                } catch (e) {
                    console.error(`[RisingStockAnalysisService] Batch AI JSON Parse Error:`, aiResponse)
                    continue
                }

                if (Array.isArray(results)) {
                    results.forEach(res => {
                        // 종목 코드 매칭 강화 (숫자만 추출하여 비교)
                        const cleanedResCode = String(res.stock_code).replace(/[^0-9]/g, '').padStart(6, '0')
                        const target = chunk.find(c => String(c.stockCode).replace(/[^0-9]/g, '').padStart(6, '0') === cleanedResCode)
                        
                        if (target) {
                            const originalTarget = cleanedStocks.find(c => String(c.code).replace(/[^0-9]/g, '').padStart(6, '0') === cleanedResCode)
                            this.db.saveRisingStockAnalysis({
                                date: targetDate,
                                timing: timing,
                                stock_code: target.stockCode,
                                stock_name: target.stockName,
                                change_rate: target.changeRate || (originalTarget as any)?.rate || 0,
                                trading_value: (originalTarget as any)?.trading_value || (originalTarget as any)?.tradingValue || 0,
                                source: (originalTarget as any)?.source || '',
                                ai_score: res.ai_score,
                                theme_sector: res.theme_sector,
                                reason: res.reason,
                                chart_insight: res.chart_insight,
                                past_reference: res.past_reference,
                                tags: res.tags || []
                            })
                            completed++
                        }
                    })
                }
                
                // API 속도 제한 준수대기 (1초)
                if (i + AI_BATCH_SIZE < stockContexts.length) {
                    await new Promise(resolve => setTimeout(resolve, 1000))
                }
            } catch (error) {
                console.error(`[RisingStockAnalysisService] Batch AI analysis failed for index ${i}:`, error)
            }
        }

        eventBus.emit(SystemEvent.BATCH_PROGRESS, { step: 'SUMMARY', current: total, total, message: '시장 종합 리포트 생성 중...' })
        await this.generateMarketDailyReport(targetDate, timing)
        eventBus.emit(SystemEvent.BATCH_PROGRESS, { step: 'COMPLETE', current: total, total, message: '일괄 분석이 완료되었습니다.' })
        return { success: true, count: completed }
    }

    /**
     * 개별 종목 분석 (거래대금 및 출처 정보 포함)
     */
    public async runAnalysis(options: { code: string, name: string, changeRate: number, tradingValue?: number, source?: string, timing?: string, date?: string }) {
        const { code: stockCode, name: stockName, changeRate, tradingValue, source, timing = 'MANUAL', date } = options
        const targetDate = date || this.db.getKstDate()
        eventBus.emit(SystemEvent.AI_EVALUATION_UPDATE, { isEvaluating: true, stock: { code: stockCode, name: stockName } })
        try {
            console.log(`[RisingStockAnalysisService] Individual analysis requested for ${stockName}(${stockCode}) on ${targetDate}`)
            const rawData = await this.collectAllData(stockCode, stockName, changeRate, targetDate)
            
            // Raw 데이터 항상 DB 저장 (수집 시점 업데이트 포함)
            this.db.saveRawData({ 
                date: targetDate, 
                stock_code: stockCode, 
                stock_name: stockName, 
                news_json: JSON.stringify(rawData.rawNews), 
                disclosures_json: JSON.stringify(rawData.rawDisclosures) 
            })
            
            const systemInstruction = this.skills.buildSystemInstruction() + `
                \n[중요 지시사항]
                - '상승 사유(reason)'를 5줄 이내로 핵심만 요약하세요.
                - 뉴스나 공시에서 확실한 근거를 찾으세요. 없으면 '이슈 미포착'이라 하지 말고, 섹터 전체의 흐름이나 차트상의 특징(전고점 돌파 등)을 언급하세요.
                - 반드시 아래 포맷의 JSON 객체 형식으로만 응답하세요. (tags는 이 종목의 핵심 테마/이슈 키워드 1~3개 배열)
                {
                    "ai_score": 85,
                    "theme_sector": "테마/섹터명",
                    "tags": ["태그1", "태그2"],
                    "reason": "상승/하락 상세 사유",
                    "chart_insight": "차트 및 수급 분석 요약",
                    "past_reference": "과거 유사 사례 및 참고사항"
                }
            `
            const promptParts = [
                `종목: ${stockName}(${stockCode})`,
                `당일 등락률: ${changeRate}%`,
                `거래대금: ${tradingValue ? Math.round(tradingValue / 100) : '0'}억`,
                '',
                '[수집된 뉴스]',
                rawData.news,
                '',
                '[수집된 공시]',
                rawData.disclosures,
                '',
                '[최근 차트 데이터]',
                rawData.chart.slice(0, 500),
                '',
                '위 데이터를 종합 분석하여 JSON 객체로 응답하세요.'
            ]
            const prompt = promptParts.join('\n')

            const aiResponse = await AiService.getInstance().askGemini(prompt, systemInstruction)
            let analysis;
            try {
                analysis = JSON.parse(aiResponse.replace(/```json|```/g, '').trim())
            } catch (pErr) {
                console.error(`[RisingStockAnalysisService] JSON Parse Error:`, aiResponse)
                throw new Error(`AI 응답 형식 오류 (JSON 파싱 불가)`)
            }

            const finalData = {
                date: targetDate, 
                timing: timing,
                stock_code: stockCode, 
                stock_name: stockName, 
                change_rate: changeRate,
                trading_value: tradingValue || 0,
                source: source || '',
                ai_score: analysis.ai_score, 
                theme_sector: analysis.theme_sector, 
                reason: analysis.reason,
                chart_insight: analysis.chart_insight, 
                past_reference: analysis.past_reference,
                tags: analysis.tags || []
            }
            this.db.saveRisingStockAnalysis(finalData)
            console.log(`[RisingStockAnalysisService] Successfully analyzed ${stockName}. Score: ${analysis.ai_score}`)
            return { success: true, data: finalData }
        } catch (error: any) {
            console.error(`[RisingStockAnalysisService] Individual analysis failed for ${stockName}:`, error)
            return { success: false, error: error.message }
        } finally {
            eventBus.emit(SystemEvent.AI_EVALUATION_UPDATE, { isEvaluating: false, stock: null })
        }
    }

    /**
     * 당일 시장의 모든 급등주에 대해 일괄 분석을 수행하고 전체 시장 리포트를 생성합니다.
     * @param date 분석 날짜
     * @param timing 분석 시점 (MORNING/EVENING/MANUAL)
     */
    public async generateMarketDailyReport(date?: string, timing: string = 'EVENING') {
        const targetDate = date || this.db.getKstDate()
        eventBus.emit(SystemEvent.AI_EVALUATION_UPDATE, { isEvaluating: true, stock: { code: 'MARKET', name: '전체 시장' } })
        try {
            const analyzedStocks = this.db.getRisingStocksByDate(targetDate, timing)
            if (analyzedStocks.length === 0) throw new Error('분석된 종목이 없습니다.')

            // === [Self-Reflection Context 구성] ===
            let reflectionContext = "";
            let morningReport: any = null;
            
            if (timing === 'EVENING') {
                morningReport = this.db.getMarketDailyReport(targetDate, 'MORNING');
                const morningStocks = this.db.getRisingStocksByDate(targetDate, 'MORNING');
                
                if (morningReport && morningStocks.length > 0) {
                    reflectionContext = `
                        [오늘 오전의 당신의 분석 복기]
                        - 오전 리포트 요약: ${morningReport.market_summary.slice(0, 500)}...
                        - 오전 주요 분석 종목: ${morningStocks.map(s => `${s.stock_name}(${s.ai_score}점)`).join(', ')}
                        
                        [현재 장 마감 결과와 비교]
                        최종 결과와 오전의 예측을 비교하여, 왜 오전에 강했던 종목이 유지되었는지/무너졌는지, 
                        혹은 오전에 없던 새로운 주도주가 왜 나타났는지 분석하여 '학습된 교훈'을 포함해 주세요.
                    `;
                }
            }

            const stocksContext = analyzedStocks.map((s: any) => {
                const tagsStr = s.tags ? ` 태그: ${JSON.parse(s.tags).join(',')}` : ''
                return `- ${s.stock_name} (${s.change_rate}%): [${s.theme_sector}]${tagsStr} ${s.reason} (AI 점수: ${s.ai_score})`
            }).join('\n')

            const typeLabel = timing === 'MORNING' ? '오전 장 초반' : '장 마감 결산';
            const systemInstruction = `당신은 ${typeLabel} 분석을 수행하는 대한민국 주식 시장 전문 전략가입니다.
                시장의 맥락(Context)을 꿰뚫어보고, 오늘 벌어진 현상의 인과관계를 논리적으로 분석하세요.
                ${this.skills.buildSystemInstruction()}
            `

            const prompt = `[${targetDate} ${timing} 분석 요약 데이터]
${stocksContext}

${reflectionContext}

위 데이터를 분석하여 대한민국 주식 시장 분석 리포트를 다음 JSON 구조로만 반환하세요.
- 불필요한 서술은 제외하고 핵심만 정교하게 분석하세요.
- 주요 테마는 오늘 시장의 영항력이 컸던 순서대로 최대 5개까지 선정하세요.
- 반드시 순수 JSON만 응답하세요.

{
  "summary_lines": [
    "결정적 특징 1", "특기 종목 흐름 2", "기타 특징 3"
  ],
  "market_outlook": "기술적 분석 및 글로벌 수급을 토대로 한 내일 시장 전망 및 대응 전략",
  "self_reflection": "오전 예측 대비 적중률 분석 및 오늘 얻은 새로운 레슨 필드 (EVENING 시점에만 작성. 없으면 빈문자열)",
  "top_themes": [
    {
      "rank": 1,
      "theme_name": "주도 테마명",
      "issue": "테마 상승의 배경 (3줄 이내)",
      "leading_stocks": ["대장주1", "주도주2"],
      "outlook": "향후 전망",
      "rating": "Good/Normal/Caution"
    }
  ]
}`

            const marketSummaryJsonText = await AiService.getInstance().askGemini(prompt, systemInstruction)
            let parsedSummary: any = { market_summary: "오늘 시장의 핵심 정보입니다.", top_themes: [] }
            try {
                parsedSummary = JSON.parse(marketSummaryJsonText.replace(/```json|```/gi, '').trim())
            } catch (e) {
                console.error("[RisingStockAnalysisService] JSON Parse Error in Market Report", e)
            }

            // === [학습 로그 및 레슨 기록] ===
            if (timing === 'EVENING' && parsedSummary.self_reflection && parsedSummary.self_reflection.length > 10) {
                try {
                    if (analyzedStocks.length > 0) {
                        this.db.saveAiLearningLog({
                            original_report_id: analyzedStocks[0].id,
                            prediction_accuracy: "종합 판단",
                            actual_performance: analyzedStocks[0].change_rate,
                            learning_point: parsedSummary.self_reflection,
                            sector: analyzedStocks[0].theme_sector
                        });
                        
                        this.skills.appendLesson('prediction_track_record.md', parsedSummary.self_reflection, `Analyze date: ${targetDate}`);
                    }
                } catch (lErr) {
                    console.error("[RisingStockAnalysisService] Learning log save failed", lErr);
                }
            }

            const report = { date: targetDate, timing, market_summary: JSON.stringify(parsedSummary), report_type: 'DAILY' }
            this.db.saveMarketDailyReport(report)
            return { success: true, data: report }
        } catch (error: any) {
            return { success: false, error: error.message }
        } finally {
            eventBus.emit(SystemEvent.AI_EVALUATION_UPDATE, { isEvaluating: false, stock: null })
        }
    }
}
