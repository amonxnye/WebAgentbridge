import { createHmac } from 'crypto';
import { query, queryOne } from '../db/client';

export type WebhookEvent =
  | 'site.registered'
  | 'site.deleted'
  | 'crawl.started'
  | 'crawl.completed'
  | 'crawl.failed';

export interface WebhookPayload {
  event: WebhookEvent;
  timestamp: string;
  site_slug: string;
  site_id: string;
  data: Record<string, unknown>;
}

interface WebhookRow extends Record<string, unknown> {
  id: string;
  url: string;
  secret: string | null;
  events: string[];
}

interface DeliveryInsert {
  webhook_id: string;
  event_type: string;
  payload: object;
  response_status?: number;
  response_body?: string;
  delivered_at?: string;
  failed_at?: string;
  error_message?: string;
}

export async function dispatch(
  siteId: string,
  event: WebhookEvent,
  data: Record<string, unknown>
): Promise<void> {
  // Load active webhooks subscribed to this event for this site (or site-less org webhooks)
  const hooks = await query<WebhookRow>(
    `SELECT id, url, secret, events
     FROM webhooks
     WHERE is_active = true
       AND (site_id = $1 OR site_id IS NULL)
       AND $2 = ANY(events)`,
    [siteId, event]
  );

  if (hooks.length === 0) return;

  // Build site slug for payload
  const siteRow = await queryOne<{ slug: string }>(
    'SELECT slug FROM sites WHERE id = $1',
    [siteId]
  );
  const siteSlug = siteRow?.slug ?? siteId;

  const payload: WebhookPayload = {
    event,
    timestamp: new Date().toISOString(),
    site_slug: siteSlug,
    site_id: siteId,
    data,
  };

  // Deliver each webhook concurrently and log aggregate failures
  const results = await Promise.allSettled(hooks.map((hook) => deliverWebhook(hook, payload)));
  const failCount = results.filter((r) => r.status === 'rejected').length;
  if (failCount > 0) {
    console.warn(`[Dispatcher] ${failCount}/${hooks.length} webhook(s) failed to deliver for event "${event}"`);
  }
}

async function deliverWebhook(
  hook: WebhookRow,
  payload: WebhookPayload
): Promise<void> {
  const body = JSON.stringify(payload);
  const delivery: DeliveryInsert = {
    webhook_id: hook.id,
    event_type: payload.event,
    payload,
  };

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'WebBridge-Webhook/1.0',
    'X-WebBridge-Event': payload.event,
    'X-WebBridge-Delivery': hook.id + '-' + Date.now(),
  };

  if (hook.secret) {
    const sig = createHmac('sha256', hook.secret).update(body).digest('hex');
    headers['X-WebBridge-Signature'] = `sha256=${sig}`;
  }

  try {
    const res = await fetch(hook.url, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(10000),
    });

    const responseBody = await res.text().catch(() => '');
    delivery.response_status = res.status;
    delivery.response_body = responseBody.slice(0, 500);

    if (res.ok) {
      delivery.delivered_at = new Date().toISOString();
      console.log(`[Webhook] ✓ ${payload.event} → ${hook.url} (${res.status})`);
    } else {
      delivery.failed_at = new Date().toISOString();
      delivery.error_message = `HTTP ${res.status}`;
      console.warn(`[Webhook] ✗ ${payload.event} → ${hook.url} (${res.status})`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    delivery.failed_at = new Date().toISOString();
    delivery.error_message = msg;
    // Capture the error in response_body so it's visible in the delivery log
    delivery.response_body = `Error: ${msg}`.slice(0, 500);
    console.warn(`[Webhook] ✗ ${payload.event} → ${hook.url}: ${msg}`);
  }

  // Log delivery attempt
  await query(
    `INSERT INTO webhook_deliveries
       (webhook_id, event_type, payload, response_status, response_body,
        delivered_at, failed_at, error_message)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      delivery.webhook_id,
      delivery.event_type,
      JSON.stringify(delivery.payload),
      delivery.response_status ?? null,
      delivery.response_body ?? null,
      delivery.delivered_at ?? null,
      delivery.failed_at ?? null,
      delivery.error_message ?? null,
    ]
  ).catch(() => {}); // never block the pipeline on logging failures

  // Update last_triggered on webhook
  await query(
    'UPDATE webhooks SET last_triggered = NOW() WHERE id = $1',
    [hook.id]
  ).catch(() => {});
}
