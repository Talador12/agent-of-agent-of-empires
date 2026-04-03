// daemon-health-score.ts — composite health metric from all subsystems.
// aggregates watchdog, SLA, error rate, stall count, cache hit rate,
// and session health into a single 0-100 score with breakdown.

export interface HealthComponent {
  name: string;
  score: number;   // 0-100
  weight: number;  // relative weight
  detail: string;
}

export interface DaemonHealthReport {
  overallScore: number;
  grade: "A" | "B" | "C" | "D" | "F";
  components: HealthComponent[];
  timestamp: number;
}

export interface HealthInputs {
  watchdogStalled: boolean;
  slaHealthPct: number;          // 0-100 fleet SLA health
  errorRatePct: number;          // 0-100 % of ticks with errors
  cacheHitRatePct: number;       // 0-100 observation cache hit rate
  avgSessionHealthPct: number;   // 0-100 average session health
  stallCount: number;            // total stall count from watchdog
  unresolvedIncidents: number;   // unresolved incident count
  complianceViolations: number;  // compliance violation count
}

/**
 * Compute composite daemon health score.
 */
export function computeHealthScore(inputs: HealthInputs, now = Date.now()): DaemonHealthReport {
  const components: HealthComponent[] = [];

  // watchdog (weight 20) — binary: 100 if ok, 0 if stalled
  const watchdogScore = inputs.watchdogStalled ? 0 : 100;
  components.push({ name: "watchdog", score: watchdogScore, weight: 20, detail: inputs.watchdogStalled ? "STALLED" : "ok" });

  // SLA health (weight 20)
  components.push({ name: "sla-health", score: inputs.slaHealthPct, weight: 20, detail: `${inputs.slaHealthPct}%` });

  // error rate (weight 15) — invert: 0% errors = 100 score
  const errorScore = Math.max(0, 100 - inputs.errorRatePct * 2);
  components.push({ name: "error-rate", score: errorScore, weight: 15, detail: `${inputs.errorRatePct}% error ticks` });

  // session health (weight 15)
  components.push({ name: "session-health", score: inputs.avgSessionHealthPct, weight: 15, detail: `avg ${inputs.avgSessionHealthPct}%` });

  // cache efficiency (weight 10)
  components.push({ name: "cache-hit-rate", score: inputs.cacheHitRatePct, weight: 10, detail: `${inputs.cacheHitRatePct}% hits` });

  // incidents (weight 10) — deduct per unresolved incident
  const incidentScore = Math.max(0, 100 - inputs.unresolvedIncidents * 15);
  components.push({ name: "incidents", score: incidentScore, weight: 10, detail: `${inputs.unresolvedIncidents} unresolved` });

  // compliance (weight 10) — deduct per violation
  const complianceScore = Math.max(0, 100 - inputs.complianceViolations * 10);
  components.push({ name: "compliance", score: complianceScore, weight: 10, detail: `${inputs.complianceViolations} violations` });

  // weighted average
  const totalWeight = components.reduce((a, c) => a + c.weight, 0);
  const overallScore = Math.round(components.reduce((a, c) => a + c.score * c.weight, 0) / totalWeight);

  const grade = overallScore >= 90 ? "A" : overallScore >= 75 ? "B" : overallScore >= 60 ? "C" : overallScore >= 40 ? "D" : "F";

  return { overallScore, grade, components, timestamp: now };
}

/**
 * Format health score for TUI display.
 */
export function formatHealthScore(report: DaemonHealthReport): string[] {
  const icon = report.grade === "A" ? "🟢" : report.grade === "B" ? "🟡" : report.grade === "C" ? "🟠" : "🔴";
  const lines: string[] = [];
  lines.push(`  Daemon Health Score: ${icon} ${report.overallScore}/100 (Grade ${report.grade})`);
  for (const c of report.components) {
    const bar = "█".repeat(Math.round(c.score / 10)) + "░".repeat(10 - Math.round(c.score / 10));
    lines.push(`    ${c.name.padEnd(16)} ${bar} ${c.score.toString().padStart(3)} (w:${c.weight}) ${c.detail}`);
  }
  return lines;
}
