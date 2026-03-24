// vibe.ts — heuristic agent vibe classification from raw pane output
//
// Vibe is a human-readable read of what an agent is actually experiencing,
// distinct from the machine status field ("working", "idle", "error", etc).
//
// Categories (ordered by priority):
//   lost      — repeating errors, stuck in a loop, unproductive churn
//   needs↑    — stalled/waiting, no clear progress path
//   focused   — working through a specific blocker methodically
//   flowing   — making steady progress, shipping work
//   idle      — not enough recent output to classify
//
// All functions are pure and take only the raw pane text + session metadata.
// No LLM calls. Designed to run on every render tick — must be fast.

export type VibeLabel = "lost" | "needs↑" | "focused" | "flowing" | "idle" | "you";

export interface VibeResult {
  label: VibeLabel;
  // optional short reason shown in vibe cell tooltip / drilldown
  reason?: string;
}

// ── Pattern library ──────────────────────────────────────────────────────────

// Patterns that indicate the agent is making real progress
const PROGRESS_PATTERNS = [
  /✓|✔|done|complete|success|passed|shipped|pushed|merged|fixed|resolved/i,
  /\bwrote\b|\bcreated\b|\badded\b|\bimplemented\b|\bupdated\b|\brefactored\b/i,
  /npm.*build|tsc|webpack|compiled|bundled/i,
  /git (commit|push|add|tag)/i,
  /tests?.*pass/i,
  /\d+ test.*pass/i,
];

// Patterns that indicate the agent is stuck or erroring
const ERROR_PATTERNS = [
  /\berror\b|\bfailed\b|\bfailure\b/i,
  /\bcannot\b|\bcannot find\b|\bno such\b|\bnot found\b/i,
  /\bTypeError\b|\bReferenceError\b|\bSyntaxError\b|\bAssertionError\b/i,
  /\bEACCES\b|\bENOENT\b|\bECONNREFUSED\b/i,
  /exit code [^0]/i,
  /\bstatus 4\d\d\b|\bstatus 5\d\d\b/i,
];

// Patterns that suggest the agent needs direction / is waiting
const WAITING_PATTERNS = [
  /\bwaiting\b|\bwaiting for\b/i,
  /\?\s*$/, // ends with question mark
  /\bwhat (should|do|would)\b/i,
  /\bhow (should|do|would|can)\b/i,
  /\bdo you want\b|\bwould you like\b|\bshould i\b/i,
  /\bneed.*input\b|\bneed.*direction\b|\bneed.*clarif/i,
  /\bplease (confirm|let me know|advise|specify)/i,
  /\bunclear\b|\bambiguous\b|\bnot sure\b|\bunsure\b/i,
];

// Patterns indicating productive focused work (not just noise)
const FOCUSED_PATTERNS = [
  /\btrying\b|\battempting\b|\bfixing\b|\bdebugging\b|\binvestigating\b/i,
  /\bretrying\b|\bfallback\b|\balternative\b/i,
  /\bstep \d\b|\bphase \d\b|\bpart \d\b/i,
  /\d+\/\d+/,  // progress fractions like "3/10"
];

// OpenCode UI chrome to strip — these lines don't reflect agent state
const CHROME_STRIP = [
  /^>\s*(ctrl\+|Ctrl\+)/,
  /^─{3,}/,
  /^(Agents?|Sessions?|Tasks?|Commands?)\s*$/,
  /^\$\s/,
  /^Press (Enter|Esc|Tab)/i,
  /^Type.*command/i,
  /^Use .*to/i,
];

// ── Core analysis ─────────────────────────────────────────────────────────────

interface PaneAnalysis {
  errorCount: number;          // total error pattern matches
  progressCount: number;       // total progress pattern matches
  waitingCount: number;        // total waiting pattern matches
  focusedCount: number;        // total focused-work pattern matches
  repeatedLineRatio: number;   // 0..1 — how much of the output is repeated lines (loop signal)
  recentLineCount: number;     // non-empty, non-chrome lines in last 20 lines
  totalLineCount: number;      // total non-empty lines in output
}

/**
 * Analyse the last N lines of raw pane text for vibe signals.
 * Only looks at the last 40 lines to keep it fast and recency-weighted.
 */
