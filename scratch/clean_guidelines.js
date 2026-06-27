const fs = require('fs');
const path = require('path');

const tracks = ['a', 'b', 'c', 'd', 'e'];
const guidelinesDir = path.join(__dirname, '..', 'guidelines');

const delimiterRegex = /^(?:##+|###+)\s*🚨\s*\[AI\s*자동\s*오답노트\s*&\s*회피\s*패턴\].*$/mi;

tracks.forEach(track => {
    const filePath = path.join(guidelinesDir, `track_${track}_phase2.md`);
    if (!fs.existsSync(filePath)) {
        console.log(`[Skip] File not found: ${filePath}`);
        return;
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const match = content.match(delimiterRegex);

    if (match && match.index !== undefined) {
        // 첫 번째 오답노트 헤더가 나오는 지점 직전까지만 잘라냅니다.
        const cleanedHeader = content.substring(0, match.index).trim();
        
        // 찌꺼기 없는 깔끔한 마크다운 파일로 복원 (일단 오답노트 헤더만 남기고 규칙 내용은 비우거나, 기존에 꼬여서 새로 갱신된 오답노트가 무엇인지 수작업으로 남겨두고 싶다면)
        // 사실, 뒤에 있던 규칙 중 가장 최근 것만 찾아 남기는게 좋습니다.
        // 이 파일에서는 마지막 오답노트 블록이 진짜 새로운 오답노트(규칙 1~5)였습니다.
        const parts = content.split(/^(?:##+|###+)\s*🚨\s*\[AI\s*자동\s*오답노트\s*&\s*회피\s*패턴\].*$/mi);
        // 맨 첫 번째 파트: 원본 헤더 지침
        const header = parts[0].trim();
        // 맨 마지막 파트: 가장 최근에 LLM이 작성해 준 규칙 데이터
        const latestRules = parts[parts.length - 1].trim();

        const newContent = `${header}\n\n## 🚨 [AI 자동 오답노트 & 회피 패턴]\n${latestRules}\n`;
        fs.writeFileSync(filePath, newContent, 'utf-8');
        console.log(`[Cleaned] ${filePath} 포맷 정돈 완료!`);
    } else {
        console.log(`[OK] No dirty format found: ${filePath}`);
    }
});
