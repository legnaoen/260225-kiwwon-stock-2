# 키움증권 OpenAPI (REST) 참조 가이드

이 문서는 프로젝트에서 사용 중인 모든 키움 REST API의 명세와 구현 지침을 정리합니다. 새로운 기능을 개발하거나 기존 코드를 수정할 때 참조하세요.

---

## 1. 공통 설정 (Common)

- **Base URL**: `https://api.kiwoom.com`
- **인증**: 모든 요청은 `authorization: Bearer {token}` 헤더를 포함해야 합니다.
- **API ID**: 모든 요청 헤더에 `'api-id': '{TR_CODE}'`를 명시해야 로그 및 에러 추적이 가능합니다.

---

## 2. 계좌 및 자산 정보 (Account & Assets)

### [ka00001] 보유 계좌 목록 조회
현재 접속된 사용자의 전체 계좌 목록을 가져옵니다.
- **Endpoint**: `POST /api/dostk/acnt`
- **Body**: `{}` (빈 객체)
- **응답 주요 필드**: `Body[]` (계좌 번호 배열 등)

### [kt00018] 계좌별 보유 종목 상세 조회
특정 계좌의 보유 주식 현황(평가손익, 매입가 등)을 조회합니다.
- **Endpoint**: `POST /api/dostk/acnt`
- **Headers**: `cont-yn`, `next-key` (연속 조회용)
- **Body**:
  ```json
  {
    "account_no": "계좌번호",
    "qry_tp": "1",
    "dmst_stex_tp": "KRX"
  }
  ```

### [kt00016] 예수금 및 자산 현황 조회
계좌의 예수금 및 주문 가능 금액을 조회합니다.
- **Endpoint**: `POST /api/dostk/acnt`
- **Body**:
  ```json
  {
    "account_no": "계좌번호",
    "fr_dt": "시작일자(YYYYMMDD)",
    "to_dt": "종료일자(YYYYMMDD)"
  }
  ```

---

## 3. 시세 및 종목 정보 (Quotes & Info)

### [ka10001] 주식 기본 정보
특정 종목의 현재가, 호가, 등락률 등 기본 정보를 가져옵니다.
- **Endpoint**: `POST /api/dostk/stkinfo`
- **Body**: `{ "stk_cd": "종목코드" }`

### [ka10081] 주식 일봉 차트 데이터
종목의 과거 일별 가격 데이터(시/고/저/종/거래량)를 조회합니다.
- **Endpoint**: `POST /api/dostk/chart`
- **Body**:
  ```json
  {
    "stk_cd": "종목코드",
    "base_dt": "기준일자(YYYYMMDD)",
    "upd_stkpc_tp": "1" // 수정주가 적용
  }
  ```

### [ka10070] 주식 분봉 차트 데이터
종목의 최근 분 단위 가격 데이터를 조회합니다.
- **Endpoint**: `POST /api/dostk/minutChart`
- **Body**:
  ```json
  {
    "stk_cd": "종목코드",
    "tm": "HHMMSS",
    "req_cnt": "30", // 요청개수
    "tm_dvs": "1" // 1분봉
  }
  ```

### [ka10099] 전체 종목 리스트
시장에 상장된 모든 종목 코드를 가져옵니다.
- **Endpoint**: `POST /api/dostk/stkinfo`
- **Body**: `{ "mrkt_tp": "시장구분(0:코스피, 1:코스닥)" }`
- **비고**: 연속 조회(`next-key`) 처리가 필요합니다.

---

## 4. 시장 급등주 및 랭킹 (Market Scanners)

### [ka10027] 전일대비 등락률 상위 (상승률 상위)
장중 및 장 종료 후 상승률이 가장 높은 종목들을 포착합니다.
- **Endpoint**: `POST /api/dostk/rkinfo`
- **Body**:
  ```json
  {
    "mrkt_tp": "000",        // 000(전체)
    "sort_tp": "1",          // 1(상승률순)
    "trde_qty_cnd": "0",
    "stk_cnd": "1",          // 1(관리종목제외)
    "updown_incls": "1",     // 1(상하한가 포함)
    "stex_tp": "3"           // 3(통합거래소)
  }
  ```

