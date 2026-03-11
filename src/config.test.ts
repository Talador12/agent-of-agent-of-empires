import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { homedir } from "node:os";
import { parseCliArgs, deepMerge, validateConfig, findConfigFile, configFileExists, defaultConfigPath, warnUnknownKeys } from "./config.js";
import type { AoaoeConfig, Action } from "./types.js";
import { actionSession, actionDetail, toSessionStatus, toTaskState, toDaemonState, toAoeSessionList, toReasonerBackend } from "./types.js";

describe("config file resolution", () => {
  it("defaultConfigPath points to ~/.aoaoe/aoaoe.config.json", () => {
    const expected = join(homedir(), ".aoaoe", "aoaoe.config.json");
    assert.equal(defaultConfigPath(), expected);
  });

  it("findConfigFile returns a string or null", () => {
    const result = findConfigFile();
    assert.ok(result === null || typeof result === "string");
  });

  it("configFileExists returns a boolean", () => {
    assert.ok(typeof configFileExists() === "boolean");
  });

  it("findConfigFile prefers ~/.aoaoe/ over cwd", () => {
    // if a config exists at ~/.aoaoe/, findConfigFile should return that path
    const found = findConfigFile();
    if (found && found.includes(".aoaoe")) {
      assert.ok(found.startsWith(homedir()), "config should be under home dir");
    }
  });
});

