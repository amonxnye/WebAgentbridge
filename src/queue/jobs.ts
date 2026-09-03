import { Queue, QueueOptions } from 'bullmq';
import IORedis from 'ioredis';
import type { CrawlJobPayload } from '../types';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

export const CRAWL_QUEUE_NAME = 'webbridge:crawl';

let connection: IORedis | null = null;

export function getRedisConnection(): IORedis {
  if (!connection) {
    connection = new IORedis(REDIS_URL, {
      maxRetriesPerRequest: null, // required by BullMQ
      enableReadyCheck: false,
    });
    connection.on('error', (err) => {
      console.warn('[Queue] Redis connection error:', err.message);
    });
  }
  return connection;
}

let crawlQueue: Queue<CrawlJobPayload> | null = null;

export function getCrawlQueue(): Queue<CrawlJobPayload> {
  if (!crawlQueue) {
    crawlQueue = new Queue<CrawlJobPayload>(CRAWL_QUEUE_NAME, {
      connection: getRedisConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    });
  }
  return crawlQueue;
}

export async function enqueueCrawl(payload: CrawlJobPayload): Promise<string> {
  const queue = getCrawlQueue();
  const job = await queue.add('crawl', payload, {
    jobId: `crawl:${payload.siteId}`,
  });
  return job.id ?? payload.siteId;
}
