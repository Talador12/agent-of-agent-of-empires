// api-webhook-push.ts — push fleet events to external URLs on configurable triggers.
// registers webhook subscriptions with URL + event filter + optional secret for
// HMAC signing. delivers payloads via native fetch with retry + backoff.
// zero dependencies.

import { createHmac } from "node:crypto";

/** webhook subscription */
export interface WebhookSubscription {
  id: string;
  url: string;
  events: string[];         // event types to match ("*" for all)
  secret?: string;          // HMAC-SHA256 signing secret
  enabled: boolean;
  createdAt: number;
  deliveries: number;
  failures: number;
  lastDeliveryAt: number;
  lastError?: string;
}

/** delivery result */
export interface DeliveryResult {
  subscriptionId: string;
  url: string;
  status: number | null;    // HTTP status or null on network error
  success: boolean;
  durationMs: number;
  error?: string;
}

/** webhook payload sent to subscribers */
export interface WebhookPayload {
  event: string;
  timestamp: number;
  data: unknown;
  daemon: string;           // daemon identifier
}

/** webhook push state */
export interface WebhookPushState {
  subscriptions: WebhookSubscription[];
  nextId: number;
  totalDeliveries: number;
  totalFailures: number;
  maxRetries: number;
  retryBaseMs: number;
}

/** create webhook push state */
export function createWebhookPush(maxRetries = 2, retryBaseMs = 1000): WebhookPushState {
  return {
    subscriptions: [],
    nextId: 1,
    totalDeliveries: 0,
    totalFailures: 0,
    maxRetries,
    retryBaseMs,
  };
}

/** add a webhook subscription */
export function addWebhook(
  state: WebhookPushState,
  url: string,
  events: string[] = ["*"],
  secret?: string,
  now = Date.now(),
): WebhookSubscription {
  const sub: WebhookSubscription = {
    id: `wh-${state.nextId++}`,
    url,
    events,
    secret,
    enabled: true,
    createdAt: now,
    deliveries: 0,
    failures: 0,
    lastDeliveryAt: 0,
  };
  state.subscriptions.push(sub);
  return sub;
}

/** remove a webhook subscription */
export function removeWebhook(state: WebhookPushState, id: string): boolean {
  const idx = state.subscriptions.findIndex((s) => s.id === id);
  if (idx < 0) return false;
  state.subscriptions.splice(idx, 1);
  return true;
}

/** toggle a webhook on/off */
export function toggleWebhook(state: WebhookPushState, id: string): boolean {
  const sub = state.subscriptions.find((s) => s.id === id);
  if (!sub) return false;
  sub.enabled = !sub.enabled;
  return true;
}

/** compute HMAC-SHA256 signature for a payload */
export function signPayload(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

/** find subscriptions matching an event type */
export function matchSubscriptions(state: WebhookPushState, eventType: string): WebhookSubscription[] {
  return state.subscriptions.filter(
    (s) => s.enabled && (s.events.includes("*") || s.events.includes(eventType)),
  );
}

/** build webhook payload */
export function buildPayload(event: string, data: unknown, daemonId = "aoaoe", now = Date.now()): WebhookPayload {
  return { event, timestamp: now, data, daemon: daemonId };
}

/** deliver a payload to a single subscription (with retry). returns result. */
export async function deliverWebhook(
  sub: WebhookSubscription,
  payload: WebhookPayload,
  maxRetries: number,
  retryBaseMs: number,
): Promise<DeliveryResult> {
  const body = JSON.stringify(payload);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "aoaoe-webhook/1.0",
    "X-Webhook-Event": payload.event,
    "X-Webhook-Timestamp": String(payload.timestamp),
  };
  if (sub.secret) {
    headers["X-Webhook-Signature"] = `sha256=${signPayload(body, sub.secret)}`;
  }

  const start = Date.now();
  let lastError: string | undefined;
  let lastStatus: number | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      // exponential backoff
      await new Promise((r) => setTimeout(r, retryBaseMs * Math.pow(2, attempt - 1)));
    }
    try {
      const res = await fetch(sub.url, {
        method: "POST",
        headers,
        body,
        signal: AbortSignal.timeout(10_000),
      });
      lastStatus = res.status;
      if (res.ok) {
        sub.deliveries++;
        sub.lastDeliveryAt = Date.now();
        return {
          subscriptionId: sub.id,
          url: sub.url,
          status: res.status,
          success: true,
          durationMs: Date.now() - start,
        };
      }
      lastError = `HTTP ${res.status}`;
    } catch (err: any) {
      lastError = err.message ?? String(err);
    }
  }

  // all retries exhausted
  sub.failures++;
  sub.lastError = lastError;
  return {
    subscriptionId: sub.id,
    url: sub.url,
    status: lastStatus,
    success: false,
    durationMs: Date.now() - start,
    error: lastError,
  };
}

/** push an event to all matching subscriptions (fire-and-forget) */
export function pushEvent(
  state: WebhookPushState,
  event: string,
  data: unknown,
  daemonId = "aoaoe",
): void {
  const subs = matchSubscriptions(state, event);
  if (subs.length === 0) return;

  const payload = buildPayload(event, data, daemonId);
  for (const sub of subs) {
    state.totalDeliveries++;
    deliverWebhook(sub, payload, state.maxRetries, state.retryBaseMs).then((result) => {
      if (!result.success) state.totalFailures++;
    }).catch(() => {
      state.totalFailures++;
    });
  }
}

/** format webhook push state for TUI display */
export function formatWebhookPush(state: WebhookPushState): string[] {
  const lines: string[] = [];
  lines.push(`webhook push: ${state.subscriptions.length} subscriptions, ${state.totalDeliveries} deliveries, ${state.totalFailures} failures`);

  for (const s of state.subscriptions) {
    const status = s.enabled ? "active" : "disabled";
    const events = s.events.join(", ");
    const errStr = s.lastError ? ` (last error: ${s.lastError})` : "";
    lines.push(`  ${s.id} [${status}] ${s.url}`);
    lines.push(`    events: ${events} | delivered: ${s.deliveries} | failed: ${s.failures}${errStr}`);
  }

  return lines;
}
