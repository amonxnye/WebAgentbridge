import { Router } from 'express';
import { query } from '../db/client';

const router = Router();

// ── Prometheus text format helpers ────────────────────────────────────────────
function gauge(name: string, help: string, value: number, labels?: Record<string, string>): string {
  const labelStr = labels
    ? '{' + Object.entries(labels).map(([k, v]) => `${k}="${v}"`).join(',') + '}'
    : '';
  return `# HELP ${name} ${help}\n# TYPE ${name} gauge\n${name}${labelStr} ${value}\n`;
}

// ── GET /metrics ──────────────────────────────────────────────────────────────
router.get('/', async (_req, res) => {
  try {
    const [siteStats, reqStats, crawlStats] = await Promise.all([
      // Sites by status
      query<{ status: string; count: string }>(
        `SELECT status, COUNT(*)::text AS count FROM sites GROUP BY status`
      ),
      // Requests in last 24h by response_status bucket
      query<{ bucket: string; count: string }>(
        `SELECT
           CASE WHEN response_status < 400 THEN '2xx_3xx'
                WHEN response_status < 500 THEN '4xx'
                ELSE '5xx' END AS bucket,
           COUNT(*)::text AS count
         FROM request_logs
         WHERE created_at >= NOW() - INTERVAL '24 hours'
         GROUP BY bucket`
      ),
      // Avg crawl duration by status
      query<{ duration_avg: string; count: string }>(
        `SELECT
           AVG(duration_ms)::text AS duration_avg,
           COUNT(*)::text AS count
         FROM request_logs
         WHERE created_at >= NOW() - INTERVAL '24 hours'`
      ),
    ]);

    let out = '';

    // webbridge_sites_total{status="ready"} 5
    out += '# HELP webbridge_sites_total Number of registered sites by status\n';
    out += '# TYPE webbridge_sites_total gauge\n';
    for (const row of siteStats) {
      out += `webbridge_sites_total{status="${row.status}"} ${row.count}\n`;
    }
    out += '\n';

    // webbridge_mcp_requests_24h_total
    out += '# HELP webbridge_mcp_requests_24h_total MCP requests in the last 24 hours by outcome\n';
    out += '# TYPE webbridge_mcp_requests_24h_total gauge\n';
    for (const row of reqStats) {
      out += `webbridge_mcp_requests_24h_total{outcome="${row.bucket}"} ${row.count}\n`;
    }
    out += '\n';

    // webbridge_mcp_avg_duration_ms
    const avgDuration = crawlStats[0]?.duration_avg ?? '0';
    out += gauge('webbridge_mcp_avg_duration_ms', 'Average MCP request duration in ms (24h)', parseFloat(avgDuration));
    out += '\n';

    // webbridge_mcp_total_requests_24h
    const totalReq = crawlStats[0]?.count ?? '0';
    out += gauge('webbridge_mcp_total_requests_24h', 'Total MCP requests in the last 24 hours', parseInt(totalReq, 10));
    out += '\n';

    // process uptime
    out += gauge('webbridge_uptime_seconds', 'Process uptime in seconds', Math.floor(process.uptime()));

    res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    res.send(out);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'error';
    res.status(500).send(`# Error generating metrics: ${msg}\n`);
  }
});

export default router;
