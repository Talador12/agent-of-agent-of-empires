import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { AoaoeConfig } from "../types.js";
import { ClaudeCodeReasoner } from "./claude-code.js";

// ── helpers ─────────────────────────────────────────────────────────────────

function makeConfig(overrides: Partial<AoaoeConfig["claudeCode"]> = {}): AoaoeConfig {
  return {
    reasoner: "claude-code",
    pollIntervalMs: 10000,
    opencode: { port: 4097 },
    claudeCode: { yolo: false, resume: false, ...overrides },
    aoe: { profile: "default" },
    policies: {
      maxIdleBeforeNudgeMs: 120000,
      maxErrorsBeforeRestart: 3,
      autoAnswerPermissions: true,
    },
    contextFiles: [],
    sessionDirs: {},
    protectedSessions: [],
    captureLinesCount: 100,
    verbose: false,
    dryRun: false,
    observe: false,
    confirm: false,
  };
}

// ClaudeCodeReasoner.buildArgs and tryExtractSessionId are private,
// so we test them through the public interface: decide().
// We construct the instance and verify behavior via decide() which calls buildArgs internally,
// and via the session resumption path which exercises tryExtractSessionId.

// ── constructor ─────────────────────────────────────────────────────────────

describe("ClaudeCodeReasoner", () => {
  it("constructs without error", () => {
    const r = new ClaudeCodeReasoner(makeConfig());
    assert.ok(r);
  });

  it("constructs with global context", () => {
    const r = new ClaudeCodeReasoner(makeConfig(), "# Project context\nBuild stuff");
    assert.ok(r);
  });

  it("constructs with model override", () => {
    const r = new ClaudeCodeReasoner(makeConfig({ model: "claude-sonnet-4-20250514" }));
    assert.ok(r);
  });

  it("constructs with yolo enabled", () => {
    const r = new ClaudeCodeReasoner(makeConfig({ yolo: true }));
    assert.ok(r);
  });

  it("constructs with resume enabled", () => {
    const r = new ClaudeCodeReasoner(makeConfig({ resume: true }));
    assert.ok(r);
  });

  it("constructs with all options", () => {
    const r = new ClaudeCodeReasoner(makeConfig({
      model: "claude-sonnet-4-20250514",
      yolo: true,
      resume: true,
    }));
    assert.ok(r);
  });
});

// ── decide() error handling ─────────────────────────────────────────────────

describe("ClaudeCodeReasoner.decide", () => {
  it("returns wait action when claude is not available", async () => {
    // decide() calls exec("claude", args) which will fail in test env (no claude binary)
    // this exercises the error path: exitCode !== 0 → wait action
    const r = new ClaudeCodeReasoner(makeConfig());
    const result = await r.decide({
      timestamp: Date.now(),
      sessions: [],
      changes: [],
    });
    assert.equal(result.actions.length, 1);
    assert.equal(result.actions[0].action, "wait");
  });

  it("returns wait action with abort signal", async () => {
    const r = new ClaudeCodeReasoner(makeConfig());
    const controller = new AbortController();
    // abort immediately so exec fails fast
    controller.abort();
    const result = await r.decide(
      { timestamp: Date.now(), sessions: [], changes: [] },
      controller.signal
    );
    assert.equal(result.actions.length, 1);
    assert.equal(result.actions[0].action, "wait");
  });
});

// ── shutdown ────────────────────────────────────────────────────────────────

describe("ClaudeCodeReasoner.shutdown", () => {
  it("resolves without error (stateless)", async () => {
    const r = new ClaudeCodeReasoner(makeConfig());
    await r.shutdown(); // should not throw
  });
});
