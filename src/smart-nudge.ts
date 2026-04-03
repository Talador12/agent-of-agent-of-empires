// smart-nudge.ts — generate context-aware nudge messages using session memory
// and recent activity. produces targeted nudges instead of generic "are you stuck?"

import { loadSessionMemory } from "./session-memory.js";
import type { TaskState } from "./types.js";

export interface NudgeContext {
  sessionTitle: string;
  goal: string;
  lastProgressSummary?: string;
  recentActivity?: string;      // from SessionSummarizer
  errorPatterns: string[];      // from session memory
  successPatterns: string[];
  idleMinutes: number;
}

/**
 * Generate a context-aware nudge message for a stuck session.
 * Uses session memory and recent context to craft a targeted message
 * rather than a generic "are you stuck?" prompt.
 */
export function generateNudge(ctx: NudgeContext): string {
  const parts: string[] = [];

  // open with awareness of what they're working on
  if (ctx.lastProgressSummary) {
    parts.push(`Last progress: "${ctx.lastProgressSummary}".`);
  }

  // if we know recent activity, reference it
  if (ctx.recentActivity && ctx.recentActivity !== "idle") {
    parts.push(`I see you're ${ctx.recentActivity}.`);
  }

  // if we have error patterns from memory, suggest checking those
  if (ctx.errorPatterns.length > 0) {
    const pattern = ctx.errorPatterns[ctx.errorPatterns.length - 1];
    parts.push(`Previous issue: ${pattern} — check if that's recurring.`);
  }

  // if we have success patterns, reference what worked before
  if (ctx.successPatterns.length > 0) {
    const pattern = ctx.successPatterns[ctx.successPatterns.length - 1];
    parts.push(`What worked before: ${pattern}.`);
  }

  // idle-aware framing
  if (ctx.idleMinutes > 30) {
    parts.push(`It's been ${ctx.idleMinutes}m since last activity.`);
  }

  // always end with the goal reminder
  const goalPreview = ctx.goal.length > 80 ? ctx.goal.slice(0, 77) + "..." : ctx.goal;
  parts.push(`Current goal: ${goalPreview}`);

  // if nothing specific, fall back to a targeted question
  if (parts.length <= 1) {
    parts.unshift("Checking in — need any help or guidance?");
  }

  return parts.join(" ");
}

/**
 * Build nudge context from task state and session data.
 */
export function buildNudgeContext(
  task: TaskState,
  recentActivity?: string,
  idleMs = 0,
): NudgeContext {
  const memory = loadSessionMemory(task.sessionTitle);
  const errorPatterns = memory.entries
    .filter((e) => e.category === "error_pattern")
    .map((e) => e.text)
    .slice(-3);
  const successPatterns = memory.entries
    .filter((e) => e.category === "success_pattern")
    .map((e) => e.text)
    .slice(-2);

  const lastProgress = task.progress.length > 0
    ? task.progress[task.progress.length - 1].summary
    : undefined;

  return {
    sessionTitle: task.sessionTitle,
    goal: task.goal,
    lastProgressSummary: lastProgress,
    recentActivity,
    errorPatterns,
    successPatterns,
    idleMinutes: Math.round(idleMs / 60_000),
  };
}

/**
 * Format a nudge for TUI display (preview before sending).
 */
export function formatNudgePreview(sessionTitle: string, nudge: string): string[] {
  return [
    `  Nudge for "${sessionTitle}":`,
    `  "${nudge}"`,
  ];
}
