// audit-trail-retention.test.ts

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createRetentionState,
  addPolicy,
  getEffectiveTtl,
  shouldArchive,
  findExpired,
  runRetention,
  retentionStats,
  formatRetention,
  type AuditEntry,
} from "./audit-trail-retention.js";

const DAY = 86_400_000;

const mkEntry = (type: string, ageMs: number, now = 100 * DAY): AuditEntry => ({
  type,
  timestamp: now - ageMs,
  detail: `${type} event`,
});

describe("getEffectiveTtl", () => {
  it("returns default TTL when no policy set", () => {
    const state = createRetentionState(7 * DAY);
    assert.equal(getEffectiveTtl(state, "action_executed"), 7 * DAY);
  });

  it("returns category-specific TTL", () => {
    const state = createRetentionState(7 * DAY);
    addPolicy(state, "auto_complete", 30 * DAY, true);
    assert.equal(getEffectiveTtl(state, "auto_complete"), 30 * DAY);
  });

  it("uses wildcard policy as fallback", () => {
    const state = createRetentionState(7 * DAY);
    addPolicy(state, "*", 14 * DAY, true);
    assert.equal(getEffectiveTtl(state, "unknown_type"), 14 * DAY);
  });

  it("category-specific overrides wildcard", () => {
    const state = createRetentionState(7 * DAY);
    addPolicy(state, "*", 14 * DAY, true);
    addPolicy(state, "special", 3 * DAY, false);
    assert.equal(getEffectiveTtl(state, "special"), 3 * DAY);
  });
});

describe("shouldArchive", () => {
  it("defaults to archive=true", () => {
    const state = createRetentionState();
    assert.equal(shouldArchive(state, "anything"), true);
  });

  it("respects policy archiveBeforeDelete=false", () => {
    const state = createRetentionState();
    addPolicy(state, "debug", 1 * DAY, false);
    assert.equal(shouldArchive(state, "debug"), false);
  });
});

describe("findExpired", () => {
  it("finds entries older than TTL", () => {
    const state = createRetentionState(7 * DAY);
    const now = 100 * DAY;
    const entries: AuditEntry[] = [
      mkEntry("action", 10 * DAY, now), // 10 days old → expired
      mkEntry("action", 3 * DAY, now),  // 3 days old → retained
    ];
    const { expired, retained } = findExpired(state, entries, now);
    assert.equal(expired.length, 1);
    assert.equal(retained.length, 1);
  });

  it("uses per-type TTL", () => {
    const state = createRetentionState(7 * DAY);
    addPolicy(state, "debug", 1 * DAY, false);
    const now = 100 * DAY;
    const entries: AuditEntry[] = [
      mkEntry("debug", 2 * DAY, now),   // 2d old, 1d TTL → expired
      mkEntry("action", 2 * DAY, now),  // 2d old, 7d TTL → retained
    ];
    const { expired, retained } = findExpired(state, entries, now);
    assert.equal(expired.length, 1);
    assert.equal(expired[0].type, "debug");
    assert.equal(retained.length, 1);
  });

  it("handles empty entries", () => {
    const state = createRetentionState();
    const { expired, retained } = findExpired(state, []);
    assert.equal(expired.length, 0);
    assert.equal(retained.length, 0);
  });
});

describe("runRetention", () => {
  it("archives expired entries by default", () => {
    const state = createRetentionState(7 * DAY);
    const now = 100 * DAY;
    const entries: AuditEntry[] = [
      mkEntry("action", 10 * DAY, now),
      mkEntry("action", 3 * DAY, now),
    ];
    const result = runRetention(state, entries, now);
    assert.equal(result.retained.length, 1);
    assert.equal(result.archived.length, 1);
    assert.equal(result.deleted.length, 0);
    assert.equal(state.archives.length, 1);
    assert.equal(state.totalArchived, 1);
  });

  it("deletes without archiving when policy says so", () => {
    const state = createRetentionState(7 * DAY);
    addPolicy(state, "debug", 1 * DAY, false);
    const now = 100 * DAY;
    const entries: AuditEntry[] = [
      mkEntry("debug", 5 * DAY, now),
    ];
    const result = runRetention(state, entries, now);
    assert.equal(result.deleted.length, 1);
    assert.equal(result.archived.length, 0);
    assert.equal(state.archives.length, 0);
  });

  it("tracks total expired across runs", () => {
    const state = createRetentionState(1 * DAY);
    const now = 100 * DAY;
    runRetention(state, [mkEntry("a", 2 * DAY, now)], now);
    runRetention(state, [mkEntry("b", 3 * DAY, now)], now + 1000);
    assert.equal(state.totalExpired, 2);
  });

  it("caps archive history", () => {
    const state = createRetentionState(1 * DAY);
    for (let i = 0; i < 120; i++) {
      runRetention(state, [mkEntry("x", 2 * DAY, i * DAY + 200 * DAY)], i * DAY + 200 * DAY);
    }
    assert.ok(state.archives.length <= 100);
  });

  it("creates archive batch with metadata", () => {
    const state = createRetentionState(1 * DAY);
    const now = 100 * DAY;
    const entries: AuditEntry[] = [
      mkEntry("action", 5 * DAY, now),
      mkEntry("auto_complete", 3 * DAY, now),
    ];
    runRetention(state, entries, now);
    assert.equal(state.archives.length, 1);
    const batch = state.archives[0];
    assert.equal(batch.entryCount, 2);
    assert.ok(batch.categories.includes("action"));
    assert.ok(batch.categories.includes("auto_complete"));
  });
});

describe("retentionStats", () => {
  it("computes stats", () => {
    const state = createRetentionState(7 * DAY);
    const now = 100 * DAY;
    const entries: AuditEntry[] = [
      mkEntry("a", 10 * DAY, now),
      mkEntry("b", 3 * DAY, now),
      mkEntry("c", 1 * DAY, now),
    ];
    const stats = retentionStats(state, entries, now);
    assert.equal(stats.totalEntries, 3);
    assert.equal(stats.expiredCount, 1);
    assert.equal(stats.retainedCount, 2);
  });
});

describe("formatRetention", () => {
  it("formats state for TUI", () => {
    const state = createRetentionState(7 * DAY);
    addPolicy(state, "debug", 1 * DAY, false);
    const entries: AuditEntry[] = [mkEntry("debug", 2 * DAY), mkEntry("action", 3 * DAY)];
    const lines = formatRetention(state, entries);
    assert.ok(lines[0].includes("2 entries"));
    assert.ok(lines[0].includes("7d"));
    assert.ok(lines.some((l) => l.includes("debug")));
  });
});
