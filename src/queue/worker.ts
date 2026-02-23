import dotenv from 'dotenv';
dotenv.config();

import { Worker } from 'bullmq';
import { CRAWL_QUEUE_NAME, getRedisConnection } from './jobs';
import { runIngestion } from '../ingestion/pipeline';
import type { CrawlJobPayload } from '../types';

console.log('[Worker] Starting WebBridge crawl worker...');

const worker = new Worker<CrawlJobPayload>(
  CRAWL_QUEUE_NAME,
  async (job) => {
    const { siteId, siteSlug, siteUrl } = job.data;
    console.log(`[Worker] Processing crawl job for site: ${siteSlug} (${siteUrl})`);

    await job.updateProgress(5);
    const result = await runIngestion(siteId);
    await job.updateProgress(100);

    return result;
  },
  {
    connection: getRedisConnection(),
    concurrency: 3,
  }
);

worker.on('completed', (job) => {
  console.log(`[Worker] ✓ Job ${job.id} completed — site: ${job.data.siteSlug}`);
});

worker.on('failed', (job, err) => {
  console.error(`[Worker] ✗ Job ${job?.id} failed — site: ${job?.data.siteSlug}: ${err.message}`);
});

worker.on('error', (err) => {
  console.error('[Worker] Worker error:', err.message);
});

process.on('SIGTERM', async () => {
  console.log('[Worker] Shutting down...');
  await worker.close();
  process.exit(0);
});

console.log('[Worker] Waiting for crawl jobs...');
