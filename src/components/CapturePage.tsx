import React, { useEffect } from 'react';
import { StockChart } from './StockChart';

interface CapturePageProps {
    code: string;
    name: string;
    theme?: string;
}

export default function CapturePage({ code, name, theme = 'dark' }: CapturePageProps) {
    useEffect(() => {
        const isDark = theme === 'dark';
        if (isDark) {
            document.documentElement.classList.add('dark');
            document.body.style.backgroundColor = '#0f172a'; // slate-900
        } else {
            document.documentElement.classList.remove('dark');
            document.body.style.backgroundColor = '#ffffff'; // white
        }

        // Give the chart enough time to fetch data and render on canvas
        const timer = setTimeout(() => {
            window.electronAPI.send('chart-render-complete', code);
        }, 3000); // 3 seconds should be safe enough for data fetch + drawing

        return () => clearTimeout(timer);
    }, [code, theme]);

    const isDark = theme === 'dark';

    return (
        <div style={{ width: '800px', height: '600px', padding: '20px', backgroundColor: isDark ? '#0f172a' : '#ffffff', display: 'flex', flexDirection: 'column' }}>
            <h2 style={{ color: isDark ? 'white' : '#0f172a', marginBottom: '16px', fontSize: '28px', fontWeight: 'bold' }}>
                {name} <span style={{ color: isDark ? '#94a3b8' : '#64748b', fontSize: '20px' }}>({code}) 일봉 차트</span>
            </h2>
            <div style={{ flex: 1, position: 'relative', width: '100%' }}>
                <StockChart stockCode={code} stockName={name} theme={theme} className={`h-full w-full rounded-xl ${isDark ? 'bg-slate-800/50' : 'bg-slate-100/50 border border-slate-200'}`} />
            </div>
        </div>
    );
}
