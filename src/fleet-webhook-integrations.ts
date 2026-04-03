// fleet-webhook-integrations.ts — format fleet events as Slack, Teams,
// and Discord webhook payloads. templates for common notifications:
// goal completed, error alert, shift handoff, daily digest.

export type WebhookPlatform = "slack" | "teams" | "discord" | "generic";

export interface WebhookPayload {
  platform: WebhookPlatform;
  body: Record<string, unknown>;
  contentType: string;
}

export interface WebhookEvent {
  type: "goal-completed" | "error-alert" | "shift-handoff" | "daily-digest" | "custom";
  title: string;
  message: string;
  severity?: "info" | "warning" | "error";
  fields?: Array<{ label: string; value: string }>;
}

/**
 * Format a webhook event for Slack Block Kit.
 */
export function formatSlack(event: WebhookEvent): WebhookPayload {
  const color = event.severity === "error" ? "#ff0000" : event.severity === "warning" ? "#ffcc00" : "#36a64f";
  const fields = (event.fields ?? []).map((f) => ({ type: "mrkdwn", text: `*${f.label}*\n${f.value}` }));
  return {
    platform: "slack",
    contentType: "application/json",
    body: {
      attachments: [{
        color,
        blocks: [
          { type: "header", text: { type: "plain_text", text: event.title } },
          { type: "section", text: { type: "mrkdwn", text: event.message } },
          ...(fields.length > 0 ? [{ type: "section", fields }] : []),
        ],
      }],
    },
  };
}

/**
 * Format a webhook event for Microsoft Teams Adaptive Card.
 */
export function formatTeams(event: WebhookEvent): WebhookPayload {
  const color = event.severity === "error" ? "attention" : event.severity === "warning" ? "warning" : "good";
  const facts = (event.fields ?? []).map((f) => ({ title: f.label, value: f.value }));
  return {
    platform: "teams",
    contentType: "application/json",
    body: {
      type: "message",
      attachments: [{
        contentType: "application/vnd.microsoft.card.adaptive",
        content: {
          type: "AdaptiveCard", version: "1.4",
          body: [
            { type: "TextBlock", text: event.title, weight: "bolder", size: "medium", color },
            { type: "TextBlock", text: event.message, wrap: true },
            ...(facts.length > 0 ? [{ type: "FactSet", facts }] : []),
          ],
        },
      }],
    },
  };
}

/**
 * Format a webhook event for Discord embed.
 */
export function formatDiscord(event: WebhookEvent): WebhookPayload {
  const color = event.severity === "error" ? 0xff0000 : event.severity === "warning" ? 0xffcc00 : 0x36a64f;
  const fields = (event.fields ?? []).map((f) => ({ name: f.label, value: f.value, inline: true }));
  return {
    platform: "discord",
    contentType: "application/json",
    body: { embeds: [{ title: event.title, description: event.message, color, fields }] },
  };
}

/**
 * Format for generic JSON webhook.
 */
export function formatGeneric(event: WebhookEvent): WebhookPayload {
  return {
    platform: "generic",
    contentType: "application/json",
    body: { type: event.type, title: event.title, message: event.message, severity: event.severity, fields: event.fields, timestamp: new Date().toISOString() },
  };
}

/**
 * Format for any platform.
 */
export function formatWebhook(event: WebhookEvent, platform: WebhookPlatform): WebhookPayload {
  switch (platform) {
    case "slack": return formatSlack(event);
    case "teams": return formatTeams(event);
    case "discord": return formatDiscord(event);
    default: return formatGeneric(event);
  }
}

/**
 * Format webhook config for TUI display.
 */
export function formatWebhookPreview(event: WebhookEvent, platform: WebhookPlatform): string[] {
  const payload = formatWebhook(event, platform);
  const json = JSON.stringify(payload.body, null, 2).split("\n").slice(0, 8);
  return [
    `  Webhook Preview [${platform}] (${payload.contentType}):`,
    ...json.map((l) => `    ${l}`),
    json.length < JSON.stringify(payload.body, null, 2).split("\n").length ? "    ..." : "",
  ].filter(Boolean);
}
