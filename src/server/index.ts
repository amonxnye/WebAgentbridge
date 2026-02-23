import express from 'express';
import dotenv from 'dotenv';
import mcpRouter from './routes/mcp';
import registryRouter from './routes/registry';
import { testConnection } from '../db/client';

dotenv.config();

const app = express();
const PORT = parseInt(process.env.PORT ?? '3000', 10);
const HOST = process.env.HOST ?? '0.0.0.0';

app.use(express.json({ limit: '1mb' }));

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', version: '1.0.0', timestamp: new Date().toISOString() });
});

// ── Public registry ───────────────────────────────────────────────────────────
app.use('/registry', registryRouter);

// ── Per-site MCP routes ───────────────────────────────────────────────────────
app.use('/sites/:slug', mcpRouter);

// ── 404 fallback ──────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({
    error_code: 'NOT_FOUND',
    message: 'Route not found.',
    retryable: false,
    hint: 'See GET /registry for available sites.',
  });
});

export async function startServer(): Promise<void> {
  await testConnection();
  console.log('[Server] Database connection verified.');

  app.listen(PORT, HOST, () => {
    const base = process.env.PUBLIC_BASE_URL ?? `http://${HOST}:${PORT}`;
    console.log(`\nWebBridge server running at ${base}`);
    console.log(`  Registry:  GET  ${base}/registry`);
    console.log(`  Site MCP:  POST ${base}/sites/{slug}/mcp`);
    console.log(`  Manifest:  GET  ${base}/sites/{slug}/agent.json`);
    console.log(`  OpenAPI:   GET  ${base}/sites/{slug}/openapi.json`);
    console.log(`  Health:    GET  ${base}/health\n`);
  });
}

export default app;
