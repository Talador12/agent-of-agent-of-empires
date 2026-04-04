// fleet-cost-optimizer.ts — actionable cost reduction recommendations.
// analyzes fleet cost patterns and suggests specific actions: throttle
// high-burn sessions, pause idle expensive ones, consolidate similar work.

export interface CostOptInput {
  sessionTitle: string;
  costUsd: number;
  burnRatePerHr: number;
  progressPct: number;
  idleMinutes: number;
  status: string;
}

export interface CostRecommendation {
  sessionTitle: string;
  action: "throttle" | "pause" | "consolidate" | "complete-soon" | "review";
  savingsEstUsd: number;
  reason: string;
  priority: "high" | "medium" | "low";
}

export interface CostOptReport {
  totalCostUsd: number;
  potentialSavingsUsd: number;
  recommendations: CostRecommendation[];
}

/**
 * Analyze fleet costs and generate optimization recommendations.
 */
export function analyzeCostOptimizations(sessions: CostOptInput[], fleetAvgBurnRate = 0): CostOptReport {
  const recommendations: CostRecommendation[] = [];
  const totalCost = sessions.reduce((a, s) => a + s.costUsd, 0);
  const avgBurn = fleetAvgBurnRate > 0 ? fleetAvgBurnRate : (sessions.length > 0 ? sessions.reduce((a, s) => a + s.burnRatePerHr, 0) / sessions.length : 0);

  for (const s of sessions) {
    if (s.status !== "active" && s.status !== "working") continue;

    // high burn rate with low progress — throttle
    if (s.burnRatePerHr > avgBurn * 2 && s.progressPct < 50) {
      const savings = (s.burnRatePerHr - avgBurn) * 2; // 2hr savings estimate
      recommendations.push({ sessionTitle: s.sessionTitle, action: "throttle", savingsEstUsd: Math.round(savings * 100) / 100, reason: `$${s.burnRatePerHr.toFixed(2)}/hr burn at ${s.progressPct}% progress`, priority: "high" });
    }

    // idle but still burning cost
    if (s.idleMinutes > 15 && s.burnRatePerHr > 0.5) {
      const savings = s.burnRatePerHr * (s.idleMinutes / 60);
      recommendations.push({ sessionTitle: s.sessionTitle, action: "pause", savingsEstUsd: Math.round(savings * 100) / 100, reason: `idle ${s.idleMinutes}m at $${s.burnRatePerHr.toFixed(2)}/hr`, priority: s.idleMinutes > 30 ? "high" : "medium" });
    }

    // near completion — push to finish
    if (s.progressPct >= 80 && s.burnRatePerHr > avgBurn) {
      recommendations.push({ sessionTitle: s.sessionTitle, action: "complete-soon", savingsEstUsd: 0, reason: `${s.progressPct}% done — push to finish to stop burn`, priority: "medium" });
    }

    // high total cost — review
    if (s.costUsd > totalCost * 0.4 && sessions.length > 1) {
      recommendations.push({ sessionTitle: s.sessionTitle, action: "review", savingsEstUsd: 0, reason: `$${s.costUsd.toFixed(2)} is ${Math.round((s.costUsd / totalCost) * 100)}% of fleet cost`, priority: "medium" });
    }
  }

  const potentialSavings = recommendations.reduce((a, r) => a + r.savingsEstUsd, 0);
  recommendations.sort((a, b) => { const p = { high: 0, medium: 1, low: 2 }; return p[a.priority] - p[b.priority]; });

  return { totalCostUsd: totalCost, potentialSavingsUsd: Math.round(potentialSavings * 100) / 100, recommendations };
}

/**
 * Format cost optimization report for TUI display.
 */
export function formatCostOptimizer(report: CostOptReport): string[] {
  const lines: string[] = [];
  lines.push(`  Cost Optimizer ($${report.totalCostUsd.toFixed(2)} total, ~$${report.potentialSavingsUsd.toFixed(2)} potential savings):`);
  if (report.recommendations.length === 0) {
    lines.push("    No cost optimizations identified — fleet is efficient");
  } else {
    for (const r of report.recommendations.slice(0, 8)) {
      const icon = r.priority === "high" ? "🔴" : r.priority === "medium" ? "🟡" : "🟢";
      const savings = r.savingsEstUsd > 0 ? ` (~$${r.savingsEstUsd.toFixed(2)} savings)` : "";
      lines.push(`    ${icon} ${r.sessionTitle}: ${r.action}${savings}`);
      lines.push(`      ${r.reason}`);
    }
  }
  return lines;
}
