/**
 * Ghost Backend API Server
 * Main entry point for the Ghost backend service
 */

import 'dotenv/config';
import net from 'node:net';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { requireApiKey } from './middleware/auth.js';
import { storageService } from './services/storage.js';

const app = new Hono();

// Middleware
app.use('*', logger());
app.use('*', cors({
  origin: '*', // Allow all origins for dashboard access (can be restricted in production)
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}));

// Auth middleware for API routes
app.use('/api/*', requireApiKey);

// Health check endpoint
app.get('/health', (c) => {
  const storageHealth = storageService.getHealth();
  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '0.1.0',
    storage: storageHealth.ok ? storageHealth.value : storageHealth.error,
  });
});

import commandRoutes from './routes/command.js';
import fileRoutes from './routes/files.js';
import dashboardRoutes from './routes/dashboard.js';
import consolidationRoutes from './routes/consolidation.js';
import explainRoutes from './routes/explain.js';
import searchRoutes from './routes/search.js';
import openFileRoutes from './routes/open-file.js';
import activateRoutes from './routes/activate.js';
import summarizeContextRoutes from './routes/summarize-context.js';

// API routes
app.route('/api/command', commandRoutes);
app.route('/api/files', fileRoutes);
app.route('/api/dashboard', dashboardRoutes);
app.route('/api/commands', dashboardRoutes); // Add direct /api/commands route
app.route('/api/memories', consolidationRoutes);
app.route('/api/explain', explainRoutes);
app.route('/api/search', searchRoutes);
app.route('/api/open-file', openFileRoutes);
app.route('/api/activate', activateRoutes);
app.route('/api/summarize-context', summarizeContextRoutes);

// 404 handler
app.notFound((c) => {
  return c.json({ error: 'Not found' }, 404);
});

// Error handler
app.onError((err, c) => {
  console.error('Server error:', err);
  return c.json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  }, 500);
});

// Start server
// Start server only if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const desiredPort = parseInt(process.env.PORT || '4000', 10);

  (async () => {
    const available = await new Promise<boolean>((resolve) => {
      const tester = net.createServer();
      tester.once('error', (err: any) => {
        if (err.code === 'EADDRINUSE') resolve(false);
        else resolve(false);
        tester.close();
      });
      tester.once('listening', () => {
        tester.close();
        resolve(true);
      });
      tester.listen(desiredPort, '0.0.0.0');
    });

    if (!available) {
      console.error(`Port ${desiredPort} is already in use. Backend will not start. Kill the existing process or set PORT to a free port.`);
      process.exit(1);
    }

    const port = desiredPort;

    console.log(`Starting Ghost Backend API on port ${port}...`);

    serve({
      fetch: app.fetch,
      port,
    }, (info) => {
      console.log(`✓ Ghost Backend API running at http://localhost:${info.port}`);
      console.log(`  Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`  Database: ${process.env.DATABASE_PATH ? 'configured' : 'NOT CONFIGURED'}`);
    });
  })();
}

export default app;
