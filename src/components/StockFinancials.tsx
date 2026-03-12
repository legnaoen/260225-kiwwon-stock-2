import React, { useState, useEffect } from 'react'
import { Database, AlertCircle, RefreshCw, BarChart3 } from 'lucide-react'
import { cn } from '../utils'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from './ui/Table'

interface StockFinancialsProps {
    stockCode: string
    stockName: string
}

interface FinancialRow {
    year: string
    reprt_code: string
    revenue: number
    opProfit: number
    netIncome: number
    equity: number
    roe: number
}

export const StockFinancials: React.FC<StockFinancialsProps> = ({ stockCode, stockName }) => {
    const [financials, setFinancials] = useState<FinancialRow[]>([])
    const [viewMode, setViewMode] = useState<'annual' | 'quarter'>('annual')
    const [isLoading, setIsLoading] = useState(false)
    const [isUpdating, setIsUpdating] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const fetchFinancials = async () => {
        if (!stockCode) return
        setIsLoading(true)
        setError(null)
        try {
            const res = await window.electronAPI.getFinancialData(stockCode)
            if (res.success && res.data) {
                // Process raw data into rows by year
                const rowsByYear = new Map<string, any>()
                res.data.forEach((d: any) => {
                    const key = `${d.year}_${d.reprt_code}`
                    if (!rowsByYear.has(key)) {
                        rowsByYear.set(key, { year: d.year, reprt_code: d.reprt_code })
                    }
                    const row = rowsByYear.get(key)

                    // Enhanced Mapping to avoid dashes
                    const accId = d.account_id || ''
                    const accNm = d.account_nm || ''

                    if (accId.includes('Revenue') || ['매출액', '영업수익'].includes(accNm)) row.revenue = d.amount
                    if (accId.includes('OperatingProfit') || ['영업이익', '영업손실(이익)', '영업이익(손실)'].includes(accNm)) row.opProfit = d.amount
                    if (accId.includes('ProfitLossAttributableToOwnersOfParent') || ['당기순이익', '분기순이익', '반기순이익'].includes(accNm)) row.netIncome = d.amount
                    if (accId.includes('EquityAttributableToOwnersOfParent') || ['자본총계', '자본의 합계'].includes(accNm)) row.equity = d.amount
                })

                const sortedRows: FinancialRow[] = Array.from(rowsByYear.values())
                    .map(r => {
                        const roe = r.equity > 0 ? (r.netIncome / r.equity) * 100 : 0
                        return {
                            year: r.year,
                            reprt_code: r.reprt_code,
                            revenue: r.revenue || 0,
                            opProfit: r.opProfit || 0,
                            netIncome: r.netIncome || 0,
                            equity: r.equity || 0,
                            roe: roe
                        }
                    })

                // Logic to process based on viewMode
                let processed: FinancialRow[] = []

                if (viewMode === 'annual') {
                    // Aggregate annual data
                    const annualMap = new Map<string, FinancialRow>()

                    // We want years, but if 11011 missing, use best available for that year
                    const years = Array.from(new Set(sortedRows.map(r => r.year))).sort((a, b) => b.localeCompare(a))

                    years.forEach(yr => {
                        const yrData = sortedRows.filter(r => r.year === yr)
                        // Best report order: Annual > 3Q > Half > 1Q
                        const bestReport = yrData.find(r => r.reprt_code === '11011') ||
                            yrData.find(r => r.reprt_code === '11014') ||
                            yrData.find(r => r.reprt_code === '11012') ||
                            yrData.find(r => r.reprt_code === '11013')

                        if (bestReport) {
                            annualMap.set(yr, bestReport)
                        }
                    })
                    processed = Array.from(annualMap.values())
                } else {
                    // Quarterly view: Show all reports for the last 2-3 years
                    processed = sortedRows.sort((a, b) => {
                        if (a.year !== b.year) return b.year.localeCompare(a.year)
                        return b.reprt_code.localeCompare(a.reprt_code)
                    })
                }

                setFinancials(processed)
            } else {
                setError(res.error || '데이터를 가져오지 못했습니다.')
            }
        } catch (err: any) {
            console.error('Failed to fetch financials:', err)
            setError(err.message)
        } finally {
            setIsLoading(false)
        }
    }
    useEffect(() => {
        fetchFinancials()
    }, [stockCode, viewMode])

    const handleUpdate = async () => {
        if (!stockCode) return
        setIsUpdating(true)
        setError(null)
        try {
            const result = await window.electronAPI.syncBatchFinancials([stockCode])
            if (result.success) {
                await fetchFinancials()
            } else {
                setError(result.error || 'DART 업데이트 실패')
            }
        } catch (err: any) {
            setError(err.message)
        } finally {
            setIsUpdating(false)
        }
    }

    const getYearLabel = (year: string, code: string) => {
        if (code === '11011') return year
        if (code === '11014') return `${year}(3Q)`
        if (code === '11012') return `${year}(半)`
        if (code === '11013') return `${year}(1Q)`
        return `${year}(?)`
    }

    const formatWon = (val: number) => {
        if (!val) return '-'
        const oku = val / 100000000
        if (Math.abs(oku) >= 10000) {
            return `${(oku / 10000).toFixed(1)}조`
        }
        return `${oku.toLocaleString()}억`
    }

    if (isLoading) {
        return (
            <div className="flex-1 flex flex-col items-center justify-center py-12 text-muted-foreground animate-pulse">
                <RefreshCw className="mb-2 animate-spin opacity-20" size={32} />
                <p className="text-xs">재무 정보를 불러오는 중...</p>
            </div>
        )
    }

    if (error) {
        return (
            <div className="bg-destructive/10 text-destructive p-4 rounded-xl flex items-center gap-3 border border-destructive/20 m-4">
                <AlertCircle size={18} />
                <p className="text-sm font-medium">{error}</p>
            </div>
        )
    }

    return (
        <div className="flex-1 flex flex-col gap-4">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <h3 className="text-sm font-bold flex items-center gap-2">
                        <BarChart3 size={16} className="text-blue-600" />
                        10년 재무제표
                    </h3>

                    <div className="flex bg-muted/30 p-0.5 rounded-lg border border-border/50">
                        <button
                            onClick={() => setViewMode('annual')}
                            className={cn(
                                "text-[10px] px-2 py-1 rounded-md transition-all font-bold",
                                viewMode === 'annual' ? "bg-white dark:bg-muted font-extrabold shadow-sm text-primary" : "text-muted-foreground hover:text-foreground"
                            )}
                        >
                            연간
                        </button>
                        <button
                            onClick={() => setViewMode('quarter')}
                            className={cn(
                                "text-[10px] px-2 py-1 rounded-md transition-all font-bold",
                                viewMode === 'quarter' ? "bg-white dark:bg-muted font-extrabold shadow-sm text-primary" : "text-muted-foreground hover:text-foreground"
                            )}
                        >
                            분기
                        </button>
                    </div>
                </div>

                <button
                    onClick={handleUpdate}
                    disabled={isUpdating || isLoading}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 text-primary text-[11px] font-bold hover:bg-primary/20 disabled:opacity-50 transition-all border border-primary/20"
                >
                    <RefreshCw size={12} className={isUpdating ? "animate-spin" : ""} />
                    DART 업데이트
                </button>
            </div>

            {financials.length === 0 ? (
                <div className="bg-muted/30 border border-dashed border-border rounded-2xl py-12 flex flex-col items-center justify-center text-center px-6">
                    <Database size={28} className="text-muted-foreground/30 mb-3" />
                    <p className="text-xs font-semibold text-muted-foreground">저장된 재무 데이터가 없습니다.</p>
                    <p className="text-[10px] text-muted-foreground/60 mt-1">설정에서 '10년 재무정보 일괄 업데이트'를<br />진행해 주세요.</p>
                </div>
            ) : (
                <div className="bg-card border border-border/60 rounded-2xl overflow-hidden shadow-sm">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead className="w-16">연도</TableHead>
                                <TableHead className="text-right">매출액</TableHead>
                                <TableHead className="text-right">영업이익</TableHead>
                                <TableHead className="text-right">당기순이익</TableHead>
                                <TableHead className="text-right">ROE</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {financials.map((row) => (
                                <TableRow key={`${row.year}_${row.reprt_code}`} className="hover:bg-muted/30">
                                    <TableCell className="font-bold text-[11px] whitespace-nowrap">
                                        {getYearLabel(row.year, row.reprt_code)}
                                    </TableCell>
                                    <TableCell className="text-right font-mono text-[11px]">{formatWon(row.revenue)}</TableCell>
                                    <TableCell className={cn(
                                        "text-right font-mono text-[11px]",
                                        row.opProfit < 0 ? "text-fall" : "text-foreground"
                                    )}>
                                        {formatWon(row.opProfit)}
                                    </TableCell>
                                    <TableCell className={cn(
                                        "text-right font-mono text-[11px]",
                                        row.netIncome < 0 ? "text-fall" : "text-foreground"
                                    )}>
                                        {formatWon(row.netIncome)}
                                    </TableCell>
                                    <TableCell className={cn(
                                        "text-right font-mono text-[11px] font-bold",
                                        row.roe > 10 ? "text-rise" : row.roe < 0 ? "text-fall" : "text-foreground"
                                    )}>
                                        {row.roe !== undefined && row.roe !== null ? row.roe.toFixed(2) : '0.00'}%
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
            )}
        </div>
    )
}
