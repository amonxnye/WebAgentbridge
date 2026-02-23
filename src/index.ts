import dotenv from 'dotenv';
dotenv.config();

import { startServer } from './server';

startServer().catch((err) => {
  console.error('[Startup] Failed to start server:', err instanceof Error ? err.message : err);
  process.exit(1);
});
