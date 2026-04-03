import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { searchFleet, formatFleetSearchResults } from "./fleet-search.js";

function makeOutputs(): Map<string, { title: string; lines: string[] }> {
  return new Map([
    ["id-1", { title: "adventure", lines: ["Edit src/auth.ts", "error: module not found", "Tests: 50 passed, 50 total"] }],
    ["id-2", { title: "code-music", lines: ["Edit src/synth.ts", "Building...", "✓ built in 2s"] }],
  ]);
}

describe("searchFleet", () => {
  it("finds matches across sessions", () => {
    const result = searchFleet(makeOutputs(), "Edit");
    assert.equal(result.totalHits, 2);
    assert.equal(result.sessionCounts.size, 2);
  });

  it("finds case-insensitive matches", () => {
    const result = searchFleet(makeOutputs(), "edit");
    assert.ok(result.totalHits >= 2);
  });

  it("returns empty for no matches", () => {
    const result = searchFleet(makeOutputs(), "nonexistent-pattern");
    assert.equal(result.totalHits, 0);
  });

  it("limits results to maxResults", () => {
    const outputs = new Map([["id-1", { title: "a", lines: Array.from({ length: 100 }, () => "match this") }]]);
    const result = searchFleet(outputs, "match", 5);
    assert.equal(result.hits.length, 5);
    assert.equal(result.totalHits, 100);
  });

  it("scores exact case matches higher", () => {
    const outputs = new Map([["id-1", { title: "a", lines: ["Error occurred", "error found"] }]]);
    const result = searchFleet(outputs, "Error");
    assert.ok(result.hits[0].line.includes("Error")); // exact case match ranked first
  });

  it("supports regex search", () => {
    const result = searchFleet(makeOutputs(), "/\\d+ passed/");
    assert.equal(result.totalHits, 1);
    assert.equal(result.hits[0].sessionTitle, "adventure");
  });

  it("strips ANSI codes before matching", () => {
    const outputs = new Map([["id-1", { title: "a", lines: ["\x1b[32merror: bad\x1b[0m"] }]]);
    const result = searchFleet(outputs, "error");
    assert.equal(result.totalHits, 1);
  });

  it("includes match position", () => {
    const result = searchFleet(makeOutputs(), "auth");
    const hit = result.hits.find((h) => h.sessionTitle === "adventure");
    assert.ok(hit);
    assert.ok(hit.matchStart >= 0);
    assert.ok(hit.matchEnd > hit.matchStart);
  });
});

describe("formatFleetSearchResults", () => {
  it("shows no-match message", () => {
    const result = searchFleet(makeOutputs(), "zzz");
    const lines = formatFleetSearchResults(result);
    assert.ok(lines[0].includes("no matches"));
  });

  it("shows hit count and session breakdown", () => {
    const result = searchFleet(makeOutputs(), "Edit");
    const lines = formatFleetSearchResults(result);
    assert.ok(lines[0].includes("2 match"));
    assert.ok(lines.some((l) => l.includes("adventure")));
  });
});