describe("parseCliArgs", () => {
  // helper: simulate argv with "node" and "script" prefix
  const argv = (...args: string[]) => ["node", "aoaoe", ...args];

  it("parses --help", () => {
    const result = parseCliArgs(argv("--help"));
    assert.equal(result.help, true);
  });

  it("parses -h", () => {
    const result = parseCliArgs(argv("-h"));
    assert.equal(result.help, true);
  });

  it("parses --version", () => {
    const result = parseCliArgs(argv("--version"));
    assert.equal(result.version, true);
  });

  it("parses register subcommand", () => {
    const result = parseCliArgs(argv("register"));
    assert.equal(result.register, true);
  });

  it("parses register --title", () => {
    const result = parseCliArgs(argv("register", "--title", "my-supervisor"));
    assert.equal(result.register, true);
    assert.equal(result.registerTitle, "my-supervisor");
  });

  it("parses register -t", () => {
    const result = parseCliArgs(argv("register", "-t", "my-supervisor"));
    assert.equal(result.register, true);
    assert.equal(result.registerTitle, "my-supervisor");
  });

  it("parses --reasoner", () => {
    const result = parseCliArgs(argv("--reasoner", "claude-code"));
    assert.equal(result.overrides.reasoner, "claude-code");
  });

  it("parses --poll-interval", () => {
    const result = parseCliArgs(argv("--poll-interval", "5000"));
    assert.equal(result.overrides.pollIntervalMs, 5000);
  });

  it("parses --port", () => {
    const result = parseCliArgs(argv("--port", "9999"));
    assert.equal(result.overrides.opencode?.port, 9999);
  });

  it("throws on non-numeric --poll-interval", () => {
    assert.throws(
      () => parseCliArgs(argv("--poll-interval", "abc")),
      { message: /--poll-interval value 'abc' is not a valid number/ },
    );
  });

  it("throws on non-numeric --port", () => {
    assert.throws(
      () => parseCliArgs(argv("--port", "xyz")),
      { message: /--port value 'xyz' is not a valid number/ },
    );
  });

  it("throws on empty-string --poll-interval", () => {
    assert.throws(
      () => parseCliArgs(argv("--poll-interval", "")),
      { message: /--poll-interval value '' is not a valid number/ },
    );
  });

  it("parseInt truncates floats for --port (no throw)", () => {
    // parseInt("3.14", 10) => 3 — valid number, no NaN
    const result = parseCliArgs(argv("--port", "3.14"));
    assert.equal(result.overrides.opencode?.port, 3);
  });

  it("parses --model (sets both backends)", () => {
    const result = parseCliArgs(argv("--model", "gpt-4o"));
    assert.equal(result.overrides.opencode?.model, "gpt-4o");
    assert.equal(result.overrides.claudeCode?.model, "gpt-4o");
  });

  it("parses --verbose", () => {
    const result = parseCliArgs(argv("--verbose"));
    assert.equal(result.overrides.verbose, true);
  });

  it("parses -v", () => {
    const result = parseCliArgs(argv("-v"));
    assert.equal(result.overrides.verbose, true);
  });

  it("parses --dry-run", () => {
    const result = parseCliArgs(argv("--dry-run"));
    assert.equal(result.overrides.dryRun, true);
  });

  it("parses --profile", () => {
    const result = parseCliArgs(argv("--profile", "staging"));
    assert.equal(result.overrides.aoe?.profile, "staging");
  });

  it("parses multiple flags", () => {
    const result = parseCliArgs(argv("--reasoner", "claude-code", "--verbose", "--dry-run", "--poll-interval", "2000"));
    assert.equal(result.overrides.reasoner, "claude-code");
    assert.equal(result.overrides.verbose, true);
    assert.equal(result.overrides.dryRun, true);
    assert.equal(result.overrides.pollIntervalMs, 2000);
  });

  it("parses test-context subcommand", () => {
    const result = parseCliArgs(argv("test-context"));
    assert.equal(result.testContext, true);
    assert.equal(result.register, false);
  });

  it("returns defaults for no args", () => {
    const result = parseCliArgs(argv());
    assert.equal(result.help, false);
    assert.equal(result.version, false);
    assert.equal(result.register, false);
    assert.equal(result.testContext, false);
    assert.equal(result.runInit, false);
    assert.equal(result.initForce, false);
    assert.equal(result.showStatus, false);
    assert.equal(result.showConfig, false);
    assert.deepEqual(result.overrides, {});
  });

  it("warns on unknown flags", () => {
    // capture stderr to check for warning
    const originalStderr = console.error;
    const warnings: string[] = [];
    console.error = (msg: string) => warnings.push(msg);
    try {
      const result = parseCliArgs(argv("--unknown-flag"));
      assert.ok(warnings.some(w => w.includes("unknown flag") && w.includes("--unknown-flag")));
      // should still return valid defaults (flag is ignored)
      assert.equal(result.help, false);
      assert.equal(result.version, false);
    } finally {
      console.error = originalStderr;
    }
  });

  it("does not warn on known flags", () => {
    const originalStderr = console.error;
    const warnings: string[] = [];
    console.error = (msg: string) => warnings.push(msg);
    try {
      parseCliArgs(argv("--verbose", "--dry-run"));
      assert.ok(!warnings.some(w => w.includes("unknown flag")));
    } finally {
      console.error = originalStderr;
    }
  });

  it("parses --confirm flag", () => {
    const result = parseCliArgs(argv("--confirm"));
    assert.equal(result.overrides.confirm, true);
  });

  it("parses --observe flag", () => {
    const result = parseCliArgs(argv("--observe"));
    assert.equal(result.overrides.observe, true);
  });

  it("parses init subcommand", () => {
    const result = parseCliArgs(argv("init"));
    assert.equal(result.runInit, true);
    assert.equal(result.initForce, false);
    assert.equal(result.register, false);
  });

  it("parses init --force", () => {
    const result = parseCliArgs(argv("init", "--force"));
    assert.equal(result.runInit, true);
    assert.equal(result.initForce, true);
  });

  it("parses init -f", () => {
    const result = parseCliArgs(argv("init", "-f"));
    assert.equal(result.runInit, true);
    assert.equal(result.initForce, true);
  });

  it("parses status subcommand", () => {
    const result = parseCliArgs(argv("status"));
    assert.equal(result.showStatus, true);
    assert.equal(result.showConfig, false);
    assert.equal(result.register, false);
  });

  it("parses config subcommand", () => {
    const result = parseCliArgs(argv("config"));
    assert.equal(result.showConfig, true);
    assert.equal(result.showStatus, false);
    assert.equal(result.register, false);
  });

  it("subcommands are mutually exclusive", () => {
    const registerResult = parseCliArgs(argv("register"));
    assert.equal(registerResult.register, true);
    assert.equal(registerResult.testContext, false);
    assert.equal(registerResult.runInit, false);
    assert.equal(registerResult.showStatus, false);
    assert.equal(registerResult.showConfig, false);

    const testCtxResult = parseCliArgs(argv("test-context"));
    assert.equal(testCtxResult.register, false);
    assert.equal(testCtxResult.testContext, true);
    assert.equal(testCtxResult.runInit, false);
    assert.equal(testCtxResult.showStatus, false);

    const initResult = parseCliArgs(argv("init"));
    assert.equal(initResult.register, false);
    assert.equal(initResult.testContext, false);
    assert.equal(initResult.runInit, true);
    assert.equal(initResult.showStatus, false);

    const statusResult = parseCliArgs(argv("status"));
    assert.equal(statusResult.showStatus, true);
    assert.equal(statusResult.register, false);
    assert.equal(statusResult.runInit, false);
    assert.equal(statusResult.showConfig, false);

    const configResult = parseCliArgs(argv("config"));
    assert.equal(configResult.showConfig, true);
    assert.equal(configResult.register, false);
    assert.equal(configResult.showStatus, false);
  });
});

