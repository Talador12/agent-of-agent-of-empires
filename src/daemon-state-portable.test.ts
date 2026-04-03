import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { exportState, validateImport, stateSummary, formatStateExport } from "./daemon-state-portable.js";

describe("exportState", () => {
  it("produces a portable state object", () => {
    const s = exportState({
      daemonVersion: "5.2.0", tasks: [{ title: "alpha" }],
      config: { reasoner: "opencode", pollIntervalMs: 10000 },
      healthScore: 85, uptimeMs: 7_200_000, tickCount: 500,
      moduleCount: 141, commandCount: 142, testCount: 4275,
    });
    assert.equal(s.version, "1.0");
    assert.equal(s.daemonVersion, "5.2.0");
    assert.equal(s.state.tasks.length, 1);
    assert.equal(s.state.healthScore, 85);
    assert.equal(s.state.moduleCount, 141);
  });

  it("sanitizes secrets in config", () => {
    const s = exportState({
      daemonVersion: "5.2.0", tasks: [],
      config: { apiKey: "sk-secret", nested: { secretToken: "abc" } },
      healthScore: 0, uptimeMs: 0, tickCount: 0,
      moduleCount: 0, commandCount: 0, testCount: 0,
    });
    assert.equal(s.state.config.apiKey, "[REDACTED]");
    assert.equal((s.state.config.nested as Record<string, unknown>).secretToken, "[REDACTED]");
  });

  it("includes metadata", () => {
    const s = exportState({
      daemonVersion: "5.2.0", tasks: [], config: {},
      healthScore: 0, uptimeMs: 0, tickCount: 0,
      moduleCount: 0, commandCount: 0, testCount: 0,
    });
    assert.ok(s.metadata.nodeVersion);
    assert.ok(s.metadata.platform);
  });

  it("includes timestamp", () => {
    const s = exportState({
      daemonVersion: "5.2.0", tasks: [], config: {},
      healthScore: 0, uptimeMs: 0, tickCount: 0,
      moduleCount: 0, commandCount: 0, testCount: 0,
    });
    assert.ok(s.exportedAt);
    assert.ok(s.exportedAt.includes("T")); // ISO format
  });
});

describe("validateImport", () => {
  it("validates correct state", () => {
    const s = exportState({
      daemonVersion: "5.2.0", tasks: [], config: {},
      healthScore: 0, uptimeMs: 0, tickCount: 0,
      moduleCount: 0, commandCount: 0, testCount: 0,
    });
    assert.ok(validateImport(s).valid);
  });

  it("rejects null", () => {
    assert.ok(!validateImport(null).valid);
  });

  it("rejects missing fields", () => {
    assert.ok(!validateImport({}).valid);
    assert.ok(!validateImport({ version: "1.0" }).valid);
  });

  it("rejects non-object", () => {
    assert.ok(!validateImport("string").valid);
  });
});

describe("stateSummary", () => {
  it("produces readable summary", () => {
    const s = exportState({
      daemonVersion: "5.2.0", tasks: [{ a: 1 }, { b: 2 }], config: {},
      healthScore: 85, uptimeMs: 7_200_000, tickCount: 500,
      moduleCount: 141, commandCount: 142, testCount: 4275,
    });
    const summary = stateSummary(s);
    assert.ok(summary.some((l) => l.includes("5.2.0")));
    assert.ok(summary.some((l) => l.includes("Tasks: 2")));
    assert.ok(summary.some((l) => l.includes("141")));
  });
});

describe("formatStateExport", () => {
  it("shows export size", () => {
    const s = exportState({
      daemonVersion: "5.2.0", tasks: [], config: {},
      healthScore: 0, uptimeMs: 0, tickCount: 0,
      moduleCount: 0, commandCount: 0, testCount: 0,
    });
    const lines = formatStateExport(s);
    assert.ok(lines[0].includes("State Export"));
    assert.ok(lines[0].includes("KB"));
  });
});
