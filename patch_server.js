const fs = require('fs');
const filepath = "C:\\Users\\legna\\Projects\\260324 Crawler test\\server.py";

try {
    let content = fs.readFileSync(filepath, 'utf8');
    // Replace the truncated markdown and html slice logic
    content = content.replace(/"text_content": clean_markdown\[:4000\],/g, '"text_content": clean_markdown,');
    content = content.replace(/"text_content": clean_markdown\[:\d+\],/g, '"text_content": clean_markdown,');
    fs.writeFileSync(filepath, content, 'utf8');
    console.log("Success");
} catch(e) {
    console.log(e.message);
}
