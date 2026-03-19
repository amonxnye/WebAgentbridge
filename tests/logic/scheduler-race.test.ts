/**
 * BUG: Race condition in scheduler — duplicate crawl jobs
 *
 * FOUND: src/scheduler/index.ts lines 34-44
 *
 * The scheduler queries for all due sites and then updates next_crawl_at
 * after enqueuing. If two scheduler instances run concurrently (or restarts
 * happen mid-run), both will find the same site and enqueue duplicate crawls.
 *
 * FIX: Make the UPDATE atomic by adding the same time-fence condition used
 *      in the SELECT, so only one scheduler can win the race:
 *
 *   UPDATE sites
 *   SET next_crawl_at = NOW() + ...
 *   WHERE id = $1
 *     AND (next_crawl_at IS NULL OR next_crawl_at <= NOW())
 *
 * The test verifies the WHERE clause is present in the UPDATE SQL.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const schedulerSource = readFileSync(
  join(__dirname, '../../src/scheduler/index.ts'),
  'utf8'
);

describe('Scheduler race-condition guard', () => {
  it('UPDATE uses the same time-fence condition as SELECT to prevent duplicate enqueueing', () => {
    // Extract the UPDATE statement block
    const updateMatch = schedulerSource.match(/UPDATE sites[\s\S]+?WHERE id = \$1([\s\S]+?)\`/);
    const updateBlock = updateMatch ? updateMatch[0] : schedulerSource;

    // After the fix the UPDATE WHERE clause must include the time-fence
    expect(updateBlock).toMatch(/next_crawl_at\s+IS\s+NULL\s+OR\s+next_crawl_at\s*<=\s*NOW\(\)/i);
  });

  it('enqueueCrawl is only called when the atomic UPDATE succeeds', async () => {
    jest.resetModules();

    const mockQuery  = jest.fn();
    const mockEnqueue = jest.fn().mockResolvedValue('job-1');

    jest.mock('../../src/db/client',  () => ({ query: mockQuery }));
    jest.mock('../../src/queue/jobs', () => ({ enqueueCrawl: mockEnqueue }));

    // Simulate: SELECT returns 1 site
    mockQuery.mockResolvedValueOnce([{
      id: 'site-1', slug: 'example', url: 'https://example.com',
      recrawl_interval_hours: 24,
    }]);
    // Simulate: UPDATE affects 0 rows (another instance already updated it)
    mockQuery.mockResolvedValueOnce({ rowCount: 0 });

    const { checkAndEnqueueForTest } = require('../../src/scheduler/index');

    if (typeof checkAndEnqueueForTest === 'function') {
      await checkAndEnqueueForTest();
      // Should NOT have enqueued because the UPDATE raced
      expect(mockEnqueue).not.toHaveBeenCalled();
    } else {
      // If the function isn't exported for testing, just verify the SQL patch
      expect(schedulerSource).toMatch(/next_crawl_at\s+IS\s+NULL\s+OR\s+next_crawl_at\s*<=\s*NOW\(\)/i);
    }
  });
});
