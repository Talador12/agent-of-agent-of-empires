import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import {
  createWarmStandby, warmSlot, claimSlot, expireSlots,
  availableSlots, warmStandbyStats, formatWarmStandby,
} from "./fleet-warm-standby.js";

describe("createWarmStandby", () => {
  it("starts empty", () => {
    const state = createWarmStandby();
    assert.equal(state.slots.length, 0);
  });
});

describe("warmSlot", () => {
  it("creates a warm slot", () => {
    const state = createWarmStandby();
    const slot = warmSlot(state, "github/adventure", ["AGENTS.md", "claude.md"]);
    assert.ok(slot);
    assert.equal(slot!.status, "warm");
    assert.equal(slot!.repo, "github/adventure");
    assert.equal(slot!.contextFiles.length, 2);
  });

  it("returns null when pool is full", () => {
    const state = createWarmStandby(2);
    warmSlot(state, "repo-a", []);
    warmSlot(state, "repo-b", []);
    assert.equal(warmSlot(state, "repo-c", []), null);
  });

  it("assigns incremental IDs", () => {
    const state = createWarmStandby();
    const s1 = warmSlot(state, "a", [])!;
    const s2 = warmSlot(state, "b", [])!;
    assert.equal(s1.id, 1);
    assert.equal(s2.id, 2);
  });
});

describe("claimSlot", () => {
  it("claims a matching warm slot", () => {
    const state = createWarmStandby();
    warmSlot(state, "github/adventure", ["f.md"], 1000);
    const claimed = claimSlot(state, "github/adventure", "adventure-fix", 2000);
    assert.ok(claimed);
    assert.equal(claimed!.status, "assigned");
    assert.equal(claimed!.assignedTo, "adventure-fix");
  });

  it("returns null for non-matching repo", () => {
    const state = createWarmStandby();
    warmSlot(state, "github/adventure", []);
    assert.equal(claimSlot(state, "github/other", "other-task"), null);
  });

  it("returns null when no warm slots available", () => {
    const state = createWarmStandby();
    assert.equal(claimSlot(state, "any", "any"), null);
  });

  it("does not claim expired slots", () => {
    const state = createWarmStandby(5, 1000); // 1s TTL
    warmSlot(state, "repo", [], 1000);
    assert.equal(claimSlot(state, "repo", "session", 5000), null); // expired
  });
});

describe("expireSlots", () => {
  it("expires old warm slots", () => {
    const state = createWarmStandby(5, 1000);
    warmSlot(state, "repo", [], 1000);
    const expired = expireSlots(state, 5000);
    assert.equal(expired, 1);
    assert.equal(state.slots[0].status, "expired");
  });

  it("does not expire fresh slots", () => {
    const state = createWarmStandby(5, 10_000);
    warmSlot(state, "repo", [], 5000);
    assert.equal(expireSlots(state, 6000), 0);
  });
});

describe("availableSlots", () => {
  it("returns only warm non-expired slots", () => {
    const state = createWarmStandby(5, 10_000);
    warmSlot(state, "a", [], 1000);
    warmSlot(state, "b", [], 1000);
    claimSlot(state, "a", "session-a", 2000);
    const avail = availableSlots(state, 2000);
    assert.equal(avail.length, 1);
    assert.equal(avail[0].repo, "b");
  });
});

describe("warmStandbyStats", () => {
  it("computes counts and repos", () => {
    const state = createWarmStandby();
    warmSlot(state, "repo-a", []);
    warmSlot(state, "repo-b", []);
    claimSlot(state, "repo-a", "session");
    const stats = warmStandbyStats(state);
    assert.equal(stats.total, 2);
    assert.equal(stats.warm, 1);
    assert.equal(stats.assigned, 1);
    assert.ok(stats.repos.includes("repo-b"));
  });
});

describe("formatWarmStandby", () => {
  it("shows warm slot details", () => {
    const state = createWarmStandby();
    warmSlot(state, "github/adventure", ["a.md", "b.md"]);
    const lines = formatWarmStandby(state);
    assert.ok(lines[0].includes("Warm Standby"));
    assert.ok(lines.some((l) => l.includes("adventure")));
  });

  it("shows no-slots message when empty", () => {
    const state = createWarmStandby();
    const lines = formatWarmStandby(state);
    assert.ok(lines.some((l) => l.includes("No warm slots")));
  });
});