### [ka10030] 거래대금 상위
당일 시장에 돈이 가장 많이 몰린(거래대금이 큰) 주도 종목을 포착합니다.
- **Endpoint**: `POST /api/dostk/rkinfo`
- **Body**:
  ```json
  {
    "mrkt_tp": "000",
    "sort_tp": "3",          // 3(거래대금순)
    "mang_stk_incls": "1",   // 1(관리종목 제외)
    "pric_tp": "8",          // 8(1천원이상)
    "stex_tp": "3"
  }
  ```

### [ka10023] 거래량 급증 (Realtime Volume)
실시간으로 거래량이 갑자기 터지는 종목을 포착합니다.
- **Endpoint**: `POST /api/dostk/rkinfo`
- **Body**:
  ```json
  {
    "tm_tp": "1",            // 1(분 단위)
    "tm": "1",               // 최근 1분간
    "trde_qty_tp": "5"       // 5천주 이상
  }
  ```

---

## 5. 주문 실행 (Orders)

### [kt10000] 주식 매수 주문
- **Endpoint**: `POST /api/dostk/ordr`
- **Body**:
  ```json
  {
    "acnt_no": "계좌번호",
    "dmst_stex_tp": "KRX",
    "stk_cd": "종목코드",
    "ord_qty": "수량",
    "ord_uv": "가격",
    "trde_tp": "00" // 00:지정가, 03:시장가
  }
  ```

### [kt10001] 주식 매도 주문
- **⚠️ 주의**: 매도 주문 시 `cond_uv`(스톱가격) 필드를 포함하면 안 됩니다. (Error 407022 예방)
- **Body**: 위 매수 주문과 동일하되, `api-id`만 `kt10001`로 변경.

### [ka10075] 미체결 주문 내역
현재 체결되지 않고 남아있는 주문 정보를 조회합니다.
- **Endpoint**: `POST /api/dostk/acnt`
- **Body**:
  ```json
  {
    "acnt_no": "계좌번호",
    "all_stk_tp": "1", // 전체 종목
    "trde_tp": "0"      // 전체 매매구분
  }
  ```

---

## 6. 구현 시 필수 트러블슈팅 가이드

### ❌ Error 8005 (Token Expired)
- **원인**: 액세스 토큰 만료.
- **해결**: `makeApiRequestWithRetry` 래퍼 함수를 사용하여 8005 에러 감지 시 즉시 토큰을 강제 갱신하고 재시도하도록 설계되어 있습니다.

### ❌ Error 407022 (매도 주문 오류)
- **내용**: "해당 주문은 스톱가격을 입력하지 않습니다."
- **해결**: 매도 주문 Body에서 `cond_uv` 필드를 아예 제거하거나 정의하지 않아야 합니다.

### ❌ "분석할 종목이 없습니다" (장외 시간 처리)
- **원인**: `isMarketOpen()` 체크 로직이 조회(Scanner) 서비스에 걸려 있는 경우.
- **해결**: 키움은 장 종료 후에도 데이터를 반환하므로, **조회(Get)** 시에는 시간 체크를 하지 말고 **실행(Order/Trade)** 시에만 체크하도록 분리합니다.

### ❌ API 속도 제한 (TPS)
- **가이드**: 초당 과도한 요청은 차단의 원인이 됩니다. 연속 호출이 필요한 경우(`getAllStocks` 등) 최소 `100ms`의 딜레이를 주어야 합니다.

---

## 7. 응답 데이터 파싱 팁
키움 API의 응답 필드는 TR마다 다를 수 있으나 보통 아래 패턴을 따릅니다:
- `Body`, `list`, `output`, `output2` 등 여러 이름으로 리스트가 옵니다.
- `Array.isArray()` 체크 후 접근하는 것이 안전합니다.
- 필드명은 대/소문자가 섞여 있거나 축약어(예: `flu_rt`, `prdy_ctrt`)인 경우가 많으므로 `console.log`로 실제 응답을 확인하며 작업하세요.
