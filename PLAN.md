# Kiwoom Trader - 프로젝트 계획서

작성일: 2026-02-24

---

## 개요

키움증권 OpenAPI를 활용한 데스크톱 주식 트레이딩 앱.
Mock UI 먼저 완성 후 실제 API를 단계적으로 연결하는 방식으로 개발.

---

## 기술 스택

| 구분 | 기술 |
|------|------|
| 런타임 | Electron 28 |
| UI 프레임워크 | React 18 + TypeScript |
| 빌드 도구 | Vite 5 |
| 스타일 | Tailwind CSS 3 (darkMode: 'class') |
| 상태관리 | Zustand |
| API 키 저장 | electron-store |
| 차트 (예정) | lightweight-charts (TradingView) |
| HTTP | node fetch (Electron main process) |
| 실시간 시세 | WebSocket (Electron main process) |

---

## 아키텍처

```
Electron Main Process (Node.js)
  ├── OAuth 토큰 관리 (발급 / 갱신 / 폐기)
  ├── 키움 REST API 호출 (CORS 없음)
  ├── WebSocket 연결 (실시간 시세)
  └── IPC 핸들러 (renderer 요청 처리)

Electron Renderer (React)
  ├── UI 컴포넌트 (Tailwind)
  ├── Zustand 스토어 (앱 상태)
  └── window.electronAPI (IPC 호출)

보안
  └── API 키 → electron-store 로컬 암호화 저장
      브라우저에 appkey/secretkey 절대 노출 안 됨
```

### IPC 메시지 구조 (예정)

```
UIToMain:
  kiwoom:getHoldings     → 보유종목 조회
  kiwoom:getWatchlist    → 관심종목 조회
  kiwoom:getQuote        → 현재가 조회
  kiwoom:placeOrder      → 주문 실행
  kiwoom:subscribeQuote  → 실시간 시세 구독 시작
  settings:saveApiKey    → API 키 저장

MainToUI:
  kiwoom:quoteUpdate     → 실시간 시세 수신
  kiwoom:orderUpdate     → 체결 업데이트
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
| 응답 형식 | JSON |

---

## 프로젝트 구조

```
260224 kiwoom-trader/
├── electron/
│   ├── main.ts          # Electron 메인 프로세스, IPC 핸들러
│   └── preload.ts       # contextBridge로 안전한 API 노출
├── src/
│   ├── components/
│   │   ├── TitleBar.tsx     # 커스텀 타이틀바 (최소화/최대화/닫기/테마)
│   │   ├── Sidebar.tsx      # 사이드바 네비게이션
│   │   ├── Holdings.tsx     # 보유종목 화면
│   │   ├── Watchlist.tsx    # 관심종목 화면
│   │   └── Orders.tsx       # 주문/체결 내역 화면
│   ├── data/
│   │   └── mockData.ts      # Mock 데이터 (API 연결 전 사용)
│   ├── store/
│   │   └── useStore.ts      # Zustand 전역 상태
│   ├── types/
│   │   ├── stock.ts         # 종목/계좌/주문 타입 정의
│   │   └── electron.d.ts    # window.electronAPI 타입 선언
│   ├── utils/
│   │   └── format.ts        # 가격/금액/등락률 포맷 유틸
│   ├── App.tsx
│   ├── main.tsx
│   └── index.css            # CSS 변수 기반 다크/라이트 색상 시스템
├── .claude/
│   └── launch.json          # Claude preview 서버 설정
├── PLAN.md                  # 이 파일
├── package.json
├── vite.config.ts
├── tailwind.config.js
├── tsconfig.json
└── tsconfig.electron.json
```

---

## 개발 단계

### Phase 1 - UI Shell (진행 중)

- [x] Electron + Vite + React + TypeScript 프로젝트 셋업
- [x] Tailwind CSS 다크/라이트 모드 (CSS 변수 기반)
- [x] 커스텀 타이틀바 (창 컨트롤 + 테마 토글)
- [x] 사이드바 네비게이션 (보유종목 / 관심종목 / 주문내역)
- [x] 보유종목 화면 - Mock 데이터로 계좌 요약 + 종목 리스트
- [x] 관심종목 화면 - 현재가 / 등락률 / 거래량
- [ ] 주문/체결 화면 - 내역 목록 + 매수/매도 버튼 placeholder
- [ ] 종목 클릭 시 하단 상세 패널 (차트 영역 예약)
- [ ] 탭 전환 시 선택 종목 초기화 버그 수정

### Phase 2 - API 연결 (예정)

- [ ] 설정 화면 — appkey / secretkey 입력 및 electron-store 저장
- [ ] Electron main에서 OAuth 토큰 발급 및 자동 갱신
- [ ] 보유종목 실데이터 연결 (`GET /api/dostk/acnt` 계좌 잔고)
- [ ] 관심종목 현재가 연결 (`GET /api/dostk/mrkcond` 현재가)
- [ ] WebSocket 연결 — 보유종목 / 관심종목 실시간 시세
- [ ] 모의투자 환경(`mockapi.kiwoom.com`) 우선 테스트

### Phase 3 - 거래 기능 (예정)

- [ ] 종목 검색 (종목명 / 코드 검색)
- [ ] 매수 / 매도 주문 폼 (수량, 가격, 주문 유형)
- [ ] 주문 전 2단계 확인 다이얼로그 (실수 방지)
- [ ] 체결 실시간 업데이트 (WebSocket)
- [ ] 주문 취소 기능
- [ ] 모의투자 → 실전투자 환경 전환 스위치

### Phase 4 - 고도화 (선택)

- [ ] lightweight-charts 차트 패널 (일봉 / 분봉)
- [ ] 수익률 히스토리 / 포트폴리오 분석
- [ ] 관심종목 그룹 관리 (추가 / 삭제 / 그룹 분류)
- [ ] 자동 새로고침 주기 설정
- [ ] electron-builder로 Windows `.exe` / 포터블 빌드

---

## 실행 방법

```bash
# UI 미리보기 (브라우저, Electron 불필요)
npm run dev:web

# Electron 앱으로 실행 (개발)
npm run dev

# 타입 체크
npm run typecheck

# 배포용 빌드 (.exe 생성)
npm run build
```

---

## 주의사항

- 모의투자는 국내 주식(KRX)만 지원
- 토큰 만료 처리 필수 — 만료 시 자동 재발급 로직 구현 필요
- 매수/매도 주문은 취소 불가 케이스가 있으므로 UI 확인 단계 필수
- 실전투자 전 모의투자(`mockapi.kiwoom.com`)로 충분히 검증
- API 키는 절대 코드에 하드코딩 금지 — electron-store 사용

---

## 색상 규칙

한국 주식 관례 적용:

| 상태 | 색상 |
|------|------|
| 상승 / 수익 | 빨강 (`text-rise` / `#ef4444`) |
| 하락 / 손실 | 파랑 (`text-fall` / `#3b82f6`) |
| 보합 | 회색 (`text-flat` / `#6b7280`) |
