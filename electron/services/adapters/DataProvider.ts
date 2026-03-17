export interface StandardData {
    id: string;
    source: string;
    category: string;
    title: string;
    content: string;
    url?: string;
    timestamp: string; // ISO 8601 (KST preferred)
    metadata: any;
}

export interface IngestionResult {
    success: boolean;
    data?: StandardData[];
    error?: string;
    stats: {
        startTime: number;
        endTime: number;
        sizeKb: number;
        count: number;
    }
}

export interface DataProvider {
    readonly providerId: string;
    readonly category: string;
    
    fetch(options?: any): Promise<IngestionResult>;
}