describe("validateConfig", () => {
  // helper: build a valid config, then override specific fields
  function makeConfig(overrides: Record<string, unknown> = {}): AoaoeConfig {
    const base: AoaoeConfig = {
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
    };
    return { ...base, ...overrides } as AoaoeConfig;
  }

  it("accepts a valid config", () => {
    assert.doesNotThrow(() => validateConfig(makeConfig()));
  });

  it("rejects invalid reasoner", () => {
    assert.throws(() => validateConfig(makeConfig({ reasoner: "gpt4" })), /reasoner must be/);
  });

  it("rejects pollIntervalMs below 1000", () => {
    assert.throws(() => validateConfig(makeConfig({ pollIntervalMs: 500 })), /pollIntervalMs/);
  });


  it("rejects captureLinesCount zero", () => {
    assert.throws(() => validateConfig(makeConfig({ captureLinesCount: 0 })), /captureLinesCount/);
  });

  it("rejects opencode.port out of range", () => {
    assert.throws(() => validateConfig(makeConfig({ opencode: { port: 0 } })), /opencode\.port/);
    assert.throws(() => validateConfig(makeConfig({ opencode: { port: 70000 } })), /opencode\.port/);
  });

  it("rejects opencode.port NaN", () => {
    assert.throws(() => validateConfig(makeConfig({ opencode: { port: NaN } })), /opencode\.port/);
  });

  it("rejects maxErrorsBeforeRestart below 1", () => {
    const config = makeConfig();
    config.policies.maxErrorsBeforeRestart = 0;
    assert.throws(() => validateConfig(config), /maxErrorsBeforeRestart/);
  });

  it("collects multiple errors", () => {
    const config = makeConfig({ reasoner: "bad", pollIntervalMs: 100 });
    assert.throws(() => validateConfig(config), /reasoner.*\n.*pollIntervalMs/s);
  });

  it("rejects maxIdleBeforeNudgeMs of 0", () => {
    const config = makeConfig();
    config.policies.maxIdleBeforeNudgeMs = 0;
    assert.throws(() => validateConfig(config), /maxIdleBeforeNudgeMs/);
  });

  it("rejects maxIdleBeforeNudgeMs below pollIntervalMs", () => {
    const config = makeConfig({ pollIntervalMs: 10_000 });
    config.policies.maxIdleBeforeNudgeMs = 5_000; // less than 10_000
    assert.throws(() => validateConfig(config), /maxIdleBeforeNudgeMs/);
  });

  it("accepts config without actionCooldownMs (optional)", () => {
    const config = makeConfig();
    delete config.policies.actionCooldownMs;
    assert.doesNotThrow(() => validateConfig(config));
  });

  it("rejects actionCooldownMs of 0", () => {
    const config = makeConfig();
    config.policies.actionCooldownMs = 0;
    assert.throws(() => validateConfig(config), /actionCooldownMs/);
  });

  it("rejects actionCooldownMs below 1000", () => {
    const config = makeConfig();
    config.policies.actionCooldownMs = 500;
    assert.throws(() => validateConfig(config), /actionCooldownMs/);
  });

  it("rejects protectedSessions as a string", () => {
    assert.throws(
      () => validateConfig(makeConfig({ protectedSessions: "adventure" })),
      /protectedSessions must be an array/,
    );
  });

  it("accepts protectedSessions as an array", () => {
    assert.doesNotThrow(() => validateConfig(makeConfig({ protectedSessions: ["adventure"] })));
  });

  it("rejects sessionDirs as an array", () => {
    assert.throws(
      () => validateConfig(makeConfig({ sessionDirs: ["foo"] })),
      /sessionDirs must be an object/,
    );
  });

  it("rejects sessionDirs as null", () => {
    assert.throws(
      () => validateConfig(makeConfig({ sessionDirs: null })),
      /sessionDirs must be an object/,
    );
  });

  it("accepts sessionDirs as an object", () => {
    assert.doesNotThrow(() => validateConfig(makeConfig({ sessionDirs: { adventure: "/tmp" } })));
  });

  it("rejects contextFiles as a string", () => {
    assert.throws(
      () => validateConfig(makeConfig({ contextFiles: "AGENTS.md" })),
      /contextFiles must be an array/,
    );
  });

  it("accepts contextFiles as an array", () => {
    assert.doesNotThrow(() => validateConfig(makeConfig({ contextFiles: ["AGENTS.md"] })));
  });

  it("rejects claudeCode.yolo as a string", () => {
    assert.throws(
      () => validateConfig(makeConfig({ claudeCode: { yolo: "true", resume: true } })),
      /claudeCode\.yolo must be a boolean/,
    );
  });

  it("rejects claudeCode.resume as a number", () => {
    assert.throws(
      () => validateConfig(makeConfig({ claudeCode: { yolo: true, resume: 1 } })),
      /claudeCode\.resume must be a boolean/,
    );
  });

  it("accepts claudeCode.yolo and resume as booleans", () => {
    assert.doesNotThrow(() => validateConfig(makeConfig({ claudeCode: { yolo: false, resume: false } })));
  });

  it("rejects aoe.profile as empty string", () => {
    assert.throws(
      () => validateConfig(makeConfig({ aoe: { profile: "" } })),
      /aoe\.profile must be a non-empty string/,
    );
  });

  it("rejects aoe.profile as a number", () => {
    assert.throws(
      () => validateConfig(makeConfig({ aoe: { profile: 42 } })),
      /aoe\.profile must be a non-empty string/,
    );
  });

  it("accepts aoe.profile as a valid string", () => {
    assert.doesNotThrow(() => validateConfig(makeConfig({ aoe: { profile: "work" } })));
  });

  it("rejects policies.autoAnswerPermissions as a string", () => {
    const config = makeConfig();
    (config.policies as Record<string, unknown>).autoAnswerPermissions = "true";
    assert.throws(() => validateConfig(config), /autoAnswerPermissions must be a boolean/);
  });

  it("rejects policies.userActivityThresholdMs as a string", () => {
    const config = makeConfig();
    (config.policies as Record<string, unknown>).userActivityThresholdMs = "30000";
    assert.throws(() => validateConfig(config), /userActivityThresholdMs must be a number/);
  });

  it("rejects policies.userActivityThresholdMs as negative", () => {
    const config = makeConfig();
    config.policies.userActivityThresholdMs = -1;
    assert.throws(() => validateConfig(config), /userActivityThresholdMs must be a number >= 0/);
  });

  it("accepts policies.userActivityThresholdMs as 0", () => {
    const config = makeConfig();
    config.policies.userActivityThresholdMs = 0;
    assert.doesNotThrow(() => validateConfig(config));
  });

  it("rejects policies.allowDestructive as a string", () => {
    const config = makeConfig();
    (config.policies as Record<string, unknown>).allowDestructive = "false";
    assert.throws(() => validateConfig(config), /allowDestructive must be a boolean/);
  });

  it("accepts policies.allowDestructive as true", () => {
    const config = makeConfig();
    config.policies.allowDestructive = true;
    assert.doesNotThrow(() => validateConfig(config));
  });
});

