import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { AoaoeConfig } from "../types.js";

// ClaudeCodeReasoner.buildArgs and tryExtractSessionId are private, so we
// replicate the pure logic here for unit testing. If the logic drifts,
// integration tests will catch it.

function defaultConfig(overrides?: Partial<AoaoeConfig>): AoaoeConfig {
  return {
    reasoner: "claude-code",
    pollIntervalMs: 10_000,
    opencode: { port: 4097 },
    claudeCode: { yolo: false, resume: false },
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

// replicated from claude-code.ts buildArgs (private method)
function buildArgs(
  prompt: string,
  config: AoaoeConfig,
  systemPrompt: string,
  sessionId: string | null,
): string[] {
  const args: string[] = ["--print"];
  args.push("--output-format", "text");
  args.push("--append-system-prompt", systemPrompt);
  if (config.claudeCode.model) {
    args.push("--model", config.claudeCode.model);
  }
  if (config.claudeCode.yolo) {
    args.push("--dangerously-skip-permissions");
  }
  if (config.claudeCode.resume && sessionId) {
    args.push("--resume", sessionId);
  }
  args.push(prompt);
  return args;
}

// replicated from claude-code.ts tryExtractSessionId (private method)
function tryExtractSessionId(output: string): string | null {
  const match = output.match(/session[_\s]?(?:id)?[:\s]+([a-f0-9-]+)/i);
  return match ? match[1] : null;
}

describe("buildArgs", () => {
  const systemPrompt = "You are a supervisor.";

  it("always includes --print and --output-format text", () => {
    const args = buildArgs("hello", defaultConfig(), systemPrompt, null);
    assert.ok(args.includes("--print"));
    const fmtIdx = args.indexOf("--output-format");
    assert.ok(fmtIdx >= 0);
    assert.equal(args[fmtIdx + 1], "text");
  });

  it("always includes system prompt", () => {
    const args = buildArgs("hello", defaultConfig(), systemPrompt, null);
    const idx = args.indexOf("--append-system-prompt");
    assert.ok(idx >= 0);
    assert.equal(args[idx + 1], systemPrompt);
  });

  it("includes model when configured", () => {
    const config = defaultConfig({ claudeCode: { model: "claude-sonnet-4-20250514", yolo: false, resume: false } });
    const args = buildArgs("hello", config, systemPrompt, null);
    const idx = args.indexOf("--model");
    assert.ok(idx >= 0);
    assert.equal(args[idx + 1], "claude-sonnet-4-20250514");
  });

  it("omits model when not configured", () => {
    const config = defaultConfig({ claudeCode: { yolo: false, resume: false } });
    const args = buildArgs("hello", config, systemPrompt, null);
    assert.ok(!args.includes("--model"));
  });

  it("includes --dangerously-skip-permissions when yolo is true", () => {
    const config = defaultConfig({ claudeCode: { yolo: true, resume: false } });
    const args = buildArgs("hello", config, systemPrompt, null);
    assert.ok(args.includes("--dangerously-skip-permissions"));
  });

  it("omits --dangerously-skip-permissions when yolo is false", () => {
    const config = defaultConfig({ claudeCode: { yolo: false, resume: false } });
    const args = buildArgs("hello", config, systemPrompt, null);
    assert.ok(!args.includes("--dangerously-skip-permissions"));
  });

  it("includes --resume with session ID when resume is true and session exists", () => {
    const config = defaultConfig({ claudeCode: { yolo: false, resume: true } });
    const args = buildArgs("hello", config, systemPrompt, "abc-123-def");
    const idx = args.indexOf("--resume");
    assert.ok(idx >= 0);
    assert.equal(args[idx + 1], "abc-123-def");
  });

  it("omits --resume when resume is true but no session ID", () => {
    const config = defaultConfig({ claudeCode: { yolo: false, resume: true } });
    const args = buildArgs("hello", config, systemPrompt, null);
    assert.ok(!args.includes("--resume"));
  });

  it("omits --resume when resume is false even with session ID", () => {
    const config = defaultConfig({ claudeCode: { yolo: false, resume: false } });
    const args = buildArgs("hello", config, systemPrompt, "abc-123-def");
    assert.ok(!args.includes("--resume"));
  });

  it("prompt is always the last argument", () => {
    const config = defaultConfig({ claudeCode: { model: "m", yolo: true, resume: true } });
    const args = buildArgs("observe and decide", config, systemPrompt, "sess-1");
    assert.equal(args[args.length - 1], "observe and decide");
  });

  it("builds full arg list with all options", () => {
    const config = defaultConfig({ claudeCode: { model: "opus-4", yolo: true, resume: true } });
    const args = buildArgs("prompt text", config, systemPrompt, "sess-1");
    assert.deepEqual(args, [
      "--print",
      "--output-format", "text",
      "--append-system-prompt", systemPrompt,
      "--model", "opus-4",
      "--dangerously-skip-permissions",
      "--resume", "sess-1",
      "prompt text",
    ]);
  });
});

describe("tryExtractSessionId", () => {
  it("extracts session_id with colon separator", () => {
    assert.equal(tryExtractSessionId("session_id: abc-123-def"), "abc-123-def");
  });

  it("extracts session id with space separator", () => {
    assert.equal(tryExtractSessionId("session id: 1a2b3c4d"), "1a2b3c4d");
  });

  it("extracts session: format", () => {
    assert.equal(tryExtractSessionId("Session: abcdef12-3456-7890"), "abcdef12-3456-7890");
  });

  it("extracts from multiline output", () => {
    const output = "Starting claude...\nSession_id: deadbeef\nThinking...";
    assert.equal(tryExtractSessionId(output), "deadbeef");
  });

  it("is case-insensitive", () => {
    assert.equal(tryExtractSessionId("SESSION_ID: aabbccdd"), "aabbccdd");
    assert.equal(tryExtractSessionId("Session: 112233"), "112233");
  });

  it("returns null when no session ID found", () => {
    assert.equal(tryExtractSessionId("no session info here"), null);
  });

  it("returns null for empty string", () => {
    assert.equal(tryExtractSessionId(""), null);
  });

  it("extracts UUID-style session IDs", () => {
    const result = tryExtractSessionId("session: 550e8400-e29b-41d4-a716-446655440000");
    assert.equal(result, "550e8400-e29b-41d4-a716-446655440000");
  });

  it("extracts from stderr + stdout combined output", () => {
    const output = "Loading model...\nsession_id: beef1234\n{\"action\":\"wait\"}";
    assert.equal(tryExtractSessionId(output), "beef1234");
  });
});
