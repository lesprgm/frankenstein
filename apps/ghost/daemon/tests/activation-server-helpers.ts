import { vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';

export type MockResponse = {
    headers: Record<string, string>;
    statusCode?: number;
    body?: string;
    setHeader: ReturnType<typeof vi.fn>;
    writeHead: ReturnType<typeof vi.fn>;
    end: ReturnType<typeof vi.fn>;
};

export function createMockRequest(method: string, url: string): IncomingMessage {
    return { method, url } as IncomingMessage;
}

export function createMockResponse(): MockResponse {
    const res: MockResponse = {
        headers: {},
        setHeader: vi.fn((name: string, value: string) => {
            res.headers[name] = value;
        }),
        writeHead: vi.fn((status: number, headers?: Record<string, string>) => {
            res.statusCode = status;
            if (headers) {
                Object.assign(res.headers, headers);
            }
        }),
        end: vi.fn((body?: string) => {
            if (typeof body !== 'undefined') {
                res.body = body;
            }
        })
    };

    return res;
}

export function asServerResponse(res: MockResponse): ServerResponse {
    return res as unknown as ServerResponse;
}