describe("deepMerge", () => {
  it("merges flat objects", () => {
    const result = deepMerge(
      { verbose: false, dryRun: false } as unknown as Record<string, unknown>,
      { verbose: true } as unknown as Record<string, unknown>,
    );
    assert.equal(result.verbose, true);
  });

  it("deep merges nested objects", () => {
    const base = {
      opencode: { port: 4097 },
      policies: { maxIdleBeforeNudgeMs: 120000 },
    };
    const override = {
      opencode: { port: 9999, model: "gpt-4o" },
    };
    const result = deepMerge(
      base as unknown as Record<string, unknown>,
      override as unknown as Record<string, unknown>,
    );
    assert.equal(result.opencode.port, 9999);
    assert.equal(result.opencode.model, "gpt-4o");
    // policies should be preserved from base
    assert.equal(result.policies.maxIdleBeforeNudgeMs, 120000);
  });

  it("does not overwrite with null or undefined", () => {
    const result = deepMerge(
      { verbose: true } as unknown as Record<string, unknown>,
      { verbose: undefined } as unknown as Record<string, unknown>,
    );
    assert.equal(result.verbose, true);
  });

  it("merges three objects in order", () => {
    const result = deepMerge(
      { pollIntervalMs: 10000 } as unknown as Record<string, unknown>,
      { pollIntervalMs: 5000 } as unknown as Record<string, unknown>,
      { pollIntervalMs: 2000 } as unknown as Record<string, unknown>,
    );
    assert.equal(result.pollIntervalMs, 2000);
  });

  it("clears nested object when override is empty {}", () => {
    const base = { sessionDirs: { foo: "/bar", baz: "/qux" } } as unknown as Record<string, unknown>;
    const override = { sessionDirs: {} } as unknown as Record<string, unknown>;
    const result = deepMerge(base, override);
    assert.deepEqual(result.sessionDirs, {});
  });

  it("replaces nested object when override is empty {}", () => {
    const base = { policies: { maxIdleBeforeNudgeMs: 120000, maxErrorsBeforeRestart: 3 } } as unknown as Record<string, unknown>;
    const override = { policies: {} } as unknown as Record<string, unknown>;
    const result = deepMerge(base, override);
    assert.deepEqual(result.policies, {});
  });

  it("still deep merges non-empty objects", () => {
    const base = { opencode: { port: 4097, model: "old" } } as unknown as Record<string, unknown>;
    const override = { opencode: { model: "new" } } as unknown as Record<string, unknown>;
    const result = deepMerge(base, override);
    assert.equal(result.opencode.port, 4097);
    assert.equal(result.opencode.model, "new");
  });
});

