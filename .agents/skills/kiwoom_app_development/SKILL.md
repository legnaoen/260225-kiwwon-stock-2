---
name: Kiwoom App Development Architecture & Guidelines
description: Instructions and guidelines for cleanly scaling the Kiwoom REST API application with Auto-trading, Telegram, and AI features based on an Event-Driven architecture.
---

# Kiwoom App Development Architecture & Guidelines

이 스킬 문서는 키움 API 기반 앱을 안정적으로 확장(자동매매, 텔레그램, AI 도입)하기 위해 AI 에이전트와 개발자가 지켜야 할 아키텍처 원칙과 개발 가이드라인을 정의합니다. 앞서 제안된 이벤트 기반(Event-Driven) 및 모듈 분리(Service) 구조를 성공적으로 적용하기 위한 지시사항입니다.

## 1. 지향하는 아키텍처 (Service & Event-Driven)
초기 형태에서는 `electron/main.ts`에 모든 로직이 집중되어 있었습니다. 이 상태에서 로직을 계속 추가하면 결합도가 높아져 유지보수가 불가능해집니다. 향후 개발 시에는 다음과 같은 원칙을 준수해야 합니다.

* **모듈 분리(Services)**: 각 비즈니스 로직은 `electron/services/` 디렉터리에 독립된 클래스/모듈로 작성합니다.
  * `KiwoomService`: 키움 API REST 호출, WebSocket 기반 실시간 시세 수집 담당
  * `AutoTradeService`: 매수/매도 타이밍 타당성 검토 및 스케줄링(주문 시그널 발송) 담당
  * `TelegramService`: 텔레그램 알림 발송 및 봇 상호작용
  * `AiService`: 외부 LLM 연동, 데이터 및 뉴스 취합을 통한 종목 리포트 생성
* **이벤트 버스(Event Bus) 통신**: 서비스 간 직접적인 호출(예: `KiwoomService` 안에서 `TelegramService.sendMessage()`를 직접 호출하는 행위)을 엄격히 금지합니다.
  * Node.js 내장 `EventEmitter` 를 기반으로 한 전용 EventBus 객체를 통해 소통합니다.
  * 예: 키움 서비스가 "체결됨(TRADE_EXECUTED)" 이벤트를 emit하면, 텔레그램 서비스가 구동 중일 때만 그 이벤트를 받아(listen) 메시지를 발송하게 만듭니다.
* **로컬 데이터베이스**: 검색 이력, 과거 차트 분석 이력, 트레이딩 로그 관리를 위해 로컬 SQLite (`better-sqlite3` 추천)를 적극 활용합니다.

## 2. 기능 확장 시 코딩 가이드라인

### 2.1 새로운 서비스(Feature)를 추가할 때
1. **역할 정의**: 해당 서비스가 정확히 '무엇'을 담당하는지 단일 책임 원칙에 따라 명확히 한정짓습니다.
2. **독립성 유지**: 다른 모듈의 내부 상태(private state)를 직접 읽거나 변경해서는 안 됩니다.
3. **Event 입출력 명세화**: 이 서비스가 발생시킬 수 있는 이벤트(`Emit`), 그리고 응답해야 하는 이벤트(`On`)의 목록을 코드 상단에 주석이나 인터페이스로 명시합니다.

### 2.2 텔레그램 연동 개발 가이드
* `telegraf` 등 라이브러리 사용 시, 봇 토큰은 절대 소스코드 내에 하드코딩하지 말고 `electron-store` 혹은 환경 변수 설정 화면을 통해 입력/관리 받도록 설계하세요.
* 텔레그램 연동(네트워크 통신) 로직이 실패하더라도 주 트레이딩 프로세스가 중단되지 않도록 예외(Exception) 처리를 엄격히 하세요.

### 2.3 AI 분석 기능 연동 가이드
* 시스템 프롬프트(지시문)와 주입되는 데이터(시세, 이슈 텍스트)를 분명히 분리하여 유지보수성을 높입니다.
* OpenAI, Claude 등 외부 공급자의 API 스펙이 변경될 가능성을 염두에 두고, `AiService` 내에 공통된 인터페이스 계층(Wrapper)을 만드세요.
* LLM API 비용을 최소화하기 위해 동일한 정보에 대한 분석 요청은 SQLite 혹은 로컬 캐싱 처리합니다.

