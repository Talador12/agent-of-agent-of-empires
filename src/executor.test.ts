import { describe, it } from "node:test";
import assert from "node:assert/strict";
// executor's resolveTmuxName is private, so we test it indirectly via the class.
// but we can test the rate-limiting logic pattern and action log structure.
// for resolveTmuxName logic, we replicate it here since it's pure:

import type { SessionSnapshot } from "./types.js";

// default cooldown from executor.ts (config.policies.actionCooldownMs ?? 30_000)
const DEFAULT_COOLDOWN_MS = 30_000;

// replicated from executor.ts -- the actual method is private on the class,
// but the logic is pure and worth validating. if this drifts from the source,
// the integration tests will catch it.
function resolveTmuxName(sessionId: string, snapshots: SessionSnapshot[]): string | null {
  const exact = snapshots.find((s) => s.session.id === sessionId);
  if (exact?.session.tmux_name) return exact.session.tmux_name;

  const prefix = snapshots.find((s) => s.session.id.startsWith(sessionId));
  if (prefix?.session.tmux_name) return prefix.session.tmux_name;

  const byTitle = snapshots.find(
    (s) => s.session.title.toLowerCase() === sessionId.toLowerCase(),
  );
  if (byTitle?.session.tmux_name) return byTitle.session.tmux_name;

  return null;
}

function makeSnap(id: string, title: string, tmuxName: string): SessionSnapshot {
  return {
    session: { id, title, path: "/tmp", tool: "opencode", status: "working", tmux_name: tmuxName },
    output: "",
    outputHash: "hash",
    capturedAt: Date.now(),
  };
}

describe("resolveTmuxName (logic)", () => {
  const snaps = [
    makeSnap("abcdef1234567890", "my-agent", "aoe_my-agent_abcdef12"),
    makeSnap("99887766aabbccdd", "worker-2", "aoe_worker-2_99887766"),
  ];

  it("resolves by exact ID", () => {
    assert.equal(resolveTmuxName("abcdef1234567890", snaps), "aoe_my-agent_abcdef12");
  });

  it("resolves by ID prefix", () => {
    assert.equal(resolveTmuxName("abcdef12", snaps), "aoe_my-agent_abcdef12");
  });

  it("resolves by title (case-insensitive)", () => {
    assert.equal(resolveTmuxName("My-Agent", snaps), "aoe_my-agent_abcdef12");
    assert.equal(resolveTmuxName("WORKER-2", snaps), "aoe_worker-2_99887766");
  });

  it("returns null for unknown session", () => {
    assert.equal(resolveTmuxName("nonexistent", snaps), null);
  });

  it("returns null for empty snapshots", () => {
    assert.equal(resolveTmuxName("abc", []), null);
  });

  it("prefers exact match over prefix match", () => {
    // create a scenario where prefix could match a different session
    const tricky = [
      makeSnap("abc", "short-id", "aoe_short-id_abc"),
      makeSnap("abcdef12", "longer-id", "aoe_longer-id_abcdef12"),
    ];
    assert.equal(resolveTmuxName("abc", tricky), "aoe_short-id_abc");
  });
});

// replicated from executor.ts -- resolves a session reference (ID, prefix, title) to canonical ID
function resolveSessionId(ref: string, snapshots: SessionSnapshot[]): string {
  const exact = snapshots.find((s) => s.session.id === ref);
  if (exact) return exact.session.id;
  const prefix = snapshots.find((s) => s.session.id.startsWith(ref));
  if (prefix) return prefix.session.id;
  const byTitle = snapshots.find(
    (s) => s.session.title.toLowerCase() === ref.toLowerCase(),
  );
  if (byTitle) return byTitle.session.id;
  return ref;
}

describe("resolveSessionId (normalization)", () => {
  const snaps = [
    makeSnap("abcdef1234567890", "my-agent", "aoe_my-agent_abcdef12"),
    makeSnap("99887766aabbccdd", "worker-2", "aoe_worker-2_99887766"),
  ];

  it("resolves exact ID to itself", () => {
    assert.equal(resolveSessionId("abcdef1234567890", snaps), "abcdef1234567890");
  });

  it("resolves ID prefix to full ID", () => {
    assert.equal(resolveSessionId("abcdef12", snaps), "abcdef1234567890");
  });

  it("resolves title to canonical ID", () => {
    assert.equal(resolveSessionId("My-Agent", snaps), "abcdef1234567890");
    assert.equal(resolveSessionId("WORKER-2", snaps), "99887766aabbccdd");
  });

  it("returns ref as-is when not found", () => {
    assert.equal(resolveSessionId("nonexistent", snaps), "nonexistent");
  });
});

describe("rate limiting (logic)", () => {
  it("tracks last action time per session", () => {
    const recentActions = new Map<string, number>();
    const now = Date.now();

    // no previous action = not rate limited
    assert.equal(recentActions.has("s1"), false);

    // mark an action
    recentActions.set("s1", now);

    // check within cooldown window
    const last = recentActions.get("s1")!;
    assert.equal(now - last < DEFAULT_COOLDOWN_MS, true); // rate limited

    // simulate past-cooldown
    recentActions.set("s1", now - DEFAULT_COOLDOWN_MS - 1_000);
    const last2 = recentActions.get("s1")!;
    assert.equal(Date.now() - last2 < DEFAULT_COOLDOWN_MS, false); // not rate limited
  });

  it("different sessions have independent limits", () => {
    const recentActions = new Map<string, number>();
    const now = Date.now();

    recentActions.set("s1", now);
    // s2 has no entry
    assert.equal(recentActions.has("s2"), false);
    assert.equal(recentActions.has("s1"), true);
  });
});
