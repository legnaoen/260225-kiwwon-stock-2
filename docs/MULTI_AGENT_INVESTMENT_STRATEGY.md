# [Master Strategy] Multi-Agent Intelligence Investment System (MAIIS)

> [!IMPORTANT]
> 본 문서는 전체 시스템의 **지능형 확장(MAIIS) 프로젝트**를 위한 전략서이며, 전체 시스템 인덱스는 [[00_INVESTMENT_INDEX.md]]를 참조하세요.

본 문서는 단순한 자동매매 시스템을 넘어, 시장의 거시적 맥락(Context)을 이해하고 일관성 있는 투자 판단을 내리는 **멀티 에이전트 기반 지능형 확장 모듈**의 통합 전략입니다. 

이 문서는 시스템의 '헌법'과 같은 역할을 수행하며, 세부적인 기술 구현 스펙은 하단에 링크된 전문 서브 문서(Sub-Specs)를 참조합니다.

---

## 1. 핵심 투자 철학 및 가치 (Core Principles)

1.  **Context-Driven Decision (맥락 우선주의)**: 모든 종목 및 이벤트 분석은 시장 전체의 '판(Frame)' 위에서 이루어진다. 거시 지표와 시장 에너지를 먼저 읽고, 그 결과에 따라 개별 시그널의 가치를 다르게 평가한다.
2.  **Consistency of Opinion (사고의 지속성 - World State)**: AI가 매일 단편적인 판단을 내리는 것이 아니라, `Strategy_DB`에 저장된 'World State(세계관)'라는 연속된 기억을 기반으로 사고한다. 관점을 변경할 때는 반드시 논리적 근거가 수반되는 'Pivot' 과정을 거친다.
3.  **Active Risk Management (능동적 리스크 대응)**: 단순 가격 변동에 따른 익절/손절을 넘어, 발생한 이슈의 성격(BM 훼손 vs 일시적 소음)을 판독하여 급락 시 '공포 매도'를 피하고 '지능적 리밸런싱'을 수행한다.
4.  **Collective Intelligence (집단 지능 - Ensemble)**: 단일 AI 모델의 편향(Bias)을 제거하기 위해 서로 다른 성향(공격/방어/매크로)을 가진 다수 에이전트의 토론과 교차 검증을 거쳐 최종 합의안을 도출한다.

---

## 2. 4단계 계층화 아키텍처 (Layered Architecture)

시스템은 확장성과 모듈화의 독립성을 보장하기 위해 4개의 핵심 계층으로 분리됩니다.

### Layer 1: 통합 정보 수집 (Universal Ingestion Layer)
*   **역할**: 파편화된 외부 데이터 소스를 하나로 모으고, 중앙 관제탑인 `IngestionManager`를 통해 효율적으로 분배하는 '데이터 공급망'.
*   **주요 모듈**:
    - **Provider Registry**: 키움, DART, 네이버뉴스, 유튜브, 야후파이낸스 등 소스별 독립 어댑터.
    - **Priority Scheduler**: 데이터 성격(실시간/주기/이벤트)에 따른 호출 우선순위 및 Throttling 제어.
*   **상세 구현 명세**: [[SUB_INGESTION_LAYER_SPEC.md]]

### Layer 2: 알고리즘 분류 및 특성 추출 (Feature Extraction Layer)
*   **역할**: 원천 로우 데이터를 AI가 판단하기 좋은 형태의 '의미 있는 지표(Feature)'로 가공하고 통일된 용어로 정형화.
*   **주요 모듈**:
    - **Sentiment Engine**: 텍스트(뉴스/전문가 의견)의 긍부정 스코어링 및 핵심 키워드 인덱싱.
    - **API Normalizer**: 증권사 특유의 용어를 전역 표준 용어(Standard Schema)로 즉시 맵핑.
*   **상세 구현 명세**: [[SUB_FEATURE_LAYER_SPEC.md]] (준비 중)

### Layer 3: 에이전트 인지 및 판단 (Cognitive Layer)
*   **구조**: 하향식 의사결정 트리 (Top-Down Decision Tree).
    - **Upper (Insight)**: 시장 지표와 메인 이슈(내러티브)를 판독하여 시장 상황을 정의.
    - **Middle (Synthesis)**: **[대전략 수립]** 에이전트가 상위 정보를 통합하여 오늘의 투자 태세(Market Thesis) 결정.
    - **Lower (Tactics)**: 다수의 독립된 **[매매 에이전트]**(공격, 방어, 스윙 등)가 대전략 지침 하에 개별 집행.
