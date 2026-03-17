# [Sub-Spec] Universal Ingestion Layer & Pipeline Intelligence

> [!IMPORTANT]
> 본 문서는 **MAIIS 확장 프로젝트 - 정보 수집 레이어(L1)**의 상세 명세입니다. 마스터 인덱스는 [[00_INVESTMENT_INDEX.md]]를 참조하세요.

본 문서는 MAIIS(Multi-Agent Intelligence Investment System)의 최 하위 계층인 **제1계층: 통합 정보 수집 레이어(Universal Ingestion Layer)**에 대한 상세 구현 명세서입니다.

---

## 1. 개요 (Overview)
정보 수집 레이어의 목적은 파편화된 외부 데이터 소스를 단일화된 인터페이스로 통합하고, 상위 레이어(판단 및 실행)가 안정적으로 정제된 데이터를 소모할 수 있도록 '데이터 공급망'을 구축하는 것입니다.

## 2. 현재 정보 수집 현황 (Inventory)

MAIIS 시스템에서 현재 실제로 가동 중인 외부 데이터 소스와 수집 항목은 다음과 같습니다.

| 분류 | 제공처 (Provider) | 수집 항목 (Data Points) | 수집 방식 (Interface) | 주요 용도 |
| :--- | :--- | :--- | :--- | :--- |
| **국내 시장** | **키움증권** | 실시간 주가, 거래량, 체결 데이터, 전일대비 등락, 조건검색 결과, 계좌 잔고 및 주문 상태 | REST API (ka10023, ka10030 등) / WebSocket | 주도주 포착, 매매 집행, 실시간 계좌 연동 |
| **기업 공시** | **OpenDART** | 상장사 정기공시(사업보고서 등), 주요사항보고서, 10개년 재무제표, 법인 코드 데이터 | OpenDART API (JSON/XML) | 종목별 상세 재무 분석, 상장폐지/유상증자 등 리스크 필터링 |
| **뉴스 정보** | **Naver Open API** | 종목별 최신 뉴스 헤드라인, 기사 요약, 네이버 뉴스 링크 | Naver Search API (REST) | AI 감성 분석(Sentiment), 시장 이슈 키워드 추출 |
| **거시 지표** | **Yahoo Finance** | KOSPI/KOSDAQ 지수, 미국 지수(S&P 500), 환율(USD/KRW), 국채 금리, 글로벌 섹터 ETF 시세(SOXX, XLK 등) | Yahoo v8 Chart API (REST) | 거시 경제 국면 판단, 글로벌 섹터 동조화 분석 |
| **업종/섹터** | **키움증권** | 국내 업종별 지수(반도체, 제약 등), 업종별 거래대금 비중, 투자자별 업종 매매동향 | 키움 API | 주도 섹터 및 수급 쏠림 현상 포착 |
| **유튜브 인사이트** | **YouTube (계획)** | 전문가 채널 영상 스크립트(Transcript), 채널별 가중치 데이터 | YouTube API / AI 요약 (구현 예정) | **[계획]** 전문가 시황 요약 및 World State 외부 관점 주입 |
| **알림 서비스** | **Telegram** | 사용자 봇 메시지, 분석 리포트 PDF/Text 전송, 사용자 상호작용 | Telegram Bot API | 실시간 알림 전파, 원격 관제 및 리포트 수신 |
| **AI 지능** | **Gemini / OpenAI** | 비정형 데이터 분석 결과, 시황 요약 리포트, 감성 분석 점수, 종목별 투자 의견 | Generative AI API | 정성 정보의 수치화, 멀티 에이전트 판단 로직 지원 |

---

## 3. IngestionManager (중앙 관제탑) 상세

모든 데이터 수집의 라이프사이클을 관리하는 핵심 클래스입니다.

### 2.1 Provider Registry (공급자 등록체계)
다양한 외부 소스를 `DataProvider` 인터페이스로 추상화하여 관리합니다.
*   **지원 어댑터 리스트**:
    - `KiwoomAdapter`: 실시간 시세, 잔고, 체결 데이터.
    - `DartAdapter`: 상장사 공시 데이터 (DART API).
    - `NewsAdapter`: 네이버/X 등 실시간 키워드 뉴스.
    - `YouTubeAdapter`: 전문가 채널 스크립트 수집 (YouTube Data API).
    - `MacroAdapter`: 매크로 지표 (Yahoo Finance, FRED).

### 2.2 지능형 스케줄링 (Priority Scheduler)
API별 Throttling(속도 제한)을 전역적으로 관리하며, 데이터 신선도에 따른 수집 주기를 결정합니다.
*   **P0 (Real-time)**: 0.1~1s 주기. (키움 시세)
*   **P1 (Event-driven)**: 즉시 수행. (공시 포착 시 관련 뉴스 즉시 검색)
*   **P2 (Interval)**: 5~10분 주기. (뉴스, 매크로)
*   **P3 (Deep)**: 장 종료 후 또는 일간 1~2회. (유튜브 스크립트 분석)

---

## 3. YouTube 전문가 인사이트 파이프라인 (Expert Intelligence)

전문가의 정성적 분석을 정량적 데이터로 변환하는 특수 파이프라인입니다.

