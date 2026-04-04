import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { extractOutputKeywords, computeCorrelation, findCorrelations, formatCorrelationPairs } from "./session-output-correlation.js";

describe("extractOutputKeywords", () => {
  it("extracts meaningful words", () => {
    const kw = extractOutputKeywords("running tests for authentication module\nauthentication passed");
    assert.ok(kw.includes("authentication"));
    assert.ok(kw.includes("tests"));
  });
  it("filters short words and stopwords", () => {
    const kw = extractOutputKeywords("the a an is in on to for");
    assert.equal(kw.length, 0);
  });
  it("strips ANSI codes", () => {
    const kw = extractOutputKeywords("\x1b[31mauthentication\x1b[0m module");
    assert.ok(kw.includes("authentication"));
  });
  it("limits to maxKeywords", () => {
    const text = Array.from({ length: 100 }, (_, i) => `keyword${i}`).join(" ");
    const kw = extractOutputKeywords(text, 10);
    assert.equal(kw.length, 10);
  });
});

describe("computeCorrelation", () => {
  it("computes high similarity for same keywords", () => {
    const p = computeCorrelation("a", ["auth", "login", "user"], "b", ["auth", "login", "token"]);
    assert.ok(p.similarityScore > 30);
    assert.ok(p.sharedKeywords.includes("auth"));
    assert.ok(p.sharedKeywords.includes("login"));
  });
  it("computes zero for no overlap", () => {
    const p = computeCorrelation("a", ["auth", "login"], "b", ["database", "migration"]);
    assert.equal(p.similarityScore, 0);
  });
});

describe("findCorrelations", () => {
  it("finds correlated sessions", () => {
    const pairs = findCorrelations([
      { title: "auth", output: "working on authentication module login system token validation" },
      { title: "login", output: "building login page with authentication token refresh system" },
      { title: "db", output: "running database migration with schema update foreign keys" },
    ], 10);
    assert.ok(pairs.some((p) => (p.sessionA === "auth" && p.sessionB === "login") || (p.sessionA === "login" && p.sessionB === "auth")));
  });
  it("returns empty for unrelated sessions", () => {
    const pairs = findCorrelations([
      { title: "a", output: "authentication" },
      { title: "b", output: "database migration" },
    ], 50);
    assert.equal(pairs.length, 0);
  });
  it("sorts by similarity descending", () => {
    const pairs = findCorrelations([
      { title: "a", output: "auth login token user session" },
      { title: "b", output: "auth login token user session validation" },
      { title: "c", output: "auth test" },
    ], 5);
    if (pairs.length >= 2) assert.ok(pairs[0].similarityScore >= pairs[1].similarityScore);
  });
});

describe("formatCorrelationPairs", () => {
  it("shows no-related message when empty", () => {
    const lines = formatCorrelationPairs([]);
    assert.ok(lines[0].includes("no related"));
  });
  it("shows correlation details", () => {
    const pairs = findCorrelations([
      { title: "alpha", output: "authentication module login system token" },
      { title: "beta", output: "authentication token login validation system" },
    ], 5);
    const lines = formatCorrelationPairs(pairs);
    assert.ok(lines[0].includes("Output Correlation"));
  });
});
