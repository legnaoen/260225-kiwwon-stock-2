import { DatabaseService } from '../DatabaseService';
import { AiExecutionQueue } from '../AiExecutionQueue';

export class ThemeOntologyAgent {
    private db = DatabaseService.getInstance().db;

    public async runOntologyMapping(): Promise<{
        totalTagsAnalyzed: number;
        newMappedKeys: number;
    }> {

        console.log('[ThemeOntologyAgent] Starting Theme Normalization Process');

        // 1. Get existing macro themes (to act as the master list base)
        const existingMapRows = this.db.prepare('SELECT raw_tag, macro_category as macro FROM theme_ontology').all() as any[];
        const existingMacroSet = new Set<string>();

        existingMapRows.forEach(row => {
            existingMacroSet.add(row.macro);
        });

        const existingMacrosArray = Array.from(existingMacroSet);

        // 2. Fetch ALL tags from daily_rising_stocks and stock_theme_tags
        const dailyRows = this.db.prepare(
            'SELECT GROUP_CONCAT(theme_sector) as themes, GROUP_CONCAT(tags) as tags FROM daily_rising_stocks'
        ).all() as any[];

        let staticThemeRows: any[] = [];
        try {
            staticThemeRows = this.db.prepare('SELECT tag_name FROM stock_theme_tags').all() as any[];
        } catch (e) { /* table may not exist */ }

        const allRawTags = new Set<string>();

        const parseTagStr = (str: string) => {
            if (!str) return;
            const parts = str.replace(/["'\[\]]+/g, '').split(',');
            parts.forEach(p => {
                const tag = p.trim();
                if (tag && tag.length <= 20) {
                    allRawTags.add(tag);
                }
            });
        };

        dailyRows.forEach(row => {
            parseTagStr(row.themes);
            parseTagStr(row.tags);
        });

        staticThemeRows.forEach(row => {
            parseTagStr(row.tag_name);
        });

        const allTagsArray = Array.from(allRawTags);

        console.log('[ThemeOntologyAgent] Extracted ' + allTagsArray.length + ' unique raw tags from DB.');

        if (allTagsArray.length === 0) {
            return { totalTagsAnalyzed: 0, newMappedKeys: 0 };
        }

        let aggregatedMapping: Record<string, string> = {};

        const BATCH_SIZE = 500;
        for (let i = 0; i < allTagsArray.length; i += BATCH_SIZE) {
            const batchTags = allTagsArray.slice(i, i + BATCH_SIZE);
            const batchNum = Math.floor(i / BATCH_SIZE) + 1;
            console.log('[ThemeOntologyAgent] Processing batch ' + batchNum + ' (' + batchTags.length + ' tags)');

            const existingRef = existingMacrosArray.length > 0
                ? existingMacrosArray.join(', ')
                : '없음 (당신이 기초를 세우십시오)';

            const prompt = [
                '당신은 대한민국 주식 시장의 테마/섹터 온톨로지(사전) 전문가입니다.',
                '목표: 파편화된 주식 테마 키워드 리스트를 입력받아, 가장 대표적이고 포괄적인 "대분류(Macro Category)"로 매핑(그룹화)하는 것입니다.',
                '',
                '[지침]',
                '1. 기존 대분류 참고: ' + existingRef + '. 이 대분류를 우선적으로 재활용하되, 필요하다면 통합하거나 분리하여 더 세련된 대분류를 제안해도 됩니다.',
                '2. 비슷한 동의어나 조합어(예: "5G", "광통신/네트워크", "5G/광통신")는 하나의 대분류(예: "통신장비")로 합치십시오.',
                '3. 너무 광범위한 대분류("제조업", "서비스업")는 지양하고, 시장에서 흔히 쓰이는 섹터명("반도체", "이차전지", "친환경에너지", "제약/바이오", "게임") 수준으로 묶어주십시오.',
                '4. "실적발표", "경영권분쟁" 같은 모멘텀 이유도 하나의 대분류로 취급할 수 있습니다.',
                '5. 반환 형식: 반드시 JSON 객체로 반환하십시오. Key는 원본 태그, Value는 새로운 대분류명입니다.',
                '예시:',
                '{',
                '  "5G(5세대 이동통신)": "통신장비",',
                '  "5G/광통신": "통신장비",',
                '  "스마트폰": "IT부품/기기",',
                '  "HLB그룹": "제약/바이오"',
                '}',
                '',
                '[처리할 원본 태그 목록 (Batch)]',
                JSON.stringify(batchTags)
            ].join('\n');

            try {
                const systemInstruction = 'You are a JSON-only response agent. You must return ONLY raw JSON, no markdown formatting.';

                const responseText = await AiExecutionQueue.getInstance().enqueue({
                    agentId: 'THEME_ONTOLOGY',
                    agentName: '테마 파편화 정리',
                    triggerType: 'MANUAL',
                    targetType: 'gemini',
                    prompt: prompt,
                    systemInstruction: systemInstruction
                });

                const cleanContent = responseText.replace(/```json/gi, '').replace(/```/g, '').trim();
                const resultObj = JSON.parse(cleanContent);

                Object.assign(aggregatedMapping, resultObj);
                console.log('[ThemeOntologyAgent] Batch ' + batchNum + ' done: ' + Object.keys(resultObj).length + ' mappings');
            } catch (err) {
                console.error('[ThemeOntologyAgent] Batch Processing Error:', err);
                console.error('[ThemeOntologyAgent] Batch processing failed: ' + String(err));
            }
        }

        let newRecords = 0;
        const nowStr = new Date().toISOString();

        // 3. Upsert to DB
        const insertStmt = this.db.prepare(
            'INSERT OR REPLACE INTO theme_ontology (raw_tag, macro_category, updated_at) VALUES (?, ?, ?)'
        );

        this.db.transaction(() => {
            for (const [rawTag, macro] of Object.entries(aggregatedMapping)) {
                if (typeof rawTag === 'string' && typeof macro === 'string' && macro.trim() !== '') {
                    insertStmt.run(rawTag, macro.trim(), nowStr);
                    newRecords++;
                }
            }
        })();

        console.log('[ThemeOntologyAgent] Mapping Complete. Updated ' + newRecords + ' tags.');

        return {
            totalTagsAnalyzed: allTagsArray.length,
            newMappedKeys: newRecords
        };
    }
}
