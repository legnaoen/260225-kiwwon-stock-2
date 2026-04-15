# AI JSON 형식 오류(Broken JSON) 자동 보완 및 복구 계획

로컬 AI(Local LLM)는 프롬프트 준수력이 대형 클라우드 AI보다 약해 종종 쉼표, 괄호, 쌍따옴표를 빠뜨리거나 일반 텍스트를 함께 섞어서 응답을 내놓는 문제가 있습니다. 이를 방어하고 시스템 중단을 막기 위한 3단계 자동 복구(Auto-Healing) 파이프라인 계획입니다.

## 🎯 1단계: 1차 텍스트 교정 및 Sanitizing (빠른 복구)
가장 빠르고 비용이 들지 않는 방법으로, 정규식 등 코드를 통해 텍스트를 강제로 잘라내고 교정하여 파싱을 시도합니다.
- **마크다운 쓰레기값 제거:** ````json ... ```` 블록 외부의 불필요한 설명글을 완벽히 도려냅니다.
- **후행 쉼표(Trailing Comma) 제거:** `},]` 또는 `},}`와 같이 마지막 요소 뒤에 붙은 잉여 콤마를 제거합니다.
- **불완전 종료 보완:** JSON 텍스트 끝에 닫히는 괄호(`]`, `}`)가 누락된 채 잘렸는지 검사하고 부족한 괄호를 채웁니다.

## 🤖 2단계: AI 자가 교정 및 재시도 (Self-Correction)
1단계 교정으로도 `JSON.parse`가 실패하면(Syntax Error), **문제가 발생한 JSON과 에러 메시지를 그대로 다시 해당 AI에게 보내 수정을 요구**합니다.
- **프롬프트 구성:** "당신이 이전에 출력한 텍스트에 문법 오류가 있습니다. (에러 내용: `Unexpected token...`) 이 에러를 수정해서 완벽한 순수 JSON으로 다시 출력하세요."
- **재시도 횟수 제한:** 최대 1~2회만 시도하여 로컬 자원 점유와 무한 루프를 방지합니다.
- **UI 피드백 발송:** 관제 대시보드에 `[AI] JSON 구문 에러 감지. 자가 복구 시도 중 (1/2)` 이벤트를 발생시켜 사용자가 멈춤으로 오인하지 않게 합니다.

## 🚀 3단계: 하위 호환 안전장치 - Gemini Fallback 전환
로컬 AI가 끝내 문법을 고치지 못해 2단계마저 실패하는 경우, 데이터 무결성과 스케줄 정상 처리를 우선하기 위해 **자동으로 백업 AI로 전환**합니다.
- **자동 전환:** 사용자의 설정이 `LOCAL AI` 모드였더라도, 내부적으로 예외 처리를 띄우고 즉시 `gemini` (또는 활성화된 가장 성능이 좋은 Cloud API) 파이프라인으로 요청을 1회 토스합니다.
- **로그 및 통보:** 정상 파싱에 성공하면 텔레그램이나 UI 로그에 `"로컬 AI JSON 포맷 불안정으로 인해 안전한 Gemini 모드로 우회하여 성공했습니다"`라는 알림을 남겨 투명성을 보장합니다.

---

### 💻 실제 적용 코드 (수도코드 예시)
`ThemeContextBuilder.ts` 의 클러스터링 로직 호출 부근에 적용될 구조입니다.

```typescript
let response = '';
let parsedResult = null;
let retryCount = 0;
const MAX_RETRY = 2;

// 1. 기본 실행 루프 (2단계 자가 교정 포함)
while(retryCount <= MAX_RETRY) {
    try {
        response = await AiQueue.enqueue({ ...agentInfo, targetType: 'local', errorFeedback: lastError });
        
        // 1단계(정규식 교정) 시도
        const sanitized = JsonParserUtil.fixCommonErrors(response); 
        parsedResult = JSON.parse(sanitized);
        break; // 성공 시 루프 탈출
    } catch(err) {
        lastError = err.message;
        retryCount++;
        eventBus.emit('LOG', `JSON 파싱 실패, 자가 교정 재시도 중 (${retryCount}/${MAX_RETRY})`);
    }
}

// 2. 3단계 (Gemini 대체 모드 가동)
if (!parsedResult) {
    eventBus.emit('LOG', `로컬 AI 자가 복구 실패. Gemini Fallback 모드로 전환하여 시도합니다.`);
    response = await AiQueue.enqueue({ ...agentInfo, targetType: 'gemini' }); // 강제 전환
    const sanitized = JsonParserUtil.fixCommonErrors(response);
    parsedResult = JSON.parse(sanitized);
}

return parsedResult;
```