describe("parseCliArgs missing flag values", () => {
  const argv = (...args: string[]) => ["node", "aoaoe", ...args];

  it("throws when --reasoner has no value", () => {
    assert.throws(() => parseCliArgs(argv("--reasoner")), /--reasoner requires a value/);
  });

  it("throws when --poll-interval has no value", () => {
    assert.throws(() => parseCliArgs(argv("--poll-interval")), /--poll-interval requires a value/);
  });

  it("throws when --port has no value", () => {
    assert.throws(() => parseCliArgs(argv("--port")), /--port requires a value/);
  });

  it("throws when --model has no value", () => {
    assert.throws(() => parseCliArgs(argv("--model")), /--model requires a value/);
  });

  it("throws when --profile has no value", () => {
    assert.throws(() => parseCliArgs(argv("--profile")), /--profile requires a value/);
  });

  it("throws when --reasoner is the last arg", () => {
    assert.throws(() => parseCliArgs(argv("--verbose", "--reasoner")), /--reasoner requires a value/);
  });

  it("throws when --reasoner has invalid value", () => {
    assert.throws(() => parseCliArgs(argv("--reasoner", "gpt-4")), /must be "opencode" or "claude-code"/);
  });
});

// ── actionSession / actionDetail helpers ────────────────────────────────────

