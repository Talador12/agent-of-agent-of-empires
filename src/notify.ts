import type { AoaoeConfig, NotificationEvent } from "./types.js";

// payload sent to both generic webhook and Slack webhook
export interface NotificationPayload {
  event: NotificationEvent;
  timestamp: number;
  session?: string;   // session title or ID
  detail?: string;    // human-readable detail (error message, action summary, etc.)
}

// send a notification to all configured webhooks.
// fire-and-forget: never throws, never blocks the daemon.
export async function sendNotification(config: AoaoeConfig, payload: NotificationPayload): Promise<void> {
  const n = config.notifications;
  if (!n) return;

  // filter: only send if event is in the configured list (or no filter = send all)
  if (n.events && n.events.length > 0 && !n.events.includes(payload.event)) return;

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
