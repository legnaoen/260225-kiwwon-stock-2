import { IBaseCollector } from '../types/PipelineTypes';

export class ResearchCollector implements IBaseCollector {
    public async collect(options?: { forceFetch?: boolean }): Promise<any> {
        return new Promise((resolve) => {
            // TODO: 네이버 리서치 / 한경컨센서스 크롤링 및 카테고리별 분류 연동
            const mockReports = [
                {
                    category: '데일리/시황',
                    brokerage: '신한투자증권',
                    analyst: '김마감',
                    title: '국내 주식 마감 시황 - 개인 역대 최대 순매수와 KOSPI',
                    summary: '외국인 매물을 개인이 전량 소화하며 하방 지지. 반도체, 금융 중심 강보합.',
                    stance: 'Neutral'
                },
                {
                    category: '산업분석',
                    brokerage: '한화투자증권',
                    analyst: '준영킴',
                    title: '차세대 통신 연결 기술 CPO(Co-Packaged Optics)의 부상',
                    summary: 'AI 데이터센터 전력 효율화를 위한 핵심 기술. 관련 밸류체인 수혜 기대.',
                    stance: 'Positive'
                },
                {
                    category: '경제/투자전략',
                    brokerage: '키움증권',
                    analyst: '이전략',
                    title: '03/24 달러, 트럼프 발언에 하락',
                    summary: '환율 변동성 확대 구간. 대형 수출주 및 헷지 관점의 포트폴리오 권고.',
                    stance: 'Neutral'
                },
                {
                    category: '국내종목',
                    brokerage: '유진투자증권',
                    analyst: '박종목',
                    title: '현대중공업 - 기업 가치 재평가 필요',
                    summary: '수주 잔고 질적 개선 및 친환경 선박 모멘텀. 이익 레버리지 본격화 구간.',
                    stance: 'Buy'
                }
            ];

            // 최근 1주간 애널리스트들이 집중한 산업 (네이버 증권 리서치 벤치마킹)
            const mockHotSectors = [
                { rank: 1, name: '반도체', reportCount: 42, reason: '차세대 통신 기술 및 HBM 수주 릴레이' },
                { rank: 2, name: '건설', reportCount: 28, reason: '원전주 강세 및 중동 재건/수주 랠리' },
                { rank: 3, name: 'IT/하드웨어', reportCount: 19, reason: '3월 기판, PCB 밸류체인 공장 투어 후기 및 턴어라운드 기대' }
            ];

            setTimeout(() => {
                resolve({
                    timestamp: new Date().toISOString(),
                    reports: mockReports,
                    hotSectors: mockHotSectors
                });
            }, 600);
        });
    }
}
