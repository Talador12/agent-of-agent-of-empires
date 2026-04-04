// daemon-perf-regression.ts — alert when tick processing times increase.
// tracks per-tick durations, computes rolling baseline, and flags ticks
// that exceed baseline by a configurable multiplier.

export interface PerfSample {
  tickNum: number;
  durationMs: number;
  timestamp: number;
}

export interface PerfAlert {
  tickNum: number;
  durationMs: number;
  baselineMs: number;
  deviationPct: number;
  severity: "warning" | "critical";
}

/**
 * Performance regression detector.
 */
export class DaemonPerfRegression {
  private samples: PerfSample[] = [];
  private maxSamples: number;
  private warningMultiplier: number;
  private criticalMultiplier: number;

  constructor(maxSamples = 100, warningMultiplier = 2.0, criticalMultiplier = 4.0) {
    this.maxSamples = maxSamples;
    this.warningMultiplier = warningMultiplier;
    this.criticalMultiplier = criticalMultiplier;
  }

  /** Record a tick duration. */
  record(tickNum: number, durationMs: number, now = Date.now()): void {
    this.samples.push({ tickNum, durationMs, timestamp: now });
    if (this.samples.length > this.maxSamples) {
      this.samples = this.samples.slice(-this.maxSamples);
    }
  }

  /** Get the rolling baseline (median of recent samples). */
  baseline(): number {
    if (this.samples.length < 5) return 0;
    const sorted = [...this.samples.map((s) => s.durationMs)].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  }

  /** Check if the latest tick is a regression. */
  check(): PerfAlert | null {
    if (this.samples.length < 5) return null;
    const latest = this.samples[this.samples.length - 1];
    const base = this.baseline();
    if (base <= 0) return null;

    const deviationPct = Math.round(((latest.durationMs - base) / base) * 100);

    if (latest.durationMs >= base * this.criticalMultiplier) {
      return { tickNum: latest.tickNum, durationMs: latest.durationMs, baselineMs: base, deviationPct, severity: "critical" };
    }
    if (latest.durationMs >= base * this.warningMultiplier) {
      return { tickNum: latest.tickNum, durationMs: latest.durationMs, baselineMs: base, deviationPct, severity: "warning" };
    }
    return null;
  }

  /** Get recent alerts (check each sample against baseline at that point). */
  recentAlerts(limit = 5): PerfAlert[] {
    if (this.samples.length < 5) return [];
    const alerts: PerfAlert[] = [];
    const base = this.baseline();
    for (const s of this.samples.slice(-20)) {
      if (s.durationMs >= base * this.warningMultiplier) {
        const deviationPct = Math.round(((s.durationMs - base) / base) * 100);
        const severity: PerfAlert["severity"] = s.durationMs >= base * this.criticalMultiplier ? "critical" : "warning";
        alerts.push({ tickNum: s.tickNum, durationMs: s.durationMs, baselineMs: base, deviationPct, severity });
      }
    }
    return alerts.slice(-limit);
  }

  /** Get sample count. */
  sampleCount(): number { return this.samples.length; }

  /** Get average tick duration. */
  avgDuration(): number {
    if (this.samples.length === 0) return 0;
    return Math.round(this.samples.reduce((a, s) => a + s.durationMs, 0) / this.samples.length);
  }
}

/**
 * Format perf regression state for TUI display.
 */
export function formatPerfRegression(detector: DaemonPerfRegression): string[] {
  const lines: string[] = [];
  const base = detector.baseline();
  const avg = detector.avgDuration();
  const alert = detector.check();
  const icon = alert ? (alert.severity === "critical" ? "🔴" : "🟡") : "🟢";
  lines.push(`  Perf Regression ${icon} (${detector.sampleCount()} samples, baseline ${base}ms, avg ${avg}ms):`);
  if (alert) {
    lines.push(`    Latest: ${alert.durationMs}ms (${alert.deviationPct}% above baseline) — ${alert.severity}`);
  } else {
    lines.push("    No regressions detected");
  }
  const recent = detector.recentAlerts(3);
  if (recent.length > 0) {
    lines.push(`    Recent alerts: ${recent.map((a) => `tick#${a.tickNum}:${a.durationMs}ms`).join(", ")}`);
  }
  return lines;
}
