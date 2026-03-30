import Database from 'better-sqlite3';
import path from 'path';
import { app } from 'electron';
import fs from 'fs';

export interface SwarmVote {
    id?: number;
    sessionId: string;
    personaId: string; // e.g., 'BEAR', 'BULL', 'BANKER', 'MACRO', 'GLOBAL'
    voteResult: string; // e.g., 'AGREE', 'OVERESTIMATED', 'UNDERESTIMATED'
    suggestedSeverity: string;
    argument: string;
    createdAt?: string;
}

export interface SwarmSession {
    id: string;
    issueId: string;
    sessionDate: string;
    targetSeverity: string;
    consensusSeverity: string;
    status: string; // e.g., 'COMPLETED'
    createdAt?: string;
    votes?: SwarmVote[];
}

export interface IssueGoodSector {
    name: string;
    reason: string;
}

export interface IssueBadSector {
    name: string;
    reason: string;
}

export interface IssueTimelineNode {
    id: number;
    timestamp: string;
    snapshot_date?: string;
    status_snapshot?: string;
    severity?: string;
    summary?: string;
    ai_analysis?: string;
    market_reaction?: string;
}

export interface IssueRecord {
    id: string;
    name: string;
    severity: string;
    status: string;
    impactDirection: string;
    summary: string;
    created_date: string;
    updated_date: string;
    goodSectors: IssueGoodSector[];
    badSectors: IssueBadSector[];
    timeline?: IssueTimelineNode[];
}

export class IssueLedgerDB {
    private static instance: IssueLedgerDB;
    private db: Database.Database;

    private constructor() {
        const userDataPath = app.getPath('userData');
        const dbDir = path.join(userDataPath, 'db');
        if (!fs.existsSync(dbDir)) {
            fs.mkdirSync(dbDir, { recursive: true });
        }
        const dbPath = path.join(dbDir, 'issue_ledger.sqlite');

        this.db = new Database(dbPath, { verbose: process.env.NODE_ENV === 'development' ? console.log : undefined });
        this.initTables();
    }

    public static getInstance(): IssueLedgerDB {
        if (!IssueLedgerDB.instance) {
            IssueLedgerDB.instance = new IssueLedgerDB();
        }
        return IssueLedgerDB.instance;
    }

    private initTables() {
        // Main issues table
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS issues (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                severity TEXT NOT NULL,
                status TEXT NOT NULL,
                impact_direction TEXT NOT NULL,
                summary TEXT,
                created_date TEXT NOT NULL,
                updated_date TEXT NOT NULL
            );
        `);

        // Sectors table mapped 1:N
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS issue_sectors (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                issue_id TEXT NOT NULL,
                type TEXT NOT NULL, -- 'GOOD' | 'BAD'
                sector_name TEXT NOT NULL,
                reason TEXT,
                FOREIGN KEY(issue_id) REFERENCES issues(id) ON DELETE CASCADE
            );
        `);

