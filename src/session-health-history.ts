// session-health-history.ts — track health scores over time per session.
// stores rolling window of health samples, computes trend (improving,
// degrading, stable), and renders sparkline visualizations.

export interface HealthSample {
  timestamp: number;
  score: number; // 0-100
}

export interface HealthTrend {
  sessionTitle: string;
  currentScore: number;
  avgScore: number;
  minScore: number;
  maxScore: number;
  trend: "improving" | "degrading" | "stable";
  sparkline: string;
  sampleCount: number;
}

const SPARK_CHARS = "▁▂▃▄▅▆▇█";

/**
 * Stateful per-session health history tracker.
 */
export class SessionHealthHistory {
  private history = new Map<string, HealthSample[]>();
  private maxSamples: number;
  private windowMs: number;

  constructor(maxSamples = 60, windowMs = 3_600_000) { // 60 samples, 1hr window
    this.maxSamples = maxSamples;
    this.windowMs = windowMs;
  }

  /** Record a health score for a session. */
  record(sessionTitle: string, score: number, now = Date.now()): void {
    const clamped = Math.max(0, Math.min(100, Math.round(score)));
    if (!this.history.has(sessionTitle)) this.history.set(sessionTitle, []);
    const samples = this.history.get(sessionTitle)!;
    samples.push({ timestamp: now, score: clamped });
    // prune old samples outside window
    const cutoff = now - this.windowMs;
    const pruned = samples.filter((s) => s.timestamp >= cutoff);
    // also enforce max samples
    const trimmed = pruned.length > this.maxSamples ? pruned.slice(-this.maxSamples) : pruned;
    this.history.set(sessionTitle, trimmed);
  }

  /** Get the health trend for a session. */
  getTrend(sessionTitle: string): HealthTrend | null {
    const samples = this.history.get(sessionTitle);
    if (!samples || samples.length < 2) return null;

    const scores = samples.map((s) => s.score);
    const current = scores[scores.length - 1];
    const avg = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
    const min = Math.min(...scores);
    const max = Math.max(...scores);

    // trend: compare first half avg vs second half avg
    const mid = Math.floor(scores.length / 2);
    const firstHalfAvg = scores.slice(0, mid).reduce((a, b) => a + b, 0) / mid;
    const secondHalfAvg = scores.slice(mid).reduce((a, b) => a + b, 0) / (scores.length - mid);
    let trend: HealthTrend["trend"] = "stable";
    if (secondHalfAvg > firstHalfAvg + 5) trend = "improving";
    else if (secondHalfAvg < firstHalfAvg - 5) trend = "degrading";

    // sparkline from last N samples (normalize to 0-7 for spark chars)
    const recentScores = scores.slice(-20);
    const sparkRange = max - min || 1;
    const sparkline = recentScores.map((s) => {
      const idx = Math.round(((s - min) / sparkRange) * 7);
      return SPARK_CHARS[Math.min(7, Math.max(0, idx))];
    }).join("");

    return { sessionTitle, currentScore: current, avgScore: avg, minScore: min, maxScore: max, trend, sparkline, sampleCount: samples.length };
  }

  /** Get health trends for all tracked sessions. */
  getAllTrends(): HealthTrend[] {
    const results: HealthTrend[] = [];
    for (const title of this.history.keys()) {
      const trend = this.getTrend(title);
      if (trend) results.push(trend);
    }
    return results.sort((a, b) => a.currentScore - b.currentScore); // worst health first
  }

  /** Get sample count for a session. */
  getSampleCount(sessionTitle: string): number {
    return this.history.get(sessionTitle)?.length ?? 0;
  }
}

/**
 * Format health history trends for TUI display.
 */
export function formatHealthHistory(trends: HealthTrend[]): string[] {
  if (trends.length === 0) return ["  Health history: no data (need 2+ samples per session)"];
  const lines: string[] = [];
  lines.push(`  Health History (${trends.length} sessions):`);
  for (const t of trends) {
    const icon = t.trend === "improving" ? "↑" : t.trend === "degrading" ? "↓" : "→";
    const healthBar = t.sparkline;
    lines.push(`  ${icon} ${t.sessionTitle.slice(0, 16).padEnd(16)} ${t.currentScore.toString().padStart(3)}% [${healthBar}] avg:${t.avgScore}% ${t.trend}`);
  }
  return lines;
}
