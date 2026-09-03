/**
 * Vercel serverless entry point.
 *
 * Exports the Express app as the default export so Vercel treats it as a
 * serverless function handler. No app.listen() is called here — Vercel manages
 * the HTTP lifecycle.
 *
 * Limitations in serverless:
 *  - The BullMQ worker and auto re-crawl scheduler cannot run (no persistent
 *    process). Use Vercel Cron Jobs or an external worker to trigger re-crawls.
 *  - Playwright-based live search proxying requires a long-running environment.
 *    On Vercel, all stored/snapshot-based MCP tools work fine; live-proxy tools
 *    will time out on the Hobby plan (10 s limit).
 */
import dotenv from 'dotenv';
dotenv.config();

export { default } from '../src/server';
