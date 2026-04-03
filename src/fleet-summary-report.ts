// fleet-summary-report.ts — generate a compact text summary of fleet state
// suitable for posting to Slack, email, or clipboard.

import type { DaemonSessionState, TaskState } from "./types.js";

export interface FleetSummary {
  generatedAt: string;
  totalSessions: number;
  activeSessions: number;
  errorSessions: number;
  completedTasks: number;
  failedTasks: number;
  pendingTasks: number;
  totalCostUsd: number;
  fleetHealth: number;
  topIssues: string[];
}

/**
 * Build a fleet summary from current state.
 */
export function buildFleetSummary(
  sessions: readonly DaemonSessionState[],
  tasks: readonly TaskState[],
): FleetSummary {
  const scores = sessions.map((s) => s.status === "working" || s.status === "running" ? 80 : s.status === "error" ? 20 : 50);
  const health = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 100;
  let cost = 0;
  for (const s of sessions) { const m = s.costStr?.match(/\$(\d+(?:\.\d+)?)/); if (m) cost += parseFloat(m[1]); }

  const issues: string[] = [];
  const errorCount = sessions.filter((s) => s.status === "error").length;
  if (errorCount > 0) issues.push(`${errorCount} session${errorCount > 1 ? "s" : ""} in error`);
  const stuck = tasks.filter((t) => t.status === "active" && (t.stuckNudgeCount ?? 0) > 0);
  if (stuck.length > 0) issues.push(`${stuck.length} stuck task${stuck.length > 1 ? "s" : ""}`);
  const failed = tasks.filter((t) => t.status === "failed");
  if (failed.length > 0) issues.push(`${failed.length} failed task${failed.length > 1 ? "s" : ""}`);

  return {
    generatedAt: new Date().toISOString(),
    totalSessions: sessions.length,
    activeSessions: sessions.filter((s) => s.status === "working" || s.status === "running").length,
    errorSessions: errorCount,
    completedTasks: tasks.filter((t) => t.status === "completed").length,
    failedTasks: failed.length,
    pendingTasks: tasks.filter((t) => t.status === "pending").length,
    totalCostUsd: cost,
    fleetHealth: health,
    topIssues: issues,
  };
}

/**
 * Format as compact text for Slack/email.
 */
export function formatFleetSummaryText(summary: FleetSummary): string {
  const lines: string[] = [];
  lines.push(`aoaoe Fleet Report — ${summary.generatedAt.slice(0, 19)}`);
  lines.push(`Health: ${summary.fleetHealth}/100 | Sessions: ${summary.totalSessions} (${summary.activeSessions} active) | Cost: $${summary.totalCostUsd.toFixed(2)}`);
  lines.push(`Tasks: ${summary.completedTasks} done, ${summary.failedTasks} failed, ${summary.pendingTasks} pending`);
  if (summary.topIssues.length > 0) lines.push(`Issues: ${summary.topIssues.join("; ")}`);
  else lines.push("No issues.");
  return lines.join("\n");
}

/**
 * Format as TUI display lines.
 */
export function formatFleetSummaryTui(summary: FleetSummary): string[] {
  return formatFleetSummaryText(summary).split("\n").map((l) => `  ${l}`);
}
