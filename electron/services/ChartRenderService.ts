import { BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';

export class ChartRenderService {
    private static win: BrowserWindow | null = null;
    private static queue: { code: string, name: string, theme: string, resolve: (buf: Buffer) => void, reject: (err: Error) => void }[] = [];
    private static isCapturing = false;

    public static async captureChart(code: string, name: string, theme: string = 'dark'): Promise<Buffer> {
        return new Promise((resolve, reject) => {
            this.queue.push({ code, name, theme, resolve, reject });
            this.processQueue();
        });
    }

    private static async processQueue() {
        if (this.isCapturing || this.queue.length === 0) return;
        this.isCapturing = true;

        const { code, name, theme, resolve, reject } = this.queue.shift()!;

        let timeout: NodeJS.Timeout;

        const onComplete = (_event: any, receivedCode: string) => {
            if (receivedCode === code) {
                executeCapture();
            }
        };

        const executeCapture = async () => {
            if (!this.win || this.win.isDestroyed()) return;
            try {
                // 약간의 여유를 둬 캔버스가 완벽히 채워졌는지 보장
                setTimeout(async () => {
                    if (!this.win || this.win.isDestroyed()) return;
                    try {
                        const image = await this.win.webContents.capturePage();
                        const buffer = image.toPNG();
                        cleanup();
                        resolve(buffer);
                    } catch (e) {
                        cleanup();
                        reject(e as Error);
                    }
                    this.processQueue();
                }, 500);
            } catch (err) {
                cleanup();
                reject(err as Error);
                this.processQueue();
            }
        };

        const cleanup = () => {
            if (timeout) clearTimeout(timeout);
            ipcMain.removeListener('chart-render-complete', onComplete);
            if (this.win && !this.win.isDestroyed()) {
                this.win.destroy();
            }
            this.win = null;
            this.isCapturing = false;
        };

        try {
            timeout = setTimeout(() => {
                cleanup();
                reject(new Error('차트 렌더링 시간 초과'));
                this.processQueue();
            }, 10000); // 10s wait

            ipcMain.on('chart-render-complete', onComplete);

            this.win = new BrowserWindow({
                width: 800,
                height: 600,
                show: false,
                webPreferences: {
                    preload: path.join(__dirname, 'preload.js'),
                    offscreen: true,
                    nodeIntegration: false,
                    contextIsolation: true
                },
            });

            const urlHash = `#/capture/${code}/${encodeURIComponent(name)}?theme=${theme}`;
            const baseUrl = process.env.VITE_DEV_SERVER_URL
                ? (process.env.VITE_DEV_SERVER_URL.endsWith('/') ? process.env.VITE_DEV_SERVER_URL.slice(0, -1) : process.env.VITE_DEV_SERVER_URL)
                : `file://${path.join(process.env.DIST as string, 'index.html')}`;

            const targetUrl = `${baseUrl}/${urlHash}`;
            console.log(`[ChartRenderService] 캡처 창 로드 시도: ${targetUrl}`);

            this.win.webContents.on('console-message', (e, level, message) => {
                console.log(`[Offscreen-Console] ${message}`);
            });

            await this.win.loadURL(targetUrl);
        } catch (err) {
            cleanup();
            reject(err as Error);
            this.processQueue();
        }
    }
}
