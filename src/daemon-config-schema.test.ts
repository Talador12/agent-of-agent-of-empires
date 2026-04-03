import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { validateConfigSchema, getSchema, formatValidation } from "./daemon-config-schema.js";

describe("validateConfigSchema", () => {
  it("passes for valid config", () => {
    const result = validateConfigSchema({ reasoner: "opencode", pollIntervalMs: 10_000, verbose: true });
    assert.ok(result.valid);
    assert.equal(result.errors.length, 0);
  });

  it("fails on missing required field", () => {
    const result = validateConfigSchema({ pollIntervalMs: 10_000 });
    assert.ok(!result.valid);
    assert.ok(result.errors.some((e) => e.field === "reasoner"));
  });

  it("fails on wrong type", () => {
    const result = validateConfigSchema({ reasoner: "opencode", pollIntervalMs: "fast" as unknown });
    assert.ok(!result.valid);
    assert.ok(result.errors.some((e) => e.field === "pollIntervalMs" && e.message.includes("number")));
  });

  it("fails on out-of-range number", () => {
    const result = validateConfigSchema({ reasoner: "opencode", pollIntervalMs: 100 });
    assert.ok(!result.valid);
    assert.ok(result.errors.some((e) => e.field === "pollIntervalMs" && e.message.includes("minimum")));
  });

  it("fails on invalid enum value", () => {
    const result = validateConfigSchema({ reasoner: "gpt-4" });
    assert.ok(!result.valid);
    assert.ok(result.errors.some((e) => e.field === "reasoner" && e.message.includes("must be one of")));
  });

  it("warns on unknown fields", () => {
    const result = validateConfigSchema({ reasoner: "opencode", totallyMadeUp: true });
    assert.ok(result.valid); // still valid, just a warning
    assert.ok(result.warnings.some((w) => w.field === "totallyMadeUp"));
  });

  it("validates nested objects", () => {
    const result = validateConfigSchema({
      reasoner: "opencode",
      policies: { maxIdleBeforeNudgeMs: -5 },
    });
    assert.ok(!result.valid);
    assert.ok(result.errors.some((e) => e.field.includes("maxIdleBeforeNudgeMs")));
  });

  it("passes with valid nested objects", () => {
    const result = validateConfigSchema({
      reasoner: "opencode",
      policies: { autoAnswerPermissions: true, maxErrorsBeforeRestart: 3 },
    });
    assert.ok(result.valid);
  });

  it("validates costBudgets nested", () => {
    const result = validateConfigSchema({
      reasoner: "opencode",
      costBudgets: { globalBudgetUsd: 50 },
    });
    assert.ok(result.valid);
  });

  it("fails on negative budget", () => {
    const result = validateConfigSchema({
      reasoner: "opencode",
      costBudgets: { globalBudgetUsd: -10 },
    });
    assert.ok(!result.valid);
  });
});

describe("getSchema", () => {
  it("returns schema fields", () => {
    const schema = getSchema();
    assert.ok(schema.length > 5);
    assert.ok(schema.some((f) => f.name === "reasoner"));
  });
});

describe("formatValidation", () => {
  it("shows VALID for clean config", () => {
    const result = validateConfigSchema({ reasoner: "opencode" });
    const lines = formatValidation(result);
    assert.ok(lines[0].includes("VALID"));
  });

  it("shows INVALID with errors", () => {
    const result = validateConfigSchema({});
    const lines = formatValidation(result);
    assert.ok(lines[0].includes("INVALID"));
    assert.ok(lines.some((l) => l.includes("✗")));
  });

  it("shows warnings", () => {
    const result = validateConfigSchema({ reasoner: "opencode", unknownField: 42 });
    const lines = formatValidation(result);
    assert.ok(lines.some((l) => l.includes("⚠")));
  });
});
