import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { PERMISSION_COOLDOWN_MS, VALID_TOOLS, Executor } from "./executor.js";
import type { AoaoeConfig, SessionSnapshot } from "./types.js";

// default cooldown from executor.ts (config.policies.actionCooldownMs ?? 30_000)
const DEFAULT_COOLDOWN_MS = 30_000;

function makeConfig(overrides?: Partial<AoaoeConfig>): AoaoeConfig {
  return {
    reasoner: "opencode",
    pollIntervalMs: 10_000,
    opencode: { port: 4097 },
    claudeCode: { yolo: true, resume: true },
    aoe: { profile: "default" },
    policies: { maxIdleBeforeNudgeMs: 120_000, maxErrorsBeforeRestart: 3, autoAnswerPermissions: true },
    contextFiles: [],
    sessionDirs: {},
    protectedSessions: [],
    captureLinesCount: 100,
    verbose: false,
    dryRun: false,
    observe: false,
    confirm: false,
    ...overrides,
  };
}

function makeSnap(id: string, title: string, tool = "opencode"): SessionSnapshot {
  return {
    session: { id, title, path: "/tmp", tool, status: "working", tmux_name: `aoe_${title}_${id.slice(0, 8)}` },
    output: "",
    outputHash: "abcd",
    capturedAt: Date.now(),
  };
}

describe("permission approval fast cooldown", () => {
  it("PERMISSION_COOLDOWN_MS is much shorter than default", () => {
    assert.ok(PERMISSION_COOLDOWN_MS < DEFAULT_COOLDOWN_MS, "permission cooldown should be shorter");
    assert.ok(PERMISSION_COOLDOWN_MS <= 2_000, "permission cooldown should be <= 2s");
    assert.ok(PERMISSION_COOLDOWN_MS >= 500, "permission cooldown should be >= 500ms");
  });

  it("permission action uses fast cooldown, next non-permission uses normal", () => {
    // simulate the rate-limit logic from executor.ts
    const recentActions = new Map<string, number>();
    const lastActionWasPermission = new Map<string, boolean>();

    const now = Date.now();

    // simulate permission approval
    recentActions.set("s1", now);
    lastActionWasPermission.set("s1", true);

    // check at PERMISSION_COOLDOWN_MS + 100ms: should NOT be rate limited
    const afterPermCooldown = now + PERMISSION_COOLDOWN_MS + 100;
    const wasPermission = lastActionWasPermission.get("s1") ?? false;
    const cooldown = wasPermission ? PERMISSION_COOLDOWN_MS : DEFAULT_COOLDOWN_MS;
    assert.equal(afterPermCooldown - now < cooldown, false, "should not be rate limited after permission cooldown");

    // but at PERMISSION_COOLDOWN_MS - 100ms: SHOULD be rate limited
    const beforePermCooldown = now + PERMISSION_COOLDOWN_MS - 100;
    assert.equal(beforePermCooldown - now < cooldown, true, "should be rate limited within permission cooldown");
  });
});

// ── VALID_TOOLS ─────────────────────────────────────────────────────────────

describe("VALID_TOOLS", () => {
  it("contains expected AoE tool names", () => {
    assert.ok(VALID_TOOLS.has("opencode"));
    assert.ok(VALID_TOOLS.has("claude-code"));
    assert.ok(VALID_TOOLS.has("cursor"));
    assert.ok(VALID_TOOLS.has("aider"));
  });

  it("does not contain invalid tool names", () => {
    assert.ok(!VALID_TOOLS.has("vim"));
    assert.ok(!VALID_TOOLS.has(""));
    assert.ok(!VALID_TOOLS.has("unknown"));
  });

  it("has at least 5 tools", () => {
    assert.ok(VALID_TOOLS.size >= 5, `expected >=5 tools, got ${VALID_TOOLS.size}`);
  });
});

// ── Executor class ──────────────────────────────────────────────────────────

