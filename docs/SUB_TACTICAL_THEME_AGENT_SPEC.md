# [Sub-Spec] Tactical Trading: Theme Momentum & Swing Agent

> [!IMPORTANT]
> 본 문서는 **MAIIS 확장 프로젝트 - 인지 레이어(L3) 하위의 전술적 매매 에이전트(Tactical Agent)**에 대한 상세 명세입니다. 마스터 인덱스는 [[00_INVESTMENT_INDEX.md]]를 참조하세요.

본 문서는 기 구축된 `v2_pipeline`의 다양한 수집기(Collector)들을 조합하여, **테마주(주도주) 중심의 모멘텀 및 스윙 매매**를 수행하는 인공지능 에이전트의 데이터 파이프라인, 예측 논리, 그리고 검증 체계를 정의합니다.

---

## 1. 개요 (Overview)

`Theme Momentum & Swing Agent`는 L3(Cognitive Layer)의 하위 매매 에이전트(Trading Agent Suite) 중 하나로서, 시장의 유동성이 쏠리는 '테마'를 쫓아 단기/중기적 수익을 창출하는 것을 목표로 합니다.
기존 단순 가격 돌파 전략과 달리, MAIIS의 L1(Ingestion) 레이어에 기 구축된 텍스트 및 펀더멘털 파이프라인과 가격 수급을 입체적으로 결합합니다.

---

## 2. 데이터 파이프라인 통합 (L1 -> L2 -> L3)

이미 시스템에 구축된 `v2_pipeline/collectors/` 기반의 체인들을 활용하여 테마주 판단의 근거로 삼습니다.

### 2.1 기초 수집 체인 (Ingestion - v2_pipeline 활용)
*   **[테마/재료 탐지]**
    *   `NewsKeywordCollector` / `NaverFlowCollector` / `NewsFlowCollector`: 장전/장중 쏟아지는 뉴스의 핵심 키워드를 추출하여 어떤 테마가 시장의 이목을 끄는지(News Flow) 정량화.
    *   `ResearchCollector` / `YoutubeContextCollector`: 단순 일회성 찌라시인지, 구조적 성장이 동반되는 메가 트렌드(다일 간 스윙 가능)인지 전문가 문맥과 증권사 리포트를 통해 심층 판단.
*   **[수급/가격 탐지]**
    *   `RisingStockCollector`: 장초반 거래대금 급증, 변동성 완화장치(VI) 발동, 52주 신고가 등 가격 모멘텀 포착.
    *   `LocalFlowCollector`: 키움증권 데이터 기반 투자자별(외인/기관/프로그램) 당일 매수세 유입 강도 측정.
    *   `MacroCollector`: 거시 지표 모니터링을 통한 시장 펀더멘털 확인.

### 2.2 특성 추출 (Feature Extraction - L2)
*   **테마 강도 스코어 (Theme Intensity Score)**: `NewsKeyword` 발생 빈도 × `RisingStock`의 거래대금 합을 기준으로 특정 테마의 당일 시장 장악력을 0~100으로 수치화.
*   **재료 연속성 스코어 (Narrative Continuity)**: `YoutubeContextCollector`의 분석결과를 바탕으로 해당 테마의 수명(1-day Momentum vs 1-week Swing)을 분류.

---

## 3. 예측 및 매매 전략 (Prediction Model - L3)

상위 대전략 에이전트(Grand Strategy Master)의 가이드라인 하에 타점을 결정합니다. 기존 `MarketConditionAgent.ts`와 긴밀히 연동됩니다.

### 3.1 모멘텀 로직 (Intraday Momentum)
*   **트리거 조건**:
    1.  `NaverFlowCollector`에서 특정 키워드 그룹(예: "양자컴퓨터")의 언급량이 전일 대비 300% 이상 폭증.
    2.  `RisingStockCollector`에서 관련 종목군의 거래대금이 코스닥 전체 거래 대금의 5% 이상 흡수.
*   **진입 (Entry)**: 대장주 1차 VI 발동 전후, 또는 눌림목 발생 시 `MarketConditionAgent`가 '공격(Risk-On)' 상태일 때 시장가/지정가 진입.
*   **청산 (Exit)**: 당일 종가 이전 1차 수익 실현 (오버나잇 리스크 헷지) 및 후속 뉴스 플로우 약화 시 즉각 탈출.

### 3.2 스윙 로직 (Swing / Pullback)
*   **트리거 조건**:
    1.  `YoutubeContextCollector` 및 `ResearchCollector`가 해당 테마를 '지속 가능한 메가 트렌드(E.g. AI 전력 설비)'로 컨센서스 요약.
    2.  `MacroCollector`의 매크로 지표가 해당 테마에 우호적 환경(예: 금리 인하 기대감) 제공.
*   **진입 (Entry)**: 단기 급등 후 차익 실현으로 인해 최고가 대비 일정 비율 하락하며 거래량이 급감한 시점(T+2 ~ T+5 눌림목).
*   **청산 (Exit)**: 상단 저항선 돌파 시 분할 매도, 또는 `NewsFlowCollector`에서 재료 소멸/악재 감지 시 전량 손절.

---

## 4. 성과 측정 및 검증 (Measurement & Validation)

수립된 가설이 실전에서 통용되는지 기존 인프라를 통해 검증합니다.

1.  **시뮬레이션 검증 (PerformanceTracker.ts 연동)**: 기 구현된 `1-tick slippage model`과 `PerformanceTracker.ts`를 활용. 모멘텀 매매 진입 시 필연적으로 발생하는 슬리피지를 엄격하게 차감한 예상 순수익률(Net PnL) 도출.
2.  **보유 기간별 체력 측정**: T+1, T+3, T+5 등 진입 이후 보유 기간에 따른 평균 수익률 커브를 그려 대상 테마가 단타용인지 스윙용인지 AI가 사후 학습.
3.  **대장주 포착 패널티**: AI가 선택한 종목이 당일 해당 섹터 내 거래대금/상승률 1위(대장주)가 아니었을 경우, 가중치 학습에 패널티 부여.

---

*작성일: 2026-03-25*
*버전: 1.0 (v2_pipeline 통합 기준)*