export function analysePaneOutput(rawOutput: string, windowSize = 40): PaneAnalysis {
  const allLines = rawOutput
    .split("\n")
    .map((l) => l.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").trim()) // strip ANSI
    .filter((l) => l.length > 0)
    .filter((l) => !CHROME_STRIP.some((re) => re.test(l)));

  const window = allLines.slice(-windowSize);
  const recent = allLines.slice(-20);

  let errorCount = 0;
  let progressCount = 0;
  let waitingCount = 0;
  let focusedCount = 0;

  for (const line of window) {
    if (ERROR_PATTERNS.some((re) => re.test(line))) errorCount++;
    if (PROGRESS_PATTERNS.some((re) => re.test(line))) progressCount++;
    if (WAITING_PATTERNS.some((re) => re.test(line))) waitingCount++;
    if (FOCUSED_PATTERNS.some((re) => re.test(line))) focusedCount++;
  }

  // loop detection: what fraction of the window is repeated lines?
  const lineCounts = new Map<string, number>();
  for (const line of window) {
    if (line.length < 10) continue; // too short to be meaningful
    lineCounts.set(line, (lineCounts.get(line) ?? 0) + 1);
  }
  const repeatedLines = [...lineCounts.values()].filter((c) => c > 2).reduce((s, c) => s + c, 0);
  const repeatedLineRatio = window.length > 0 ? repeatedLines / window.length : 0;

  return {
    errorCount,
    progressCount,
    waitingCount,
    focusedCount,
    repeatedLineRatio,
    recentLineCount: recent.length,
    totalLineCount: allLines.length,
  };
}

/**
 * Classify agent vibe from pane analysis + session metadata.
 * Priority order: you > lost > needs↑ > focused > flowing > idle
 */
export function classifyVibe(
  analysis: PaneAnalysis,
  opts: {
    userActive: boolean;
    status: string;
    idleSinceMs: number | undefined;
    consecutiveErrors: number; // from TUI error count tracking
  }
): VibeResult {
  const { userActive, status, idleSinceMs, consecutiveErrors } = opts;

  // Human is in the pane — highest priority
  if (userActive) return { label: "you" };

  // Loop detection: lots of repeated lines = stuck
  if (analysis.repeatedLineRatio > 0.4 && analysis.errorCount > 0) {
    return { label: "lost", reason: "repeating errors" };
  }
  if (analysis.repeatedLineRatio > 0.5) {
    return { label: "lost", reason: "output loop" };
  }

  // Many consecutive errors with no progress = lost
  if (consecutiveErrors >= 4 || (consecutiveErrors >= 2 && analysis.progressCount === 0 && analysis.errorCount > 2)) {
    return { label: "lost", reason: `${consecutiveErrors} errors, no progress` };
  }

  // Waiting signals dominate
  if (analysis.waitingCount >= 2 || (analysis.waitingCount >= 1 && status === "waiting")) {
    return { label: "needs↑", reason: "needs direction" };
  }

  // Done / stopped with no recent activity
  if (status === "done" || status === "stopped") {
    return { label: "idle", reason: status };
  }

  // Long idle with no output
  if (idleSinceMs !== undefined && idleSinceMs > 180_000 && analysis.recentLineCount < 3) {
    return { label: "idle", reason: `quiet ${Math.round(idleSinceMs / 60_000)}m` };
  }

  // Errors but also making progress = focused (working through it)
  if (analysis.errorCount > 0 && analysis.progressCount > 0) {
    return { label: "focused", reason: "fixing" };
  }
  if (analysis.errorCount > 0 && analysis.focusedCount > 0) {
    return { label: "focused", reason: "debugging" };
  }
  if (analysis.focusedCount > 0 && analysis.progressCount === 0) {
    return { label: "focused", reason: "working through it" };
  }

  // Clear progress signals = flowing
  if (analysis.progressCount >= 2) {
    return { label: "flowing", reason: "shipping" };
  }
  if (analysis.progressCount >= 1 && (status === "working" || status === "running")) {
    return { label: "flowing" };
  }

  // Active status with recent output but unclear signal
  if ((status === "working" || status === "running") && analysis.recentLineCount > 5) {
    return { label: "flowing" };
  }

  // Not enough signal
  return { label: "idle" };
}

// ── Formatted output for TUI ──────────────────────────────────────────────────

import { RESET, BOLD, DIM, AMBER, ROSE, LIME, GOLD, SLATE } from "./colors.js";
import { TEAL } from "./colors.js";

const VIBE_COL_W = 8; // target width for the vibe cell (padded to fill)

/** Format a VibeResult as a colored, fixed-width string for the session table. */
export function formatVibe(v: VibeResult): string {
  const pad = (s: string) => s.padEnd(VIBE_COL_W);
  switch (v.label) {
    case "you":     return `${AMBER}${BOLD}${pad("you")}${RESET}`;
    case "lost":    return `${ROSE}${BOLD}${pad("lost")}${RESET}`;
    case "needs↑":  return `${AMBER}${pad("needs↑")}${RESET}`;
    case "focused": return `${TEAL}${pad("focused")}${RESET}`;
    case "flowing": return `${LIME}${pad("flowing")}${RESET}`;
    case "idle":    return `${SLATE}${DIM}${pad("idle")}${RESET}`;
  }
}
