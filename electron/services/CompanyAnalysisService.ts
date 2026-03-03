import { DatabaseService } from './DatabaseService'
import { KiwoomService } from './KiwoomService'
import { PriceStore } from './PriceStore'

export interface AnalysisResult {
    stockCode: string
    fundamentals: {
        years: string[]
        revenue: number[]
        opProfit: number[]
        netIncome: number[]
        roe: number[]
        debtRatio: number[]
        opMargin: number[]
        stability: number // Std Dev of OP
    }
    valuation: {
        currentPrice: number
        intrinsicValue: number
        marginOfSafety: number
        recommendation: string
    }
    insights: {
        fundamentals: string
        valuation: string
    }
    report: string
}

export class CompanyAnalysisService {
    private static instance: CompanyAnalysisService
    private db = DatabaseService.getInstance()
    private kiwoom = KiwoomService.getInstance()

    private constructor() { }

    public static getInstance(): CompanyAnalysisService {
        if (!CompanyAnalysisService.instance) {
            CompanyAnalysisService.instance = new CompanyAnalysisService()
        }
        return CompanyAnalysisService.instance
    }

    /**
     * Perform full 5-step analysis for a stock
     */
    public async analyzeStock(stockCode: string): Promise<AnalysisResult | null> {
        // Normalize stock code (ensure 6 digits, remove 'A' or other prefixes)
        const cleanCode = stockCode.replace(/[^0-9]/g, '')
        if (cleanCode.length !== 6) return null

        const financialData = this.db.getFinancialData(cleanCode)
        if (!financialData || financialData.length === 0) return null

        // 1. Get Current Price (Check Store first, then Fallback to API)
        let currentPrice = PriceStore.getInstance().getPrice(cleanCode) || 0

        if (currentPrice === 0) {
            console.log(`[CompanyAnalysisService] No cached price for ${cleanCode}. Fetching via API...`)
            const priceInfo = await this.kiwoom.getCurrentPrice(cleanCode)

            // Robust Price Extraction
            const rawData = priceInfo?.Body || priceInfo?.output || priceInfo
            const target = Array.isArray(rawData) ? rawData[0] : rawData

            const priceStr = target?.stk_prc || target?.lastPrice || target?.close || '0'
            currentPrice = Math.abs(parseInt(priceStr.toString().replace(/[^0-9-]/g, '')))

            if (currentPrice > 0) {
                PriceStore.getInstance().setPrice(cleanCode, currentPrice)
            }
        }
        else {
            console.log(`[CompanyAnalysisService] Using cached price for ${cleanCode}: ${currentPrice}`)
        }

        // 2. Fetch Listed Shares & Process Fundamentals
        const basicInfo = await this.kiwoom.getStockBasicInfo(cleanCode)
        const basicData = basicInfo?.Body || basicInfo?.body || basicInfo?.output || basicInfo
        const targetBasic = Array.isArray(basicData) ? basicData[0] : basicData

        // Try multiple field names for listing shares
        const lstStkQtyStr = (targetBasic?.lst_stk_qty || targetBasic?.lstStkQty || targetBasic?.totalShares || '0').toString()
        const lstStkQty = parseInt(lstStkQtyStr.replace(/[^0-9]/g, ''))

        // Fallback: If currentPrice is still 0, try to find it in basic info too
        if (currentPrice === 0 && targetBasic) {
            const fallbackPriceStr = (targetBasic?.stk_prc || targetBasic?.lastPrice || targetBasic?.close || '0').toString()
            currentPrice = Math.abs(parseInt(fallbackPriceStr.replace(/[^0-9-]/g, '')))
        }

        const fundamentals = this.processFundamentals(financialData)

        // 3. Valuation
        const valuation = this.calculateValuation(fundamentals, currentPrice, lstStkQty)

        // 3. Generate Algorithmic Insights
        const insights = this.generateInsights(fundamentals, valuation)

        // 4. Generate Report Text (Persona: World's Top Value Quant)
        const report = this.generateReportSummary(cleanCode, fundamentals, valuation, insights)

        const result: AnalysisResult = {
            stockCode: cleanCode,
            fundamentals,
            valuation,
            insights,
            report: report + `\n(v1.2 sys_track: ${currentPrice > 0 ? 'P_OK' : 'P_FAIL'}/${lstStkQty > 0 ? 'S_OK' : 'S_FAIL'} ${valuation.debug})`
        }

        // Cache the result
        this.db.saveAnalysisCache(cleanCode, JSON.stringify(result))

        return result
    }