describe("actionSession", () => {
  it("returns session for send_input", () => {
    const a: Action = { action: "send_input", session: "abc", text: "hello" };
    assert.equal(actionSession(a), "abc");
  });

  it("returns session for start_session", () => {
    const a: Action = { action: "start_session", session: "xyz" };
    assert.equal(actionSession(a), "xyz");
  });

  it("returns title for create_agent", () => {
    const a: Action = { action: "create_agent", path: "/tmp", title: "test", tool: "opencode" };
    assert.equal(actionSession(a), "test");
  });

  it("returns undefined for wait", () => {
    const a: Action = { action: "wait", reason: "idle" };
    assert.equal(actionSession(a), undefined);
  });
});

describe("actionDetail", () => {
  it("returns text for send_input", () => {
    const a: Action = { action: "send_input", session: "abc", text: "do stuff" };
    assert.equal(actionDetail(a), "do stuff");
  });

  it("returns summary for report_progress", () => {
    const a: Action = { action: "report_progress", session: "abc", summary: "fixed bug" };
    assert.equal(actionDetail(a), "fixed bug");
  });

  it("returns summary for complete_task", () => {
    const a: Action = { action: "complete_task", session: "abc", summary: "done" };
    assert.equal(actionDetail(a), "done");
  });

  it("returns reason for wait", () => {
    const a: Action = { action: "wait", reason: "all good" };
    assert.equal(actionDetail(a), "all good");
  });

  it("returns undefined for start_session (no detail field)", () => {
    const a: Action = { action: "start_session", session: "abc" };
    assert.equal(actionDetail(a), undefined);
  });

  it("returns undefined for wait without reason", () => {
    const a: Action = { action: "wait" };
    assert.equal(actionDetail(a), undefined);
  });
});

describe("toSessionStatus", () => {
  it("returns valid status unchanged", () => {
    assert.equal(toSessionStatus("working"), "working");
    assert.equal(toSessionStatus("idle"), "idle");
    assert.equal(toSessionStatus("error"), "error");
    assert.equal(toSessionStatus("stopped"), "stopped");
  });

  it("returns 'unknown' for invalid string", () => {
    assert.equal(toSessionStatus("banana"), "unknown");
    assert.equal(toSessionStatus("WORKING"), "unknown"); // case-sensitive
  });

  it("returns 'unknown' for null/undefined", () => {
    assert.equal(toSessionStatus(null), "unknown");
    assert.equal(toSessionStatus(undefined), "unknown");
  });

  it("returns 'unknown' for non-string input", () => {
    assert.equal(toSessionStatus(42), "unknown");
    assert.equal(toSessionStatus(true), "unknown");
  });
});

// ── toTaskState ─────────────────────────────────────────────────────────────

