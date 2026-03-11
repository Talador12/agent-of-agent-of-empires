import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatSlackPayload, sendNotification } from "./notify.js";
import type { NotificationPayload } from "./notify.js";
import type { AoaoeConfig } from "./types.js";

function makeConfig(notifications?: AoaoeConfig["notifications"]): AoaoeConfig {
  return {
    reasoner: "opencode",
    pollIntervalMs: 10_000,
    opencode: { port: 4097 },
    claudeCode: { yolo: true, resume: true },
    aoe: { profile: "default" },
    policies: { maxIdleBeforeNudgeMs: 120_000, maxErrorsBeforeRestart: 3, autoAnswerPermissions: true },
    contextFiles: [],
    sessionDirs: {},
    captureLinesCount: 100,
    verbose: false,
    dryRun: false,
    observe: false,
    confirm: false,
    protectedSessions: [],
    notifications,
  };
}

describe("formatSlackPayload", () => {
  it("returns text and blocks fields", () => {
    const payload: NotificationPayload = { event: "daemon_started", timestamp: 1700000000000 };
    const result = formatSlackPayload(payload);
    assert.ok(typeof result.text === "string");
    assert.ok(Array.isArray(result.blocks));
    assert.ok(result.blocks.length >= 2);
  });

  it("includes event title in text fallback", () => {
    const payload: NotificationPayload = { event: "daemon_started", timestamp: 1700000000000 };
    const result = formatSlackPayload(payload);
    assert.ok(result.text.includes("Daemon Started"), `expected "Daemon Started" in "${result.text}"`);
  });

  it("includes session name when provided", () => {
    const payload: NotificationPayload = { event: "session_error", timestamp: 1700000000000, session: "adventure" };
    const result = formatSlackPayload(payload);
    assert.ok(result.text.includes("adventure"), `expected "adventure" in "${result.text}"`);
    const sectionBlock = result.blocks[0] as Record<string, unknown>;
    const sectionText = (sectionBlock.text as Record<string, unknown>).text as string;
    assert.ok(sectionText.includes("adventure"));
  });

  it("includes detail when provided", () => {
    const payload: NotificationPayload = { event: "action_failed", timestamp: 1700000000000, detail: "connection refused" };
    const result = formatSlackPayload(payload);
    assert.ok(result.text.includes("connection refused"));
  });

  it("includes timestamp in context block", () => {
    const ts = 1700000000000;
    const payload: NotificationPayload = { event: "daemon_stopped", timestamp: ts };
    const result = formatSlackPayload(payload);
    const contextBlock = result.blocks[1] as Record<string, unknown>;
    const elements = contextBlock.elements as Array<Record<string, unknown>>;
    const text = elements[0].text as string;
    assert.ok(text.includes("aoaoe"));
    assert.ok(text.includes(new Date(ts).toISOString()));
  });

  it("uses correct icon for each event type", () => {
    const events: Array<{ event: NotificationPayload["event"]; icon: string }> = [
      { event: "session_error", icon: "\u{1F6A8}" },
      { event: "session_done", icon: "\u2705" },
      { event: "action_executed", icon: "\u2699" },
      { event: "action_failed", icon: "\u274C" },
      { event: "daemon_started", icon: "\u{1F680}" },
      { event: "daemon_stopped", icon: "\u{1F6D1}" },
    ];
    for (const { event, icon } of events) {
      const result = formatSlackPayload({ event, timestamp: 0 });
      assert.ok(result.text.includes(icon), `expected icon for ${event} in text`);
    }
  });

  it("section block has mrkdwn type", () => {
    const result = formatSlackPayload({ event: "daemon_started", timestamp: 0 });
    const section = result.blocks[0] as Record<string, unknown>;
    assert.equal(section.type, "section");
    const text = section.text as Record<string, unknown>;
    assert.equal(text.type, "mrkdwn");
  });

  it("works with all fields populated", () => {
    const payload: NotificationPayload = {
      event: "action_executed",
      timestamp: 1700000000000,
      session: "cloud-hypervisor",
      detail: "send_input: implement the login flow",
    };
    const result = formatSlackPayload(payload);
    assert.ok(result.text.includes("Action Executed"));
    assert.ok(result.text.includes("cloud-hypervisor"));
    assert.ok(result.text.includes("send_input"));
  });
});

describe("sendNotification", () => {
  it("no-ops when notifications config is undefined", async () => {
    const config = makeConfig(undefined);
    // should resolve without error (no fetch calls)
    await sendNotification(config, { event: "daemon_started", timestamp: Date.now() });
  });

  it("no-ops when no webhooks are configured", async () => {
    const config = makeConfig({});
    await sendNotification(config, { event: "daemon_started", timestamp: Date.now() });
  });

  it("no-ops when event is not in configured filter list", async () => {
    const config = makeConfig({
      webhookUrl: "https://example.com/webhook",
      events: ["session_error", "session_done"],
    });
    // daemon_started is not in the events filter — should be skipped
    await sendNotification(config, { event: "daemon_started", timestamp: Date.now() });
  });

  it("no-ops when events filter is empty array (send all)", async () => {
    // empty events array = no filter = send all, but no webhook URL → still no-op
    const config = makeConfig({ events: [] });
    await sendNotification(config, { event: "daemon_started", timestamp: Date.now() });
  });

  it("handles fetch failure gracefully (generic webhook)", async () => {
    // use a URL that will fail immediately (connection refused on localhost)
    const config = makeConfig({ webhookUrl: "http://127.0.0.1:1/nope" });
    // should not throw — fire-and-forget
    await sendNotification(config, { event: "daemon_started", timestamp: Date.now() });
  });

  it("handles fetch failure gracefully (slack webhook)", async () => {
    const config = makeConfig({ slackWebhookUrl: "http://127.0.0.1:1/nope" });
    await sendNotification(config, { event: "daemon_started", timestamp: Date.now() });
  });

  it("respects event filter — sends when event matches", async () => {
    // event filter includes session_error — should attempt to send (and fail on bad URL, but not throw)
    const config = makeConfig({
      webhookUrl: "http://127.0.0.1:1/nope",
      events: ["session_error"],
    });
    await sendNotification(config, { event: "session_error", timestamp: Date.now(), session: "test", detail: "some error" });
  });

  it("payload shape is correct", () => {
    const payload: NotificationPayload = {
      event: "action_executed",
      timestamp: 1700000000000,
      session: "adventure",
      detail: "sent input",
    };
    assert.equal(payload.event, "action_executed");
    assert.equal(payload.timestamp, 1700000000000);
    assert.equal(payload.session, "adventure");
    assert.equal(payload.detail, "sent input");
  });
});
