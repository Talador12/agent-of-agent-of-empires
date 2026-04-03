// daemon-metrics-histogram.ts — per-tick latency distribution for reasoning,
// polling, and execution phases. records timing samples, computes percentiles,
// and renders ASCII histograms for performance analysis.

export type MetricPhase = "poll" | "reason" | "execute" | "tick-total";

export interface LatencySample {
  phase: MetricPhase;
  durationMs: number;
  timestamp: number;
}

export interface PercentileStats {
  phase: MetricPhase;
  count: number;
  min: number;
  max: number;
  mean: number;
  p50: number;
  p90: number;
  p99: number;
}

/**
 * Stateful latency histogram tracker.
 */
export class DaemonMetricsHistogram {
  private samples = new Map<MetricPhase, number[]>();
  private maxSamples: number;

  constructor(maxSamples = 500) {
    this.maxSamples = maxSamples;
    for (const phase of ["poll", "reason", "execute", "tick-total"] as MetricPhase[]) {
      this.samples.set(phase, []);
    }
  }

  /** Record a latency sample for a phase. */
  record(phase: MetricPhase, durationMs: number): void {
    const arr = this.samples.get(phase);
    if (!arr) return;
    arr.push(Math.max(0, durationMs));
    if (arr.length > this.maxSamples) {
      // keep last N samples
      this.samples.set(phase, arr.slice(-this.maxSamples));
    }
  }

  /** Compute percentile stats for a phase. */
  stats(phase: MetricPhase): PercentileStats | null {
    const arr = this.samples.get(phase);
    if (!arr || arr.length === 0) return null;

    const sorted = [...arr].sort((a, b) => a - b);
    const len = sorted.length;

    return {
      phase,
      count: len,
      min: sorted[0],
      max: sorted[len - 1],
      mean: Math.round(sorted.reduce((a, b) => a + b, 0) / len),
      p50: sorted[Math.floor(len * 0.5)],
      p90: sorted[Math.floor(len * 0.9)],
      p99: sorted[Math.min(len - 1, Math.floor(len * 0.99))],
    };
  }

  /** Get stats for all phases. */
  allStats(): PercentileStats[] {
    const results: PercentileStats[] = [];
    for (const phase of ["poll", "reason", "execute", "tick-total"] as MetricPhase[]) {
      const s = this.stats(phase);
      if (s) results.push(s);
    }
    return results;
  }

  /** Get raw sample count for a phase. */
  sampleCount(phase: MetricPhase): number {
    return this.samples.get(phase)?.length ?? 0;
  }

  /** Build an ASCII histogram for a phase (8 buckets). */
  histogram(phase: MetricPhase, buckets = 8): string[] {
    const arr = this.samples.get(phase);
    if (!arr || arr.length === 0) return [];

    const sorted = [...arr].sort((a, b) => a - b);
    const min = sorted[0];
    const max = sorted[sorted.length - 1];
    const range = max - min || 1;
    const bucketWidth = range / buckets;

    const counts = new Array(buckets).fill(0);
    for (const v of sorted) {
      const idx = Math.min(buckets - 1, Math.floor((v - min) / bucketWidth));
      counts[idx]++;
    }

    const maxCount = Math.max(...counts);
    const barChars = "▏▎▍▌▋▊▉█";
    const lines: string[] = [];

    for (let i = 0; i < buckets; i++) {
      const lo = Math.round(min + i * bucketWidth);
      const hi = Math.round(min + (i + 1) * bucketWidth);
      const pct = maxCount > 0 ? counts[i] / maxCount : 0;
      const barLen = Math.round(pct * 20);
      const bar = "█".repeat(barLen) + (pct > 0 && barLen === 0 ? "▏" : "");
      lines.push(`    ${String(lo).padStart(6)}–${String(hi).padEnd(6)} ${bar} ${counts[i]}`);
    }

    return lines;
  }
}

/**
 * Format metrics histogram for TUI display.
 */
export function formatMetricsHistogram(hist: DaemonMetricsHistogram): string[] {
  const allStats = hist.allStats();
  if (allStats.length === 0) return ["  Daemon metrics: no data collected"];
  const lines: string[] = [];
  lines.push("  Daemon Metrics Histogram:");
  lines.push(`  ${"Phase".padEnd(12)} ${"Count".padStart(6)} ${"Min".padStart(6)} ${"P50".padStart(6)} ${"P90".padStart(6)} ${"P99".padStart(6)} ${"Max".padStart(6)} ${"Mean".padStart(6)}`);
  for (const s of allStats) {
    lines.push(`  ${s.phase.padEnd(12)} ${String(s.count).padStart(6)} ${(s.min + "ms").padStart(6)} ${(s.p50 + "ms").padStart(6)} ${(s.p90 + "ms").padStart(6)} ${(s.p99 + "ms").padStart(6)} ${(s.max + "ms").padStart(6)} ${(s.mean + "ms").padStart(6)}`);
  }
  // show histogram for tick-total
  const tickHist = hist.histogram("tick-total");
  if (tickHist.length > 0) {
    lines.push("  Tick latency distribution (ms):");
    lines.push(...tickHist);
  }
  return lines;
}
