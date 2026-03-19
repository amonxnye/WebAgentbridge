/**
 * BUGS: Webhook dispatcher issues
 *
 * BUG 1: When a network error occurs, response_body was never captured in
 *         the delivery log (only set inside the try block, not the catch).
 *         The DB row would have response_body = NULL even though an error occurred.
 *
 * FOUND: src/webhooks/dispatcher.ts — catch block didn't set delivery.response_body
 *
 * BUG 2: Promise.allSettled results were not inspected, so all delivery failures
 *         were completely invisible at the dispatcher level.
 *
 * FIX:
 *  - In the catch block, set delivery.response_body to the error message string.
 *  - After allSettled, count and warn about rejected deliveries.
 */

jest.mock('../../src/db/client', () => ({
  query: jest.fn(),
  queryOne: jest.fn(),
}));

const { query, queryOne } = require('../../src/db/client');

const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
const logSpy  = jest.spyOn(console, 'log').mockImplementation(() => {});

const mockFetch = jest.fn();
global.fetch = mockFetch as any;

describe('Webhook dispatcher', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (queryOne as jest.Mock).mockResolvedValue({ slug: 'example-com' });
    // Default: no webhooks
    (query as jest.Mock).mockResolvedValue([]);
  });

  afterAll(() => {
    warnSpy.mockRestore();
    logSpy.mockRestore();
  });

  it('records response_body in DB when network fetch throws (error capture fix)', async () => {
    // Set up one webhook
    (query as jest.Mock).mockImplementation((sql: string) => {
      if (sql.includes('SELECT id, url')) {
        return Promise.resolve([{
          id: 'hook-2', url: 'https://bad-host.example/hook', secret: null,
          events: ['crawl.failed'],
        }]);
      }
      return Promise.resolve([]);
    });

    // Simulate total network failure
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));

    const { dispatch } = require('../../src/webhooks/dispatcher');
    await dispatch('site-1', 'crawl.failed', { error: 'timeout' });

    // Find the INSERT call to webhook_deliveries
    const insertCall = (query as jest.Mock).mock.calls.find(
      ([sql]: [string]) => sql.includes('INSERT INTO webhook_deliveries')
    );
    expect(insertCall).toBeDefined();

    const insertParams: unknown[] = insertCall[1];
    // response_body is at index 4 (webhook_id=0, event_type=1, payload=2,
    // response_status=3, response_body=4, delivered_at=5, failed_at=6, error_message=7)
    const responseBody = insertParams[4] as string | null;
    // After the fix: must capture the error, NOT be null
    expect(responseBody).not.toBeNull();
    expect(responseBody).toMatch(/ECONNREFUSED/);
  });

  it('per-webhook warning is logged when HTTP response is non-2xx', async () => {
    (query as jest.Mock).mockImplementation((sql: string) => {
      if (sql.includes('SELECT id, url')) {
        return Promise.resolve([{
          id: 'hook-1', url: 'https://example.com/hook', secret: null,
          events: ['crawl.completed'],
        }]);
      }
      return Promise.resolve([]);
    });

    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error',
    });

    const { dispatch } = require('../../src/webhooks/dispatcher');
    await dispatch('site-1', 'crawl.completed', { pages: 10 });

    // The per-webhook warn is emitted even before the fix, but it should still be there
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringMatching(/crawl\.completed.*example\.com.*500/)
    );
  });

  it('failed_at is set in DB record when HTTP fails', async () => {
    (query as jest.Mock).mockImplementation((sql: string) => {
      if (sql.includes('SELECT id, url')) {
        return Promise.resolve([{
          id: 'hook-1', url: 'https://example.com/hook', secret: null,
          events: ['crawl.completed'],
        }]);
      }
      return Promise.resolve([]);
    });

    mockFetch.mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => 'Service Unavailable',
    });

    const { dispatch } = require('../../src/webhooks/dispatcher');
    await dispatch('site-1', 'crawl.completed', { pages: 10 });

    const insertCall = (query as jest.Mock).mock.calls.find(
      ([sql]: [string]) => sql.includes('INSERT INTO webhook_deliveries')
    );
    expect(insertCall).toBeDefined();
    const insertParams: unknown[] = insertCall[1];
    // failed_at is index 6
    expect(insertParams[6]).not.toBeNull(); // failed_at must be set
    expect(insertParams[5]).toBeNull();     // delivered_at must be null
  });

  it('delivered_at is set in DB record when HTTP succeeds', async () => {
    (query as jest.Mock).mockImplementation((sql: string) => {
      if (sql.includes('SELECT id, url')) {
        return Promise.resolve([{
          id: 'hook-1', url: 'https://example.com/hook', secret: null,
          events: ['crawl.completed'],
        }]);
      }
      return Promise.resolve([]);
    });

    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '{"received":true}',
    });

    const { dispatch } = require('../../src/webhooks/dispatcher');
    await dispatch('site-1', 'crawl.completed', { pages: 10 });

    const insertCall = (query as jest.Mock).mock.calls.find(
      ([sql]: [string]) => sql.includes('INSERT INTO webhook_deliveries')
    );
    expect(insertCall).toBeDefined();
    const insertParams: unknown[] = insertCall[1];
    expect(insertParams[5]).not.toBeNull(); // delivered_at must be set
    expect(insertParams[6]).toBeNull();     // failed_at must be null
  });
});