*   **특징**: 확장 가능한 멀티 전략 구조. 필요에 따라 새로운 매매 전략 에이전트를 언제든 추가할 수 있는 플러그인 스타일 아키텍처.
*   **상세 명세**: [[SUB_COGNITIVE_LAYER_SPEC.md]]

### Layer 4: 실행 및 관제 (Execution Layer)
*   **역할**: 상위 레이어의 결정 시그널을 실제 시장에 관철시키고, 집행 상태를 L3에 피드백하는 '손과 발'.
*   **주요 모듈**: Execution Optimizer(분할매매), Kill-Switch(비상 정지), Balance Syncer.
*   **상세 구현 명세**: [[SUB_EXECUTION_LAYER_SPEC.md]] (준비 중)

---

## 3. 지능형 정보 파이프라인 및 모니터링 (Core Features)

### 3.1 YouTube 전문가 인사이트 수집 (Expert Intelligence)
기존의 파편화된 뉴스 중심에서 벗어나, 시장의 '인과관계'를 분석하는 전문가들의 시각을 시스템의 인지 데이터로 활용합니다.
*   **프로세스**: 영상 감지 → 스크립트 추출 → AI 통합 요약(테제, 종목, 리스크) → World State 주입.
*   **가중치 시스템**: 사용자 UI를 통해 각 채널별 신뢰 지수(Weight)를 부여하여 판단의 신빙성 조절.

### 3.2 데이터 파이프라인 관제 센터 (Monitoring & Health)
단일 정보 수집에서 벗어나 전체 시스템의 데이터 흐름이 정상인지 실시간으로 확인하는 관제 시스템입니다.
*   **API Connection Status**: 키움, LLM, DART 등 모든 외부 API의 온라인 여부 및 응답 지연 시간 모니터링.
*   **Data Freshness**: 분야별 최신 데이터 유입 시각과 성공률을 시각화하여 데이터의 '심장박동'을 감시.
*   **Error Alert**: Throttling 또는 통신 오류 발생 시 텔레그램 연동 및 UI 레드 라이트 경고.

---

## 4. 통합 제어 및 UI/UX 체계 (System Control)

사용자의 관리 편의를 위해 설정과 관제를 4대 범주로 단일화합니다.

1.  **정보 수집 설정 (Data Source API)**: 데이터 원천(키움/뉴스/유튜브 채널 관리) 연동 제어.
2.  **AI 지능 설정 (Intelligence API)**: 판단 모델(LLM), 에이전트 성향, 지식 보존 정책 설정.
3.  **알림 및 소통 설정 (Communication)**: 텔레그램 및 알림 트리거 필터링 관리.
4.  **시스템 관제 센터 (Pipeline Dashboard)**: 실시간 데이터 흐름 및 상태 모니터링 전용 탭.

---

## 5. 기존 기능 연계 및 리팩토링 전략 (Legacy Management)

*   **자동매매의 분리**: 기존의 거대한 자동매매 서비스를 '순수 주문 처리부(L4)'와 '투자 판단부(L3)'로 엄격히 분리하여 재구축.
*   **마켓 스캐너의 데이터화**: 화면에만 표시하던 스캔 결과를 `Market_Feature_DB`에 기록하여 에이전트의 판단 재료로 공급.

---

## 6. 논의 및 결정 사항 누적 로그 (Cumulative Decision Log)

*   **2026-03-13**: 
    - 멀티 에이전트 기반 MAIIS 프로젝트 발족 및 4단계 레이어 아키텍처 확정.
    - World State(지능 지속성) 및 Intelligence Loop(자가 추론) 개념 도입 합의.
    - 유튜브 전문가 인사이트 가중치 분석 파이프라인 설계 확정.
    - 통합 인입 레이어(IngestionManager) 및 관제 센터 도입 합의.
    - 설정 메뉴의 4개 논리적 카테고리 개편안 확정.
    - **상세 명세 관리를 위한 Main-Sub 문서 연계 체계(Obsidian Style Link) 전격 도입.**

---

## 🔗 관련 상세 명세 문서 리스트
*   **정보 수집 상세**: [[SUB_INGESTION_LAYER_SPEC.md]]
*   **특성 추출 상세**: [[SUB_FEATURE_LAYER_SPEC.md]] (Coming Soon)
*   **판단/추론 상세**: [[SUB_COGNITIVE_LAYER_SPEC.md]] (Coming Soon)
*   **실행/관제 상세**: [[SUB_EXECUTION_LAYER_SPEC.md]] (Coming Soon)