## 3. UI/UX 업데이트 원칙
백엔드(Electron Main)가 분리되더라도 프론트엔드(React + Zustand)는 독립적인 구조를 유지해야 합니다.
* **단방향 통신 집중**: 프론트엔드에서 일어나는 모든 명령은 `window.electronAPI` 인터페이스 핸들러를 통해서만 백엔드에 전달합니다. UI에서 백엔드의 모듈을 직접 참조할 수 없습니다.
* **설정 UI 분리**: 기능이 거대해짐에 따라 AI나 자동매매 세팅 기능은 기존 화면에 욱여넣지 않고 새로운 탭(Tab)이나 설정(Settings) 다이얼로그로 독립시켜 여백과 사용성을 유지하세요.

## 4. 키움 REST API 연동 시 필수 고려사항 (제약 및 특징)

> [!IMPORTANT]
> 키움 REST API의 구현 상세 규격(Body 파라미터, 필드명, TR 코드 등)은 프로젝트 루트의 [KIWOOM_API_REFERENCE.md](../../../docs/KIWOOM_API_REFERENCE.md) 문서를 최우선으로 조회하고 참조해야 합니다.

자동매매 및 각종 부가기능 연동 시 키움증권 OpenAPI의 특징을 반드시 고려해야 합니다.

* **API 호출 제한 (Rate Limit & Throttling)**: REST API 호출에 엄격한 속도 제한(TPS)이 적용됩니다. `KiwoomService`에는 반드시 API 요청 큐 및 스로틀링 메커니즘을 적용하여 일정한 딜레이를 강제해야 합니다.
* **토큰 만료 완벽 처리 (8005 Error)**: Oauth 2.0 기반이므로 토큰 만료 시(`return_code: 3` & `8005`) 스스로 토큰을 재발행하고 실패했던 요청을 재시도하는 로직이 필수입니다.
* **WebSocket 구독 임계치 제한**: 실시간 시세 수신 시 한 번에 등록 가능한 종목 개수에 제한이 있으므로, 필요한 종목만 동적으로 구독/해제 관리해야 합니다.
* **정규장 시간 제어 (Time 필터)**: 국내 주식 정규 시간(09:00 ~ 15:30) 외에는 불필요한 API 호출을 방지하기 위해 타임필터를 적용합니다. 단, 데이터 조회의 경우 키움이 장외에도 직전 데이터를 반환하므로 유연하게 적용합니다.
* **동시 다발적 대량주문 제어**: 대량 주문 시 API 호출 한도 및 증거금 부족 오류 방지를 위해 주문 개수 통제 로직이 필요합니다.

## 5. AI 에이전트 필수 행동 수칙 (개발 프로세스)
이 프로젝트에서 새로운 기능을 개발하거나 코드를 수정하는 모든 AI 에이전트(혹은 협력 개발자)는 코딩을 시작하기 전 **반드시 아래의 절차를 준수**해야 합니다.

1. **계획 문서 확인**:
   * 개발 전 무조건 프로젝트 루트의 `PLAN.md`를 읽고 현재 진행 중인 단계(Phase)와 기존 아키텍처 제약사항을 확인합니다.
2. **사전 리서치 및 API 규격 확인**:
   * 기능 구현에 API 스펙이 필요한 경우, 섣불리 코드를 작성하지 않습니다.
   * 먼저 프로젝트의 [KIWOOM_API_REFERENCE.md](../../../docs/KIWOOM_API_REFERENCE.md)를 확인하여 이미 구현된 패턴이 있는지 확인합니다.
   * 새로운 API를 사용하는 경우 `키움 REST API 문서.pdf` 또는 `키움 REST API 문서.xlsx` 등 문서를 검색하여 **엔드포인트(URL), 요청 헤더/바디, 정확한 응답 구조(Response JSON)**를 파악합니다.
3. **설계 공유 및 승인**:
   * 리서치 결과를 바탕으로 어떻게 코드를 모듈화(`electron/services/XxxService.ts`)할 것인지, 어떤 이벤트 버스 채널을 사용할 것인지 설계안을 먼저 작성합니다.
   * 사용자(User)에게 설계안을 제시하고 **승인(Confirm)을 받은 후**에만 실제 파일 쓰기(Coding)에 돌입합니다.
6. **점진적 구현 및 검증**:
   * 코드를 한 번에 수백 줄 작성하지 않고, 모듈별 단위로 구현한 후 서버 실행 또는 테스트를 통해 정상 작동(특히 API 인증, 호출 제한 등)을 확인하며 다음 단계로 넘어갑니다.

