import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { createEvolutionState, recordWindow, detectShifts, patternTrend, formatPatternEvolution } from "./session-pattern-evolution.js";

describe("createEvolutionState", () => {
  it("starts with default patterns", () => {
    const s = createEvolutionState();
    assert.ok(s.patternNames.length >= 8);
    assert.equal(s.windows.length, 0);
  });
});

describe("recordWindow", () => {
  it("records pattern counts for a window", () => {
    const s = createEvolutionState();
    const w = recordWindow(s, ["test passed", "test passed", "build complete"]);
    assert.ok((w.patternCounts.get("test-pass") ?? 0) >= 2);
    assert.ok((w.patternCounts.get("build") ?? 0) >= 1);
  });

  it("enforces max windows", () => {
    const s = createEvolutionState(3);
    for (let i = 0; i < 5; i++) recordWindow(s, ["test passed"]);
    assert.equal(s.windows.length, 3);
  });
});

describe("detectShifts", () => {
  it("detects appeared patterns", () => {
    const s = createEvolutionState();
    recordWindow(s, ["normal output"]);
    recordWindow(s, ["ERROR: something broke"]);
    const shifts = detectShifts(s);
    assert.ok(shifts.some((sh) => sh.pattern === "error" && sh.type === "appeared"));
  });

  it("detects disappeared patterns", () => {
    const s = createEvolutionState();
    recordWindow(s, ["ERROR: bad thing"]);
    recordWindow(s, ["all good now"]);
    const shifts = detectShifts(s);
    assert.ok(shifts.some((sh) => sh.pattern === "error" && sh.type === "disappeared"));
  });

  it("detects increased patterns", () => {
    const s = createEvolutionState();
    recordWindow(s, ["error 1"]);
    recordWindow(s, ["error 1", "error 2", "error 3"]);
    const shifts = detectShifts(s, 50);
    assert.ok(shifts.some((sh) => sh.type === "increased"));
  });

  it("returns empty with insufficient windows", () => {
    const s = createEvolutionState();
    recordWindow(s, ["test"]);
    assert.equal(detectShifts(s).length, 0);
  });

  it("respects threshold", () => {
    const s = createEvolutionState();
    recordWindow(s, ["test", "test"]);
    recordWindow(s, ["test", "test", "test"]); // 50% increase
    const low = detectShifts(s, 30);
    const high = detectShifts(s, 80);
    assert.ok(low.length >= high.length);
  });
});

describe("patternTrend", () => {
  it("returns count series for a pattern", () => {
    const s = createEvolutionState();
    recordWindow(s, ["error"]);
    recordWindow(s, ["error", "error"]);
    recordWindow(s, ["error", "error", "error"]);
    const trend = patternTrend(s, "error");
    assert.deepEqual(trend, [1, 2, 3]);
  });

  it("returns zeros for unmatched pattern", () => {
    const s = createEvolutionState();
    recordWindow(s, ["hello"]);
    const trend = patternTrend(s, "error");
    assert.deepEqual(trend, [0]);
  });
});

describe("formatPatternEvolution", () => {
  it("shows no-shifts message when stable", () => {
    const s = createEvolutionState();
    recordWindow(s, ["test"]);
    recordWindow(s, ["test"]);
    const lines = formatPatternEvolution(s);
    assert.ok(lines.some((l) => l.includes("No significant")));
  });

  it("shows shifts and sparklines", () => {
    const s = createEvolutionState();
    recordWindow(s, ["normal"]);
    recordWindow(s, ["error error error"]);
    const lines = formatPatternEvolution(s);
    assert.ok(lines[0].includes("Pattern Evolution"));
  });
});
