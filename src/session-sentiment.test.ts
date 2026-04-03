import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { analyzeSentiment, analyzeFleetSentiment, formatSentiment } from "./session-sentiment.js";

describe("analyzeSentiment", () => {
  it("detects success sentiment", () => {
    const r = analyzeSentiment("alpha", "All 42 tests passed\nBuild succeeded\nPushed to main");
    assert.equal(r.sentiment, "success");
    assert.ok(r.confidence >= 40);
  });

  it("detects progress sentiment", () => {
    const r = analyzeSentiment("beta", "Working on the auth module\nCommitted changes to feature branch");
    assert.equal(r.sentiment, "progress");
  });

  it("detects blocked sentiment", () => {
    const r = analyzeSentiment("gamma", "Waiting for backend API\nBlocked by missing credentials");
    assert.equal(r.sentiment, "blocked");
  });

  it("detects frustration sentiment", () => {
    const r = analyzeSentiment("delta", "Still not working right\nTried everything but cannot figure it out");
    assert.equal(r.sentiment, "frustration");
  });

  it("detects error sentiment", () => {
    const r = analyzeSentiment("epsilon", "FATAL: compilation error\nERROR: type mismatch");
    assert.equal(r.sentiment, "error");
  });

  it("detects idle sentiment", () => {
    const r = analyzeSentiment("zeta", "some output\n$ ");
    assert.equal(r.sentiment, "idle");
  });

  it("returns neutral for ambiguous output", () => {
    const r = analyzeSentiment("eta", "doing some thing\nlooking at the code\nthinking");
    assert.equal(r.sentiment, "neutral");
  });

  it("prioritizes error over progress", () => {
    const r = analyzeSentiment("mixed", "Working on fix\nERROR: crash detected\nCommitted changes");
    assert.equal(r.sentiment, "error");
  });

  it("returns signals for detected patterns", () => {
    const r = analyzeSentiment("alpha", "All tests passed\nDeployed to production");
    assert.ok(r.signals.length > 0);
    assert.ok(r.signals.some((s) => s.sentiment === "success"));
  });

  it("confidence increases with more signals", () => {
    const low = analyzeSentiment("a", "committed");
    const high = analyzeSentiment("b", "All tests passed\nBuild succeeded\nPushed to main\nDeployed");
    assert.ok(high.confidence >= low.confidence);
  });
});

describe("analyzeFleetSentiment", () => {
  it("analyzes multiple sessions", () => {
    const results = analyzeFleetSentiment([
      { title: "a", output: "All tests passed" },
      { title: "b", output: "ERROR: crash" },
    ]);
    assert.equal(results.length, 2);
  });
});

describe("formatSentiment", () => {
  it("shows no-sessions message when empty", () => {
    const lines = formatSentiment([]);
    assert.ok(lines[0].includes("no sessions"));
  });

  it("shows sentiment with icons", () => {
    const results = analyzeFleetSentiment([{ title: "alpha", output: "All tests passed" }]);
    const lines = formatSentiment(results);
    assert.ok(lines[0].includes("Session Sentiment"));
    assert.ok(lines.some((l) => l.includes("alpha")));
  });
});
