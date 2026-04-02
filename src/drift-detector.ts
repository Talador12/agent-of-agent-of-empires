// drift-detector.ts — detect when a session's actual activity diverges
// from its stated goal. compares goal keywords against recent session output
// to flag sessions that may be working on unrelated tasks.

import type { TaskState } from "./types.js";

export interface DriftSignal {
  sessionTitle: string;
  goalKeywords: string[];
  outputKeywords: string[];
  overlapRatio: number;   // 0.0-1.0 — fraction of goal keywords found in output
  drifted: boolean;
  detail: string;
}

// words to ignore when extracting keywords (too generic)
const STOP_WORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "shall", "can", "need", "must", "and", "or",
  "but", "if", "then", "else", "when", "where", "how", "what", "which",
  "who", "whom", "this", "that", "these", "those", "it", "its", "my",
  "your", "our", "their", "his", "her", "for", "to", "from", "in", "on",
  "at", "by", "with", "about", "into", "of", "not", "no", "all", "any",
  "each", "some", "more", "most", "other", "new", "old", "up", "out",
  "add", "fix", "update", "make", "use", "get", "set", "run", "test",
  "file", "code", "src", "build", "work", "change", "create",
]);

/**
 * Extract meaningful keywords from a text string.
 * Strips punctuation, lowercases, removes stop words and short tokens.
 */
export function extractKeywords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w))
    .filter((v, i, a) => a.indexOf(v) === i); // deduplicate
}

/**
 * Compute overlap ratio: fraction of goalKeywords found in outputKeywords.
 */
export function computeOverlap(goalKeywords: string[], outputKeywords: string[]): number {
  if (goalKeywords.length === 0) return 1; // no goal = no drift possible
  const outputSet = new Set(outputKeywords);
  const found = goalKeywords.filter((k) => outputSet.has(k)).length;
  return found / goalKeywords.length;
}

/**
 * Check if a session has drifted from its goal.
 * Uses a simple keyword overlap heuristic — if fewer than `threshold`
 * fraction of goal keywords appear in recent output, flags as drifted.
 */
export function detectDrift(
  task: TaskState,
  recentOutput: string,
  threshold = 0.15,
): DriftSignal {
  const goalKeywords = extractKeywords(task.goal);
  const outputKeywords = extractKeywords(recentOutput);
  const overlapRatio = computeOverlap(goalKeywords, outputKeywords);
  const drifted = overlapRatio < threshold && goalKeywords.length >= 3;

  const detail = drifted
    ? `drift detected: only ${Math.round(overlapRatio * 100)}% goal keyword overlap (threshold: ${Math.round(threshold * 100)}%)`
    : `on track: ${Math.round(overlapRatio * 100)}% goal keyword overlap`;

  return {
    sessionTitle: task.sessionTitle,
    goalKeywords,
    outputKeywords: outputKeywords.slice(0, 20), // keep manageable
    overlapRatio,
    drifted,
    detail,
  };
}

/**
 * Format drift signals for TUI display.
 */
export function formatDriftSignals(signals: DriftSignal[]): string[] {
  if (signals.length === 0) return ["  (no drift data)"];
  const lines: string[] = [];
  for (const s of signals) {
    const icon = s.drifted ? "⚠" : "✓";
    const pct = Math.round(s.overlapRatio * 100);
    lines.push(`  ${icon} ${s.sessionTitle}: ${pct}% overlap${s.drifted ? " — DRIFTED" : ""}`);
  }
  return lines;
}