### 3.1 수집 및 분석 흐름
1.  **감지**: 등록된 채널의 신규 영상 업로드 확인.
2.  **Transcript**: YouTube API를 통해 자막 텍스트(OCR 또는 자막) 추출.
3.  **Synthesis**: Gemini 모델을 사용하여 다음 항목으로 요약:
    - **핵심 투자 테제**: 전문가가 주장하는 시장의 메인 논리.
    - **섹터별 바이어스**: 긍정(Bullish)/부정(Bearish) 섹터 구분 및 판단 근거.
    - **언급 종목 리스트**: 구체적으로 언급된 종목과 논리적 수혜 관계.
    - **내러티브 연속성 (Continuity)**: 최근 7일간의 시장 컨텍스트(World State)와 대조한 시장의 연속성 분석.
    - **피보팅 (Pivot)**: 전문가들의 기조 변화 및 새로운 주도 내러티브의 등장 여부 감지.

### 3.2 내러티브 트렌드 및 생애주기 관리
*   **Trend Tracking**: 주요 섹터 및 키워드의 영향력 지수(0~1) 산출.
*   **Lifecycle Status**: 각 내러티브를 EMERGING(태동), DOMINANT(지배), FADING(소멸)로 분류하여 L3 에이전트의 판단 근거로 활용.
*   **Data Persistence**: `youtube_daily_consensus` 및 `youtube_narrative_trends` 테이블을 통해 장기 흐름을 정형 데이터로 관리.

### 3.3 전문가 신뢰도 가중치 (Expert Weighting)
*   사용자 UI를 통해 각 채널별로 **신뢰 점수(0.1 ~ 1.0)**를 부여합니다.
*   에이전트 판단 시 `신뢰 점수 * 의견 강도`를 계산하여 최종 시황 리포트에 반영 비중을 조절합니다. (현재 모든 채널 가중치 1.0 기본 적용 중)

---

## 4. Market News & Narrative Briefing (L1)

네이버 뉴스를 활용하여 시장의 전반적인 분위기와 심리를 브리핑하는 파이프라인입니다.

### 4.1 수집 및 분석 흐름
1.  **키워드 관리**: `market_briefing_settings`에 등록된 핵심 키워드군(시황, 금리 등)을 기반으로 검색.
2.  **24시간 윈도우**: `pubDate`를 기준으로 현재 시각부터 24시간 이내의 뉴스만 정교하게 필터링.
3.  **내러티브 연속성**: 오늘의 뉴스를 분석할 때 전일의 `market_news_consensus`를 AI의 '기억(Memory)'으로 주입.
4.  **피보팅(Pivot) 추출**: "어제의 우려가 오늘 해소되었는가?" 또는 "새로운 내러티브가 어제의 시장 논리를 대체하고 있는가?"를 중점적으로 추출.

### 4.2 데이터 구조 및 저장 (Schema)
*   **Table**: `market_news_consensus`
*   **Fields**:
    *   `summary`: 시장 흐름 관통 3줄 요약.
    *   `sentiment`: 시장 탐욕/공포 지수 (-1.0 ~ 1.0).
    *   `pivot`: 어제 대비 시장의 논리적 변화 지점.
    *   `themes`: 현재 시장을 주도하는 Top 3 테마 및 사유.

---

## 4. 데이터 파이프라인 관제 대시보드 (Control Center)

수집된 모든 데이터의 유통 과정을 실시간으로 모니터링합니다.

### 4.1 연결 및 상태 모니터링 (Health Check)
*   **API 상태**: 키움(로그인/토큰), LLM(지연시간), DART 등의 가동 여부를 실시간 시각화.
*   **Freshness Check**: 각 카테고리별 마지막 수집 시각을 표시하고, 수집 중단 시 UI에 Red Light 표시.
*   **Error Logger**: Throttling 발생 시 큐 대기 시간 증가 현황 등을 관리자에게 알림.

### 4.2 시스템 제어 UI
*   **유튜브 채널 관리**: 채널 ID 등록, 삭제, 가중치 슬라이더 제공.
*   **API 갱신**: 강제 토큰 갱신 및 수동 데이터 Fetch 버튼.

---

## 5. 데이터 표준화 및 정규화 (Normalization)

키움 API 등 증권사 특유의 용어를 시스템 내부 표준 용어로 변환하는 규칙입니다.
*   **맵핑 예시**:
    - `stck_prc` / `pdno` → `current_price` / `stock_code`
    - `prdy_vrss_sign` → `price_change_sign`
*   **Common Engine**: 모든 데이터 요청 시 재시도(Retry), 에러 로깅, 전역 Throttling을 자동으로 적용하여 상위 어댑터의 비즈니스 로직을 보호합니다.

---

## 6. 데이터 정합성 (Persistence Strategy)

*   **Raw_Data_DB**: 분석 전 원천 정보를 보존하여 추후 AI의 재학습이나 오판단 복기에 활용.
*   **Integrated Snapshot (Golden Record)**: [가격 + 뉴스 점수 + 공시 상태 + 전문가 의견]을 단일 시점(Timestamp)으로 묶어 저장하여 레이어 2(알고리즘 분류)에 전달.

---

## 관련 문서
*   상위 전략 문서: [[MULTI_AGENT_INVESTMENT_STRATEGY.md]]
*   판단 레이어 상세: [[SUB_COGNITIVE_LAYER_SPEC.md]] (준비 중)
