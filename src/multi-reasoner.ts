// multi-reasoner.ts — assign different LLM backends per session.
// routes observations to the appropriate reasoner based on session config,
// template, or difficulty. supports reasoner pools with load balancing.

import type { Observation, Reasoner, ReasonerResult, SessionSnapshot } from "./types.js";

export type ReasonerBackend = "opencode" | "claude-code" | "gemini" | "custom";

export interface ReasonerAssignment {
  sessionTitle: string;
  backend: ReasonerBackend;
  reason: string;
}

export interface MultiReasonerConfig {
  defaultBackend: ReasonerBackend;
  sessionOverrides: Record<string, ReasonerBackend>; // explicit per-session
  templateMappings: Record<string, ReasonerBackend>; // template name → backend
  difficultyThreshold: number; // score above which to use premium backend (default: 7)
  premiumBackend: ReasonerBackend; // backend for high-difficulty tasks (default: "opencode")
  economyBackend: ReasonerBackend; // backend for low-difficulty tasks (default: "claude-code")
}

const DEFAULT_CONFIG: MultiReasonerConfig = {
  defaultBackend: "opencode",
  sessionOverrides: {},
  templateMappings: {},
  difficultyThreshold: 7,
  premiumBackend: "opencode",
  economyBackend: "claude-code",
};

/**
 * Determine which reasoner backend to use for each session.
 */
export function assignReasonerBackends(
  sessions: Array<{ title: string; template?: string; difficultyScore?: number }>,
  config: Partial<MultiReasonerConfig> = {},
): ReasonerAssignment[] {
  const c = { ...DEFAULT_CONFIG, ...config };

  return sessions.map((s) => {
    // explicit override wins
    if (c.sessionOverrides[s.title]) {
      return { sessionTitle: s.title, backend: c.sessionOverrides[s.title], reason: "explicit override" };
    }

    // template mapping
    if (s.template && c.templateMappings[s.template]) {
      return { sessionTitle: s.title, backend: c.templateMappings[s.template], reason: `template: ${s.template}` };
    }

    // difficulty-based routing
    if (s.difficultyScore !== undefined) {
      if (s.difficultyScore >= c.difficultyThreshold) {
        return { sessionTitle: s.title, backend: c.premiumBackend, reason: `high difficulty (${s.difficultyScore}/10)` };
      }
      return { sessionTitle: s.title, backend: c.economyBackend, reason: `low difficulty (${s.difficultyScore}/10)` };
    }

    return { sessionTitle: s.title, backend: c.defaultBackend, reason: "default" };
  });
}

/**
 * Split an observation into per-backend groups for routing.
 */
export function routeObservation(
  observation: Observation,
  assignments: ReasonerAssignment[],
): Map<ReasonerBackend, Observation> {
  const assignMap = new Map(assignments.map((a) => [a.sessionTitle, a.backend]));
  const groups = new Map<ReasonerBackend, { sessions: SessionSnapshot[]; changes: Observation["changes"] }>();

  for (const snap of observation.sessions) {
    const backend = assignMap.get(snap.session.title) ?? "opencode";
    if (!groups.has(backend)) groups.set(backend, { sessions: [], changes: [] });
    groups.get(backend)!.sessions.push(snap);
  }

  for (const change of observation.changes) {
    const backend = assignMap.get(change.title) ?? "opencode";
    if (groups.has(backend)) groups.get(backend)!.changes.push(change);
  }

  const result = new Map<ReasonerBackend, Observation>();
  for (const [backend, data] of groups) {
    result.set(backend, { timestamp: observation.timestamp, sessions: data.sessions, changes: data.changes });
  }
  return result;
}

/**
 * Merge results from multiple reasoner backends into a single result.
 */
export function mergeReasonerResults(results: ReasonerResult[]): ReasonerResult {
  const allActions = results.flatMap((r) => r.actions);
  // use lowest confidence across all results
  const confidences = results.map((r) => r.confidence).filter(Boolean);
  const confidence = confidences.length > 0
    ? (confidences.includes("low") ? "low" : confidences.includes("medium") ? "medium" : "high")
    : undefined;
  return { actions: allActions, confidence: confidence as ReasonerResult["confidence"] };
}

/**
 * Format assignments for TUI display.
 */
export function formatAssignments(assignments: ReasonerAssignment[]): string[] {
  if (assignments.length === 0) return ["  (no sessions to assign)"];
  const lines: string[] = [];
  const backendCounts = new Map<string, number>();
  for (const a of assignments) {
    backendCounts.set(a.backend, (backendCounts.get(a.backend) ?? 0) + 1);
    lines.push(`  ${a.sessionTitle}: ${a.backend} (${a.reason})`);
  }
  const summary = [...backendCounts.entries()].map(([b, c]) => `${b}: ${c}`).join(", ");
  lines.unshift(`  Multi-reasoner assignments (${summary}):`);
  return lines;
}
