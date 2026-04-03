import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { createExecution, advanceExecution, skipStep, failExecution, formatExecution } from "./runbook-executor.js";
import type { GeneratedRunbook } from "./runbook-generator.js";

function makeRunbook(): GeneratedRunbook {
  return {
    title: "Test Recovery",
    scenario: "test scenario",
    steps: [
      { action: "check", detail: "check the thing", frequency: 5 },
      { action: "fix", detail: "fix the thing", frequency: 3 },
      { action: "verify", detail: "verify the fix", frequency: 2 },
    ],
    basedOnEvents: 10,
    confidence: "medium",
  };
}

describe("createExecution", () => {
  it("creates execution with all steps pending", () => {
    const exec = createExecution(makeRunbook());
    assert.equal(exec.steps.length, 3);
    assert.ok(exec.steps.every((s) => s.status === "pending"));
    assert.equal(exec.status, "pending");
  });
});

describe("advanceExecution", () => {
  it("advances through steps sequentially", () => {
    const exec = createExecution(makeRunbook());
    const s1 = advanceExecution(exec);
    assert.ok(s1);
    assert.equal(s1.action, "check");
    assert.equal(s1.status, "running");
    assert.equal(exec.status, "running");

    const s2 = advanceExecution(exec, "checked OK");
    assert.ok(s2);
    assert.equal(s2.action, "fix");
    assert.equal(exec.steps[0].status, "completed");
    assert.equal(exec.steps[0].result, "checked OK");
  });

  it("completes after all steps", () => {
    const exec = createExecution(makeRunbook());
    advanceExecution(exec);
    advanceExecution(exec);
    advanceExecution(exec);
    const done = advanceExecution(exec, "verified");
    assert.equal(done, null);
    assert.equal(exec.status, "completed");
    assert.ok(exec.completedAt);
  });

  it("returns null for already completed execution", () => {
    const exec = createExecution(makeRunbook());
    exec.status = "completed";
    assert.equal(advanceExecution(exec), null);
  });
});

describe("skipStep", () => {
  it("marks current step as skipped", () => {
    const exec = createExecution(makeRunbook());
    advanceExecution(exec);
    skipStep(exec);
    assert.equal(exec.steps[0].status, "skipped");
  });
});

describe("failExecution", () => {
  it("marks execution as failed with reason", () => {
    const exec = createExecution(makeRunbook());
    advanceExecution(exec);
    failExecution(exec, "something broke");
    assert.equal(exec.status, "failed");
    assert.equal(exec.steps[0].result, "something broke");
  });
});

describe("formatExecution", () => {
  it("shows steps with status icons", () => {
    const exec = createExecution(makeRunbook());
    advanceExecution(exec);
    const lines = formatExecution(exec);
    assert.ok(lines[0].includes("Test Recovery"));
    assert.ok(lines.some((l) => l.includes("▶"))); // running step
    assert.ok(lines.some((l) => l.includes("○"))); // pending steps
  });
});
