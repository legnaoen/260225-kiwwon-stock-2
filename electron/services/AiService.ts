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
        const model = customModel || settings?.modelName || 'gemini-2.5-flash';

        if (!key) {
            throw new Error('Gemini API 키가 설정되지 않았습니다. 설정 메뉴에서 키를 입력해주세요.');
        }

        const url = `${this.baseUrl}/${model}:generateContent?key=${key}`;
        console.log(`[AiService] Calling Gemini API (Model: ${model})...`);

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
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
                        maxOutputTokens: 2048,
                    }
                })
            });

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
