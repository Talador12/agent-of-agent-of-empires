import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { createHeatmapState, recordProgress, getHeatmapGrid, peakHour, formatProgressHeatmap } from "./goal-progress-heatmap.js";

describe("createHeatmapState", () => {
  it("starts empty", () => { assert.equal(createHeatmapState().grid.size, 0); });
});

describe("recordProgress", () => {
  it("records delta at correct hour", () => {
    const s = createHeatmapState();
    recordProgress(s, "alpha", 14, 10);
    assert.equal(s.grid.get("alpha")![14], 10);
  });
  it("accumulates deltas", () => {
    const s = createHeatmapState();
    recordProgress(s, "alpha", 10, 5);
    recordProgress(s, "alpha", 10, 3);
    assert.equal(s.grid.get("alpha")![10], 8);
  });
  it("clamps hour to 0-23", () => {
    const s = createHeatmapState();
    recordProgress(s, "alpha", 25, 10);
    assert.equal(s.grid.get("alpha")![23], 10); // clamped to 23
  });
  it("ignores negative deltas", () => {
    const s = createHeatmapState();
    recordProgress(s, "alpha", 5, -10);
    assert.equal(s.grid.get("alpha")![5], 0);
  });
});

describe("getHeatmapGrid", () => {
  it("returns all sessions", () => {
    const s = createHeatmapState();
    recordProgress(s, "a", 0, 1);
    recordProgress(s, "b", 0, 1);
    assert.equal(getHeatmapGrid(s).length, 2);
  });
});

describe("peakHour", () => {
  it("finds peak hour", () => {
    const s = createHeatmapState();
    recordProgress(s, "a", 14, 20);
    recordProgress(s, "b", 14, 15);
    recordProgress(s, "a", 3, 5);
    const peak = peakHour(s);
    assert.ok(peak);
    assert.equal(peak!.hour, 14);
    assert.equal(peak!.total, 35);
  });
  it("returns null for empty state", () => {
    assert.equal(peakHour(createHeatmapState()), null);
  });
});

describe("formatProgressHeatmap", () => {
  it("shows no-data message when empty", () => {
    const lines = formatProgressHeatmap(createHeatmapState());
    assert.ok(lines[0].includes("no data"));
  });
  it("shows heatmap with legend", () => {
    const s = createHeatmapState();
    recordProgress(s, "alpha", 10, 5);
    recordProgress(s, "alpha", 14, 20);
    const lines = formatProgressHeatmap(s);
    assert.ok(lines[0].includes("Progress Heatmap"));
    assert.ok(lines.some((l) => l.includes("Legend")));
    assert.ok(lines.some((l) => l.includes("alpha")));
  });
});
