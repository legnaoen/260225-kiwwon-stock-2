const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src', 'components', 'v2_dashboard', 'PipelineMonitorTab.tsx');
let content = fs.readFileSync(filePath, 'utf8');

// Fix key names to match V2PipelineResult interface
content = content.replace(/aggregatedMarkdown\}/g, 'aggregated_markdown}');
content = content.replace(/\.rawData\b/g, '.raw_data');

fs.writeFileSync(filePath, content, 'utf8');
console.log('Done. Fixed key names in PipelineMonitorTab.tsx');