        // Timeline events mapped 1:N
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS issue_timeline (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                issue_id TEXT NOT NULL,
                timestamp TEXT NOT NULL,
                snapshot_date TEXT,
                status_snapshot TEXT,
                severity TEXT,
                summary TEXT,
                ai_analysis TEXT,
                market_reaction TEXT,
                FOREIGN KEY(issue_id) REFERENCES issues(id) ON DELETE CASCADE
            );
        `);

        // Daily Briefing table
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS issue_briefings (
                date TEXT PRIMARY KEY,
                risk_score INTEGER NOT NULL,
                summary_markdown TEXT NOT NULL,
                macro_vix TEXT,
                macro_krw TEXT,
                macro_tnx TEXT,
                macro_oil TEXT,
                created_at TEXT NOT NULL
            );
        `);

        // Swarm sessions table mapped to issues
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS swarm_sessions (
                id TEXT PRIMARY KEY,
                issue_id TEXT NOT NULL,
                session_date TEXT NOT NULL,
                target_severity TEXT NOT NULL,
                consensus_severity TEXT NOT NULL,
                status TEXT DEFAULT 'COMPLETED',
                created_at TEXT NOT NULL,
                FOREIGN KEY(issue_id) REFERENCES issues(id) ON DELETE CASCADE
            );
        `);

        // Swarm votes table mapped to swarm_sessions
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS swarm_votes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL,
                persona_id TEXT NOT NULL,
                vote_result TEXT NOT NULL,
                suggested_severity TEXT NOT NULL,
                argument TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY(session_id) REFERENCES swarm_sessions(id) ON DELETE CASCADE
            );
        `);

        try {
            this.db.exec(`ALTER TABLE issue_briefings ADD COLUMN macro_tnx TEXT;`);
        } catch (e) { /* ignore */ }
        try {
            this.db.exec(`ALTER TABLE issue_briefings ADD COLUMN macro_oil TEXT;`);
        } catch (e) { /* ignore */ }

        // Need to enable Foreign Keys for SQLite
        this.db.pragma('foreign_keys = ON');
    }

    /**
     * Delete all issues and recreate tables
     */
    public __dropAndRecreate(): void {
        this.db.exec(`
            DROP TABLE IF EXISTS swarm_votes;
            DROP TABLE IF EXISTS swarm_sessions;
            DROP TABLE IF EXISTS issue_timeline;
            DROP TABLE IF EXISTS issue_sectors;
            DROP TABLE IF EXISTS issues;
            DROP TABLE IF EXISTS issue_briefings;
        `);
        this.initTables();
    }

    /**
     * Get active (non-RESOLVED) issues with populated sectors and timeline.
     */
    public getActiveIssues(): IssueRecord[] {
        const issues = this.db.prepare(`SELECT * FROM issues WHERE status != 'RESOLVED' ORDER BY updated_date DESC`).all() as any[];

        return issues.map(row => {
            const sectors = this.db.prepare(`SELECT * FROM issue_sectors WHERE issue_id = ?`).all(row.id) as any[];
            
            // Fetch latest swarm session for summary
            const latestSession = this.db.prepare(`SELECT id, target_severity, consensus_severity FROM swarm_sessions WHERE issue_id = ? ORDER BY created_at DESC LIMIT 1`).get(row.id) as any;
            let swarmSummary = '';
            if (latestSession) {
                const votes: any[] = this.db.prepare(`SELECT vote_result FROM swarm_votes WHERE session_id = ?`).all(latestSession.id);
                const total = votes.length;
                if (total > 0) {
                    const upVotes = votes.filter(v => v.vote_result === 'UP').length;
                    const downVotes = votes.filter(v => v.vote_result === 'DOWN').length;
                    const holdVotes = votes.filter(v => v.vote_result === 'HOLD').length;
                    
                    let maxVotes = upVotes;
                    let dirStr = '상승';
                    
                    if (downVotes > maxVotes) { maxVotes = downVotes; dirStr = '하락'; }
                    if (holdVotes > maxVotes) { maxVotes = holdVotes; dirStr = '중립'; }
                    
                    const pct = Math.round((maxVotes / total) * 100);
                    
                    swarmSummary = `🗨️ ${dirStr} ${pct}% ➡️ ${latestSession.consensus_severity}`;
                }
            }

            return {
                id: row.id,
                name: row.name,
                severity: row.severity,
                status: row.status,
                impactDirection: row.impact_direction,
                summary: row.summary,
                created_date: row.created_date,
                updated_date: row.updated_date,
                goodSectors: sectors.filter(s => s.type === 'GOOD').map(s => ({ name: s.sector_name, reason: s.reason })),
                badSectors: sectors.filter(s => s.type === 'BAD').map(s => ({ name: s.sector_name, reason: s.reason })),
                swarmSummary: swarmSummary
            };
        });
    }

    /**
     * Get the latest daily briefing summary
     */
    public getLatestBriefing(): any {
        return this.db.prepare(`SELECT * FROM issue_briefings ORDER BY date DESC LIMIT 1`).get();
    }

    /**
     * Save the daily briefing summary
     */
    public saveBriefing(date: string, riskScore: number, summaryMarkdown: string, macroVix: string, macroKrw: string, macroTnx: string = '', macroOil: string = ''): void {
        this.db.prepare(`
            INSERT OR REPLACE INTO issue_briefings (date, risk_score, summary_markdown, macro_vix, macro_krw, macro_tnx, macro_oil, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))
        `).run(date, riskScore, summaryMarkdown, macroVix, macroKrw, macroTnx, macroOil);
    }

    /**
     * Get a specific issue timeline
     */
    public getIssueTimeline(issueId: string): IssueTimelineNode[] {
        return this.db.prepare(`SELECT * FROM issue_timeline WHERE issue_id = ? ORDER BY timestamp DESC`).all(issueId) as any[];
    }

    /**
     * Terminate an issue natively
     */
    public resolveIssue(issueId: string): void {
        this.db.prepare(`UPDATE issues SET status = 'RESOLVED', updated_date = datetime('now', 'localtime') WHERE id = ?`).run(issueId);
        
        // Add a timeline trace for closure
        this.db.prepare(`
            INSERT INTO issue_timeline (issue_id, timestamp, snapshot_date, status_snapshot, severity, summary, ai_analysis, market_reaction) 
            VALUES (?, datetime('now', 'localtime'), date('now', 'localtime'), 'RESOLVED', NULL, '사용자(PM)에 의해 이슈가 인위적으로 종료되었습니다.', NULL, NULL)
        `).run(issueId);
    }

    /**
     * Add a timeline node to an issue
     */
    public addTimelineNode(issueId: string, node: Partial<IssueTimelineNode>): void {
        this.db.prepare(`
            INSERT INTO issue_timeline (issue_id, timestamp, snapshot_date, status_snapshot, severity, summary, ai_analysis, market_reaction)
            VALUES (?, datetime('now', 'localtime'), ?, ?, ?, ?, ?, ?)
        `).run(
            issueId,
            node.snapshot_date || new Date().toISOString().substring(0, 10),
            node.status_snapshot || null,
            node.severity || null,
            node.summary || null,
            node.ai_analysis || null,
            node.market_reaction || null
        );
    }

    /**
     * Create or update an issue
     */
    public upsertIssue(issue: IssueRecord): void {
        const updateTransaction = this.db.transaction(() => {
            const existing = this.db.prepare(`SELECT id FROM issues WHERE id = ?`).get(issue.id);
            
            if (existing) {
                this.db.prepare(`
                    UPDATE issues 
                    SET name = ?, severity = ?, status = ?, impact_direction = ?, summary = ?, updated_date = ?
                    WHERE id = ?
                `).run(
                    issue.name, issue.severity, issue.status, issue.impactDirection, issue.summary, issue.updated_date, issue.id
                );
            } else {
                this.db.prepare(`
                    INSERT INTO issues (id, name, severity, status, impact_direction, summary, created_date, updated_date)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                `).run(
                    issue.id, issue.name, issue.severity, issue.status, issue.impactDirection, issue.summary, issue.created_date, issue.updated_date
                );
            }

            // Purge existing sectors and overwrite
            this.db.prepare(`DELETE FROM issue_sectors WHERE issue_id = ?`).run(issue.id);

            const insertSectorStmt = this.db.prepare(`
                INSERT INTO issue_sectors (issue_id, type, sector_name, reason) VALUES (?, ?, ?, ?)
            `);
            
            for (const g of issue.goodSectors) {
                insertSectorStmt.run(issue.id, 'GOOD', g.name, g.reason);
            }
            for (const b of issue.badSectors) {
                insertSectorStmt.run(issue.id, 'BAD', b.name, b.reason);
            }
        });

        updateTransaction();
    }

    /**
     * Get Swarm sessions for an issue
     */
    public getSwarmSessionsForIssue(issueId: string): SwarmSession[] {
        const sessions = this.db.prepare(`
            SELECT id, issue_id as issueId, session_date as sessionDate, target_severity as targetSeverity, 
                   consensus_severity as consensusSeverity, status, created_at as createdAt 
            FROM swarm_sessions 
            WHERE issue_id = ? 
            ORDER BY created_at DESC
        `).all(issueId) as SwarmSession[];

        for (const session of sessions) {
            session.votes = this.db.prepare(`
                SELECT id, session_id as sessionId, persona_id as personaId, vote_result as voteResult, 
                       suggested_severity as suggestedSeverity, argument, created_at as createdAt 
                FROM swarm_votes 
                WHERE session_id = ?
            `).all(session.id) as SwarmVote[];
        }
        return sessions;
    }

    /**
     * Save a complete Swarm Session including its votes
     */
    public saveSwarmSession(session: SwarmSession): void {
        const saveTransaction = this.db.transaction(() => {
            // Save Session
            this.db.prepare(`
                INSERT OR REPLACE INTO swarm_sessions (id, issue_id, session_date, target_severity, consensus_severity, status, created_at)
                VALUES (?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))
            `).run(session.id, session.issueId, session.sessionDate, session.targetSeverity, session.consensusSeverity, session.status);

            // Save Votes
            if (session.votes && session.votes.length > 0) {
                // Delete existing votes if it's an update
                this.db.prepare(`DELETE FROM swarm_votes WHERE session_id = ?`).run(session.id);
                
                const insertVoteStmt = this.db.prepare(`
                    INSERT INTO swarm_votes (session_id, persona_id, vote_result, suggested_severity, argument, created_at)
                    VALUES (?, ?, ?, ?, ?, datetime('now', 'localtime'))
                `);

                for (const vote of session.votes) {
                    insertVoteStmt.run(session.id, vote.personaId, vote.voteResult, vote.suggestedSeverity, vote.argument);
                }
            }
        });

        saveTransaction();
    }

    /**
     * 해당 이슈에 대해 오늘 이미 Swarm 세션이 생성되었는지 확인 (중복 방지)
     */
    public hasSwarmToday(issueId: string): boolean {
        const today = new Date().toLocaleDateString('sv-SE'); // 'YYYY-MM-DD'
        const row = this.db.prepare(
            `SELECT id FROM swarm_sessions WHERE issue_id = ? AND session_date = ? LIMIT 1`
        ).get(issueId, today);
        return !!row;
    }

    /**
     * Delete a Swarm Session and its cascading votes
     */
    public deleteSwarmSession(sessionId: string): void {
        this.db.prepare(`DELETE FROM swarm_sessions WHERE id = ?`).run(sessionId);
    }
}