## 6. 배포(Build) 및 .exe 파일 생성 시 주의사항 (Troubleshooting)
Electron 애플리케이션을 배포용 설치 파일(`.exe`)로 빌드할 때(`npm run build`) 빈번하게 발생하는 에러와 해결책(Best Practice)입니다.

* **winCodeSign 심볼릭 링크(Symbolic link) 생성 권한 오류**:
  * `electron-builder`가 윈도우용 서명 툴을 다운로드/압축 해제할 때 권한 문제가 발생할 수 있습니다.
  * **해결책**: 터미널(VS Code, cmd, PowerShell)을 반드시 **'관리자 권한'으로 실행**한 뒤 `npm run build`를 수행하거나, 윈도우 설정에서 '개발자 모드(Developer Mode)'를 켜야 합니다.
* **설치 후 실행 시 하얀 화면(White Screen)이 나오는 문제**:
  * 빌드 도구가 Vite의 라우팅 경로나 로컬 파일 경로를 찾지 못할 때 발생합니다.
  * **해결책 1**: 프로젝트 폴더의 `vite.config.ts` 파일 내 `defineConfig`에 `base: './'` 옵션이 반드시 포함되어야 합니다.
  * **해결책 2**: 배포 시 불필요한 파일이 없도록 `.gitignore`에 `dist` 폴더가 등록되어 있을 텐데, `package.json`의 `build.files` 배열에 `"dist/**/*"`, `"dist-electron/**/*"` 폴더를 명시적으로 반드시 포함시켜야 빌드 결과물에 화면 구성 파일이 누락되지 않습니다.
* **백그라운드 창(offscreen) 로드 타임아웃 오류**:
  * 텔레그램 차트 캡처 등을 위해 사용하는 보이지 않는 `BrowserWindow`가 배포 환경에서 작동하지 않는 경우가 있습니다.
  * **해결책**: `loadURL`과 `loadFile`의 분기 처리를 명확히 해야 합니다. 배포 환경(`!process.env.VITE_DEV_SERVER_URL`)에서는 URL 문자열을 직접 조합하지 말고, `win.loadFile(targetPath, { hash: urlHash })` 형식으로 Electron 기본 API를 안전하게 사용해야 리소스를 정상적으로 로드할 수 있습니다.

---

## 7. 개발 지식 체계 (Development Framework)

이 섹션은 프로젝트의 기능을 개발할 때 AI 에이전트가 활용해야 할 '개발 전용' 지식 체계를 정의합니다.

### 7.1. 특화된 AI 에이전트 역할 (Agents)
개발 중 특정 작업이 필요할 때 해당 페르소나를 소환하여 작업을 수행합니다.
- **[The Architect]**: 신규 기능 설계 시 `PLAN.md`를 업데이트하고 모듈 구조를 제안합니다.
- **[UI Auditor]**: Glassmorphism 가이드라인 준수 여부를 검토하고 컴포넌트를 마이그레이션합니다.
- **[Bug Hunter]**: 로그 분석 및 런타임 에러 수정을 전문적으로 수행합니다.

### 7.2. 반복 숙달 능력 (Skills)
- **[Skill] IPC-Bridge-Builder**: `main`↔`renderer` 간 통신 채널 구축 시 `preload.ts` 및 `types` 자동 업데이트.
- **[Skill] Kiwoom-Error-Handler**: 키움 API 전용 에러 코드 대응 로직 자동 주입.

### 7.3. 개발 전용 도구 (Plugins)
- **`develop/scripts/`**: 독립적 실행이 가능한 테스트 스크립트 모음 (예: `fetch_test.js`).
- **Mock Data Provider**: 장외 시간 개발을 위한 가짜 시세 데이터 주입 로직.

---

## 8. 구현 교훈 — 급등주 분석 기능 (2026-03-10)

반복적으로 발생했던 오류 유형과 해결 패턴을 기록합니다. 동일한 실수를 반복하지 않도록 합니다.

### 7.1. 키움 API 데이터 조회 vs 주문 실행 단계 구분

**잘못된 패턴:** 급등주 조회(`ka10027`, `ka10030`)를 호출하는 서비스에 `isMarketOpen()` 체크를 적용하여 장외 시간에 빈 배열을 반환함.

**올바른 패턴:**
- **데이터 조회**: 장중 여부 무관하게 항상 호출 (키움은 장외에도 직전 데이터 반환)
- **주문 실행**: 반드시 장중 여부 체크 후 실행

