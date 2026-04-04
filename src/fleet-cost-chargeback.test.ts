import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { generateChargeback, formatChargeback, formatChargebackMd } from "./fleet-cost-chargeback.js";

describe("generateChargeback", () => {
  it("groups costs by tag", () => {
    const r = generateChargeback([
      { sessionTitle: "a", costUsd: 10, tags: new Map([["team", "platform"]]) },
      { sessionTitle: "b", costUsd: 5, tags: new Map([["team", "platform"]]) },
      { sessionTitle: "c", costUsd: 8, tags: new Map([["team", "frontend"]]) },
    ], "team", "2026-04");
    assert.equal(r.entries.length, 2);
    const platform = r.entries.find((e) => e.groupKey === "platform");
    assert.ok(platform);
    assert.equal(platform!.totalCostUsd, 15);
    assert.equal(platform!.sessionCount, 2);
  });
  it("tracks untagged sessions", () => {
    const r = generateChargeback([
      { sessionTitle: "a", costUsd: 10, tags: new Map([["team", "platform"]]) },
      { sessionTitle: "b", costUsd: 5, tags: new Map() },
    ], "team", "2026-04");
    assert.equal(r.untaggedSessions.length, 1);
    assert.equal(r.untaggedCostUsd, 5);
  });
  it("computes fleet percentage", () => {
    const r = generateChargeback([
      { sessionTitle: "a", costUsd: 50, tags: new Map([["team", "be"]]) },
      { sessionTitle: "b", costUsd: 50, tags: new Map([["team", "fe"]]) },
    ], "team", "2026-04");
    assert.equal(r.entries[0].pctOfFleet, 50);
  });
  it("sorts by cost descending", () => {
    const r = generateChargeback([
      { sessionTitle: "a", costUsd: 5, tags: new Map([["team", "small"]]) },
      { sessionTitle: "b", costUsd: 20, tags: new Map([["team", "big"]]) },
    ], "team", "2026-04");
    assert.equal(r.entries[0].groupKey, "big");
  });
  it("handles empty input", () => {
    const r = generateChargeback([], "team", "2026-04");
    assert.equal(r.totalCostUsd, 0);
    assert.equal(r.entries.length, 0);
  });
});

describe("formatChargeback", () => {
  it("shows report with entries", () => {
    const r = generateChargeback([
      { sessionTitle: "a", costUsd: 10, tags: new Map([["team", "platform"]]) },
    ], "team", "2026-04");
    const lines = formatChargeback(r);
    assert.ok(lines[0].includes("Chargeback"));
    assert.ok(lines.some((l) => l.includes("platform")));
  });
  it("shows no-tags message", () => {
    const r = generateChargeback([{ sessionTitle: "a", costUsd: 10, tags: new Map() }], "team", "2026-04");
    const lines = formatChargeback(r);
    assert.ok(lines.some((l) => l.includes("No tagged")));
  });
});

describe("formatChargebackMd", () => {
  it("produces markdown with table", () => {
    const r = generateChargeback([
      { sessionTitle: "a", costUsd: 10, tags: new Map([["team", "platform"]]) },
    ], "team", "2026-04");
    const md = formatChargebackMd(r);
    assert.ok(md.includes("# Cost Chargeback"));
    assert.ok(md.includes("platform"));
  });
});
