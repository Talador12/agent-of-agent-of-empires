import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mergeHotReload, formatConfigChange, ConfigWatcher, type ConfigChange } from "./config-watcher.js";
import type { AoaoeConfig } from "./types.js";

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

// --- mergeHotReload ---

describe("mergeHotReload", () => {
  it("returns no changes for identical configs", () => {
    const config = makeConfig();
    const { changes } = mergeHotReload(config, { ...config });
    assert.equal(changes.length, 0);
  });

  it("detects and applies pollIntervalMs change", () => {
    const current = makeConfig({ pollIntervalMs: 10_000 });
    const fresh = makeConfig({ pollIntervalMs: 15_000 });
    const { config, changes } = mergeHotReload(current, fresh);
    assert.equal(config.pollIntervalMs, 15_000);
    const change = changes.find((c) => c.field === "pollIntervalMs");
    assert.ok(change);
    assert.equal(change!.applied, true);
    assert.equal(change!.oldValue, 10_000);
    assert.equal(change!.newValue, 15_000);
  });

  it("detects and applies verbose change", () => {
    const current = makeConfig({ verbose: false });
    const fresh = makeConfig({ verbose: true });
    const { config, changes } = mergeHotReload(current, fresh);
    assert.equal(config.verbose, true);
    assert.ok(changes.find((c) => c.field === "verbose" && c.applied));
  });

  it("detects and applies sessionDirs change", () => {
    const current = makeConfig({ sessionDirs: {} });
    const fresh = makeConfig({ sessionDirs: { frontend: "/path/to/frontend" } });
    const { config, changes } = mergeHotReload(current, fresh);
    assert.deepEqual(config.sessionDirs, { frontend: "/path/to/frontend" });
    assert.ok(changes.find((c) => c.field === "sessionDirs" && c.applied));
  });

  it("detects and applies protectedSessions change", () => {
    const current = makeConfig({ protectedSessions: [] });
    const fresh = makeConfig({ protectedSessions: ["prod-api"] });
    const { config, changes } = mergeHotReload(current, fresh);
    assert.deepEqual(config.protectedSessions, ["prod-api"]);
    assert.ok(changes.find((c) => c.field === "protectedSessions" && c.applied));
  });

  it("detects and applies policies change", () => {
    const current = makeConfig();
    const freshPolicies = { ...current.policies, maxIdleBeforeNudgeMs: 60_000 };
    const fresh = makeConfig({ policies: freshPolicies });
    const { config, changes } = mergeHotReload(current, fresh);
    assert.equal(config.policies.maxIdleBeforeNudgeMs, 60_000);
    assert.ok(changes.find((c) => c.field === "policies" && c.applied));
  });

  it("detects and applies notifications change", () => {
    const current = makeConfig();
    const fresh = makeConfig({ notifications: { webhookUrl: "https://example.com/hook" } });
    const { config, changes } = mergeHotReload(current, fresh);
    assert.equal(config.notifications?.webhookUrl, "https://example.com/hook");
    assert.ok(changes.find((c) => c.field === "notifications" && c.applied));
  });

  it("detects non-reloadable reasoner change", () => {
    const current = makeConfig({ reasoner: "opencode" });
    const fresh = makeConfig({ reasoner: "claude-code" });
    const { config, changes } = mergeHotReload(current, fresh);
    // reasoner should NOT be changed
    assert.equal(config.reasoner, "opencode");
    const change = changes.find((c) => c.field === "reasoner");
    assert.ok(change);
    assert.equal(change!.applied, false);
  });

  it("detects non-reloadable dryRun change", () => {
    const current = makeConfig({ dryRun: false });
    const fresh = makeConfig({ dryRun: true });
    const { config, changes } = mergeHotReload(current, fresh);
    assert.equal(config.dryRun, false); // not changed
    assert.ok(changes.find((c) => c.field === "dryRun" && !c.applied));
  });

  it("detects non-reloadable opencode.port change", () => {
    const current = makeConfig({ opencode: { port: 4097 } });
    const fresh = makeConfig({ opencode: { port: 4098 } });
    const { config, changes } = mergeHotReload(current, fresh);
    assert.equal(config.opencode.port, 4097); // not changed
    assert.ok(changes.find((c) => c.field === "opencode.port" && !c.applied));
  });

  it("handles multiple changes at once", () => {
    const current = makeConfig({ pollIntervalMs: 10_000, verbose: false });
    const fresh = makeConfig({ pollIntervalMs: 20_000, verbose: true, reasoner: "claude-code" });
    const { config, changes } = mergeHotReload(current, fresh);
    assert.equal(config.pollIntervalMs, 20_000); // applied
    assert.equal(config.verbose, true); // applied
    assert.equal(config.reasoner, "opencode"); // NOT applied
    assert.equal(changes.length, 3);
    assert.equal(changes.filter((c) => c.applied).length, 2);
    assert.equal(changes.filter((c) => !c.applied).length, 1);
  });

  it("preserves non-hot-reload fields when they haven't changed", () => {
    const current = makeConfig();
    const fresh = makeConfig({ pollIntervalMs: 20_000 });
    const { config } = mergeHotReload(current, fresh);
    assert.equal(config.reasoner, "opencode");
    assert.equal(config.opencode.port, 4097);
    assert.equal(config.dryRun, false);
    assert.equal(config.observe, false);
    assert.equal(config.confirm, false);
  });
});

// --- formatConfigChange ---

describe("formatConfigChange", () => {
  it("formats an applied change", () => {
    const change: ConfigChange = { field: "pollIntervalMs", oldValue: 10000, newValue: 15000, applied: true };
    const result = formatConfigChange(change);
    assert.ok(result.includes("pollIntervalMs"));
    assert.ok(result.includes("15000"));
    assert.ok(result.includes("applied"));
  });

  it("formats a non-applied change", () => {
    const change: ConfigChange = { field: "reasoner", oldValue: "opencode", newValue: "claude-code", applied: false };
    const result = formatConfigChange(change);
    assert.ok(result.includes("reasoner"));
    assert.ok(result.includes("requires restart"));
  });

  it("truncates long values", () => {
    const longValue = "a".repeat(100);
    const change: ConfigChange = { field: "test", oldValue: "", newValue: longValue, applied: true };
    const result = formatConfigChange(change);
    assert.ok(result.length < 150);
    assert.ok(result.includes("..."));
  });

  it("formats object values as JSON", () => {
    const change: ConfigChange = {
      field: "policies",
      oldValue: { maxIdleBeforeNudgeMs: 120000 },
      newValue: { maxIdleBeforeNudgeMs: 60000 },
      applied: true,
    };
    const result = formatConfigChange(change);
    assert.ok(result.includes("60000"));
  });
});

// --- ConfigWatcher ---

describe("ConfigWatcher", () => {
  it("constructs without throwing", () => {
    const config = makeConfig();
    const watcher = new ConfigWatcher(config);
    assert.ok(watcher);
  });

  it("getConfig returns the initial config", () => {
    const config = makeConfig({ pollIntervalMs: 12345 });
    const watcher = new ConfigWatcher(config);
    assert.equal(watcher.getConfig().pollIntervalMs, 12345);
  });

  it("stop is safe to call without start", () => {
    const config = makeConfig();
    const watcher = new ConfigWatcher(config);
    assert.doesNotThrow(() => watcher.stop());
  });

  it("stop is safe to call multiple times", () => {
    const config = makeConfig();
    const watcher = new ConfigWatcher(config);
    assert.doesNotThrow(() => {
      watcher.stop();
      watcher.stop();
    });
  });
});