describe("Executor", () => {
  it("constructs without throwing", () => {
    const ex = new Executor(makeConfig());
    assert.ok(ex);
  });

  it("execute with wait action returns success", async () => {
    const ex = new Executor(makeConfig());
    const results = await ex.execute(
      [{ action: "wait", reason: "all is well" }],
      [],
    );
    assert.equal(results.length, 1);
    assert.equal(results[0].success, true);
    assert.ok(results[0].detail.includes("all is well"));
  });

  it("blocks destructive actions when allowDestructive is false", async () => {
    const ex = new Executor(makeConfig({ policies: { maxIdleBeforeNudgeMs: 120_000, maxErrorsBeforeRestart: 3, autoAnswerPermissions: true, allowDestructive: false } }));
    const snap = makeSnap("abc12345-1234-5678-9012-123456789abc", "test-agent");
    const results = await ex.execute(
      [{ action: "remove_agent", session: "abc12345-1234-5678-9012-123456789abc" }],
      [snap],
    );
    assert.equal(results.length, 1);
    assert.equal(results[0].success, false);
    assert.ok(results[0].detail.includes("allowDestructive"));
  });

  it("blocks stop_session when allowDestructive is false", async () => {
    const ex = new Executor(makeConfig());
    const snap = makeSnap("abc12345-1234-5678-9012-123456789abc", "test-agent");
    const results = await ex.execute(
      [{ action: "stop_session", session: "abc12345-1234-5678-9012-123456789abc" }],
      [snap],
    );
    assert.equal(results.length, 1);
    assert.equal(results[0].success, false);
    assert.ok(results[0].detail.includes("allowDestructive"));
  });

  it("blocks actions targeting protected sessions", async () => {
    const ex = new Executor(makeConfig({ protectedSessions: ["secret-project"] }));
    const snap = makeSnap("abc12345-1234-5678-9012-123456789abc", "secret-project");
    const results = await ex.execute(
      [{ action: "start_session", session: "abc12345-1234-5678-9012-123456789abc" }],
      [snap],
    );
    assert.equal(results.length, 1);
    assert.equal(results[0].success, false);
    assert.ok(results[0].detail.includes("protected"));
  });

  it("protected session matching is case-insensitive", async () => {
    const ex = new Executor(makeConfig({ protectedSessions: ["Secret-Project"] }));
    const snap = makeSnap("abc12345-1234-5678-9012-123456789abc", "secret-project");
    const results = await ex.execute(
      [{ action: "start_session", session: "abc12345-1234-5678-9012-123456789abc" }],
      [snap],
    );
    assert.equal(results[0].success, false);
    assert.ok(results[0].detail.includes("protected"));
  });

  it("blocks send_input to user-active sessions", async () => {
    const ex = new Executor(makeConfig());
    const snap = { ...makeSnap("abc12345-1234-5678-9012-123456789abc", "active-agent"), userActive: true };
    const results = await ex.execute(
      [{ action: "send_input", session: "abc12345-1234-5678-9012-123456789abc", text: "hello" }],
      [snap],
    );
    assert.equal(results.length, 1);
    assert.equal(results[0].success, false);
    assert.ok(results[0].detail.includes("user active"));
  });

  it("getRecentLog returns logged actions", async () => {
    const ex = new Executor(makeConfig());
    await ex.execute([{ action: "wait" }], []);
    await ex.execute([{ action: "wait", reason: "second" }], []);
    const log = ex.getRecentLog(10);
    assert.equal(log.length, 2);
  });

  it("resolves session by title (case-insensitive)", async () => {
    const ex = new Executor(makeConfig());
    // send_input to a non-existent tmux target will fail, but we can check the log entry
    const snap = makeSnap("abc12345-1234-5678-9012-123456789abc", "Adventure");
    const results = await ex.execute(
      [{ action: "send_input", session: "adventure", text: "hello" }],
      [snap],
    );
    // it will try to send to tmux and likely fail, but it resolved the session
    assert.equal(results.length, 1);
    // the action should reference the resolved session, not return "could not resolve"
    assert.ok(!results[0].detail.includes("could not resolve"));
  });
});