    private processFundamentals(rows: any[]) {
        const yearsSet = new Set<string>()
        rows.forEach(r => yearsSet.add(r.year))
        const years = Array.from(yearsSet).sort()

        const revenue: number[] = []
        const opProfit: number[] = []
        const netIncome: number[] = []
        const equity: number[] = []
        const liabilities: number[] = []

        years.forEach(yr => {
            const yrData = rows.filter(r => r.year === yr)
            revenue.push(this.findAmount(yrData, ['ifrs-full_Revenue', 'ifrs_Revenue', '매출액', '영업수익']))
            opProfit.push(this.findAmount(yrData, ['ifrs-full_OperatingProfitLoss', 'ifrs_OperatingProfitLoss', '영업이익', '영업손실(이익)', '영업이익(손실)']))
            netIncome.push(this.findAmount(yrData, ['ifrs-full_ProfitLossAttributableToOwnersOfParent', 'ifrs_ProfitLossAttributableToOwnersOfParent', '당기순이익', '분기순이익', '반기순이익']))
            equity.push(this.findAmount(yrData, ['ifrs-full_EquityAttributableToOwnersOfParent', 'ifrs_EquityAttributableToOwnersOfParent', '자본총계', '자본의 합계']))
            liabilities.push(this.findAmount(yrData, ['ifrs-full_Liabilities', 'ifrs_Liabilities', '부채총계', '부채의 합계']))
        })

        const roe = netIncome.map((ni, i) => i > 0 ? (ni / ((equity[i] + equity[i - 1]) / 2)) * 100 : (ni / equity[i]) * 100)
        const debtRatio = liabilities.map((l, i) => (l / equity[i]) * 100)
        const opMargin = opProfit.map((op, i) => (op / revenue[i]) * 100)

        // Stability: Coefficient of Variation (Std Dev / Mean)
        const meanOP = opProfit.reduce((a, b) => a + b, 0) / opProfit.length
        const variance = opProfit.reduce((a, b) => a + Math.pow(b - meanOP, 2), 0) / opProfit.length
        const stdDev = Math.sqrt(variance)
        const stability = (stdDev / Math.abs(meanOP)) * 100

        return { years, revenue, opProfit, netIncome, roe, debtRatio, opMargin, stability, equity }
    }

    private findAmount(data: any[], ids: string[]): number {
        for (const id of ids) {
            const match = data.find(d => d.account_id === id || d.account_nm.includes(id))
            if (match) return match.amount
        }
        return 0
    }

    private calculateValuation(f: any, currentPrice: number, lstStkQty: number) {
        // Required Rate of Return (10% = 0.10)
        const requiredReturn = 0.10
        const avgRoe = (f.roe.reduce((a: number, b: number) => a + b, 0) / f.roe.length) / 100

        // Latest Total Equity
        const lastEquity = f.equity[f.equity.length - 1] || 0

        let intrinsicValue = 0
        if (lstStkQty > 0 && lastEquity > 0) {
            // Intrinsic Value = (Total Equity * (Avg ROE / Required Return)) / Total Shares
            const totalIntrinsicValue = lastEquity * (avgRoe / requiredReturn)
            intrinsicValue = totalIntrinsicValue / lstStkQty
        } else if (lastEquity > 0 && currentPrice > 0) {
            // Fallback: If share count missing, use a relative multiplier (less accurate)
            intrinsicValue = currentPrice * (avgRoe / requiredReturn)
        }

        const marginOfSafety = (intrinsicValue > 0 && currentPrice > 0) ? ((intrinsicValue - currentPrice) / intrinsicValue) * 100 : 0

        let recommendation = 'HOLD'
        if (marginOfSafety > 30 && avgRoe > 0.12) recommendation = 'STRONG BUY'
        else if (marginOfSafety > 15) recommendation = 'BUY'
        else if (marginOfSafety < -15) recommendation = 'REDUCE'
        else if (marginOfSafety < -30) recommendation = 'AVOID'

        return {
            currentPrice,
            intrinsicValue,
            marginOfSafety,
            recommendation,
            debug: `[E:${Math.round(lastEquity / 1e8)}억, S:${lstStkQty}]`
        }
    }

    private generateInsights(f: any, v: any) {
        // Fundamentals Insight
        const avgRoe = f.roe.reduce((a: number, b: number) => a + b, 0) / f.roe.length
        const roeTrend = f.roe[f.roe.length - 1] > avgRoe ? '개선' : '정체'

        let fundamentals = ""
        if (avgRoe > 15 && f.stability < 15) {
            fundamentals = "자본 효율성이 극히 높고 이익 변동성이 낮은 A급 비즈니스 모델입니다."
        } else if (avgRoe > 10) {
            fundamentals = `수익성이 견조하며 최근 지표가 ${roeTrend} 추세에 있습니다.`
        } else {
            fundamentals = "수익성이 낮거나 이익 변동이 커 보수적인 접근이 필요합니다."
        }

        // Valuation Insight
        let valuation = ""
        if (v.marginOfSafety > 30) {
            valuation = "현재가는 계산된 내재가치 대비 과도하게 저평가된 매력적인 구간입니다."
        } else if (v.marginOfSafety > 10) {
            valuation = "적정 가치 이하로 거래되고 있어 분할 매수 관점에서 유리합니다."
        } else {
            valuation = "적정 가치 부근이거나 프리미엄이 붙어 있어 가격 메리트가 낮습니다."
        }

        return { fundamentals, valuation }
    }

    private generateReportSummary(code: string, f: any, v: any, i: any): string {
        const avgRoe = (f.roe.reduce((a: any, b: any) => a + b, 0) / f.roe.length).toFixed(2)

        return `[${code}] 가치 퀀트 분석 리포트
기준일: ${new Date().toLocaleDateString('ko-KR')}

■ 3단계: 펀더멘털 품질 (Quality)
- 10년 평균 ROE: ${avgRoe}%
- 이익 안정성(변동계수): ${f.stability.toFixed(2)}%
- [분석 의견]: ${i.fundamentals}

■ 4단계: 밸류에이션 (Valuation)
- 현재가: ${v.currentPrice.toLocaleString()}원
- 산출 내재가치: ${Math.round(v.intrinsicValue).toLocaleString()}원
- 안전마진: ${v.marginOfSafety.toFixed(2)}%
- [분석 의견]: ${i.valuation}

■ 5단계: 최종 판단 (Verdict)
- 종합 등급: ${v.recommendation}
- [결론]: 현재 안전마진은 ${v.marginOfSafety.toFixed(1)}%로, 데이터 기반의 객관적 진입 가치는 ${v.marginOfSafety > 15 ? '충분' : '부족'}한 상태입니다.
`
    }
}
