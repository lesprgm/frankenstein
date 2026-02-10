import http from 'node:http';

export type ActivationRequestHandler = (req: http.IncomingMessage, res: http.ServerResponse) => void;

export function createActivationRequestHandler(onActivate: () => Promise<void>): ActivationRequestHandler {
    return (req, res) => {
        // CORS headers for dashboard
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

        if (req.method === 'OPTIONS') {
            res.writeHead(200);
            res.end();
            return;
        }

        if (req.method === 'POST' && req.url === '/activate') {
            console.log('[Ghost] External activation via HTTP');
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, message: 'Activation triggered' }));

            // Trigger activation asynchronously
            onActivate().catch(err => {
                console.error('[Ghost] Activation error:', err);
            });
            return;
        }

        res.writeHead(404);
        res.end('Not found');
    };
}

export class ActivationServer {
    private server: http.Server | null = null;
    private port: number;
    private onActivate: () => Promise<void>;
    private handler: ActivationRequestHandler;

    constructor(port: number, onActivate: () => Promise<void>) {
        this.port = port;
        this.onActivate = onActivate;
        this.handler = createActivationRequestHandler(onActivate);
    }

    start(): void {
        if (this.server) return;

        this.server = http.createServer(this.handler);

        this.server.listen(this.port, () => {
            console.log(`[Ghost] Activation server running on http://localhost:${this.port}`);
        });
    }

    stop(): void {
        if (this.server) {
            this.server.close();
            this.server = null;
        }
    }
}
