import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { assignReasonerBackends, routeObservation, mergeReasonerResults, formatAssignments } from "./multi-reasoner.js";
import type { Observation, SessionSnapshot, AoeSession } from "./types.js";

function makeSnap(title: string): SessionSnapshot {
  const session: AoeSession = { id: `id-${title}`, title, path: "/tmp", tool: "opencode", status: "working", tmux_name: `aoe_${title}` };
  return { session, output: "test", outputHash: "h", capturedAt: Date.now() };
}

describe("assignReasonerBackends", () => {
  it("uses default backend when no overrides", () => {
    const assignments = assignReasonerBackends([{ title: "a" }], { defaultBackend: "opencode" });
    assert.equal(assignments[0].backend, "opencode");
  });

  it("explicit override wins over everything", () => {
    const assignments = assignReasonerBackends(
      [{ title: "special", template: "frontend", difficultyScore: 2 }],
      { sessionOverrides: { special: "gemini" }, templateMappings: { frontend: "claude-code" } },
    );
    assert.equal(assignments[0].backend, "gemini");
  });

  it("template mapping works", () => {
    const assignments = assignReasonerBackends(
      [{ title: "a", template: "infra" }],
      { templateMappings: { infra: "claude-code" } },
    );
    assert.equal(assignments[0].backend, "claude-code");
  });

  it("difficulty routing: high → premium, low → economy", () => {
    const assignments = assignReasonerBackends(
      [{ title: "hard", difficultyScore: 9 }, { title: "easy", difficultyScore: 2 }],
      { difficultyThreshold: 7, premiumBackend: "opencode", economyBackend: "claude-code" },
    );
    assert.equal(assignments.find((a) => a.sessionTitle === "hard")?.backend, "opencode");
    assert.equal(assignments.find((a) => a.sessionTitle === "easy")?.backend, "claude-code");
  });
});

describe("routeObservation", () => {
  it("splits observation by backend", () => {
    const obs: Observation = {
      timestamp: Date.now(),
      sessions: [makeSnap("a"), makeSnap("b")],
      changes: [{ sessionId: "id-a", title: "a", tool: "opencode", status: "working", newLines: "" }, { sessionId: "id-b", title: "b", tool: "opencode", status: "working", newLines: "" }],
    };
    const assignments = [
      { sessionTitle: "a", backend: "opencode" as const, reason: "default" },
      { sessionTitle: "b", backend: "claude-code" as const, reason: "template" },
    ];
    const routed = routeObservation(obs, assignments);
    assert.equal(routed.size, 2);
    assert.equal(routed.get("opencode")?.sessions.length, 1);
    assert.equal(routed.get("claude-code")?.sessions.length, 1);
  });
});

describe("mergeReasonerResults", () => {
  it("merges actions from multiple results", () => {
    const merged = mergeReasonerResults([
      { actions: [{ action: "wait", reason: "a" }] },
      { actions: [{ action: "wait", reason: "b" }] },
    ]);
    assert.equal(merged.actions.length, 2);
  });

  it("uses lowest confidence", () => {
    const merged = mergeReasonerResults([
      { actions: [], confidence: "high" },
      { actions: [], confidence: "low" },
    ]);
    assert.equal(merged.confidence, "low");
  });
});

describe("formatAssignments", () => {
  it("shows summary and per-session assignments", () => {
    const assignments = assignReasonerBackends([{ title: "a" }, { title: "b" }]);
    const lines = formatAssignments(assignments);
    assert.ok(lines[0].includes("Multi-reasoner"));
    assert.ok(lines.some((l) => l.includes("a")));
  });

  it("handles empty", () => {
    const lines = formatAssignments([]);
    assert.ok(lines[0].includes("no sessions"));
  });
});