```typescript
// 조회 서비스 — 장중 체크 불필요
async getTopRisingStocks(): Promise<RisingStock[]> {
    const res = await this.callApi('ka10027', params)  // 항상 호출
    return res.data ?? []
}

// 주문 서비스 — 장중 체크 필수
async placeOrder(code: string, qty: number): Promise<void> {
    if (!this.isMarketOpen()) throw new Error('장외 시간에는 주문 불가')
    await this.callApi('kt00009', orderParams)
}
```

---

### 7.2. DART API 메서드 시그니처 주의사항

`DartApiService`에는 단수 조회 메서드가 없습니다. **항상 배치 메서드를 사용**해야 합니다.

```typescript
// ❌ 존재하지 않는 메서드 (런타임 오류 발생)
await dartApi.getCorpCodeByStockCode(stockCode)

// ✅ 올바른 사용법 — 단일 종목도 배열로 감싸서 호출
const map = await dartApi.getCorpCodesByStockCodes([stockCode])
const corpCode = map[stockCode]  // 결과가 없으면 undefined

// ✅ 공시 요약 — raw 데이터 포함 버전
const { summary, items } = await dartApi.getDisclosuresSummaryForAiWithRaw(stockCode)
// items: DartDisclosure[] (원본 공시 목록, DB 저장용)
// summary: string (AI 요약 텍스트)
```

---

### 7.3. 새 서비스 파일 생성 시 필수 Import 체크리스트

서비스 파일(`electron/services/XxxService.ts`)을 새로 만들 때 아래 항목 중 필요한 것을 빠뜨리지 말 것:

```typescript
import { eventBus, SystemEvent } from '../utils/EventBus'      // 이벤트 emit/on 사용 시
import { DatabaseService } from './DatabaseService'            // DB 접근 시
import { KiwoomService } from './KiwoomService'                // 키움 API 호출 시
import { AiService } from './AiService'                        // Gemini AI 호출 시
import { NaverNewsService } from './NaverNewsService'          // 네이버 뉴스 API 시
import { DartApiService } from './DartApiService'              // DART API 시
```

누락 시 `is not a function` 또는 `is not defined` 런타임 오류 발생 (TypeScript 컴파일 단계에서는 안 잡힐 수 있음).

---

### 7.4. React 상태 관리 — 실시간 데이터 + DB 데이터 병합 원칙

급등주 리포트처럼 "실시간 시세(API)" + "분석 결과(DB)" 두 소스를 합쳐 보여줄 때:

**❌ 잘못된 패턴:** DB 로드 시 실시간 리스트를 `setRealtimeStocks([])`처럼 초기화함 → 목록 사라짐

**✅ 올바른 패턴:** 실시간 데이터를 베이스로, DB 데이터를 덮어씌우는 병합

```typescript
// DB 결과 로드 후 실시간 데이터와 병합
const mergedStocks = realtimeStocks.map(rt => {
    const db = dbAnalyzedStocks.find(d => d.code === rt.code)
    return db ? { ...rt, ...db } : rt   // DB 결과 있으면 병합, 없으면 실시간만
})
// realtimeStocks state는 절대 DB 로드 과정에서 초기화하지 말 것
```

---

### 7.5. 데이터 수집 → AI 분석 → DB 저장 올바른 순서

```typescript
// 반드시 이 순서를 지킬 것
const { newsItems, disclosureItems, summary } = await collectAllData(...)

// 1단계: raw 데이터를 AI 호출 전에 먼저 DB 저장
db.saveRawData({ date, stock_code, news_json: JSON.stringify(newsItems), ... })

// 2단계: AI 분석 (실패해도 raw 데이터는 보존됨)
const aiResult = await ai.analyze(summary)

// 3단계: 분석 결과 저장
db.saveAnalysisResult(aiResult)
```

이 순서를 지키면 AI 호출 실패, 타임아웃, 비용 한도 초과 시에도 수집한 원본 데이터는 DB에 안전하게 보존됩니다.

---

### 7.6. NaverNewsService — searchNews vs getNewsSummaryForAi 구분

```typescript
// raw 데이터 배열 반환 (DB 저장용)
const items: NaverNewsItem[] = await naverNews.searchNews(stockName)

// AI용 텍스트 요약 반환 (프롬프트 주입용) — raw 저장 불가
const summary: string = await naverNews.getNewsSummaryForAi(stockName)
```

raw 데이터 DB 저장이 필요한 경우 반드시 `searchNews()`를 사용하고, 요약까지 필요하다면 직접 포맷팅할 것.
