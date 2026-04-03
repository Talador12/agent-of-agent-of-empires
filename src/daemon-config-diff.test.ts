import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { createConfigDiffState, recordConfig, computeConfigDiff, recentDiffs, formatConfigDiff } from "./daemon-config-diff.js";

describe("createConfigDiffState", () => {
  it("starts empty", () => {
    const state = createConfigDiffState();
    assert.equal(state.snapshots.length, 0);
  });
});

describe("recordConfig", () => {
  it("records a snapshot", () => {
    const state = createConfigDiffState();
    recordConfig(state, { pollIntervalMs: 10_000 });
    assert.equal(state.snapshots.length, 1);
  });

  it("enforces max snapshots", () => {
    const state = createConfigDiffState(3);
    for (let i = 0; i < 5; i++) recordConfig(state, { v: i });
    assert.equal(state.snapshots.length, 3);
  });
});

describe("computeConfigDiff", () => {
  it("returns null with only one snapshot", () => {
    const state = createConfigDiffState();
    recordConfig(state, { a: 1 });
    assert.equal(computeConfigDiff(state), null);
  });

  it("detects no changes", () => {
    const state = createConfigDiffState();
    recordConfig(state, { a: 1, b: "hello" });
    recordConfig(state, { a: 1, b: "hello" });
    const diff = computeConfigDiff(state)!;
    assert.ok(!diff.hasChanges);
    assert.equal(diff.changes.length, 0);
  });

  it("detects changed values", () => {
    const state = createConfigDiffState();
    recordConfig(state, { pollIntervalMs: 10_000 });
    recordConfig(state, { pollIntervalMs: 5_000 });
    const diff = computeConfigDiff(state)!;
    assert.ok(diff.hasChanges);
    assert.equal(diff.changes.length, 1);
    assert.equal(diff.changes[0].type, "changed");
    assert.equal(diff.changes[0].oldValue, 10_000);
    assert.equal(diff.changes[0].newValue, 5_000);
  });

  it("detects added fields", () => {
    const state = createConfigDiffState();
    recordConfig(state, { a: 1 });
    recordConfig(state, { a: 1, b: 2 });
    const diff = computeConfigDiff(state)!;
    assert.ok(diff.changes.some((c) => c.type === "added" && c.path === "b"));
  });

  it("detects removed fields", () => {
    const state = createConfigDiffState();
    recordConfig(state, { a: 1, b: 2 });
    recordConfig(state, { a: 1 });
    const diff = computeConfigDiff(state)!;
    assert.ok(diff.changes.some((c) => c.type === "removed" && c.path === "b"));
  });

  it("diffs nested objects", () => {
    const state = createConfigDiffState();
    recordConfig(state, { policies: { maxIdle: 60_000 } });
    recordConfig(state, { policies: { maxIdle: 30_000 } });
    const diff = computeConfigDiff(state)!;
    assert.ok(diff.changes.some((c) => c.path === "policies.maxIdle"));
  });
});

describe("recentDiffs", () => {
  it("returns recent diffs in reverse order", () => {
    const state = createConfigDiffState();
    recordConfig(state, { a: 1 }, 1000);
    recordConfig(state, { a: 2 }, 2000);
    recordConfig(state, { a: 3 }, 3000);
    const diffs = recentDiffs(state, 5);
    assert.equal(diffs.length, 2);
    assert.equal(diffs[0].timestamp, 3000);
  });
});

describe("formatConfigDiff", () => {
  it("shows need-more-snapshots message", () => {
    const lines = formatConfigDiff(null);
    assert.ok(lines[0].includes("one snapshot"));
  });

  it("shows no-changes message", () => {
    const state = createConfigDiffState();
    recordConfig(state, { a: 1 });
    recordConfig(state, { a: 1 });
    const lines = formatConfigDiff(computeConfigDiff(state));
    assert.ok(lines[0].includes("no changes"));
  });

  it("shows change details", () => {
    const state = createConfigDiffState();
    recordConfig(state, { poll: 10_000 });
    recordConfig(state, { poll: 5_000 });
    const lines = formatConfigDiff(computeConfigDiff(state));
    assert.ok(lines[0].includes("Config Diff"));
    assert.ok(lines.some((l) => l.includes("poll")));
  });
});
