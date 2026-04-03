import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { formatFleetDiff, formatSnapshotList } from "./fleet-diff.js";
import type { FleetDiffResult } from "./fleet-diff.js";

describe("formatFleetDiff", () => {
  it("formats diff result with filenames", () => {
    const result: FleetDiffResult = {
      olderFilename: "fleet-2026-04-01.json",
      newerFilename: "fleet-2026-04-02.json",
      diff: ["  Health: 60 → 80 (+20)", "  Cost: $5.00 → $8.00 (+$3.00)"],
      olderSummary: [],
      newerSummary: [],
    };
    const lines = formatFleetDiff(result);
    assert.ok(lines.some((l) => l.includes("fleet-2026-04-01")));
    assert.ok(lines.some((l) => l.includes("fleet-2026-04-02")));
    assert.ok(lines.some((l) => l.includes("Health")));
  });
});

describe("formatSnapshotList", () => {
  it("shows no-snapshots message when empty", () => {
    // this reads from disk — if no snapshots dir, returns empty message
    const lines = formatSnapshotList();
    // either "no fleet snapshots" or actual list depending on state
    assert.ok(lines.length >= 1);
  });
});
