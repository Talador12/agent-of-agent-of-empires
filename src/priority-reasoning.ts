// priority-reasoning.ts — filter observations to only include highest-priority
// sessions before sending to the reasoner. reduces LLM context and cost by
// focusing reasoning on the sessions that need it most.

import type { SessionSnapshot, Observation } from "./types.js";
import type { PrioritizedSession } from "./session-priority.js";

export interface PriorityFilterConfig {
  maxSessionsPerCall: number;   // max sessions to include in one reasoning call (default: 5)
  minPriority: number;          // skip sessions with priority below this (default: 5)
  alwaysIncludeChanged: boolean; // always include sessions with new output (default: true)
}

const DEFAULT_CONFIG: PriorityFilterConfig = {
  maxSessionsPerCall: 5,
  minPriority: 5,
  alwaysIncludeChanged: true,
};

/**
 * Filter an observation to only include the highest-priority sessions.
 * Returns a trimmed observation and a list of excluded sessions.
 */
export function filterByPriority(
  observation: Observation,
  ranked: PrioritizedSession[],
  changedTitles: Set<string>,
  config: Partial<PriorityFilterConfig> = {},
): { filtered: Observation; excluded: string[]; included: string[] } {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  // build inclusion set
  const included = new Set<string>();
  const excluded: string[] = [];

  // always include changed sessions if configured
  if (cfg.alwaysIncludeChanged) {
    for (const title of changedTitles) {
      included.add(title);
    }
  }

  // add highest-priority sessions up to max
  for (const s of ranked) {
    if (included.size >= cfg.maxSessionsPerCall) break;
    if (s.priority < cfg.minPriority) continue;
    included.add(s.sessionTitle);
  }

  // build excluded list
  for (const snap of observation.sessions) {
    if (!included.has(snap.session.title)) {
      excluded.push(snap.session.title);
    }
  }

  // filter observation
  const filtered: Observation = {
    timestamp: observation.timestamp,
    sessions: observation.sessions.filter((s) => included.has(s.session.title)),
    changes: observation.changes.filter((c) => included.has(c.title)),
  };

  return { filtered, excluded, included: [...included] };
}

/**
 * Compute how much context was saved by priority filtering.
 */
export function computeSavings(
  original: Observation,
  filtered: Observation,
): { sessionsSaved: number; changesSaved: number; estimatedTokensSaved: number } {
  const sessionsSaved = original.sessions.length - filtered.sessions.length;
  const changesSaved = original.changes.length - filtered.changes.length;

  // rough estimate: each excluded session saves ~500 tokens of context
  const estimatedTokensSaved = sessionsSaved * 500;

  return { sessionsSaved, changesSaved, estimatedTokensSaved };
}

/**
 * Format priority filter results for TUI display.
 */
export function formatPriorityFilter(
  included: string[],
  excluded: string[],
  savings: { sessionsSaved: number; estimatedTokensSaved: number },
): string[] {
  const lines: string[] = [];
  lines.push(`  Priority reasoning: ${included.length} included, ${excluded.length} excluded`);
  if (savings.sessionsSaved > 0) {
    lines.push(`  Saved: ~${savings.estimatedTokensSaved} tokens (${savings.sessionsSaved} sessions excluded)`);
  }
  if (included.length > 0) {
    lines.push(`  Included: ${included.join(", ")}`);
  }
  if (excluded.length > 0) {
    lines.push(`  Excluded: ${excluded.join(", ")}`);
  }
  return lines;
}
