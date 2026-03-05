# Kiwoom Trader - 프로젝트 계획서

작성일: 2026-02-24 (업데이트: 2026-03-01)

---

## 개요

키움증권 OpenAPI를 활용한 데스크톱 주식 트레이딩 앱 및 봇 시스템.
기본적인 수동 매매 및 포트폴리오 관리를 넘어, **자동매매 (알고리즘 트레이딩), 텔레그램 연동, AI 분석 리포팅** 기능으로 확장 가능한 차세대 스마트 트레이딩 플랫폼 설계.

---

## 기술 스택

| 구분 | 기술 |
|------|------|
| 런타임 | Electron 28 |
| UI 프레임워크 | React 18 + TypeScript |
| 빌드 도구 | Vite 5 |
| 스타일 | Tailwind CSS 3 (darkMode: 'class') |
| 상태관리 | Zustand |
| 로컬 DB (예정) | SQLite (`better-sqlite3`) - 매매기록, 시세 히스토리용 |
| 스케줄러 (예정) | `node-cron` - 자동매매/조건검색 스케줄링 |
| AI/LLM 연동 (예정) | OpenAI API (Node.js) 또는 별도 Python 백엔드 분리 |
| 메신저 연동 (예정) | 텔레그램 봇 API (`telegraf`) |
| API 키 저장 | electron-store |
| HTTP | node fetch / axios (Electron main process) |
| 실시간 시세 | WebSocket (Electron main process) |

---

## 확장형 아키텍처 (Service & Event-Driven 구조)

거대한 기능(자동매매, 텔레그램, AI) 추가를 대비하여, `main.ts`에 집중된 로직을 **독립된 서비스 클래스와 이벤트 버스(Event Bus)** 기반으로 분리하여 각 기능 간 결합도를 낮추고 확장을 용이하게 합니다.

```text
Electron Main Process (Node.js 백엔드)
  ├── EventBus (EventEmitter)
  │     # 모든 모듈은 EventBus를 통해 통신 ('PRICE_UPDATE', 'TRADE_EXECUTED' 등)
  │
  ├── Services (독립된 모듈화)
  │     ├── KiwoomService: 키움 REST API 연동, 주문, WebSocket 시세 수집 
  │     ├── TelegramService: 텔레그램 봇 연동 (명령어 수신/메시지 발송)
  │     ├── AutoTradeService: 조건검색식 스케줄링 및 주문 조건 판단
  │     └── AiService: 확보된 DB 및 시세를 기반으로 분석/매매 의견(리포트) 생성
  │
  ├── Database (SQLite)
  │     └── 시세, 매매 기록, 텔레그램 로그 저장
  │
  └── IPC 핸들러 (UI Renderer와의 통신)
        └── UI에서 요청 처리, 상태 브로드캐스트

Electron Renderer (React 프론트엔드)
  ├── UI Dashboard (포트폴리오, 차트)
  └── Automation Settings (자동매매 규칙 설정 등)
```

---

## 키움 OpenAPI 정보

| 항목 | 내용 |
|------|------|
| 인증 | OAuth 2.0 (client_credentials) |
| 실전 도메인 | `https://api.kiwoom.com` |
| 모의투자 도메인 | `https://mockapi.kiwoom.com` |
| 프로토콜 | REST (조회/주문) + WebSocket (실시간 시세) |
| 토큰 엔드포인트 | `POST /oauth2/token` |

---

## 개발 단계 로드맵

### Phase 1 - UI Shell (기반 작업 완료)
- [x] Electron + React 프로젝트 셋업 및 기본 테마/화면 구성 (보유종목, 관심종목)
- [x] 키움 API 토큰 갱신 로직 및 기본 요청 핸들러 구축

### Phase 2 - 서비스 계층 분리 및 이벤트 버스 도입 (우선 과제)
- [ ] `main.ts` 핵심 로직을 `services/KiwoomService.ts` 등으로 모듈화
- [ ] `EventEmitter`를 활용한 앱 내 전역 Event Bus 구현 (Pub-Sub 구조)
- [ ] 로컬 SQLite DB 도입 및 기본 스키마(매매기록 저장 등) 세팅

### Phase 3 - 자동매매 (Auto-trading)
- [ ] 조건검색식 스케줄러 도입 (`node-cron`)
- [ ] `AutoTradeService` 구현: 특정 조건 (가격, 등락률 등) 도달 시 이벤트 버스에 알림 -> `KiwoomService`가 주문 실행
- [ ] React UI에 자동매매 규칙 설정 화면 추가

### Phase 4 - 텔레그램 봇 연동
- [ ] `TelegramService` 구현: `telegraf` 라이브러리 연동
- [ ] 관심종목 이격침체 알림: 이격침체 발생 시 종목별 일 1회 제한으로 알림 발송 (중복 발송 방지)
- [ ] 자동매매 스케줄 알림: 오전 08:50, 오후 03:10에 자동매매 실행 여부 상태 알림 발송 (`node-cron` 활용)
- [ ] 자동매매 주문 결과 알림: 매수 주문 실행 시 성공/실패 여부, 성공 종목 수, 총 매수 대금 알림 발송 및 주문 실패 시 즉각적인 에러 알림 발송
- [ ] 커맨드 기능: 텔레그램에서 종목명 입력 시 백엔드에서 일봉 차트 이미지를 캡처/생성해 텔레그램으로 반환

