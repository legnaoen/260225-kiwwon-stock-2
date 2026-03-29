import Store from 'electron-store';

const store = new Store();

export interface LocalAiSettings {
    baseUrl: string;
    modelName: string;
}

export class LocalAiService {
    private static instance: LocalAiService;
    // LM Studio 기본 서버 URL (v1/chat/completions은 OpenAI 호환)
    // Node.js fetch()의 IPv6 우선 시도 문제(::1)를 피하기 위해 127.0.0.1을 명시적으로 사용합니다.
    private defaultBaseUrl = 'http://127.0.0.1:1234/v1';
    
    // 권장 모델 명 (향후 모델 변경 시 유연한 연동)
    private defaultModelName = 'qwen/qwen3-4b-2507';

    private constructor() { }

    public static getInstance(): LocalAiService {
        if (!LocalAiService.instance) {
            LocalAiService.instance = new LocalAiService();
        }
        return LocalAiService.instance;
    }

    private getSettings(): LocalAiSettings {
        const settings = store.get('local_ai_settings') as LocalAiSettings | null;
        return {
            baseUrl: settings?.baseUrl || this.defaultBaseUrl,
            modelName: settings?.modelName || this.defaultModelName
        };
    }

    /**
     * 로컬 AI (LM Studio 등 OpenAI 호환 서버)를 호출하여 답변을 생성합니다.
     */
    public async askLocalAi(
        prompt: string, 
        systemInstruction?: string, 
        customModel?: string
    ): Promise<string> {
        const settings = this.getSettings();
        const model = customModel || settings.modelName;
        const endpoint = `${settings.baseUrl}/chat/completions`;

        console.log(`[LocalAi] 🚀 서버 요청: ${endpoint} (Model: ${model})`);

        const messages: any[] = [];
        if (systemInstruction) {
            messages.push({ role: 'system', content: systemInstruction });
        }
        messages.push({ role: 'user', content: prompt });

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 180000); 

        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                signal: controller.signal,
                body: JSON.stringify({
                    model: model,
                    messages: messages,
                    temperature: 0.7,
                    max_tokens: 4000,
                    stream: true // 60초 HTTP 타임아웃 방지를 위해 스트리밍 강제 사용
                })
            });
            clearTimeout(timeoutId);

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`로컬 AI 서버 오류 (${response.status}): ${errorText}`);
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder('utf-8');
            let fullText = '';
            let buffer = '';
            let isDone = false;
            let rawSample = '';

            try {
                while (!isDone) {
                    const { value, done } = await reader.read();
                    if (done) break;

                    const chunk = decoder.decode(value, { stream: true });
                    if (!rawSample) rawSample = chunk.substring(0, 200); // 1행 로깅용

                    buffer += chunk;
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || ''; // 마지막 불완전한 라인은 버퍼에 남김

                    for (const line of lines) {
                        const trimmed = line.trim();
                        if (!trimmed) continue;
                        if (trimmed.includes('[DONE]')) {
                            isDone = true;
                            break;
                        }
                        if (trimmed.startsWith('data:')) {
                            try {
                                const dataStr = trimmed.substring(5).trim();
                                const parsed = JSON.parse(dataStr);
                                const delta = parsed.choices?.[0]?.delta;
                                if (delta) {
                                    const token = delta.content || delta.reasoning_content || '';
                                    if (token) fullText += token;
                                }
                            } catch (e: any) {
                                console.error(`[LocalAi] 스트림 JSON 파싱 에러: ${e.message} \n원본 문자열: ${trimmed}`);
                            }
                        } else if (trimmed.startsWith('{') && !fullText) {
                            try {
                                const parsed = JSON.parse(trimmed);
                                if (parsed.choices?.[0]?.message?.content) {
                                    fullText = parsed.choices[0].message.content;
                                    isDone = true;
                                }
                            } catch (e: any) {
                                console.error(`[LocalAi] 일반 JSON 파싱 에러: ${e.message} \n원본 문자열: ${trimmed}`);
                            }
                        }
                    }
                }
                
                // 잔여 버퍼 처리
                if (buffer.trim().startsWith('data:')) {
                    try {
                        const dataStr = buffer.trim().substring(5).trim();
                        const parsed = JSON.parse(dataStr);
                        const delta = parsed.choices?.[0]?.delta;
                        if (delta) {
                            const token = delta.content || delta.reasoning_content || '';
                            if (token) fullText += token;
                        }
                    } catch (e) {}
                }
                
            } finally {
                reader.releaseLock();
            }

            if (fullText.trim()) {
                console.log(`[LocalAi] ✅ 스트림 응답 성공 (Model: ${model}, Length: ${fullText.length} chars)`);
                return fullText.trim();
            } else {
                console.warn(`[LocalAi] ⚠️ 빈 텍스트 응답. 샘플 청크 기록:`, rawSample);
            }
            return '로컬 AI에서 응답을 반환하지 않았습니다.';
        } catch (error: any) {
            console.error('[LocalAi] ❌ 호스트 연결 거부 또는 타임아웃:', error.message);
            if (error.name === 'AbortError') {
                throw new Error('로컬 AI 서버 타임아웃. GPU 로딩 중이거나 응답이 너무 깁니다.');
            }
            if (error.message.includes('fetch')) {
                throw new Error('LM Studio 서버에 연결할 수 없습니다. "lms server start"를 실행했는지 확인하세요.');
            }
            throw error;
        }
    }

    /**
     * 로컬 AI 서버의 연결 상태 및 로드된 모델을 확인합니다.
     */
    public async checkServerStatus(): Promise<{
        isOnline: boolean;
        models: string[];
    }> {
        const settings = this.getSettings();
        const endpoint = `${settings.baseUrl}/models`;
        
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 2000); // 상태 체크는 짧게
            
            const response = await fetch(endpoint, { signal: controller.signal });
            clearTimeout(timeoutId);
            
            if (response.ok) {
                const data = await response.json() as any;
                const models = data.data?.map((m: any) => m.id) || [];
                return { isOnline: true, models };
            }
            return { isOnline: false, models: [] };
        } catch (error) {
            return { isOnline: false, models: [] };
        }
    }
}
