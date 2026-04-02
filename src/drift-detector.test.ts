import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { extractKeywords, computeOverlap, detectDrift, formatDriftSignals } from "./drift-detector.js";
import type { TaskState } from "./types.js";

function makeTask(goal: string): TaskState {
  return { repo: "test", sessionTitle: "test", sessionMode: "auto", tool: "opencode", goal, status: "active", progress: [] };
}

describe("extractKeywords", () => {
  it("extracts meaningful words", () => {
    const kw = extractKeywords("implement authentication login system");
    assert.ok(kw.includes("implement"));
    assert.ok(kw.includes("authentication"));
    assert.ok(kw.includes("login"));
    assert.ok(kw.includes("system"));
  });

  it("removes stop words", () => {
    const kw = extractKeywords("add the new feature to the system");
    assert.ok(!kw.includes("the"));
    assert.ok(!kw.includes("add"));
  });

  it("lowercases and deduplicates", () => {
    const kw = extractKeywords("Auth AUTH auth");
    assert.equal(kw.filter((w) => w === "auth").length, 1);
  });

  it("returns empty for empty input", () => {
    assert.deepEqual(extractKeywords(""), []);
  });
});

describe("computeOverlap", () => {
  it("returns 1 for empty goal keywords", () => {
    assert.equal(computeOverlap([], ["random"]), 1);
  });

  it("returns 0 for no overlap", () => {
    assert.equal(computeOverlap(["auth", "login"], ["music", "synth"]), 0);
  });

  it("returns 1 for full overlap", () => {
    assert.equal(computeOverlap(["auth", "login"], ["auth", "login", "extra"]), 1);
  });

  it("returns 0.5 for partial overlap", () => {
    assert.equal(computeOverlap(["auth", "login"], ["auth", "music"]), 0.5);
  });
});

describe("detectDrift", () => {
  it("detects no drift when output matches goal", () => {
    const task = makeTask("implement authentication and login system");
    const output = "editing src/auth.ts implementing the authentication module and login flow";
    const signal = detectDrift(task, output);
    assert.equal(signal.drifted, false);
  });

  it("detects drift when output is unrelated", () => {
    const task = makeTask("implement authentication and login system");
    const output = "editing music synthesizer configuration polyphony oscillator";
    const signal = detectDrift(task, output);
    assert.equal(signal.drifted, true);
  });

  it("does not flag drift for short goals", () => {
    const task = makeTask("fix bug");
    const output = "random unrelated output";
    const signal = detectDrift(task, output);
    assert.equal(signal.drifted, false); // goal < 3 keywords
  });

  it("includes overlap percentage in detail", () => {
    const task = makeTask("implement authentication and login system");
    const output = "working on authentication module";
    const signal = detectDrift(task, output);
    assert.ok(signal.detail.includes("%"));
  });
});

describe("formatDriftSignals", () => {
  it("shows no-data message for empty", () => {
    const lines = formatDriftSignals([]);
    assert.ok(lines[0].includes("no drift data"));
  });

  it("shows drift warning", () => {
    const signals = [{
      sessionTitle: "adventure",
      goalKeywords: ["auth", "login"],
      outputKeywords: ["music"],
      overlapRatio: 0,
      drifted: true,
      detail: "drift detected",
    }];
    const lines = formatDriftSignals(signals);
    assert.ok(lines[0].includes("DRIFTED"));
    assert.ok(lines[0].includes("adventure"));
  });
});
