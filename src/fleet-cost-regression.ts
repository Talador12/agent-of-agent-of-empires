// fleet-cost-regression.ts — alert when cost patterns deviate from
// historical baseline. tracks per-session cost-per-hour samples,
// computes a rolling baseline, and flags deviations beyond a threshold.

export interface CostRegressionAlert {
  sessionTitle: string;
  currentRate: number;     // $/hr now
  baselineRate: number;    // $/hr historical average
  deviationPct: number;    // how far above baseline (%)
  severity: "warning" | "critical";
  message: string;
}

/**
 * Stateful cost regression detector.
 */
export class FleetCostRegression {
  private baselines = new Map<string, number[]>(); // session -> rolling rate samples
  private maxSamples: number;
  private warningThreshold: number;  // % above baseline to warn
  private criticalThreshold: number; // % above baseline for critical

  constructor(maxSamples = 30, warningThreshold = 50, criticalThreshold = 100) {
    this.maxSamples = maxSamples;
    this.warningThreshold = warningThreshold;
    this.criticalThreshold = criticalThreshold;
  }

  /** Record a cost rate sample for a session. */
  record(sessionTitle: string, costPerHour: number): void {
    if (!this.baselines.has(sessionTitle)) this.baselines.set(sessionTitle, []);
    const samples = this.baselines.get(sessionTitle)!;
    samples.push(Math.max(0, costPerHour));
    if (samples.length > this.maxSamples) {
      this.baselines.set(sessionTitle, samples.slice(-this.maxSamples));
    }
  }

  /** Get the baseline (average) cost rate for a session. */
  baseline(sessionTitle: string): number | null {
    const samples = this.baselines.get(sessionTitle);
    if (!samples || samples.length < 3) return null; // need 3+ samples
    return samples.reduce((a, b) => a + b, 0) / samples.length;
  }

  /** Check all sessions for cost regressions. */
  detect(currentRates: Map<string, number>): CostRegressionAlert[] {
    const alerts: CostRegressionAlert[] = [];

    for (const [session, currentRate] of currentRates) {
      const base = this.baseline(session);
      if (base === null || base < 0.01) continue; // no baseline or negligible

      const deviationPct = Math.round(((currentRate - base) / base) * 100);
      if (deviationPct < this.warningThreshold) continue;

      const severity: CostRegressionAlert["severity"] = deviationPct >= this.criticalThreshold ? "critical" : "warning";
      alerts.push({
        sessionTitle: session,
        currentRate,
        baselineRate: Math.round(base * 100) / 100,
        deviationPct,
        severity,
        message: `$${currentRate.toFixed(2)}/hr is ${deviationPct}% above baseline $${base.toFixed(2)}/hr`,
      });
    }

    return alerts.sort((a, b) => b.deviationPct - a.deviationPct);
  }

  /** Get tracked session count. */
  trackedSessions(): number {
    return this.baselines.size;
  }

  /** Get sample count for a session. */
  sampleCount(sessionTitle: string): number {
    return this.baselines.get(sessionTitle)?.length ?? 0;
  }
}

/**
 * Format cost regression alerts for TUI display.
 */
export function formatCostRegression(detector: FleetCostRegression, currentRates: Map<string, number>): string[] {
  const alerts = detector.detect(currentRates);
  const lines: string[] = [];
  lines.push(`  Cost Regression Detector (${detector.trackedSessions()} sessions tracked):`);
  if (alerts.length === 0) {
    lines.push("    All sessions within historical cost baseline");
  } else {
    for (const a of alerts) {
      const icon = a.severity === "critical" ? "🔴" : "🟡";
      lines.push(`    ${icon} ${a.sessionTitle}: ${a.message}`);
    }
  }
  return lines;
}