### Phase 5 - AI 연동 및 고도화 (Value Quant 엔진)
- [ ] `AiService` 구현: 최신 시세나 종목별 뉴스를 수집해 OpenAI API에 주입, 요약 리포트/매수·매도 의견 산출
- [ ] **데이터 확장 (Value Quant):** ECOS, FRED, KRX, 공공데이터포털 API 연동 (매크로/산업/밸류에이션 밴드 데이터 수집)
- [ ] **뉴스 분석:** 네이버 뉴스 검색 API를 통한 실시간 이슈 수집 및 AI 감성 분석 (Sentiment Analysis)
- [ ] AI와 텔레그램 연동: 텔레그램에 기업명을 물어보면 AI가 최근 이슈와 차트 분석 결과를 종합 리포팅
- [ ] (장기) 데이터 양 증가 시 AI 기능을 Node.js에서 Python 기반 외부서버(FastAPI 등)로 분리

---

---

## 📍 현재 진행 상황 및 미해결 과제 (2026-03-02)

### 1. 종목 분석 리포트 고도화 (진행중)
- **추진 내용**: 텔레그램 '종목명 분석' 시 퀀트 트레이더 페르소나 기반의 분석 리포트 생성 (3~5단계 집중).
- **구축 완료**: `PriceStore` 싱글톤을 통한 시세 캐싱, DART API 호출 쿨다운 로직.

### 2. [중요] 미해결 이슈: 밸류에이션 데이터 수집 실패
- **현상**: 분석 리포트 생성 시 현재가 및 내재가치가 `0` 또는 `NaN`으로 표시되는 버그 지속.
- **관찰된 내용**: 화면(UI)에서는 시세가 정상이나, `CompanyAnalysisService` 내부에서 시세를 0으로 인지함.
- **추정 원인**: 'A' 접두사 유무에 따른 캐시 키 불일치, 인스턴스 고립, API 파싱 비일관성 (일부 대응 완료).
- **다음 단계 도출**:
    - `sys_track` 디버그 태그를 통한 실시간 데이터 흐름 모니터링.
    - `PriceStore`의 전역성(Global) 보장 및 인스턴스 일원화 재검토.

### 3. 향후 확장 계획 (Value Quant & News, NXT)
- **외부 API 통합 (진행중)**: `docs/API_INTEGRATION_GUIDE.md`를 기반으로 매크로 및 외부 데이터 연동 진행.
    - **야후 파이낸스(`yahoo-finance2`) 도입**:
        - **원칙**: 기존 API(키움/DART)와 데이터 충돌(중복)을 방지하기 위해 역할을 명확히 격리함.
        - **사용처**: 오직 "과거 10년 장기 주가 히스토리(월봉)" 및 "글로벌 매크로 지표(S&P500, 환율 등)" 조회용으로만 한정. 실시간 시세 및 재무(Fundamental) 데이터는 절대 사용하지 않음.
        - **진행 단계**: 데이터 수집 및 로컬 DB(SQLite) 캐싱 로직 우선 개발 (UI 연동은 데이터 확보 후 진행).
- **AI 분석 레이어**: 수집된 4단계 데이터(Macro -> Industry -> Fundamental -> Valuation/News)를 AI 프롬프트에 동적으로 주입하는 구조 설계.
### 4. 종목 태그(Tag) 기능 (진행 예정)
- **추진 내용**: 종목정보 페이지의 노트 작성란이나 종목별 관리 영역에 다중 '태그(Tag)' 지정 기능 구현.
- **주요 요구사항**: 
    - 태그의 귀속 대상은 **'종목'** 자체 (노트 건별이 아님).
    - 종목에 지정된 태그는 해당 종목이 관심종목/보유종목에서 삭제되더라도 계속 유지(Persistent)되어야 함.
    - 관심종목 페이지 상단의 검색창 위치를 우측으로 이동시키고, 좌측에 **다중 태그 필터**를 추가.
    - 복수 태그 선택 시 필터 로직은 **'OR 조건(![A or B])'**으로 동작해야 함.
- **보류 사항**: 키움 API 및 DART에서 기업 테마/업종 정보를 자동으로 받아와 태그로 자동 지정하는 기능은 현재 시점에서는 **보류(나중에 개발)** 하기로 함.

---

## 📍 AI 트레이드 시스템 구축 현황 (2026-03-05)

> 💡 상세한 로드맵 및 고도화 계획은 [AI_AUTO_TRADE_PLAN.md](docs/AI_AUTO_TRADE_PLAN.md) 문서를 참조하십시오.

### 퀵 서머리
- **완료**: 슬리피지 시뮬레이션(0.4%), AI 의사결정 로깅 인프라, 5지표 채점 가중치, 일일 자가 복기 엔진.
- **진행 중**: 데이터 로깅 보강 및 로컬 백테스팅(Replay) 시스템 설계.
- **주요 과제**: DB 스키마 마이그레이션(ai_score), 전략 버전 번호 체계 정교화.

