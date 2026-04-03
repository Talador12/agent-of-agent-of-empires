// operator-shift-handoff.ts — generate structured handoff notes for operator
// shift changes. aggregates fleet state, recent events, active issues, and
// pending decisions into a scannable summary that incoming operators can
// read in 30 seconds.

import type { TaskState } from "./types.js";

export interface HandoffSession {
  title: string;
  status: string;
  goal: string;
  progressPct: number;
  costUsd: number;
  healthScore: number;
  recentActivity: string; // one-line summary
}

export interface HandoffAlert {
  severity: "info" | "warning" | "critical";
  message: string;
}

export interface ShiftHandoff {
  generatedAt: string;
  fleetSummary: {
    totalSessions: number;
    activeSessions: number;
    completedSessions: number;
    totalCostUsd: number;
    avgHealthScore: number;
  };
  sessions: HandoffSession[];
  alerts: HandoffAlert[];
  pendingDecisions: string[];
  recommendations: string[];
}

/**
 * Build a shift handoff from current fleet state.
 */
export function buildShiftHandoff(
  tasks: TaskState[],
  sessionHealthScores: Map<string, number>,
  sessionCosts: Map<string, number>,
  recentAlerts: string[],
  pendingApprovals: string[],
): ShiftHandoff {
  const now = new Date();
  const active = tasks.filter((t) => t.status === "active");
  const completed = tasks.filter((t) => t.status === "completed");
  const failed = tasks.filter((t) => t.status === "failed");
  const paused = tasks.filter((t) => t.status === "paused");

  const sessions: HandoffSession[] = tasks.map((t) => {
    const health = sessionHealthScores.get(t.sessionTitle) ?? 50;
    const cost = sessionCosts.get(t.sessionTitle) ?? 0;
    const progressPct = t.progress.length > 0 ? Math.min(100, t.progress.length * 15) : 0;
    const lastProgress = t.progress.length > 0
      ? t.progress[t.progress.length - 1].summary.slice(0, 60)
      : "no progress entries";

    return {
      title: t.sessionTitle,
      status: t.status,
      goal: t.goal.slice(0, 80),
      progressPct,
      costUsd: cost,
      healthScore: health,
      recentActivity: lastProgress,
    };
  });

  const totalCost = Array.from(sessionCosts.values()).reduce((a, b) => a + b, 0);
  const healthScores = Array.from(sessionHealthScores.values());
  const avgHealth = healthScores.length > 0
    ? Math.round(healthScores.reduce((a, b) => a + b, 0) / healthScores.length)
    : 0;

  // generate alerts
  const alerts: HandoffAlert[] = [];
  if (failed.length > 0) {
    alerts.push({ severity: "critical", message: `${failed.length} failed task${failed.length !== 1 ? "s" : ""}: ${failed.map((t) => t.sessionTitle).join(", ")}` });
  }
  if (paused.length > 0) {
    alerts.push({ severity: "warning", message: `${paused.length} paused task${paused.length !== 1 ? "s" : ""}: ${paused.map((t) => t.sessionTitle).join(", ")}` });
  }
  if (avgHealth < 40) {
    alerts.push({ severity: "critical", message: `Fleet health critically low: ${avgHealth}%` });
  } else if (avgHealth < 60) {
    alerts.push({ severity: "warning", message: `Fleet health below normal: ${avgHealth}%` });
  }
  for (const a of recentAlerts.slice(0, 5)) {
    alerts.push({ severity: "info", message: a.slice(0, 100) });
  }

  // generate recommendations
  const recommendations: string[] = [];
  if (failed.length > 0) recommendations.push("Review and restart failed tasks or update goals");
  if (paused.length > 2) recommendations.push("Consider resuming or removing stale paused tasks");
  if (totalCost > 50) recommendations.push(`Fleet cost is $${totalCost.toFixed(2)} — review cost budgets`);
  if (pendingApprovals.length > 0) recommendations.push(`${pendingApprovals.length} pending approval${pendingApprovals.length !== 1 ? "s" : ""} in queue`);
  if (active.length === 0 && tasks.length > 0) recommendations.push("No active tasks — check if work is stalled");

  return {
    generatedAt: now.toISOString(),
    fleetSummary: {
      totalSessions: tasks.length,
      activeSessions: active.length,
      completedSessions: completed.length,
      totalCostUsd: totalCost,
      avgHealthScore: avgHealth,
    },
    sessions,
    alerts,
    pendingDecisions: pendingApprovals.slice(0, 10),
    recommendations,
  };
}

/**
 * Format handoff as TUI-friendly output.
 */
export function formatHandoffTui(handoff: ShiftHandoff): string[] {
  const lines: string[] = [];
  const fs = handoff.fleetSummary;
  lines.push(`  ═══ Shift Handoff (${handoff.generatedAt.slice(0, 19)}) ═══`);
  lines.push(`  Fleet: ${fs.activeSessions} active / ${fs.completedSessions} done / ${fs.totalSessions} total | $${fs.totalCostUsd.toFixed(2)} | health ${fs.avgHealthScore}%`);

  if (handoff.alerts.length > 0) {
    lines.push("  Alerts:");
    for (const a of handoff.alerts) {
      const icon = a.severity === "critical" ? "🔴" : a.severity === "warning" ? "🟡" : "ℹ";
      lines.push(`    ${icon} ${a.message}`);
    }
  }

  lines.push("  Sessions:");
  for (const s of handoff.sessions) {
    const bar = s.healthScore >= 70 ? "●" : s.healthScore >= 40 ? "◐" : "○";
    lines.push(`    ${bar} ${s.title} [${s.status}] ${s.progressPct}% $${s.costUsd.toFixed(2)}`);
  }

  if (handoff.recommendations.length > 0) {
    lines.push("  Recommendations:");
    for (const r of handoff.recommendations) lines.push(`    → ${r}`);
  }

  return lines;
}

/**
 * Format handoff as clipboard-friendly markdown.
 */
export function formatHandoffMarkdown(handoff: ShiftHandoff): string {
  const fs = handoff.fleetSummary;
  const parts: string[] = [];
  parts.push(`# Shift Handoff — ${handoff.generatedAt.slice(0, 16)}`);
  parts.push(`**Fleet:** ${fs.activeSessions} active, ${fs.completedSessions} done, ${fs.totalSessions} total | $${fs.totalCostUsd.toFixed(2)} | health ${fs.avgHealthScore}%`);

  if (handoff.alerts.length > 0) {
    parts.push("\n## Alerts");
    for (const a of handoff.alerts) parts.push(`- **${a.severity}**: ${a.message}`);
  }

  if (handoff.sessions.length > 0) {
    parts.push("\n## Sessions");
    for (const s of handoff.sessions) {
      parts.push(`- **${s.title}** [${s.status}] — ${s.progressPct}% — $${s.costUsd.toFixed(2)} — ${s.recentActivity}`);
    }
  }

  if (handoff.recommendations.length > 0) {
    parts.push("\n## Recommendations");
    for (const r of handoff.recommendations) parts.push(`- ${r}`);
  }

  return parts.join("\n");
}
