// progress-velocity.ts — track task completion rate over time for ETA refinement.
// records progress % samples per task and computes velocity (% per hour).

import type { TaskState } from "./types.js";

export interface VelocitySample {
  timestamp: number;
  percentComplete: number;
}

export interface VelocityEstimate {
  sessionTitle: string;
  currentPercent: number;
  velocityPerHour: number;     // % per hour
  etaMs: number;               // ms until 100% (-1 = stalled/unknown)
  etaLabel: string;            // human-readable ETA
  trend: "accelerating" | "steady" | "decelerating" | "stalled";
}

/**
 * Track progress velocity per task.
 */
export class ProgressVelocityTracker {
  private samples = new Map<string, VelocitySample[]>();
  private windowMs: number;

  constructor(windowMs = 2 * 60 * 60_000) { // 2-hour lookback
    this.windowMs = windowMs;
  }

  /** Record a progress % sample for a task. */
  recordProgress(sessionTitle: string, percentComplete: number, now = Date.now()): void {
    if (!this.samples.has(sessionTitle)) this.samples.set(sessionTitle, []);
    const samples = this.samples.get(sessionTitle)!;
    // deduplicate: skip if same % as last sample
    if (samples.length > 0 && samples[samples.length - 1].percentComplete === percentComplete) return;
    samples.push({ timestamp: now, percentComplete });
    this.prune(sessionTitle, now);
  }

  /** Compute velocity and ETA for a task. */
  estimate(sessionTitle: string, now = Date.now()): VelocityEstimate | null {
    const samples = this.samples.get(sessionTitle);
    if (!samples || samples.length < 2) return null;

    const current = samples[samples.length - 1].percentComplete;
    const first = samples[0];
    const dt = now - first.timestamp;
    if (dt <= 0) return null;

    const dpct = current - first.percentComplete;
    const velocityPerMs = dpct / dt;
    const velocityPerHour = velocityPerMs * 3_600_000;

    // trend: compare first-half velocity vs second-half velocity
    const mid = Math.floor(samples.length / 2);
    const firstHalf = samples.slice(0, mid);
    const secondHalf = samples.slice(mid);
    let trend: VelocityEstimate["trend"] = "steady";
    if (firstHalf.length >= 2 && secondHalf.length >= 2) {
      const v1 = (firstHalf[firstHalf.length - 1].percentComplete - firstHalf[0].percentComplete) /
        Math.max(1, firstHalf[firstHalf.length - 1].timestamp - firstHalf[0].timestamp);
      const v2 = (secondHalf[secondHalf.length - 1].percentComplete - secondHalf[0].percentComplete) /
        Math.max(1, secondHalf[secondHalf.length - 1].timestamp - secondHalf[0].timestamp);
      if (v2 > v1 * 1.3) trend = "accelerating";
      else if (v2 < v1 * 0.7) trend = "decelerating";
    }

    if (velocityPerHour <= 0.1) {
      return { sessionTitle, currentPercent: current, velocityPerHour: 0, etaMs: -1, etaLabel: "stalled", trend: "stalled" };
    }

    const remaining = 100 - current;
    if (remaining <= 0) {
      return { sessionTitle, currentPercent: current, velocityPerHour, etaMs: 0, etaLabel: "done", trend };
    }

    const etaMs = remaining / velocityPerMs;
    return { sessionTitle, currentPercent: current, velocityPerHour, etaMs, etaLabel: formatDuration(etaMs), trend };
  }

  /** Get velocity estimates for all tracked tasks. */
  estimateAll(now = Date.now()): VelocityEstimate[] {
    const results: VelocityEstimate[] = [];
    for (const title of this.samples.keys()) {
      const est = this.estimate(title, now);
      if (est) results.push(est);
    }
    return results;
  }

  /** Format velocity estimates for TUI display. */
  formatAll(now = Date.now()): string[] {
    const estimates = this.estimateAll(now);
    if (estimates.length === 0) return ["  (no velocity data — need 2+ progress samples)"];
    const lines: string[] = [];
    for (const e of estimates) {
      const trendIcon = e.trend === "accelerating" ? "↑" : e.trend === "decelerating" ? "↓" : e.trend === "stalled" ? "⏸" : "→";
      lines.push(`  ${trendIcon} ${e.sessionTitle}: ${e.currentPercent}% @ ${e.velocityPerHour.toFixed(1)}%/hr → ETA: ${e.etaLabel}`);
    }
    return lines;
  }

  /** Get sample count for a session (for testing). */
  getSampleCount(sessionTitle: string): number {
    return this.samples.get(sessionTitle)?.length ?? 0;
  }

  private prune(sessionTitle: string, now: number): void {
    const cutoff = now - this.windowMs;
    const samples = this.samples.get(sessionTitle);
    if (samples) {
      const pruned = samples.filter((s) => s.timestamp >= cutoff);
      if (pruned.length === 0) this.samples.delete(sessionTitle);
      else this.samples.set(sessionTitle, pruned);
    }
  }
}

function formatDuration(ms: number): string {
  if (ms <= 0) return "done";
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  const hours = Math.floor(ms / 3_600_000);
  const mins = Math.round((ms % 3_600_000) / 60_000);
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}
