import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import {
  createGroupingState, createGroup, addToGroup, removeFromGroup,
  removeGroup, getGroupSessions, getSessionGroup, listGroups,
  computeGroupStats, formatGrouping, formatGroupStats,
} from "./fleet-session-grouping.js";

describe("createGroupingState", () => {
  it("starts empty", () => {
    const s = createGroupingState();
    assert.equal(s.groups.size, 0);
  });
});

describe("addToGroup", () => {
  it("creates group and adds session", () => {
    const s = createGroupingState();
    addToGroup(s, "frontend", "alpha");
    assert.equal(getGroupSessions(s, "frontend").length, 1);
  });

  it("deduplicates sessions", () => {
    const s = createGroupingState();
    addToGroup(s, "frontend", "alpha");
    addToGroup(s, "frontend", "alpha");
    assert.equal(getGroupSessions(s, "frontend").length, 1);
  });
});

describe("removeFromGroup", () => {
  it("removes a session", () => {
    const s = createGroupingState();
    addToGroup(s, "frontend", "alpha");
    assert.ok(removeFromGroup(s, "frontend", "alpha"));
    assert.equal(getGroupSessions(s, "frontend").length, 0);
  });

  it("returns false for nonexistent group", () => {
    const s = createGroupingState();
    assert.ok(!removeFromGroup(s, "nope", "alpha"));
  });
});

describe("removeGroup", () => {
  it("removes entire group", () => {
    const s = createGroupingState();
    addToGroup(s, "frontend", "alpha");
    assert.ok(removeGroup(s, "frontend"));
    assert.equal(listGroups(s).length, 0);
  });
});

describe("getSessionGroup", () => {
  it("finds the group a session belongs to", () => {
    const s = createGroupingState();
    addToGroup(s, "backend", "api");
    assert.equal(getSessionGroup(s, "api"), "backend");
  });

  it("returns null for ungrouped session", () => {
    const s = createGroupingState();
    assert.equal(getSessionGroup(s, "orphan"), null);
  });
});

describe("listGroups", () => {
  it("lists all groups", () => {
    const s = createGroupingState();
    addToGroup(s, "fe", "alpha");
    addToGroup(s, "be", "beta");
    assert.equal(listGroups(s).length, 2);
  });
});

describe("computeGroupStats", () => {
  it("computes aggregate stats", () => {
    const s = createGroupingState();
    addToGroup(s, "fe", "alpha");
    addToGroup(s, "fe", "beta");
    const data = new Map([
      ["alpha", { active: true, healthPct: 80, costUsd: 5.0, progressPct: 60 }],
      ["beta", { active: false, healthPct: 90, costUsd: 3.0, progressPct: 40 }],
    ]);
    const stats = computeGroupStats(s, "fe", data);
    assert.ok(stats);
    assert.equal(stats!.sessionCount, 2);
    assert.equal(stats!.activeSessions, 1);
    assert.equal(stats!.avgHealthPct, 85);
    assert.equal(stats!.totalCostUsd, 8.0);
    assert.equal(stats!.avgProgressPct, 50);
  });

  it("returns null for empty group", () => {
    const s = createGroupingState();
    assert.equal(computeGroupStats(s, "nope", new Map()), null);
  });
});

describe("formatGrouping", () => {
  it("shows no-groups message when empty", () => {
    const lines = formatGrouping([]);
    assert.ok(lines[0].includes("none defined"));
  });

  it("shows groups with sessions", () => {
    const s = createGroupingState();
    addToGroup(s, "fe", "alpha");
    const lines = formatGrouping(listGroups(s));
    assert.ok(lines.some((l) => l.includes("fe")));
    assert.ok(lines.some((l) => l.includes("alpha")));
  });
});

describe("formatGroupStats", () => {
  it("shows no-data message when empty", () => {
    const lines = formatGroupStats([]);
    assert.ok(lines[0].includes("no data"));
  });
});
