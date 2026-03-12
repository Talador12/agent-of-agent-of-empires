import type { AoaoeConfig, NotificationEvent } from "./types.js";

// payload sent to both generic webhook and Slack webhook
export interface NotificationPayload {
  event: NotificationEvent;
  timestamp: number;
  session?: string;   // session title or ID
  detail?: string;    // human-readable detail (error message, action summary, etc.)
}

// ── rate limiting ───────────────────────────────────────────────────────────
// dedup key: "event:session" — prevents spam when sessions rapidly error/recover.
// default window: 60s per unique event+session combo.
const RATE_LIMIT_MS = 60_000;
const recentNotifications = new Map<string, number>(); // key → last-sent timestamp

function rateLimitKey(payload: NotificationPayload): string {
  return `${payload.event}:${payload.session ?? ""}`;
}

// exported for testing
export function isRateLimited(payload: NotificationPayload, now?: number): boolean {
  const key = rateLimitKey(payload);
  const lastSent = recentNotifications.get(key);
  const ts = now ?? Date.now();
  if (lastSent !== undefined && ts - lastSent < RATE_LIMIT_MS) return true;
  return false;
}

function recordSent(payload: NotificationPayload, now?: number): void {
  const key = rateLimitKey(payload);
  recentNotifications.set(key, now ?? Date.now());
  // prune old entries to prevent unbounded growth (keep last 200)
  if (recentNotifications.size > 200) {
    const cutoff = (now ?? Date.now()) - RATE_LIMIT_MS;
    for (const [k, v] of recentNotifications) {
      if (v < cutoff) recentNotifications.delete(k);
    }
  }
}

// exported for testing — reset rate limiter state between tests
export function resetRateLimiter(): void {
  recentNotifications.clear();
}

// send a notification to all configured webhooks.
// fire-and-forget: never throws, never blocks the daemon.
// rate-limited: suppresses duplicate event+session combos within 60s.
export async function sendNotification(config: AoaoeConfig, payload: NotificationPayload): Promise<void> {
  const n = config.notifications;
  if (!n) return;

  // filter: only send if event is in the configured list (or no filter = send all)
  if (n.events && n.events.length > 0 && !n.events.includes(payload.event)) return;

  // rate limit: skip if we sent the same event+session recently
  if (isRateLimited(payload)) return;
  recordSent(payload);

  const promises: Promise<void>[] = [];

  if (n.webhookUrl) {
    promises.push(sendGenericWebhook(n.webhookUrl, payload));
  }
  if (n.slackWebhookUrl) {
    promises.push(sendSlackWebhook(n.slackWebhookUrl, payload));
  }

  // fire-and-forget — swallow all errors so the daemon never crashes on notification failure
  await Promise.allSettled(promises);
}

// send a test notification and return whether delivery succeeded.
// unlike sendNotification, this is NOT fire-and-forget — it reports errors.
export async function sendTestNotification(config: AoaoeConfig): Promise<{ webhookOk?: boolean; slackOk?: boolean; webhookError?: string; slackError?: string }> {
  const n = config.notifications;
  if (!n) return {};

  const payload: NotificationPayload = {
    event: "daemon_started",
    timestamp: Date.now(),
    detail: "test notification from aoaoe notify-test",
  };

  const result: { webhookOk?: boolean; slackOk?: boolean; webhookError?: string; slackError?: string } = {};

  if (n.webhookUrl) {
    try {
      const resp = await fetch(n.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event: payload.event, timestamp: payload.timestamp, detail: payload.detail }),
        signal: AbortSignal.timeout(10_000),
      });
      result.webhookOk = resp.ok;
      if (!resp.ok) result.webhookError = `HTTP ${resp.status} ${resp.statusText}`;
    } catch (err) {
      result.webhookOk = false;
      result.webhookError = String(err);
    }
  }

  if (n.slackWebhookUrl) {
    try {
      const body = formatSlackPayload(payload);
      const resp = await fetch(n.slackWebhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });
      result.slackOk = resp.ok;
      if (!resp.ok) result.slackError = `HTTP ${resp.status} ${resp.statusText}`;
    } catch (err) {
      result.slackOk = false;
      result.slackError = String(err);
    }
  }

  return result;
}

// POST JSON payload to a generic webhook URL
async function sendGenericWebhook(url: string, payload: NotificationPayload): Promise<void> {
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: payload.event,
        timestamp: payload.timestamp,
        session: payload.session,
        detail: payload.detail,
      }),
      signal: AbortSignal.timeout(5000),
    });
  } catch (err) {
    console.error(`[notify] generic webhook failed: ${err}`);
  }
}

// POST Slack block format to a Slack incoming webhook URL
async function sendSlackWebhook(url: string, payload: NotificationPayload): Promise<void> {
  try {
    const body = formatSlackPayload(payload);
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
  } catch (err) {
    console.error(`[notify] slack webhook failed: ${err}`);
  }
}

// format a notification payload into Slack block kit format.
// exported for testing.
export function formatSlackPayload(payload: NotificationPayload): { text: string; blocks: object[] } {
  const icon = eventIcon(payload.event);
  const title = eventTitle(payload.event);
  const fallbackText = payload.session
    ? `${icon} ${title}: ${payload.session}${payload.detail ? ` — ${payload.detail}` : ""}`
    : `${icon} ${title}${payload.detail ? ` — ${payload.detail}` : ""}`;

  const blocks: object[] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${icon} ${title}*${payload.session ? `\n*Session:* ${payload.session}` : ""}${payload.detail ? `\n${payload.detail}` : ""}`,
      },
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `aoaoe | ${new Date(payload.timestamp).toISOString()}`,
        },
      ],
    },
  ];

  return { text: fallbackText, blocks };
}

// human-readable title for each event type
function eventTitle(event: NotificationEvent): string {
  switch (event) {
    case "session_error": return "Session Error";
    case "session_done": return "Session Done";
    case "action_executed": return "Action Executed";
    case "action_failed": return "Action Failed";
    case "daemon_started": return "Daemon Started";
    case "daemon_stopped": return "Daemon Stopped";
  }
}

// emoji icon for each event type (used in Slack messages)
function eventIcon(event: NotificationEvent): string {
  switch (event) {
    case "session_error": return "\u{1F6A8}";     // 🚨
    case "session_done": return "\u2705";          // ✅
    case "action_executed": return "\u2699\uFE0F"; // ⚙️
    case "action_failed": return "\u274C";         // ❌
    case "daemon_started": return "\u{1F680}";     // 🚀
    case "daemon_stopped": return "\u{1F6D1}";     // 🛑
  }
}
