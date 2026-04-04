// fleet-cost-chargeback.ts — assign costs to teams/projects with
// invoicing. aggregates session costs by tag (team, project) and
// generates chargeback reports for cost allocation.

export interface ChargebackEntry {
  groupKey: string; // team name, project, etc.
  sessions: string[];
  totalCostUsd: number;
  sessionCount: number;
  pctOfFleet: number;
}

export interface ChargebackReport {
  periodLabel: string;
  totalCostUsd: number;
  entries: ChargebackEntry[];
  untaggedCostUsd: number;
  untaggedSessions: string[];
}

export interface SessionCostInfo {
  sessionTitle: string;
  costUsd: number;
  tags: Map<string, string>; // e.g. team=platform, project=auth
}

/**
 * Generate a chargeback report grouped by a tag key.
 */
export function generateChargeback(sessions: SessionCostInfo[], tagKey: string, periodLabel: string): ChargebackReport {
  const totalCost = sessions.reduce((a, s) => a + s.costUsd, 0);
  const groups = new Map<string, { sessions: string[]; cost: number }>();
  const untagged: string[] = [];
  let untaggedCost = 0;

  for (const s of sessions) {
    const tagValue = s.tags.get(tagKey);
    if (!tagValue) {
      untagged.push(s.sessionTitle);
      untaggedCost += s.costUsd;
      continue;
    }
    if (!groups.has(tagValue)) groups.set(tagValue, { sessions: [], cost: 0 });
    const g = groups.get(tagValue)!;
    g.sessions.push(s.sessionTitle);
    g.cost += s.costUsd;
  }

  const entries: ChargebackEntry[] = Array.from(groups.entries()).map(([key, g]) => ({
    groupKey: key,
    sessions: g.sessions,
    totalCostUsd: Math.round(g.cost * 100) / 100,
    sessionCount: g.sessions.length,
    pctOfFleet: totalCost > 0 ? Math.round((g.cost / totalCost) * 100) : 0,
  })).sort((a, b) => b.totalCostUsd - a.totalCostUsd);

  return {
    periodLabel,
    totalCostUsd: Math.round(totalCost * 100) / 100,
    entries,
    untaggedCostUsd: Math.round(untaggedCost * 100) / 100,
    untaggedSessions: untagged,
  };
}

/**
 * Format chargeback report for TUI display.
 */
export function formatChargeback(report: ChargebackReport): string[] {
  const lines: string[] = [];
  lines.push(`  Cost Chargeback [${report.periodLabel}] ($${report.totalCostUsd.toFixed(2)} total):`);
  if (report.entries.length === 0) {
    lines.push("    No tagged sessions — tag sessions with /session-tag <session> team=<name>");
  } else {
    lines.push(`  ${"Group".padEnd(16)} ${"Cost".padStart(9)} ${"% Fleet".padStart(8)} ${"Sessions".padStart(9)}`);
    for (const e of report.entries) {
      lines.push(`  ${e.groupKey.padEnd(16)} ${"$" + e.totalCostUsd.toFixed(2).padStart(8)} ${(e.pctOfFleet + "%").padStart(8)} ${String(e.sessionCount).padStart(9)}`);
    }
  }
  if (report.untaggedSessions.length > 0) {
    lines.push(`    Untagged: $${report.untaggedCostUsd.toFixed(2)} (${report.untaggedSessions.length} sessions)`);
  }
  return lines;
}

/**
 * Format chargeback as markdown (for email/export).
 */
export function formatChargebackMd(report: ChargebackReport): string {
  const parts: string[] = [];
  parts.push(`# Cost Chargeback — ${report.periodLabel}`);
  parts.push(`\n**Total:** $${report.totalCostUsd.toFixed(2)}`);
  if (report.entries.length > 0) {
    parts.push("\n| Group | Cost | % | Sessions |");
    parts.push("|-------|------|---|----------|");
    for (const e of report.entries) {
      parts.push(`| ${e.groupKey} | $${e.totalCostUsd.toFixed(2)} | ${e.pctOfFleet}% | ${e.sessionCount} |`);
    }
  }
  if (report.untaggedCostUsd > 0) parts.push(`\n**Untagged:** $${report.untaggedCostUsd.toFixed(2)} (${report.untaggedSessions.length} sessions)`);
  return parts.join("\n");
}
