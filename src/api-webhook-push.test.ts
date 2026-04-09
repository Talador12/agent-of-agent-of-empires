// api-webhook-push.test.ts

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createWebhookPush,
  addWebhook,
  removeWebhook,
  toggleWebhook,
  signPayload,
  matchSubscriptions,
  buildPayload,
  formatWebhookPush,
} from "./api-webhook-push.js";

describe("addWebhook", () => {
  it("adds subscription with auto id", () => {
    const state = createWebhookPush();
    const sub = addWebhook(state, "https://example.com/hook", ["session:started"]);
    assert.ok(sub.id.startsWith("wh-"));
    assert.equal(sub.url, "https://example.com/hook");
    assert.deepEqual(sub.events, ["session:started"]);
    assert.equal(sub.enabled, true);
    assert.equal(state.subscriptions.length, 1);
  });

  it("defaults to wildcard events", () => {
    const state = createWebhookPush();
    const sub = addWebhook(state, "https://example.com/hook");
    assert.deepEqual(sub.events, ["*"]);
  });

  it("stores secret", () => {
    const state = createWebhookPush();
    const sub = addWebhook(state, "https://example.com/hook", ["*"], "my-secret");
    assert.equal(sub.secret, "my-secret");
  });
});

describe("removeWebhook", () => {
  it("removes existing subscription", () => {
    const state = createWebhookPush();
    const sub = addWebhook(state, "https://example.com");
    assert.equal(removeWebhook(state, sub.id), true);
    assert.equal(state.subscriptions.length, 0);
  });

  it("returns false for unknown id", () => {
    const state = createWebhookPush();
    assert.equal(removeWebhook(state, "wh-999"), false);
  });
});

describe("toggleWebhook", () => {
  it("toggles enabled state", () => {
    const state = createWebhookPush();
    const sub = addWebhook(state, "https://example.com");
    assert.equal(sub.enabled, true);
    toggleWebhook(state, sub.id);
    assert.equal(sub.enabled, false);
    toggleWebhook(state, sub.id);
    assert.equal(sub.enabled, true);
  });

  it("returns false for unknown id", () => {
    const state = createWebhookPush();
    assert.equal(toggleWebhook(state, "wh-999"), false);
  });
});

describe("signPayload", () => {
  it("produces consistent HMAC-SHA256", () => {
    const sig1 = signPayload('{"event":"test"}', "secret");
    const sig2 = signPayload('{"event":"test"}', "secret");
    assert.equal(sig1, sig2);
    assert.equal(sig1.length, 64); // hex sha256
  });

  it("produces different signatures for different secrets", () => {
    const sig1 = signPayload("data", "secret1");
    const sig2 = signPayload("data", "secret2");
    assert.notEqual(sig1, sig2);
  });
});

describe("matchSubscriptions", () => {
  it("matches wildcard subscriptions", () => {
    const state = createWebhookPush();
    addWebhook(state, "https://a.com", ["*"]);
    const matches = matchSubscriptions(state, "session:started");
    assert.equal(matches.length, 1);
  });

  it("matches specific event types", () => {
    const state = createWebhookPush();
    addWebhook(state, "https://a.com", ["session:started", "session:stopped"]);
    addWebhook(state, "https://b.com", ["cost:exceeded"]);
    const matches = matchSubscriptions(state, "session:started");
    assert.equal(matches.length, 1);
    assert.equal(matches[0].url, "https://a.com");
  });

  it("excludes disabled subscriptions", () => {
    const state = createWebhookPush();
    const sub = addWebhook(state, "https://a.com", ["*"]);
    toggleWebhook(state, sub.id);
    const matches = matchSubscriptions(state, "test");
    assert.equal(matches.length, 0);
  });

  it("returns empty for no matches", () => {
    const state = createWebhookPush();
    addWebhook(state, "https://a.com", ["session:started"]);
    const matches = matchSubscriptions(state, "cost:exceeded");
    assert.equal(matches.length, 0);
  });
});

describe("buildPayload", () => {
  it("builds structured payload", () => {
    const payload = buildPayload("session:started", { session: "frontend" }, "daemon-1", 1000);
    assert.equal(payload.event, "session:started");
    assert.equal(payload.timestamp, 1000);
    assert.equal(payload.daemon, "daemon-1");
    assert.deepEqual(payload.data, { session: "frontend" });
  });
});

describe("formatWebhookPush", () => {
  it("formats state for TUI", () => {
    const state = createWebhookPush();
    addWebhook(state, "https://slack.com/webhook", ["session:started", "session:error"]);
    addWebhook(state, "https://grafana.com/webhook", ["*"]);
    const lines = formatWebhookPush(state);
    assert.ok(lines[0].includes("2 subscriptions"));
    assert.ok(lines.some((l) => l.includes("slack.com")));
    assert.ok(lines.some((l) => l.includes("grafana.com")));
  });

  it("handles empty state", () => {
    const state = createWebhookPush();
    const lines = formatWebhookPush(state);
    assert.ok(lines[0].includes("0 subscriptions"));
  });
});
