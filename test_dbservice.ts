import { DatabaseService } from './electron/services/DatabaseService';

const dbService = DatabaseService.getInstance();
const result = dbService.getThemeTrackerData('THEME', '2026-04-10', 14, 5);

const targetName = '광통신'; // Or find first item with reason in historyData
const matchingHistory = result.historyData.filter(d => d.name.includes(targetName));

console.dir(matchingHistory, { depth: null });