describe("toTaskState", () => {
  const valid = {
    repo: "github/adventure",
    sessionTitle: "adventure",
    tool: "opencode",
    goal: "build it",
    status: "active",
    progress: [],
  };

  it("accepts a valid task state object", () => {
    const result = toTaskState(valid);
    assert.ok(result);
    assert.equal(result.repo, "github/adventure");
    assert.equal(result.status, "active");
    assert.deepEqual(result.progress, []);
  });

  it("accepts all valid statuses", () => {
    for (const s of ["pending", "active", "completed", "paused", "failed"]) {
      assert.ok(toTaskState({ ...valid, status: s }));
    }
  });

  it("rejects null/undefined/primitives", () => {
    assert.equal(toTaskState(null), null);
    assert.equal(toTaskState(undefined), null);
    assert.equal(toTaskState("string"), null);
    assert.equal(toTaskState(42), null);
  });

  it("rejects missing required fields", () => {
    assert.equal(toTaskState({ ...valid, repo: undefined }), null);
    assert.equal(toTaskState({ ...valid, sessionTitle: 42 }), null);
    assert.equal(toTaskState({ ...valid, tool: undefined }), null);
    assert.equal(toTaskState({ ...valid, goal: undefined }), null);
    assert.equal(toTaskState({ ...valid, progress: "not-array" }), null);
  });

  it("rejects invalid status values", () => {
    assert.equal(toTaskState({ ...valid, status: "banana" }), null);
    assert.equal(toTaskState({ ...valid, status: 42 }), null);
  });

  it("preserves optional fields when present", () => {
    const result = toTaskState({ ...valid, sessionId: "abc-123", createdAt: 1000, lastProgressAt: 2000, completedAt: 3000 });
    assert.ok(result);
    assert.equal(result.sessionId, "abc-123");
    assert.equal(result.createdAt, 1000);
    assert.equal(result.lastProgressAt, 2000);
    assert.equal(result.completedAt, 3000);
  });

  it("drops optional fields with wrong types", () => {
    const result = toTaskState({ ...valid, sessionId: 42, createdAt: "not-a-number" });
    assert.ok(result);
    assert.equal(result.sessionId, undefined);
    assert.equal(result.createdAt, undefined);
  });

  it("filters invalid progress entries", () => {
    const result = toTaskState({ ...valid, progress: [
      { at: 1000, summary: "did stuff" },
      { at: "bad", summary: "nope" },
      null,
      { at: 2000, summary: "more stuff" },
    ]});
    assert.ok(result);
    assert.equal(result.progress.length, 2);
  });
});

// ── toDaemonState ───────────────────────────────────────────────────────────

describe("toDaemonState", () => {
  const valid = {
    tickStartedAt: 1000,
    nextTickAt: 2000,
    pollIntervalMs: 10000,
    phase: "sleeping",
    phaseStartedAt: 1000,
    pollCount: 5,
    paused: false,
    sessionCount: 2,
    changeCount: 1,
    sessions: [],
  };

  it("accepts a valid daemon state", () => {
    const result = toDaemonState(valid);
    assert.ok(result);
    assert.equal(result.phase, "sleeping");
  });

  it("rejects null/undefined/primitives", () => {
    assert.equal(toDaemonState(null), null);
    assert.equal(toDaemonState(undefined), null);
    assert.equal(toDaemonState("string"), null);
  });

  it("rejects missing required fields", () => {
    assert.equal(toDaemonState({ ...valid, tickStartedAt: undefined }), null);
    assert.equal(toDaemonState({ ...valid, phase: 42 }), null);
    assert.equal(toDaemonState({ ...valid, paused: "yes" }), null);
    assert.equal(toDaemonState({ ...valid, sessions: "not-array" }), null);
  });
});

// ── toAoeSessionList ────────────────────────────────────────────────────────

describe("toAoeSessionList", () => {
  it("filters valid sessions from array", () => {
    const result = toAoeSessionList([
      { id: "abc", title: "Adventure" },
      { id: "def", title: "CHV" },
    ]);
    assert.equal(result.length, 2);
    assert.equal(result[0].title, "Adventure");
  });

  it("returns empty for non-array", () => {
    assert.deepEqual(toAoeSessionList(null), []);
    assert.deepEqual(toAoeSessionList("string"), []);
    assert.deepEqual(toAoeSessionList(42), []);
  });

  it("filters out entries missing id or title", () => {
    const result = toAoeSessionList([
      { id: "abc", title: "good" },
      { id: "def" }, // missing title
      { title: "no-id" }, // missing id
      null,
      42,
      { id: "ghi", title: "also-good" },
    ]);
    assert.equal(result.length, 2);
  });
});

