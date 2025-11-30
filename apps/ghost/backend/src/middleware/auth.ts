import type { MiddlewareHandler } from 'hono';

const resolveApiKey = (): string | undefined => {
  return (
    process.env.API_KEY ||
    process.env.GHOST_API_KEY ||
    process.env.BACKEND_API_KEY ||
    // Provide a sensible default for local development
    (process.env.NODE_ENV === 'production' ? undefined : 'ghost-api-key-123')
  );
};

/**
 * Bearer token authentication middleware for all API routes.
 */
export const requireApiKey: MiddlewareHandler = async (c, next) => {
  const apiKey = resolveApiKey();

  if (!apiKey) {
    return c.json({ error: 'API key not configured' }, 500);
  }

  const header = c.req.header('authorization') || c.req.header('Authorization');
  if (!header || !header.startsWith('Bearer ')) {
    return c.json({ error: 'Missing Authorization header' }, 401);
  }

  const token = header.replace(/^Bearer\s+/i, '').trim();
  if (token !== apiKey) {
    return c.json({ error: 'Invalid API key' }, 401);
  }

  await next();
};
