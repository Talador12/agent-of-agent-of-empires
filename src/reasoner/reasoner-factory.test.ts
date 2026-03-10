import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createReasoner, OpencodeReasoner, ClaudeCodeReasoner } from "./index.js";
import type { AoaoeConfig } from "../types.js";

function defaultConfig(overrides?: Partial<AoaoeConfig>): AoaoeConfig {
  return {
    reasoner: "opencode",
    pollIntervalMs: 10_000,
    opencode: { port: 4097 },
    claudeCode: { yolo: true, resume: true },
    aoe: { profile: "default" },
    policies: {
      maxIdleBeforeNudgeMs: 120_000,
      maxErrorsBeforeRestart: 3,
      autoAnswerPermissions: true,
    },
    contextFiles: [],
    sessionDirs: {},
    captureLinesCount: 100,
    verbose: false,
    dryRun: false,
    ...overrides,
  };
}

describe("createReasoner", () => {
  it("creates OpencodeReasoner for 'opencode' backend", () => {
    const config = defaultConfig({ reasoner: "opencode" });
    const reasoner = createReasoner(config);
    assert.ok(reasoner instanceof OpencodeReasoner);
  });

  it("creates ClaudeCodeReasoner for 'claude-code' backend", () => {
    const config = defaultConfig({ reasoner: "claude-code" });
    const reasoner = createReasoner(config);
    assert.ok(reasoner instanceof ClaudeCodeReasoner);
  });

  it("throws for unknown backend", () => {
    const config = defaultConfig();
    // force an invalid value
    (config as unknown as Record<string, unknown>).reasoner = "gpt-4";
    assert.throws(
      () => createReasoner(config),
      (err: Error) => err.message.includes("unknown reasoner backend"),
    );
  });

  it("passes globalContext to OpencodeReasoner", () => {
    const config = defaultConfig({ reasoner: "opencode" });
    // just verifying it doesn't throw with context
    const reasoner = createReasoner(config, "# AGENTS.md\nSome context");
    assert.ok(reasoner instanceof OpencodeReasoner);
  });

  it("passes globalContext to ClaudeCodeReasoner", () => {
    const config = defaultConfig({ reasoner: "claude-code" });
    const reasoner = createReasoner(config, "# AGENTS.md\nSome context");
    assert.ok(reasoner instanceof ClaudeCodeReasoner);
  });

  it("works with undefined globalContext", () => {
    const config = defaultConfig({ reasoner: "opencode" });
    const reasoner = createReasoner(config, undefined);
    assert.ok(reasoner instanceof OpencodeReasoner);
  });

  it("returns object with Reasoner interface methods", () => {
    const config = defaultConfig({ reasoner: "opencode" });
    const reasoner = createReasoner(config);
    assert.equal(typeof reasoner.init, "function");
    assert.equal(typeof reasoner.decide, "function");
    assert.equal(typeof reasoner.shutdown, "function");
  });
});