// ── toReasonerBackend ───────────────────────────────────────────────────────

describe("toReasonerBackend", () => {
  it("accepts valid backends", () => {
    assert.equal(toReasonerBackend("opencode"), "opencode");
    assert.equal(toReasonerBackend("claude-code"), "claude-code");
  });

  it("throws for invalid backend", () => {
    assert.throws(() => toReasonerBackend("gpt-4"), /must be "opencode" or "claude-code"/);
    assert.throws(() => toReasonerBackend(""), /must be "opencode" or "claude-code"/);
  });
});

// ── warnUnknownKeys ─────────────────────────────────────────────────────────

describe("warnUnknownKeys", () => {
  // capture stderr warnings emitted by warnUnknownKeys
  function captureWarnings(fn: () => void): string[] {
    const original = console.error;
    const warnings: string[] = [];
    console.error = (msg: string) => warnings.push(msg);
    try { fn(); } finally { console.error = original; }
    return warnings;
  }

  it("produces no warnings for valid top-level keys", () => {
    const warnings = captureWarnings(() =>
      warnUnknownKeys({ reasoner: "opencode", pollIntervalMs: 10000, verbose: true }, "test.json"),
    );
    assert.equal(warnings.length, 0);
  });

  it("warns on unknown top-level key", () => {
    const warnings = captureWarnings(() =>
      warnUnknownKeys({ reasoner: "opencode", typo_key: true }, "test.json"),
    );
    assert.equal(warnings.length, 1);
    assert.ok(warnings[0].includes("typo_key"));
    assert.ok(warnings[0].includes("test.json"));
  });

  it("warns on multiple unknown top-level keys", () => {
    const warnings = captureWarnings(() =>
      warnUnknownKeys({ foo: 1, bar: 2, reasoner: "opencode" }, "test.json"),
    );
    assert.equal(warnings.length, 2);
  });

  it("produces no warnings for valid nested keys", () => {
    const warnings = captureWarnings(() =>
      warnUnknownKeys({ opencode: { port: 4097, model: "gpt-4o" }, policies: { maxErrorsBeforeRestart: 3 } }, "test.json"),
    );
    assert.equal(warnings.length, 0);
  });

  it("warns on unknown nested key", () => {
    const warnings = captureWarnings(() =>
      warnUnknownKeys({ opencode: { port: 4097, bogus: true } }, "test.json"),
    );
    assert.equal(warnings.length, 1);
    assert.ok(warnings[0].includes("opencode.bogus"));
    assert.ok(warnings[0].includes("test.json"));
  });

  it("warns on unknown nested key in policies", () => {
    const warnings = captureWarnings(() =>
      warnUnknownKeys({ policies: { maxErrorsBeforeRestart: 3, fakePolicy: true } }, "test.json"),
    );
    assert.equal(warnings.length, 1);
    assert.ok(warnings[0].includes("policies.fakePolicy"));
  });

  it("is a no-op for non-object input", () => {
    const warnings = captureWarnings(() => {
      warnUnknownKeys(null, "test.json");
      warnUnknownKeys(undefined, "test.json");
      warnUnknownKeys("string", "test.json");
      warnUnknownKeys(42, "test.json");
      warnUnknownKeys([], "test.json");
    });
    assert.equal(warnings.length, 0);
  });

  it("skips nested check when nested value is not an object", () => {
    // opencode expects a Set of valid sub-keys, but if the value is a string, skip
    const warnings = captureWarnings(() =>
      warnUnknownKeys({ opencode: "not-an-object" }, "test.json"),
    );
    assert.equal(warnings.length, 0);
  });

  it("includes source path in warning messages", () => {
    const warnings = captureWarnings(() =>
      warnUnknownKeys({ unknownField: true }, "/home/user/.aoaoe/aoaoe.config.json"),
    );
    assert.ok(warnings[0].includes("/home/user/.aoaoe/aoaoe.config.json"));
  });
});
