
import { describe, it, expect, vi } from 'vitest';
import { createActivationRequestHandler } from '../src/services/activation-server';
import { createMockRequest, createMockResponse, asServerResponse } from './activation-server-helpers';

describe('ActivationServer', () => {
    it('should trigger callback on POST /activate', async () => {
        const onActivate = vi.fn().mockResolvedValue(undefined);
        const handler = createActivationRequestHandler(onActivate);
        const req = createMockRequest('POST', '/activate');
        const res = createMockResponse();

        handler(req, asServerResponse(res));

        // Check callback
        expect(onActivate).toHaveBeenCalled();
        expect(res.statusCode).toBe(200);
        expect(res.body).toBe(JSON.stringify({ success: true, message: 'Activation triggered' }));
    });
});
