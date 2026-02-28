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
- [ ] 알림 기능: 이벤트 버스를 구독(Listen)하여 매수/매도 신호나 체결 결과를 텔레그램 메시지로 자동 전송
- [ ] 커맨드 기능: 텔레그램에서 `/stock 삼성전자` 입력 시 백엔드에서 시세/차트 이미지를 생성해 텔레그램으로 반환

### Phase 5 - AI 연동 및 고도화
- [ ] `AiService` 구현: 최신 시세나 종목별 뉴스를 수집해 OpenAI API에 주입, 요약 리포트/매수·매도 의견 산출
- [ ] AI와 텔레그램 연동: 텔레그램에 기업명을 물어보면 AI가 최근 이슈와 차트 분석 결과를 종합 리포팅
- [ ] (장기) 데이터 양 증가 시 AI 기능을 Node.js에서 Python 기반 외부서버(FastAPI 등)로 분리

---

## 주의사항
- 모의투자는 국내 주식(KRX)만 지원
- 향후 스파게티 코드를 방지하기 위해 새로운 기능 추가 시 반드시 `Service` 클래스를 독립시키고 뷰/다른 모듈과는 Event나 IPC로만 소통할 것.
- AI 기능 연동 시 프롬프트 및 API 이용료를 관리할 최적화 방안 고려
