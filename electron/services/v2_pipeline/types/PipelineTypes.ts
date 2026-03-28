export type PipelineId = 
    | 'PL-Macro'       // 글로벌 매크로 지수 및 환율
    | 'PL-LocalFlow'   // 국내 증시 지수 & 누적 수급
    | 'PL-NewsKeyword' // 핵심 뉴스 헤드라인 키워드
    | 'PL-Research'    // 네이버 리서치(증권사 시황 코멘트)
    | 'PL-RisingStock' // 당일 특징주/급등주 (분석 배제)
    | 'PL-NaverFlow'   // 네이버 섹터/테마 흐름 분석
    | 'PL-NewsFlow'    // 네이버 증권 뉴스 (주요/해외)
    | 'PL-NaverSearch' // 키워드 기반 동적 뉴스 검색 
    | 'PL-FinanceInfo' // [Phase 2.9] 종목코드 기반 (coinfo) 재무/비즈니스 마크다운 추출
    | 'PL-InvestorFlow';// 장중 주체별 수급 동향 (외인/기관 현선물 및 프로그램)

// 모든 데이터 수집 및 1차 가공 파이프라인의 종착역 (표준 리턴 포맷)
export interface V2PipelineResult {
    pipeline_id: PipelineId;
    status: 'success' | 'failed';
    exec_time_ms: number;           // 실행 소요시간 (테스트/모니터링 용도)
    
    // [보조 검증용 Raw JSON] - 크롤러가 긁어온 1차 거친 데이터 원형
    raw_data: any;                  
    
    // [메인 열람용 Markdown] - LLM 프롬프트에 즉각 주입할 '수학 연산/텍스트 클러스터링' 완료본
    aggregated_markdown: string;   
    
    error_message?: string;
}

// 1차 가공기(Aggregator) 규격 강제
export interface IBaseAggregator {
    executeAggregation(rawData: any): Promise<string> | string; // 반드시 Markdown String 렌더링 강제
}
