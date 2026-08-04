import Store from 'electron-store';

const store = new Store();

export class AiService {
    private static instance: AiService;
    private baseUrl = 'https://generativelanguage.googleapis.com/v1beta/models';

    private constructor() { }

    public static getInstance(): AiService {
        if (!AiService.instance) {
            AiService.instance = new AiService();
        }
        return AiService.instance;
    }

    private getSettings() {
        return store.get('ai_settings') as { geminiKey: string, modelName: string } | null;
    }

    /**
     * Google Gemini API를 호출하여 텍스트를 생성합니다.
     */
    public async askGemini(prompt: string, systemInstruction?: string, customKey?: string, customModel?: string): Promise<string> {
        const settings = this.getSettings();
        const key = customKey || settings?.geminiKey;
        const model = customModel || settings?.modelName || 'gemini-3.5-flash-lite';

        if (!key) {
            throw new Error('Gemini API 키가 설정되지 않았습니다. 설정 메뉴에서 키를 입력해주세요.');
        }

        const url = `${this.baseUrl}/${model}:generateContent?key=${key}`;
        console.log(`[AiService] Calling Gemini API (Model: ${model})...`);

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 300000); // 300초 타임아웃

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                signal: controller.signal,
                body: JSON.stringify({
                    contents: [
                        {
                            role: 'user',
                            parts: [{ text: prompt }]
                        }
                    ],
                    system_instruction: systemInstruction ? {
                        parts: [{ text: systemInstruction }]
                    } : undefined,
                    generationConfig: {
                        temperature: 0.7,
                        topK: 40,
                        topP: 0.95,
                        maxOutputTokens: 8192,
                    }
                })
            });
            clearTimeout(timeoutId);

            if (!response.ok) {
                const errorData = (await response.json()) as any;
                throw new Error(errorData.error?.message || 'Gemini API 호출 실패');
            }

            const data = (await response.json()) as any;
            const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
            if (text) {
                console.log(`[AiService] Gemini Response Success (Model: ${model})`);
                return text;
            }
            return '응답을 생성할 수 없습니다.';
        } catch (error: any) {
            console.error('[AiService] Gemini API Error:', error);

            const errMsg = error.message || '';
            const isModelDeprecated = errMsg.includes('is no longer available') || 
                                     errMsg.includes('not found') || 
                                     errMsg.includes('not_found') || 
                                     errMsg.includes('invalid model') ||
                                     errMsg.includes('models/');

            const fallbackModel = 'gemini-3.5-flash-lite';

            if (isModelDeprecated && model !== fallbackModel) {
                console.warn(`[AiService] ⚠️ Model "${model}" is deprecated or unavailable. Attempting graceful fallback to "${fallbackModel}"...`);

                try {
                    // 1. 대체 모델로 호출 재시도
                    const fallbackText = await this.askGemini(prompt, systemInstruction, customKey, fallbackModel);

                    // 2. 재시도 성공 시, 설정을 정식 모델로 영구 자동 마이그레이션
                    try {
                        const aiSettings = store.get('ai_settings') as any || {};
                        let migrated = false;
                        if (aiSettings.modelName === model) {
                            aiSettings.modelName = fallbackModel;
                            migrated = true;
                        }
                        if (aiSettings.deepModelName === model) {
                            aiSettings.deepModelName = fallbackModel;
                            migrated = true;
                        }
                        if (aiSettings.lightweightCloudModel === model) {
                            aiSettings.lightweightCloudModel = fallbackModel;
                            migrated = true;
                        }
                        if (migrated) {
                            store.set('ai_settings', aiSettings);
                            console.log(`[AiService] Electron store config auto-migrated: ${model} -> ${fallbackModel}`);
                        }
                    } catch (storeErr: any) {
                        console.error('[AiService] Settings auto-migration failed:', storeErr.message);
                    }

                    // 3. 텔레그램 알림 발송
                    try {
                        const { TelegramService } = await import('./TelegramService');
                        TelegramService.getInstance().sendMessage(
                            `⚠️ **[AI 모델 자동 긴급 대체 및 마이그레이션]**\n` +
                            `- 이전 모델: \`${model}\` (구글 지원 종료)\n` +
                            `- 대체 모델: \`${fallbackModel}\`\n` +
                            `- 설명: 기존 프리뷰 모델의 서비스가 종료되어 최신 정식 버전인 \`${fallbackModel}\`로 자동 롤백 및 마이그레이션을 수행했습니다.`
                        );
                    } catch (tgErr: any) {
                        console.error('[AiService] Telegram alert failed:', tgErr.message);
                    }

                    return fallbackText;
                } catch (retryErr: any) {
                    console.error('[AiService] Graceful fallback retry failed:', retryErr.message);
                    throw retryErr;
                }
            }

            throw error;
        }
    }

    /**
     * 종목에 대한 최신 이슈 및 차트 분석 리포트를 생성합니다. (기능 확장용)
     */
    public async generateReport(stockCode: string, contextData: any): Promise<string> {
        const prompt = `${stockCode} 종목에 대해 다음 데이터를 기반으로 분석해줘: ${JSON.stringify(contextData)}`;
        const systemInstruction = "너는 전문적인 주식 투자 분석가야. 한국 주식 시장의 특성을 잘 알아.";
        return this.askGemini(prompt, systemInstruction);
    }
}
