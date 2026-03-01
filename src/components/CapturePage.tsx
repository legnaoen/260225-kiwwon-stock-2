import React, { useEffect } from 'react';
import { StockChart } from './StockChart';

interface CapturePageProps {
    code: string;
    name: string;
}

export default function CapturePage({ code, name }: CapturePageProps) {
    useEffect(() => {
        // Force dark mode on body for chart to look good
        document.documentElement.classList.add('dark');
        document.body.style.backgroundColor = '#0f172a'; // tailwind slate-900

        // Give the chart enough time to fetch data and render on canvas
        const timer = setTimeout(() => {
            window.electronAPI.send('chart-render-complete', code);
        }, 3000); // 3 seconds should be safe enough for data fetch + drawing

        return () => clearTimeout(timer);
    }, [code]);

    return (
        <div style={{ width: '800px', height: '600px', padding: '20px', backgroundColor: '#0f172a', display: 'flex', flexDirection: 'column' }}>
            <h2 style={{ color: 'white', marginBottom: '16px', fontSize: '28px', fontWeight: 'bold' }}>
                {name} <span style={{ color: '#94a3b8', fontSize: '20px' }}>({code}) 일봉 차트</span>
            </h2>
            <div style={{ flex: 1, position: 'relative', width: '100%' }}>
                <StockChart stockCode={code} stockName={name} className="h-full w-full bg-slate-800/50 rounded-xl" />
            </div>
        </div>
    );
}
