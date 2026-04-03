// fleet-workload-balancer.ts — redistribute tasks when session load is
// uneven. scores sessions by active task count, burn rate, and health,
// then suggests moves from overloaded to underloaded sessions.

export interface SessionLoad {
  sessionTitle: string;
  activeTasks: number;
  burnRatePerHr: number;
  healthScore: number;
  repo: string;
}

export interface BalanceRecommendation {
  action: "move" | "pause" | "none";
  fromSession: string;
  toSession?: string;
  reason: string;
  priority: "high" | "medium" | "low";
}

export interface BalanceReport {
  balanced: boolean;
  maxLoadDiff: number;
  recommendations: BalanceRecommendation[];
  sessionLoads: Array<{ sessionTitle: string; loadScore: number; classification: "overloaded" | "normal" | "underloaded" }>;
}

/**
 * Compute a load score for a session (higher = more loaded).
 */
export function computeLoadScore(session: SessionLoad): number {
  return session.activeTasks * 40 + session.burnRatePerHr * 10 + Math.max(0, 100 - session.healthScore);
}

/**
 * Analyze fleet workload balance and generate recommendations.
 */
export function analyzeBalance(sessions: SessionLoad[], threshold = 50): BalanceReport {
  if (sessions.length < 2) {
    return { balanced: true, maxLoadDiff: 0, recommendations: [], sessionLoads: sessions.map((s) => ({ sessionTitle: s.sessionTitle, loadScore: computeLoadScore(s), classification: "normal" as const })) };
  }

  const scored = sessions.map((s) => ({ ...s, loadScore: computeLoadScore(s) }));
  scored.sort((a, b) => b.loadScore - a.loadScore);

  const avgLoad = scored.reduce((a, s) => a + s.loadScore, 0) / scored.length;
  const maxDiff = scored[0].loadScore - scored[scored.length - 1].loadScore;

  const sessionLoads = scored.map((s) => ({
    sessionTitle: s.sessionTitle,
    loadScore: s.loadScore,
    classification: s.loadScore > avgLoad + threshold ? "overloaded" as const :
      s.loadScore < avgLoad - threshold ? "underloaded" as const : "normal" as const,
  }));

  const overloaded = sessionLoads.filter((s) => s.classification === "overloaded");
  const underloaded = sessionLoads.filter((s) => s.classification === "underloaded");

  const recommendations: BalanceRecommendation[] = [];

  if (overloaded.length > 0 && underloaded.length > 0) {
    for (const over of overloaded) {
      const target = underloaded[0]; // simplest: suggest moving to least loaded
      recommendations.push({
        action: "move",
        fromSession: over.sessionTitle,
        toSession: target.sessionTitle,
        reason: `load ${over.loadScore} vs avg ${Math.round(avgLoad)} — move task to ${target.sessionTitle} (load ${target.loadScore})`,
        priority: over.loadScore > avgLoad * 2 ? "high" : "medium",
      });
    }
  } else if (overloaded.length > 0) {
    for (const over of overloaded) {
      recommendations.push({
        action: "pause",
        fromSession: over.sessionTitle,
        reason: `load ${over.loadScore} is ${Math.round(over.loadScore - avgLoad)} above average — consider pausing lowest-priority task`,
        priority: "medium",
      });
    }
  }

  return { balanced: maxDiff <= threshold, maxLoadDiff: maxDiff, recommendations, sessionLoads };
}

/**
 * Format balance report for TUI display.
 */
export function formatBalanceReport(report: BalanceReport): string[] {
  const lines: string[] = [];
  const status = report.balanced ? "BALANCED" : "IMBALANCED";
  const icon = report.balanced ? "🟢" : "🟡";
  lines.push(`  Fleet Workload ${icon} [${status}] (max load diff: ${report.maxLoadDiff}):`);

  for (const s of report.sessionLoads) {
    const tag = s.classification === "overloaded" ? " ← high" : s.classification === "underloaded" ? " ← low" : "";
    lines.push(`    ${s.sessionTitle}: load ${s.loadScore}${tag}`);
  }

  if (report.recommendations.length > 0) {
    lines.push("  Recommendations:");
    for (const r of report.recommendations) {
      lines.push(`    → ${r.action} ${r.fromSession}${r.toSession ? " → " + r.toSession : ""}: ${r.reason}`);
    }
  }

  return lines;
}
