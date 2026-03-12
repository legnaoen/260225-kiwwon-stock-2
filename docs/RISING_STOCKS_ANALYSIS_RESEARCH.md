# 급등주 정밀 분석 서비스 개발을 위한 API 리서치 보고서

본 문서는 '급등주 정밀 분석 서비스' 구현에 필요한 국내외 API의 상세 사양, 연동 방식 및 데이터 활용 방안을 기술합니다.

---

## 1. Kiwoom REST API (기존 모듈 필수 활용)

기존 `KiwoomService.ts`에 이미 구현된 TR들을 조합하여 분석 엔진의 기초 데이터를 확보합니다.

### 1.1. 분석 대상 추출 (Rising Stocks)
*   **TR: ka10027 (전일대비 등락률 상위)**
    *   **용도:** 당일 가장 높은 상승률을 기록 중인 후보군 추출.
    *   **주요 파라미터:** `mrkt_tp: '000'` (전체), `sort_tp: '1'` (상승률순).
*   **TR: ka10030 (거래대금 상위)**
    *   **용도:** 거래대금이 집중된 '시장 주도주'를 포착하여 분석 리스트에 추가.
    *   **주요 파라미터:** `sort_tp: '3'` (거래대금순).

### 1.2. 기술적 지표 확보 (Technical Analysis)
*   **TR: ka10081 (주식 일봉 차트 조회)**
    *   **용도:** 최근 **80봉**의 일봉 데이터를 수집하여 차트 추세(정배열/역배열) 및 주요 매물대를 AI에게 전달.
    *   **주요 파라미터:** `stk_cd` (종목코드), `base_dt` (기준일자).
*   **TR: ka10001 (주식 기본 정보)**
    *   **용도:** 업종 분류명 및 발행 주식 총수 등 기본 정보 매핑.

---

## 2. 네이버 뉴스 검색 API (Naver News Search)

상승의 '재료'가 되는 실시간 뉴스 데이터를 확보하기 위해 연동합니다.

*   **Endpoint:** `https://openapi.naver.com/v1/search/news.json`
*   **Method:** GET
*   **Auth:** HTTP Header에 `X-Naver-Client-Id` 및 `X-Naver-Client-Secret` 주입.
*   **주요 파라미터:**
    *   `query`: 필수 (UTF-8 인코딩된 종목명).
    *   `display`: 표시 개수 (기본 10, 최대 100). 분석용으로는 20-30건 적정.
    *   `sort`: `sim` (정확도순) 또는 `date` (날짜순). 상승 사유 파악을 위해 `sim` 권장.
*   **데이터 활용:** 뉴스 제목(`title`)과 요약(`description`) 텍스트를 AI 분석 프롬프트에 주입.

---

## 3. OpenDART API (Disclosure Data)

뉴스보다 신뢰도가 높은 전자공시 데이터를 상승 근거로 활용합니다. (`DartApiService.ts` 확장 활용)

*   **Endpoint:** `https://opendart.fss.or.kr/api/list.json`
*   **Method:** GET
*   **Auth:** API Key (`crtfc_key`) 파라미터.
*   **주요 파라미터:**
    *   `corp_code`: 종목의 고유번호 (키움 종목코드와 매핑 필요).
    *   `bgn_de` / `end_de`: 검색 시작/종료일. 분석일 기준 당일~전일까지 설정.
    *   `pblntf_ty`: 공시 유형. 'A'(정기공시), 'B'(주요사항보고), 'I'(거래소공시) 등.
*   **데이터 활용:** `report_nm`(보고서명)과 `rcept_no`(접수번호)를 통해 주요 실적 발표, 수주 계약, 지분 변동 여부를 확인.

---

## 4. Google Gemini API (AI Analysis Engine)

수집된 모든 데이터를 통합하여 최종 분석 리포트를 생성하는 핵심 엔진입니다. (`AiService.ts` 활용)

*   **Endpoint:** `https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`
*   **Model:** `gemini-1.5-flash` 또는 `gemini-1.5-pro` (텍스트 처리량에 따라 선택).
*   **프롬프트 주입 데이터 구조 (Context Window):**
    ```json
    {
      "stock_info": { "name": "삼성전자", "change": "+5.2%" },
      "chart_data": "Last 80 days OHLCV summary...",
      "news_context": [ "Title 1...", "Title 2..." ],
      "disclosure_context": [ "Report Name 1...", "Link..." ],
      "past_history": "History of similar rises recorded in DB..."
    }
    ```
*   **자기 학습 루프:** 분석 3일/7일 뒤 주가 데이터를 다시 수집하여 AI에게 "반성문(오답노트)" 작성을 요청하고 이를 지식 베이스로 누적.

---

## 5. 결론 및 연동 가이드

1.  **키움 API**를 통해 리스트를 먼저 뽑고,
2.  **네이버 뉴스**와 **DART**를 통해 컨텍스트를 채운 뒤,
3.  **Gemini**가 이 모든 것을 읽고 인사이트 리포트를 작성하며,
4.  **로컬 DB(SQLite)**가 이 모든 기록을 저장하여 내일의 분석 재료로 사용합니다.

네이버 뉴스 API 키 발급이 선행되어야 하며, `electron-store`에 `naver_api_id`와 `naver_api_secret`을 저장하는 설정 기능 추가가 우선적으로 필요합니다.
