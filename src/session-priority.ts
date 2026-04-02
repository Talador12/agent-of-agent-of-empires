// session-priority.ts — prioritize reasoner attention by health score, staleness,
// activity level, and task status. when the reasoner can only process a subset of
// sessions, this determines which ones get attention first.

import type { TaskState } from "./types.js";

export interface SessionPriorityInput {
  sessionTitle: string;
  healthScore: number;        // 0-100, lower = needs more attention
  lastChangeMs: number;       // ms since last output change
  lastProgressMs: number;     // ms since last task progress
  taskStatus: string;         // "active" | "paused" | "failed" | etc.
  isStuck: boolean;           // flagged as stuck
  hasError: boolean;          // currently in error state
  isUserActive: boolean;      // human is interacting
}

export interface PrioritizedSession {
  sessionTitle: string;
  priority: number;           // higher = more urgent
  reason: string;             // human-readable explanation
}

// weights for priority scoring
const WEIGHTS = {
  error: 100,          // errors are top priority
  stuck: 80,           // stuck tasks need intervention
  failedTask: 70,      // failed tasks need retry/attention
  lowHealth: 0.5,      // per-point below 50: (50 - score) * 0.5
  stale: 0.001,        // per-ms since last change (30min idle = 1.8 points)
  activeTask: 10,      // active tasks get baseline priority
  userActive: -200,    // human is working — back off entirely
};

/**
 * Compute a priority score for a session.
 * Higher score = more urgent = gets reasoner attention first.
 */
export function computeSessionPriority(input: SessionPriorityInput): PrioritizedSession {
  let priority = 0;
  const reasons: string[] = [];

  // user activity: suppress all priority
  if (input.isUserActive) {
    return { sessionTitle: input.sessionTitle, priority: -200, reason: "user active — backing off" };
  }

  // error state: highest priority
  if (input.hasError) {
    priority += WEIGHTS.error;
    reasons.push("error state");
  }

  // stuck: high priority
  if (input.isStuck) {
    priority += WEIGHTS.stuck;
    reasons.push("stuck");
  }

  // failed task
  if (input.taskStatus === "failed") {
    priority += WEIGHTS.failedTask;
    reasons.push("task failed");
  }

  // low health: proportional penalty
  if (input.healthScore < 50) {
    const healthBoost = (50 - input.healthScore) * WEIGHTS.lowHealth;
    priority += healthBoost;
    reasons.push(`low health (${input.healthScore})`);
  }

  // staleness: older changes = higher priority
  if (input.lastChangeMs > 0) {
    const stalenessBoost = input.lastChangeMs * WEIGHTS.stale;
    priority += stalenessBoost;
    if (input.lastChangeMs > 30 * 60_000) {
      reasons.push(`stale (${Math.round(input.lastChangeMs / 60_000)}m)`);
    }
  }

  // active task: baseline priority
  if (input.taskStatus === "active") {
    priority += WEIGHTS.activeTask;
    if (reasons.length === 0) reasons.push("active task");
  }

  const reason = reasons.length > 0 ? reasons.join(", ") : "nominal";
  return { sessionTitle: input.sessionTitle, priority, reason };
}

/**
 * Rank all sessions by priority (highest first).
 */
export function rankSessionsByPriority(inputs: SessionPriorityInput[]): PrioritizedSession[] {
  return inputs
    .map(computeSessionPriority)
    .sort((a, b) => b.priority - a.priority);
}

/**
 * Select the top N sessions that need attention.
 * Filters out user-active sessions and sessions with priority <= 0.
 */
export function selectTopPriority(inputs: SessionPriorityInput[], maxSessions = 3): PrioritizedSession[] {
  return rankSessionsByPriority(inputs)
    .filter((s) => s.priority > 0)
    .slice(0, maxSessions);
}

/**
 * Format priority queue for TUI display.
 */
export function formatPriorityQueue(ranked: PrioritizedSession[]): string[] {
  if (ranked.length === 0) return ["  (no sessions need attention)"];
  const lines: string[] = [];
  for (let i = 0; i < ranked.length; i++) {
    const s = ranked[i];
    const icon = s.priority >= 100 ? "🔴" : s.priority >= 50 ? "🟡" : s.priority > 0 ? "🟢" : "⏸";
    lines.push(`  ${i + 1}. ${icon} ${s.sessionTitle} (priority ${Math.round(s.priority)}) — ${s.reason}`);
  }
  return lines;
}
