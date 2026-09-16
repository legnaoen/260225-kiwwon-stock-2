import { DatabaseService } from './DatabaseService'
import { VirtualAccountService } from './VirtualAccountService'
import { AiService } from './AiService'
import { DataLoggingService } from './DataLoggingService'
import { v4 as uuidv4 } from 'uuid'
import Store from 'electron-store';

const store = new Store();

export class DailyRetrospectiveService {
    private static instance: DailyRetrospectiveService;
    private db = DatabaseService.getInstance();
    private account = VirtualAccountService.getInstance();
    private aiService = AiService.getInstance();

    private constructor() { }

    public static getInstance(): DailyRetrospectiveService {
        if (!DailyRetrospectiveService.instance) {
            DailyRetrospectiveService.instance = new DailyRetrospectiveService();
        }
        return DailyRetrospectiveService.instance;
    }

    /**
     * Run the daily retrospective process:
     * 1. Analyze today's virtual account performance
     * 2. Generate a new strategy reasoning (using Gemini AI)
     * 3. Create and save a new strategy version to the Database
     */
    public async runRetrospective(): Promise<any> {
        console.log('[DailyRetrospectiveService] [DEPRECATED] 종목 AI 자동매매 복기 및 전략 생성 엔진 폐기됨');
        const existingStrategies = this.db.getAiStrategies();
        const active = existingStrategies.find(s => s.isActive) || existingStrategies[0] || null;
        return {
            status: 'DEPRECATED',
            message: '종목 AI 자동매매 엔진이 공식 폐기되어 신규 전략 자동 생성이 중단되었습니다.',
            activeStrategy: active
        };
    }

    private shiftDate(dateString: string, days: number): string {
        const d = new Date(dateString);
        d.setDate(d.getDate() + days);
        return this.db.getKstDate(d);
    }
}
