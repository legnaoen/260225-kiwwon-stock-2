import React, { useState, useEffect } from 'react';
import { RefreshCw, Activity, Code, Database, AlertCircle } from 'lucide-react';

export default function ApiDiagnosticsTab() {
    const [logs, setLogs] = useState<any[]>([]);
    const [selectedLog, setSelectedLog] = useState<any | null>(null);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [hideKa00001, setHideKa00001] = useState(true);
    const [isTestingSync, setIsTestingSync] = useState(false);

    const filterLogs = (rawLogs: any[]) => {
        if (!hideKa00001) return rawLogs;
        return rawLogs.filter(log => log.apiId !== 'ka00001');
    };

    const fetchLogs = async () => {
        setIsRefreshing(true);
        if (window.electronAPI?.getApiLogs) {
            const data = await window.electronAPI.getApiLogs();
            setLogs(filterLogs(data || []));
            if (data && data.length > 0 && !selectedLog) {
                const filtered = filterLogs(data);
                if (filtered.length > 0) setSelectedLog(filtered[0]);
            }
        }
        setIsRefreshing(false);
    };

    const runManualTest = async () => {
        setIsTestingSync(true);
        if (window.electronAPI?.testMarketScanner) {
            await window.electronAPI.testMarketScanner();
            setTimeout(fetchLogs, 500); // 0.5s delay to assure interceptor catches it
        }
        setIsTestingSync(false);
    };

    useEffect(() => {
        fetchLogs();
    }, [hideKa00001]);

    useEffect(() => {
        fetchLogs();
        const timer = setInterval(fetchLogs, 5000);
        return () => clearInterval(timer);
    }, [hideKa00001]);

    const formatJson = (data: any) => {
        if (!data) return 'No data available';
        try {
            return JSON.stringify(data, null, 2);
        } catch (e) {
            return String(data);
        }
    };

    return (
        <div className="flex flex-col h-full bg-slate-50 dark:bg-gray-900 absolute inset-0 pt-6">
            <div className="flex items-center justify-between px-6 mb-4">
                <div>
                    <h2 className="text-xl font-bold font-neo text-slate-800 dark:text-gray-100 flex items-center">
                        <Activity className="w-5 h-5 mr-2 text-indigo-500" />
                        API & Data Pipeline Inspector
                    </h2>
                    <p className="text-sm text-slate-500 dark:text-gray-400 mt-1">
                        최근 백엔드 서버(키움증권 등)와의 API 통신 기록과 가공된 날것의 데이터를 교차 검증합니다.
                    </p>
                </div>
                <div className="flex items-center space-x-3">
                    <label className="flex items-center space-x-2 text-sm text-slate-600 dark:text-gray-300 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={hideKa00001}
                            onChange={(e) => setHideKa00001(e.target.checked)}
                            className="rounded border-slate-300 text-indigo-500 focus:ring-indigo-500"
                        />
                        <span>ka00001 숨기기</span>
                    </label>

                    <button
                        onClick={runManualTest}
                        disabled={isTestingSync}
                        className="flex items-center px-4 py-2 bg-indigo-50 dark:bg-indigo-900/40 border border-indigo-200 dark:border-indigo-800 rounded-lg hover:bg-indigo-100 dark:hover:bg-indigo-900/60 transition font-neo text-sm font-bold text-indigo-700 dark:text-indigo-400 shadow-sm disabled:opacity-50"
                    >
                        {isTestingSync ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <Activity className="w-4 h-4 mr-2" />}
                        시장스캐너 강제 포착시험
                    </button>

                    <button
                        onClick={fetchLogs}
                        className="flex items-center px-4 py-2 bg-white dark:bg-gray-800 border border-slate-200 dark:border-gray-700 rounded-lg hover:bg-slate-50 dark:hover:bg-gray-700 transition font-neo text-sm font-bold text-slate-700 dark:text-gray-200 shadow-sm"
                    >
                        <RefreshCw className={`w-4 h-4 mr-2 ${isRefreshing ? 'animate-spin' : ''}`} />
                        Refresh Logs
                    </button>
                </div>
            </div>

            <div className="flex flex-1 overflow-hidden border-t border-slate-200 dark:border-gray-800">
                {/* Left Panel: Log List */}
                <div className="w-1/3 border-r border-slate-200 dark:border-gray-800 bg-white dark:bg-gray-800 overflow-y-auto">
                    {logs.length === 0 ? (
                        <div className="p-8 text-center text-slate-400 dark:text-gray-500">
                            No API logs available yet.
                        </div>
                    ) : (
                        <div className="divide-y divide-slate-100 dark:divide-gray-700">
                            {logs.map((log) => (
                                <button
                                    key={log.id}
                                    onClick={() => setSelectedLog(log)}
                                    className={`w-full text-left p-4 hover:bg-slate-50 dark:hover:bg-gray-700 transition ${selectedLog?.id === log.id ? 'bg-indigo-50 dark:bg-indigo-900/20 border-l-4 border-indigo-500' : 'border-l-4 border-transparent'
                                        }`}
                                >
                                    <div className="flex justify-between items-start mb-1">
                                        <div className="flex items-center space-x-2">
                                            {log.success ? (
                                                <div className="w-2 h-2 rounded-full bg-green-500"></div>
                                            ) : (
                                                <div className="w-2 h-2 rounded-full bg-red-500"></div>
                                            )}
                                            <span className="font-bold text-sm text-slate-800 dark:text-gray-200">
                                                {log.apiId}
                                            </span>
                                        </div>
                                        <span className="text-xs text-slate-400 dark:text-gray-500 font-mono">
                                            {log.time}
                                        </span>
                                    </div>
                                    <div className="text-xs text-slate-500 dark:text-gray-400 truncate max-w-[250px]">
                                        {log.url?.replace('https://api.kiwoom.com', '')}
                                    </div>
                                    <div className="mt-2 text-xs text-slate-400 dark:text-gray-500 flex justify-between">
                                        <span>{log.duration}ms</span>
                                        {!log.success && <span className="text-red-500 truncate w-32 ml-2">{typeof log.responseData === 'string' ? log.responseData : 'Error'}</span>}
                                    </div>
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                {/* Right Panel: Data Debugger */}
                <div className="w-2/3 bg-[#1e1e1e] text-[#d4d4d4] flex flex-col overflow-hidden">
                    {selectedLog ? (
                        <>
                            <div className="flex items-center space-x-4 bg-[#252526] px-4 py-2 border-b border-[#3c3c3c]">
                                <div className="font-mono text-sm">
                                    <span className="text-indigo-400">POST</span>{' '}
                                    <span className="text-emerald-400">{selectedLog.url}</span>
                                </div>
                                <div className="ml-auto text-xs px-2 py-0.5 rounded bg-[#3c3c3c]">
                                    {selectedLog.duration}ms
                                </div>
                            </div>

                            <div className="flex-1 overflow-auto p-4 space-y-6">
                                {/* Request Panel */}
                                <div>
                                    <h3 className="text-xs font-bold uppercase text-slate-400 mb-2 flex items-center">
                                        <Code className="w-4 h-4 mr-2" />
                                        Request Payload (Param)
                                    </h3>
                                    <pre className="bg-[#1e1e1e] p-4 rounded-lg font-mono text-xs overflow-x-auto border border-[#3c3c3c] text-orange-300">
                                        {formatJson(selectedLog.requestData)}
                                    </pre>
                                </div>

                                {/* Response Panel */}
                                <div>
                                    <h3 className={`text-xs font-bold uppercase mb-2 flex items-center ${selectedLog.success ? 'text-emerald-400' : 'text-rose-400'}`}>
                                        {selectedLog.success ? <Database className="w-4 h-4 mr-2" /> : <AlertCircle className="w-4 h-4 mr-2" />}
                                        {selectedLog.success ? 'Raw Response (Server Data)' : 'Error Response'}
                                    </h3>
                                    <pre className={`bg-[#1e1e1e] p-4 rounded-lg font-mono text-xs overflow-x-auto border border-[#3c3c3c] ${selectedLog.success ? 'text-sky-300' : 'text-rose-300'}`}>
                                        {formatJson(selectedLog.responseData)}
                                    </pre>
                                </div>
                            </div>
                        </>
                    ) : (
                        <div className="flex-1 flex items-center justify-center text-slate-500">
                            Select a log entry from the list to view details
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
