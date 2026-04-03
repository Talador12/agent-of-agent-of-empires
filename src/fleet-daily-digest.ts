// fleet-daily-digest.ts — auto-generated daily summary of fleet activity.
// aggregates completions, errors, costs, health trends, and notable events
// into a scannable digest for webhook/email delivery or TUI review.

export interface DigestInput {
  periodLabel: string;           // e.g. "2026-04-03"
  completedGoals: string[];
  failedGoals: string[];
  activeGoals: string[];
  totalCostUsd: number;
  avgHealthPct: number;
  incidentCount: number;
  topBurnSession: string | null;
  topBurnRatePerHr: number;
  nudgesSent: number;
  reasonerCalls: number;
  uptimeHours: number;
}

export interface DailyDigest {
  periodLabel: string;
  summary: string;
  sections: DigestSection[];
  generatedAt: number;
}

export interface DigestSection {
  title: string;
  lines: string[];
}

/**
 * Build a daily digest from fleet metrics.
 */
export function buildDailyDigest(input: DigestInput): DailyDigest {
  const sections: DigestSection[] = [];

  // overview
  const overviewLines = [
    `Completed: ${input.completedGoals.length} | Failed: ${input.failedGoals.length} | Active: ${input.activeGoals.length}`,
    `Cost: $${input.totalCostUsd.toFixed(2)} | Health: ${input.avgHealthPct}% | Incidents: ${input.incidentCount}`,
    `Uptime: ${input.uptimeHours.toFixed(1)}h | Reasoner calls: ${input.reasonerCalls} | Nudges: ${input.nudgesSent}`,
  ];
  sections.push({ title: "Overview", lines: overviewLines });

  // completions
  if (input.completedGoals.length > 0) {
    sections.push({ title: "Completed", lines: input.completedGoals.map((g) => `  ✓ ${g}`) });
  }

  // failures
  if (input.failedGoals.length > 0) {
    sections.push({ title: "Failed", lines: input.failedGoals.map((g) => `  ✗ ${g}`) });
  }

  // cost highlight
  if (input.topBurnSession) {
    sections.push({ title: "Cost", lines: [`  Top burn: ${input.topBurnSession} ($${input.topBurnRatePerHr.toFixed(2)}/hr)`] });
  }

  // health
  if (input.avgHealthPct < 60) {
    sections.push({ title: "Health Warning", lines: [`  Fleet health ${input.avgHealthPct}% — below normal`] });
  }

  const summary = `${input.periodLabel}: ${input.completedGoals.length} completed, ${input.failedGoals.length} failed, $${input.totalCostUsd.toFixed(2)} spent`;

  return { periodLabel: input.periodLabel, summary, sections, generatedAt: Date.now() };
}

/**
 * Format digest as markdown (for webhook/email).
 */
export function formatDigestMarkdown(digest: DailyDigest): string {
  const parts: string[] = [];
  parts.push(`# Fleet Daily Digest — ${digest.periodLabel}`);
  parts.push(`\n> ${digest.summary}`);
  for (const s of digest.sections) {
    parts.push(`\n## ${s.title}`);
    for (const l of s.lines) parts.push(l);
  }
  return parts.join("\n");
}

/**
 * Format digest for TUI display.
 */
export function formatDigestTui(digest: DailyDigest): string[] {
  const lines: string[] = [];
  lines.push(`  ═══ Daily Digest: ${digest.periodLabel} ═══`);
  lines.push(`  ${digest.summary}`);
  for (const s of digest.sections) {
    lines.push(`  ${s.title}:`);
    for (const l of s.lines) lines.push(`  ${l}`);
  }
  return lines;
}
