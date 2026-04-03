import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { formatSlack, formatTeams, formatDiscord, formatGeneric, formatWebhook, formatWebhookPreview } from "./fleet-webhook-integrations.js";
import type { WebhookEvent } from "./fleet-webhook-integrations.js";

const EVENT: WebhookEvent = {
  type: "goal-completed", title: "Goal Shipped", message: "alpha completed: build auth",
  severity: "info", fields: [{ label: "Session", value: "alpha" }, { label: "Cost", value: "$5.50" }],
};

describe("formatSlack", () => {
  it("produces Slack Block Kit payload", () => {
    const p = formatSlack(EVENT);
    assert.equal(p.platform, "slack");
    assert.equal(p.contentType, "application/json");
    assert.ok((p.body as any).attachments);
    assert.ok((p.body as any).attachments[0].blocks.length >= 2);
  });

  it("uses red color for errors", () => {
    const p = formatSlack({ ...EVENT, severity: "error" });
    assert.equal((p.body as any).attachments[0].color, "#ff0000");
  });
});

describe("formatTeams", () => {
  it("produces Teams Adaptive Card", () => {
    const p = formatTeams(EVENT);
    assert.equal(p.platform, "teams");
    assert.ok((p.body as any).attachments[0].content.body.length >= 2);
  });
});

describe("formatDiscord", () => {
  it("produces Discord embed", () => {
    const p = formatDiscord(EVENT);
    assert.equal(p.platform, "discord");
    assert.ok((p.body as any).embeds[0].title === "Goal Shipped");
    assert.ok((p.body as any).embeds[0].fields.length === 2);
  });

  it("uses correct color for severity", () => {
    const errP = formatDiscord({ ...EVENT, severity: "error" });
    assert.equal((errP.body as any).embeds[0].color, 0xff0000);
  });
});

describe("formatGeneric", () => {
  it("produces generic JSON", () => {
    const p = formatGeneric(EVENT);
    assert.equal(p.platform, "generic");
    assert.equal((p.body as any).type, "goal-completed");
    assert.ok((p.body as any).timestamp);
  });
});

describe("formatWebhook", () => {
  it("dispatches to correct platform", () => {
    assert.equal(formatWebhook(EVENT, "slack").platform, "slack");
    assert.equal(formatWebhook(EVENT, "teams").platform, "teams");
    assert.equal(formatWebhook(EVENT, "discord").platform, "discord");
    assert.equal(formatWebhook(EVENT, "generic").platform, "generic");
  });
});

describe("formatWebhookPreview", () => {
  it("shows preview with platform label", () => {
    const lines = formatWebhookPreview(EVENT, "slack");
    assert.ok(lines[0].includes("slack"));
    assert.ok(lines[0].includes("Webhook Preview"));
  });
});
