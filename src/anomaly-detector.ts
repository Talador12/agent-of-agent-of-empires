// anomaly-detector.ts — flag sessions with unusual cost or activity patterns.
// uses z-score against fleet-wide statistics to identify outliers.

export interface AnomalySignal {
  sessionTitle: string;
  metric: "cost_rate" | "activity_rate" | "error_rate" | "idle_duration";
  value: number;
  fleetMean: number;
  fleetStdDev: number;
  zScore: number;
  anomalous: boolean;
  detail: string;
}

/**
 * Compute mean and standard deviation for an array of numbers.
 */
export function computeStats(values: number[]): { mean: number; stdDev: number } {
  if (values.length === 0) return { mean: 0, stdDev: 0 };
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (values.length === 1) return { mean, stdDev: 0 };
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  return { mean, stdDev: Math.sqrt(variance) };
}

/**
 * Compute z-score: how many standard deviations from the mean.
 */
export function zScore(value: number, mean: number, stdDev: number): number {
  if (stdDev === 0) return 0;
  return (value - mean) / stdDev;
}

export interface SessionMetrics {
  sessionTitle: string;
  costRatePerHour: number;   // $/hr
  activityEventsPerHour: number;
  errorCount: number;
  idleDurationMs: number;    // how long since last activity
}

/**
 * Detect anomalies across fleet sessions.
 * A session is anomalous if any metric has |z-score| > threshold.
 */
export function detectAnomalies(
  sessions: SessionMetrics[],
  threshold = 2.0,
): AnomalySignal[] {
  if (sessions.length < 3) return []; // need 3+ for meaningful statistics

  const signals: AnomalySignal[] = [];

  // check each metric across fleet
  const metrics: Array<{ key: keyof SessionMetrics & string; metric: AnomalySignal["metric"]; highIsAnomaly: boolean }> = [
    { key: "costRatePerHour", metric: "cost_rate", highIsAnomaly: true },
    { key: "activityEventsPerHour", metric: "activity_rate", highIsAnomaly: false }, // both high and low
    { key: "errorCount", metric: "error_rate", highIsAnomaly: true },
    { key: "idleDurationMs", metric: "idle_duration", highIsAnomaly: true },
  ];

  for (const { key, metric, highIsAnomaly } of metrics) {
    const values = sessions.map((s) => s[key] as number);
    const { mean, stdDev } = computeStats(values);
    if (stdDev === 0) continue; // all same value, no anomaly possible

    for (const session of sessions) {
      const value = session[key] as number;
      const z = zScore(value, mean, stdDev);
      const anomalous = highIsAnomaly ? z > threshold : Math.abs(z) > threshold;

      if (anomalous) {
        const direction = z > 0 ? "above" : "below";
        signals.push({
          sessionTitle: session.sessionTitle,
          metric,
          value,
          fleetMean: mean,
          fleetStdDev: stdDev,
          zScore: z,
          anomalous: true,
          detail: `${metric}: ${value.toFixed(2)} is ${Math.abs(z).toFixed(1)}σ ${direction} fleet mean (${mean.toFixed(2)})`,
        });
      }
    }
  }

  return signals;
}

/**
 * Format anomaly signals for TUI display.
 */
export function formatAnomalies(signals: AnomalySignal[]): string[] {
  if (signals.length === 0) return ["  ✅ no anomalies detected"];
  const lines: string[] = [];
  lines.push(`  ⚠ ${signals.length} anomal${signals.length !== 1 ? "ies" : "y"} detected:`);
  for (const s of signals) {
    lines.push(`  ${s.sessionTitle}: ${s.detail}`);
  }
  return lines;
}
