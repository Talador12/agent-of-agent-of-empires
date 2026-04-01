import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatSlackPayload, sendNotification, isRateLimited, resetRateLimiter, sendTestNotification, fetchWithRetry, shouldNotifySession, formatNotifyFilters, parseNotifyEvents, VALID_NOTIFY_EVENTS } from "./notify.js";
import type { NotificationPayload, SessionNotifyFilter } from "./notify.js";
import type { AoaoeConfig } from "./types.js";

function makeConfig(notifications?: AoaoeConfig["notifications"]): AoaoeConfig {
  return {
    reasoner: "opencode",
    pollIntervalMs: 10_000,
    reasonIntervalMs: 60_000,
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

describe("isRateLimited", () => {
  it("returns false on first call for a given event+session", () => {
    resetRateLimiter();
    const payload: NotificationPayload = { event: "daemon_started", timestamp: 1000 };
    assert.equal(isRateLimited(payload, 1000), false);
  });

  it("returns false because isRateLimited does not record (read-only check)", () => {
    resetRateLimiter();
    const payload: NotificationPayload = { event: "daemon_started", timestamp: 1000 };
    // isRateLimited is a read-only check; calling it twice without sendNotification should still return false
    assert.equal(isRateLimited(payload, 1000), false);
    assert.equal(isRateLimited(payload, 1000), false);
  });

  it("different event+session combos are independent", () => {
    resetRateLimiter();
    const p1: NotificationPayload = { event: "session_error", timestamp: 1000, session: "alpha" };
    const p2: NotificationPayload = { event: "session_error", timestamp: 1000, session: "beta" };
    const p3: NotificationPayload = { event: "session_done", timestamp: 1000, session: "alpha" };
    // all should be independent — none rate-limited
    assert.equal(isRateLimited(p1, 1000), false);
    assert.equal(isRateLimited(p2, 1000), false);
    assert.equal(isRateLimited(p3, 1000), false);
  });

  it("resetRateLimiter clears all state", () => {
    resetRateLimiter();
    // after reset, nothing should be rate-limited
    const payload: NotificationPayload = { event: "daemon_started", timestamp: 1000 };
    assert.equal(isRateLimited(payload, 1000), false);
  });

  it("rate limits after sendNotification records a send", async () => {
    resetRateLimiter();
    // use a config with a bogus webhook so sendNotification records the send
    const config = makeConfig({ webhookUrl: "http://127.0.0.1:1/nope" });
    const payload: NotificationPayload = { event: "daemon_started", timestamp: Date.now() };
    await sendNotification(config, payload);
    // now isRateLimited should return true for the same event
    assert.equal(isRateLimited(payload), true);
    resetRateLimiter();
  });
});

describe("sendTestNotification", () => {
  it("returns empty object when no notifications configured", async () => {
    const config = makeConfig(undefined);
    const result = await sendTestNotification(config);
    assert.deepEqual(result, {});
  });

  it("returns empty object when notifications block has no URLs", async () => {
    const config = makeConfig({});
    const result = await sendTestNotification(config);
    assert.deepEqual(result, {});
  });

  it("returns webhookOk=false for unreachable generic webhook", async () => {
    const config = makeConfig({ webhookUrl: "http://127.0.0.1:1/nope" });
    const result = await sendTestNotification(config);
    assert.equal(result.webhookOk, false);
    assert.ok(typeof result.webhookError === "string");
    assert.equal(result.slackOk, undefined);
  });

  it("returns slackOk=false for unreachable slack webhook", async () => {
    const config = makeConfig({ slackWebhookUrl: "http://127.0.0.1:1/nope" });
    const result = await sendTestNotification(config);
    assert.equal(result.slackOk, false);
    assert.ok(typeof result.slackError === "string");
    assert.equal(result.webhookOk, undefined);
  });

  it("returns both fields when both webhooks configured", async () => {
    const config = makeConfig({
      webhookUrl: "http://127.0.0.1:1/nope",
      slackWebhookUrl: "http://127.0.0.1:1/nope",
    });
    const result = await sendTestNotification(config);
    assert.equal(result.webhookOk, false);
    assert.equal(result.slackOk, false);
    assert.ok(typeof result.webhookError === "string");
    assert.ok(typeof result.slackError === "string");
  });
});

describe("fetchWithRetry", () => {
  it("succeeds on first attempt with no retries", async () => {
    // use a real HTTP server that returns 200
    const { createServer } = await import("node:http");
    const server = createServer((_req, res) => {
      res.writeHead(200);
      res.end("ok");
    });
    server.listen(19890, "127.0.0.1");
    await new Promise((r) => setTimeout(r, 50));

    try {
      const resp = await fetchWithRetry("http://127.0.0.1:19890/", { method: "GET" }, 0);
      assert.equal(resp.status, 200);
    } finally {
      server.close();
    }
  });

  it("throws immediately on failure when maxRetries=0", async () => {
    await assert.rejects(
      () => fetchWithRetry("http://127.0.0.1:1/unreachable", { method: "GET" }, 0),
    );
  });

  it("retries on failure and eventually succeeds", async () => {
    const { createServer } = await import("node:http");
    let callCount = 0;
    const server = createServer((_req, res) => {
      callCount++;
      if (callCount < 3) {
        res.writeHead(500);
        res.end("error");
      } else {
        res.writeHead(200);
        res.end("ok");
      }
    });
    server.listen(19891, "127.0.0.1");
    await new Promise((r) => setTimeout(r, 50));

    try {
      // 2 retries = 3 total attempts. Fails on 1st and 2nd, succeeds on 3rd.
      const resp = await fetchWithRetry(
        "http://127.0.0.1:19891/",
        { method: "GET" },
        2,     // maxRetries
        50,    // 50ms base delay for fast test
      );
      assert.equal(resp.status, 200);
      assert.equal(callCount, 3);
    } finally {
      server.close();
    }
  });

  it("gives up after maxRetries exhausted", async () => {
    const { createServer } = await import("node:http");
    let callCount = 0;
    const server = createServer((_req, res) => {
      callCount++;
      res.writeHead(500);
      res.end("always fails");
    });
    server.listen(19892, "127.0.0.1");
    await new Promise((r) => setTimeout(r, 50));

    try {
      // maxRetries=1 → 2 total attempts, both return 500.
      // fetchWithRetry returns the last non-ok response instead of throwing.
      const resp = await fetchWithRetry(
        "http://127.0.0.1:19892/",
        { method: "GET" },
        1,     // maxRetries
        50,    // 50ms base delay for fast test
      );
      assert.equal(resp.status, 500);
      assert.equal(callCount, 2);
    } finally {
      server.close();
    }
  });

  it("retries network errors (connection refused)", async () => {
    // all attempts fail with network error → throws the last error
    await assert.rejects(
      () => fetchWithRetry(
        "http://127.0.0.1:1/unreachable",
        { method: "GET" },
        1,     // 1 retry = 2 attempts
        10,    // 10ms base delay for fast test
      ),
    );
  });
});

// ── shouldNotifySession ──────────────────────────────────────────────────

describe("shouldNotifySession", () => {
  it("allows all events when no filters exist", () => {
    assert.equal(shouldNotifySession("session_error", "Alpha", new Map(), undefined), true);
  });

  it("respects global events filter", () => {
    assert.equal(shouldNotifySession("session_error", "Alpha", new Map(), ["session_error"]), true);
    assert.equal(shouldNotifySession("action_executed", "Alpha", new Map(), ["session_error"]), false);
  });

  it("per-session filter overrides global", () => {
    const filters = new Map([["Alpha", new Set(["action_executed" as const])]]);
    // session_error is in global but NOT in per-session → blocked
    assert.equal(shouldNotifySession("session_error", "Alpha", filters, ["session_error"]), false);
    // action_executed is in per-session → allowed
    assert.equal(shouldNotifySession("action_executed", "Alpha", filters, ["session_error"]), true);
  });

  it("case-insensitive session matching", () => {
    const filters = new Map([["Alpha", new Set(["session_error" as const])]]);
    assert.equal(shouldNotifySession("session_error", "ALPHA", filters, undefined), true);
    assert.equal(shouldNotifySession("action_executed", "alpha", filters, undefined), false);
  });

  it("sessions without filter use global", () => {
    const filters = new Map([["Alpha", new Set(["session_error" as const])]]);
    // Bravo has no filter — uses global
    assert.equal(shouldNotifySession("session_error", "Bravo", filters, ["session_error"]), true);
    assert.equal(shouldNotifySession("action_executed", "Bravo", filters, ["session_error"]), false);
  });

  it("empty per-session filter blocks all events", () => {
    const filters = new Map([["Alpha", new Set<never>() as SessionNotifyFilter]]);
    assert.equal(shouldNotifySession("session_error", "Alpha", filters, undefined), false);
    assert.equal(shouldNotifySession("daemon_started", "Alpha", filters, undefined), false);
  });

  it("undefined session uses global filter only", () => {
    assert.equal(shouldNotifySession("session_error", undefined, new Map(), ["session_error"]), true);
    assert.equal(shouldNotifySession("action_executed", undefined, new Map(), ["session_error"]), false);
  });
});

// ── formatNotifyFilters ──────────────────────────────────────────────────

describe("formatNotifyFilters", () => {
  it("returns placeholder for empty map", () => {
    const lines = formatNotifyFilters(new Map());
    assert.ok(lines[0].includes("no per-session"));
  });

  it("shows count in header", () => {
    const filters = new Map<string, SessionNotifyFilter>();
    filters.set("Alpha", new Set(["session_error"]));
    filters.set("Bravo", new Set(["action_executed", "action_failed"]));
    const lines = formatNotifyFilters(filters);
    assert.ok(lines[0].includes("2 sessions"));
  });

  it("shows events per session", () => {
    const filters = new Map([["Alpha", new Set(["session_error" as const, "session_done" as const])]]);
    const lines = formatNotifyFilters(filters);
    const joined = lines.join("\n");
    assert.ok(joined.includes("Alpha"));
    assert.ok(joined.includes("session_done"));
    assert.ok(joined.includes("session_error"));
  });

  it("shows blocked message for empty filter", () => {
    const filters = new Map([["Alpha", new Set<never>() as SessionNotifyFilter]]);
    const lines = formatNotifyFilters(filters);
    assert.ok(lines.join("\n").includes("all blocked"));
  });
});

// ── parseNotifyEvents ────────────────────────────────────────────────────

describe("parseNotifyEvents", () => {
  it("parses valid events", () => {
    const result = parseNotifyEvents(["session_error", "action_executed"]);
    assert.equal(result.size, 2);
    assert.ok(result.has("session_error"));
    assert.ok(result.has("action_executed"));
  });

  it("ignores unknown events", () => {
    const result = parseNotifyEvents(["session_error", "not_a_real_event"]);
    assert.equal(result.size, 1);
  });

  it("is case-insensitive", () => {
    const result = parseNotifyEvents(["SESSION_ERROR"]);
    assert.equal(result.size, 1);
    assert.ok(result.has("session_error"));
  });

  it("returns empty set for no valid events", () => {
    const result = parseNotifyEvents(["foo", "bar"]);
    assert.equal(result.size, 0);
  });

  it("returns empty set for empty input", () => {
    assert.equal(parseNotifyEvents([]).size, 0);
  });
});

// ── VALID_NOTIFY_EVENTS ──────────────────────────────────────────────────

describe("VALID_NOTIFY_EVENTS", () => {
  it("has 9 event types", () => {
    assert.equal(VALID_NOTIFY_EVENTS.length, 9);
  });

  it("includes session_error and action_executed", () => {
    assert.ok(VALID_NOTIFY_EVENTS.includes("session_error"));
    assert.ok(VALID_NOTIFY_EVENTS.includes("task_completed"));
    assert.ok(VALID_NOTIFY_EVENTS.includes("task_stuck"));
    assert.ok(VALID_NOTIFY_EVENTS.includes("task_unblocked"));
    assert.ok(VALID_NOTIFY_EVENTS.includes("action_executed"));
  });
});
