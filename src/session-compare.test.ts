import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { compareSessions, formatComparison } from "./session-compare.js";

describe("compareSessions", () => {
  it("compares two sessions", () => {
    const a = { session: { id: "1", title: "fast", tool: "opencode", status: "working" as const, costStr: "$3.00" }, task: { repo: "t", sessionTitle: "fast", sessionMode: "auto" as const, tool: "opencode", goal: "implement auth", status: "active" as const, progress: [{ at: 1, summary: "done" }] } };
    const b = { session: { id: "2", title: "slow", tool: "opencode", status: "error" as const, costStr: "$10.00" }, task: { repo: "t", sessionTitle: "slow", sessionMode: "auto" as const, tool: "opencode", goal: "implement auth", status: "active" as const, progress: [] } };
    const cmp = compareSessions(a, b);
    assert.equal(cmp.titleA, "fast");
    assert.equal(cmp.titleB, "slow");
    assert.ok(cmp.fields.some((f) => f.label === "Cost" && f.winner === "a")); // $3 < $10
    assert.ok(cmp.fields.some((f) => f.label === "Progress entries" && f.winner === "a")); // 1 > 0
  });
});

describe("formatComparison", () => {
  it("shows side-by-side", () => {
    const a = { session: { id: "1", title: "A", tool: "opencode", status: "working" as const } };
    const b = { session: { id: "2", title: "B", tool: "opencode", status: "idle" as const } };
    const cmp = compareSessions(a, b);
    const lines = formatComparison(cmp);
    assert.ok(lines[0].includes("Compare"));
    assert.ok(lines.some((l) => l.includes("Status")));
  });
});
