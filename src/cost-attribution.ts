// cost-attribution.ts — break down spend by goal, repo, and time period.
// builds reports from audit trail + cost data to show where money is going.

import { parseCostUsd } from "./cost-budget.js";
import type { TaskState } from "./types.js";

export interface CostAttribution {
  sessionTitle: string;
  repo: string;
  goal: string;
  costUsd: number;
  status: string;
  costPerProgressEntry: number;
  efficiency: "high" | "medium" | "low"; // cost vs progress ratio
}

export interface CostReport {
  totalCostUsd: number;
  byRepo: Array<{ repo: string; costUsd: number; sessions: number }>;
  byStatus: Array<{ status: string; costUsd: number; count: number }>;
  topSpenders: CostAttribution[];
  mostEfficient: CostAttribution[];
  leastEfficient: CostAttribution[];
}

/**
 * Build cost attributions from task states and cost strings.
 */
export function buildCostAttributions(
  tasks: readonly TaskState[],
  costBySession: ReadonlyMap<string, string>, // session title -> "$N.NN"
): CostAttribution[] {
  return tasks.map((t) => {
    const costStr = costBySession.get(t.sessionTitle);
    const costUsd = parseCostUsd(costStr) ?? 0;
    const costPerEntry = t.progress.length > 0 ? costUsd / t.progress.length : costUsd;
    const efficiency: CostAttribution["efficiency"] =
      costPerEntry <= 0.5 ? "high" :
      costPerEntry <= 2 ? "medium" :
      "low";

    return {
      sessionTitle: t.sessionTitle,
      repo: t.repo,
      goal: t.goal.length > 60 ? t.goal.slice(0, 57) + "..." : t.goal,
      costUsd,
      status: t.status,
      costPerProgressEntry: costPerEntry,
      efficiency,
    };
  });
}

/**
 * Compute a cost report from attributions.
 */
export function computeCostReport(attributions: CostAttribution[]): CostReport {
  const totalCost = attributions.reduce((sum, a) => sum + a.costUsd, 0);

  // by repo
  const repoMap = new Map<string, { costUsd: number; sessions: number }>();
  for (const a of attributions) {
    const entry = repoMap.get(a.repo) ?? { costUsd: 0, sessions: 0 };
    entry.costUsd += a.costUsd;
    entry.sessions++;
    repoMap.set(a.repo, entry);
  }
  const byRepo = [...repoMap.entries()]
    .map(([repo, v]) => ({ repo, ...v }))
    .sort((a, b) => b.costUsd - a.costUsd);

  // by status
  const statusMap = new Map<string, { costUsd: number; count: number }>();
  for (const a of attributions) {
    const entry = statusMap.get(a.status) ?? { costUsd: 0, count: 0 };
    entry.costUsd += a.costUsd;
    entry.count++;
    statusMap.set(a.status, entry);
  }
  const byStatus = [...statusMap.entries()]
    .map(([status, v]) => ({ status, ...v }))
    .sort((a, b) => b.costUsd - a.costUsd);

  const sorted = [...attributions].sort((a, b) => b.costUsd - a.costUsd);
  const withProgress = attributions.filter((a) => a.costPerProgressEntry > 0);
  const effSorted = [...withProgress].sort((a, b) => a.costPerProgressEntry - b.costPerProgressEntry);

  return {
    totalCostUsd: totalCost,
    byRepo,
    byStatus,
    topSpenders: sorted.slice(0, 5),
    mostEfficient: effSorted.slice(0, 3),
    leastEfficient: effSorted.slice(-3).reverse(),
  };
}

/**
 * Format cost report for TUI display.
 */
export function formatCostReport(report: CostReport): string[] {
  if (report.topSpenders.length === 0) return ["  (no cost attribution data)"];
  const lines: string[] = [];
  lines.push(`  Cost attribution: $${report.totalCostUsd.toFixed(2)} total`);
  lines.push("  By repo:");
  for (const r of report.byRepo) {
    lines.push(`    ${r.repo}: $${r.costUsd.toFixed(2)} (${r.sessions} sessions)`);
  }
  lines.push("  By status:");
  for (const s of report.byStatus) {
    lines.push(`    ${s.status}: $${s.costUsd.toFixed(2)} (${s.count} tasks)`);
  }
  lines.push("  Top spenders:");
  for (const a of report.topSpenders) {
    lines.push(`    $${a.costUsd.toFixed(2)} — ${a.sessionTitle}`);
  }
  if (report.mostEfficient.length > 0) {
    lines.push("  Most efficient ($/progress):");
    for (const a of report.mostEfficient) {
      lines.push(`    $${a.costPerProgressEntry.toFixed(2)}/entry — ${a.sessionTitle} (${a.efficiency})`);
    }
  }
  return lines;
}
