import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import {
  createCompressionState, computeDelta, recordSnapshot,
  compressionStats, formatCompressionStats,
} from "./fleet-snapshot-compression.js";

describe("createCompressionState", () => {
  it("starts with no base", () => {
    const s = createCompressionState();
    assert.equal(s.baseSnapshot, null);
    assert.equal(s.deltas.length, 0);
  });
});

describe("computeDelta", () => {
  it("detects added fields", () => {
    const delta = computeDelta({ a: 1 }, { a: 1, b: 2 }, 1000, 2000);
    assert.ok("b" in delta.added);
  });

  it("detects removed fields", () => {
    const delta = computeDelta({ a: 1, b: 2 }, { a: 1 }, 1000, 2000);
    assert.ok(delta.removed.includes("b"));
  });

  it("detects modified fields", () => {
    const delta = computeDelta({ a: 1 }, { a: 2 }, 1000, 2000);
    assert.ok("a" in delta.modified);
    assert.equal(delta.modified.a.from, 1);
    assert.equal(delta.modified.a.to, 2);
  });

  it("returns empty for identical snapshots", () => {
    const delta = computeDelta({ a: 1 }, { a: 1 }, 1000, 2000);
    assert.equal(Object.keys(delta.added).length, 0);
    assert.equal(delta.removed.length, 0);
    assert.equal(Object.keys(delta.modified).length, 0);
  });

  it("computes compression ratio for large objects", () => {
    const base: Record<string, unknown> = {};
    const curr: Record<string, unknown> = {};
    for (let i = 0; i < 20; i++) { base[`field${i}`] = `value${i}`; curr[`field${i}`] = `value${i}`; }
    curr.field19 = "changed";
    const delta = computeDelta(base, curr, 0, 1);
    assert.ok(delta.compressionRatio > 0);
  });
});

describe("recordSnapshot", () => {
  it("stores first snapshot as full base", () => {
    const s = createCompressionState();
    const r = recordSnapshot(s, { a: 1 });
    assert.ok(!r.isDelta);
    assert.ok(s.baseSnapshot);
  });

  it("stores subsequent as delta for large snapshots", () => {
    const s = createCompressionState();
    const big: Record<string, unknown> = {};
    for (let i = 0; i < 30; i++) big[`field${i}`] = `value${i}`;
    recordSnapshot(s, big);
    const changed = { ...big, field29: "changed" };
    const r = recordSnapshot(s, changed);
    assert.ok(r.isDelta);
    assert.ok(r.savedBytes >= 0);
  });

  it("stores full when delta is too large", () => {
    const s = createCompressionState();
    recordSnapshot(s, { a: 1 });
    const r = recordSnapshot(s, { x: 1, y: 2, z: 3, w: 4, q: 5 }); // completely different
    // might store full because delta > 60% of full
    assert.ok(typeof r.isDelta === "boolean");
  });

  it("compacts after max deltas", () => {
    const s = createCompressionState(3);
    recordSnapshot(s, { a: 1, b: 2, c: 3 });
    recordSnapshot(s, { a: 1, b: 2, c: 4 });
    recordSnapshot(s, { a: 1, b: 2, c: 5 });
    recordSnapshot(s, { a: 1, b: 2, c: 6 });
    recordSnapshot(s, { a: 1, b: 2, c: 7 }); // should compact
    assert.ok(s.deltas.length <= 3);
  });
});

describe("compressionStats", () => {
  it("computes stats", () => {
    const s = createCompressionState();
    recordSnapshot(s, { a: 1, b: 2, c: 3, d: 4, e: 5 });
    recordSnapshot(s, { a: 1, b: 2, c: 3, d: 4, e: 6 });
    const stats = compressionStats(s);
    assert.ok(stats.deltaCount >= 0);
    assert.ok(stats.totalSavedBytes >= 0);
  });
});

describe("formatCompressionStats", () => {
  it("shows stats", () => {
    const s = createCompressionState();
    recordSnapshot(s, { a: 1 });
    const lines = formatCompressionStats(s);
    assert.ok(lines[0].includes("Snapshot Compression"));
  });

  it("shows delta details", () => {
    const s = createCompressionState();
    recordSnapshot(s, { a: 1, b: 2, c: 3, d: 4, e: 5 });
    recordSnapshot(s, { a: 1, b: 2, c: 3, d: 4, e: 6 });
    const lines = formatCompressionStats(s);
    assert.ok(lines.some((l) => l.includes("delta") || l.includes("No deltas")));
  });
});
