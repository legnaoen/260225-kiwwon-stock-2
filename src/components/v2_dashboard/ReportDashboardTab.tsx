import React, { useState, useEffect } from 'react';
import { Search, Filter, ExternalLink, RefreshCw } from 'lucide-react';

interface NaverReport {
    id?: number;
    date: string;
    rank: number;
    industry_name: string;
    report_title: string;
    analyst: string;
    broker: string;
    content_snippet: string;
    url: string;
    collected_at: string;
}

export default function ReportDashboardTab() {
    const [reports, setReports] = useState<NaverReport[]>([]);
    const [topSectors, setTopSectors] = useState<any[]>([]);
    const [loading, setLoading] = useState<boolean>(true);
    const [activeTab, setActiveTab] = useState<string>('전체');
    const [searchTerm, setSearchTerm] = useState('');
    const [showTopSectors, setShowTopSectors] = useState<boolean>(true);

    const fetchReports = async () => {
        setLoading(true);
        try {
            if (window.electronAPI?.getNaverResearchReports) {
                const [data, topData] = await Promise.all([
                    window.electronAPI.getNaverResearchReports(500),
                    window.electronAPI.getNaverResearchTopSectors ? window.electronAPI.getNaverResearchTopSectors(7) : Promise.resolve([])
                ]);
                setReports(data || []);
                setTopSectors(topData || []);
            }
        } catch (error) {
            console.error('Failed to fetch reports:', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchReports();
    }, []);

    // 기본 카테고리와 동적 카테고리 분리
    const BASE_CATEGORIES = ['데일리', '투자전략', '경제분석', '산업분석', '국내종목'];
    const allCategories = Array.from(new Set(reports.map(r => r.industry_name).filter(Boolean)));
    const dynamicCategories = allCategories.filter(cat => !BASE_CATEGORIES.includes(cat));

    // 데이터 필터링
    const filteredReports = reports.filter(r => {
        const matchesCategory = activeTab === '전체' || r.industry_name === activeTab;
        const matchesSearch = !searchTerm || 
            r.report_title?.toLowerCase().includes(searchTerm.toLowerCase()) || 
            r.broker?.toLowerCase().includes(searchTerm.toLowerCase()) ||
            r.analyst?.toLowerCase().includes(searchTerm.toLowerCase());
        return matchesCategory && matchesSearch;
    });

    const handleOpenUrl = (url: string) => {
        if (url && window.electronAPI?.openExternal) {
            window.electronAPI.openExternal(url);
        }
    };

    const formatDate = (dateStr: string) => {
        if (!dateStr) return '';
        if (dateStr.length >= 10) return dateStr.substring(5, 10).replace('-', '/');
        return dateStr;
    };

    // 주간 집중 산업 날짜별 그룹화
    const topSectorsByDate = topSectors.reduce((acc, curr) => {
        if (!acc[curr.date]) acc[curr.date] = [];
        acc[curr.date].push(curr);
        return acc;
    }, {} as Record<string, any[]>);
    const sortedDates = Object.keys(topSectorsByDate).sort((a, b) => b.localeCompare(a));

    return (
        <div className="flex flex-col h-full bg-background">
            <div className="flex items-center justify-between p-4 border-b shrink-0">
                <div>
                    <h2 className="text-lg font-bold">네이버 리서치 대시보드</h2>
                    <p className="text-sm text-muted-foreground">증권사 리포트 모아보기 및 애널리스트 집중 산업 탑3</p>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => setShowTopSectors(!showTopSectors)}
                        className={`px-3 py-2 text-sm font-medium rounded-lg transition-colors border ${showTopSectors ? 'bg-primary/10 text-primary border-primary/20' : 'bg-muted text-muted-foreground border-transparent'}`}
                    >
                        주간 탑3 트렌드 {showTopSectors ? '숨기기' : '보기'}
                    </button>
                    <div className="relative ml-2">
                        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                        <input
                            type="text"
                            placeholder="제목, 증권사, 애널리스트 검색..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-64 pl-9 pr-4 py-2 bg-muted/50 border-none rounded-lg text-sm focus:ring-1 focus:ring-primary outline-none transition-all"
                        />
                    </div>
                    <button
                        onClick={fetchReports}
                        disabled={loading}
                        className="p-2 bg-muted hover:bg-muted/80 rounded-lg text-muted-foreground transition-colors"
                        title="새로고침"
                    >
                        <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
                    </button>
                </div>
            </div>

            {showTopSectors && sortedDates.length > 0 && (
                <div className="p-4 border-b bg-muted/20 shrink-0">
                    <h3 className="text-sm font-bold mb-3 flex items-center gap-2">
                        📈 최근 주간 집중 산업 (Top 3) 흐름
                    </h3>
                    <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-hide">
                        {sortedDates.map(date => (
                            <div key={date} className="min-w-[200px] bg-card border rounded-lg p-3 shadow-sm">
                                <div className="text-xs font-bold text-muted-foreground mb-2 pb-2 border-b">
                                    {date}
                                </div>
                                <div className="space-y-2">
                                    {topSectorsByDate[date].map((sector: any) => (
                                        <div key={sector.rank} className="flex items-center gap-2 text-sm">
                                            <span className={`flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold ${sector.rank === 1 ? 'bg-amber-500/20 text-amber-600' : sector.rank === 2 ? 'bg-slate-500/20 text-slate-400' : 'bg-orange-500/20 text-orange-600'}`}>
                                                {sector.rank}
                                            </span>
                                            <span className="font-medium truncate">{sector.industry_name}</span>
                                            <span className="text-xs text-muted-foreground ml-auto">({sector.report_count}건)</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            <div className="flex px-4 pt-2 border-b gap-2 overflow-x-auto shrink-0 scrollbar-hide items-center">
                <button
                    onClick={() => setActiveTab('전체')}
                    className={`pb-3 px-2 text-sm font-bold border-b-2 transition-colors whitespace-nowrap ${
                        activeTab === '전체' 
                        ? 'border-primary text-primary' 
                        : 'border-transparent text-muted-foreground hover:text-foreground'
                    }`}
                >
                    전체
                </button>
                
                <div className="h-4 w-px bg-border mx-2"></div>

                {BASE_CATEGORIES.map(category => (
                    <button
                        key={category}
                        onClick={() => setActiveTab(category)}
                        className={`pb-3 px-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                            activeTab === category 
                            ? 'border-primary text-primary' 
                            : 'border-transparent text-muted-foreground hover:text-foreground'
                        }`}
                    >
                        {category}
                    </button>
                ))}

                {dynamicCategories.length > 0 && (
                    <>
                        <div className="h-4 w-px bg-border mx-2"></div>
                        <span className="text-[10px] font-bold text-amber-500 bg-amber-500/10 px-2 py-0.5 rounded-full mb-3 shrink-0">HOT 산업</span>
                        {dynamicCategories.map(category => (
                            <button
                                key={category}
                                onClick={() => setActiveTab(category)}
                                className={`pb-3 px-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                                    activeTab === category 
                                    ? 'border-amber-500 text-amber-500' 
                                    : 'border-transparent text-muted-foreground hover:text-foreground'
                                }`}
                            >
                                {category}
                            </button>
                        ))}
                    </>
                )}
            </div>

            <div className="flex-1 overflow-auto p-4">
                {loading ? (
                    <div className="flex items-center justify-center h-full">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                    </div>
                ) : filteredReports.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                        <Filter size={32} className="mb-2 opacity-50" />
                        <p>해당하는 리포트가 없습니다.</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {filteredReports.map((report, idx) => (
                            <div key={idx} className="bg-card border rounded-xl p-4 flex flex-col hover:border-primary/50 transition-colors shadow-sm">
                                <div className="flex justify-between items-start mb-2">
                                    <span className="text-xs font-semibold px-2 py-1 bg-primary/10 text-primary rounded-md">
                                        {report.industry_name || '분류없음'}
                                    </span>
                                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                                        {formatDate(report.date)}
                                    </span>
                                </div>
                                <h3 className="font-bold text-base leading-tight mb-2 line-clamp-2" title={report.report_title}>
                                    {report.report_title}
                                </h3>
                                <div className="flex items-center gap-2 text-xs text-muted-foreground mb-3">
                                    <span className="font-medium text-foreground/80">{report.broker}</span>
                                    <span>•</span>
                                    <span>{report.analyst}</span>
                                </div>
                                {report.content_snippet && (
                                    <p className="text-sm text-muted-foreground line-clamp-3 mb-4 flex-1">
                                        {report.content_snippet}
                                    </p>
                                )}
                                <div className="mt-auto pt-3 border-t flex justify-end">
                                    <button 
                                        onClick={() => handleOpenUrl(report.url)}
                                        disabled={!report.url}
                                        className="text-xs flex items-center gap-1 text-blue-500 hover:text-blue-400 disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        원문 보기 <ExternalLink size={12} />
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
