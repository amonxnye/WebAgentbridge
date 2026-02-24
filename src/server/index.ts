import express from 'express';
import { join } from 'path';
import dotenv from 'dotenv';

import mcpRouter from './routes/mcp';
import registryRouter from './routes/registry';
import sitesRouter from './routes/sites';
import keysRouter from './routes/keys';
import analyticsRouter from './routes/analytics';
import marketplaceRouter from './routes/marketplace';
import webhooksRouter from './routes/webhooks';
import auditRouter from './routes/audit';
import authRouter from './routes/auth';
import metricsRouter from '../health/metrics';
import { attachJwt } from './middleware/jwt';
import { rateLimitMcp } from './middleware/rate-limit';
import { testConnection } from '../db/client';
import { startScheduler } from '../scheduler';

dotenv.config();

const app = express();
const PORT = parseInt(process.env.PORT ?? '3000', 10);
const HOST = process.env.HOST ?? '0.0.0.0';

// ── Global middleware ─────────────────────────────────────────────────────────
app.use(express.json({ limit: '2mb' }));
app.use(attachJwt);                              // attach JWT user from Bearer token if present

// ── Dashboard (static SPA) ────────────────────────────────────────────────────
app.use(express.static(join(__dirname, '..', '..', 'public')));

// ── Health + Prometheus metrics ───────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', version: '1.0.0', timestamp: new Date().toISOString() });
});
app.use('/metrics', metricsRouter);

// ── Auth (login / register / /me) ─────────────────────────────────────────────
app.use('/auth', authRouter);

// ── Public registry ───────────────────────────────────────────────────────────
app.use('/registry', registryRouter);

// ── Marketplace (Phase 3) ─────────────────────────────────────────────────────
app.use('/marketplace', marketplaceRouter);

// ── Management API (/api/*) ───────────────────────────────────────────────────
app.use('/api/sites/:slug/keys',      keysRouter);
app.use('/api/sites/:slug/analytics', analyticsRouter);
app.use('/api/sites/:slug/webhooks',  webhooksRouter);
app.use('/api/sites',                 sitesRouter);
app.use('/api/analytics',             analyticsRouter);   // global analytics
app.use('/api/audit',                 auditRouter);

// ── Per-site MCP + discovery endpoints (with rate limiting) ───────────────────
app.use('/sites/:slug', rateLimitMcp, mcpRouter);

// ── 404 fallback ──────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({
    error_code: 'NOT_FOUND',
    message: 'Route not found.',
    retryable: false,
    hint: 'Dashboard: GET /  |  Registry: GET /registry  |  Marketplace: GET /marketplace',
  });
});

export async function startServer(): Promise<void> {
  await testConnection();
  console.log('[Server] Database connection verified.');

  startScheduler();

  app.listen(PORT, HOST, () => {
    const base = process.env.PUBLIC_BASE_URL ?? `http://${HOST}:${PORT}`;
    console.log(`\nWebBridge server running at ${base}`);
    console.log(`  Dashboard:   GET  ${base}/`);
    console.log(`  Auth:        POST ${base}/auth/login`);
    console.log(`  Registry:    GET  ${base}/registry`);
    console.log(`  Marketplace: GET  ${base}/marketplace`);
    console.log(`  Metrics:     GET  ${base}/metrics`);
    console.log(`  Site MCP:    POST ${base}/sites/{slug}/mcp`);
    console.log(`  Manifest:    GET  ${base}/sites/{slug}/agent.json`);
    console.log(`  OpenAPI:     GET  ${base}/sites/{slug}/openapi.json`);
    console.log(`  Mgmt API:    GET  ${base}/api/sites`);
    console.log(`  Health:      GET  ${base}/health\n`);
  });
}

export default app;
