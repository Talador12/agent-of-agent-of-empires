import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { verifyCompletion, formatVerification } from "./goal-completion-verifier.js";

describe("verifyCompletion", () => {
  it("passes with strong positive signals", () => {
    const output = "All 42 tests passed\nBuild succeeded\nPushed to main";
    const result = verifyCompletion("alpha", "implement auth", output);
    assert.ok(result.passed);
    assert.equal(result.confidence, "high");
    assert.equal(result.recommendation, "confirm-complete");
    assert.ok(result.signals.filter((s) => s.type === "positive").length >= 2);
  });

  it("fails with negative signals", () => {
    const output = "FAILED: 3 tests fail\nBuild error on line 42";
    const result = verifyCompletion("beta", "fix bug", output);
    assert.ok(!result.passed);
    assert.equal(result.recommendation, "revert-to-active");
  });

  it("returns needs-review with no signals", () => {
    const output = "doing some work\nthinking about things\nstill going";
    const result = verifyCompletion("gamma", "refactor code", output);
    assert.equal(result.confidence, "low");
    assert.equal(result.recommendation, "needs-review");
  });

  it("returns needs-review with single negative signal", () => {
    const output = "deployed successfully\nBut there was a merge conflict in main";
    const result = verifyCompletion("delta", "deploy", output);
    assert.ok(!result.passed);
    assert.equal(result.recommendation, "needs-review");
  });

  it("detects mixed signals with negative winning", () => {
    const output = "42 tests passed\nBut FAILED: integration test broken";
    const result = verifyCompletion("epsilon", "test all", output);
    assert.ok(!result.passed);
    assert.ok(result.signals.some((s) => s.type === "negative"));
    assert.ok(result.signals.some((s) => s.type === "positive"));
  });

  it("handles empty output", () => {
    const result = verifyCompletion("zeta", "build thing", "");
    assert.equal(result.confidence, "low");
  });

  it("detects PR activity as positive", () => {
    const output = "PR created: #42 - Add feature";
    const result = verifyCompletion("eta", "add feature", output);
    assert.ok(result.signals.some((s) => s.pattern === "PR activity"));
  });

  it("detects crash indicators as negative", () => {
    const output = "panic: runtime error: index out of range";
    const result = verifyCompletion("theta", "optimize", output);
    assert.ok(!result.passed);
    assert.ok(result.signals.some((s) => s.pattern === "crash indicator"));
  });
});

describe("formatVerification", () => {
  it("shows no-tasks message when empty", () => {
    const lines = formatVerification([]);
    assert.ok(lines[0].includes("no completed tasks"));
  });

  it("shows verification details", () => {
    const result = verifyCompletion("test", "fix bug", "All 10 tests passed\nPushed to main");
    const lines = formatVerification([result]);
    assert.ok(lines.some((l) => l.includes("test")));
    assert.ok(lines.some((l) => l.includes("confirm-complete")));
  });

  it("shows negative signal warnings", () => {
    const result = verifyCompletion("broken", "fix", "FAILED: 5 tests fail");
    const lines = formatVerification([result]);
    assert.ok(lines.some((l) => l.includes("⚠")));
  });
});
