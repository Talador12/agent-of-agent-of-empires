// activity-heatmap.ts — per-session activity sparkline for TUI display.
// tracks change events per session in fixed-width time buckets and renders
// as a compact sparkline using Unicode block characters.

export interface ActivityBucket {
  startMs: number;
  count: number; // number of change events in this bucket
}

export interface SessionHeatmap {
  sessionTitle: string;
  buckets: ActivityBucket[];
  sparkline: string;
  totalEvents: number;
  peakRate: number; // max events per bucket
}

// sparkline characters: ▁▂▃▄▅▆▇█ (8 levels)
const SPARK_CHARS = " ▁▂▃▄▅▆▇";

/**
 * Render a sparkline string from an array of values.
 * Values are normalized to 0-8 range based on the max value.
 */
export function renderSparkline(values: number[]): string {
  if (values.length === 0) return "";
  const max = Math.max(...values);
  if (max === 0) return " ".repeat(values.length);
  return values.map((v) => {
    const idx = Math.round((v / max) * (SPARK_CHARS.length - 1));
    return SPARK_CHARS[idx];
  }).join("");
}

/**
 * Track activity events per session in time buckets.
 * Each tick, call `recordEvent()` for sessions with new output.
 * Call `getHeatmap()` to render the sparkline for display.
 */
export class ActivityTracker {
  private events = new Map<string, number[]>(); // session -> timestamps
  private bucketMs: number;
  private windowMs: number;
  private bucketCount: number;

  constructor(bucketMs = 60_000, bucketCount = 30) { // 1 min buckets, 30 buckets = 30 min window
    this.bucketMs = bucketMs;
    this.bucketCount = bucketCount;
    this.windowMs = bucketMs * bucketCount;
  }

  /** Record an activity event for a session. */
  recordEvent(sessionTitle: string, now = Date.now()): void {
    if (!this.events.has(sessionTitle)) this.events.set(sessionTitle, []);
    this.events.get(sessionTitle)!.push(now);
    this.prune(sessionTitle, now);
  }

  /** Get the heatmap for a single session. */
  getHeatmap(sessionTitle: string, now = Date.now()): SessionHeatmap {
    const timestamps = this.events.get(sessionTitle) ?? [];
    const windowStart = now - this.windowMs;

    // build buckets
    const buckets: ActivityBucket[] = [];
    for (let i = 0; i < this.bucketCount; i++) {
      const startMs = windowStart + i * this.bucketMs;
      const endMs = startMs + this.bucketMs;
      // last bucket uses <= to include events at exactly `now`
      const count = timestamps.filter((t) => t >= startMs && (i === this.bucketCount - 1 ? t <= endMs : t < endMs)).length;
      buckets.push({ startMs, count });
    }

    const counts = buckets.map((b) => b.count);
    const totalEvents = counts.reduce((a, b) => a + b, 0);
    const peakRate = Math.max(...counts);

    return {
      sessionTitle,
      buckets,
      sparkline: renderSparkline(counts),
      totalEvents,
      peakRate,
    };
  }

  /** Get heatmaps for all tracked sessions. */
  getAllHeatmaps(now = Date.now()): SessionHeatmap[] {
    const result: SessionHeatmap[] = [];
    for (const title of this.events.keys()) {
      result.push(this.getHeatmap(title, now));
    }
    return result;
  }

  /** Format a heatmap for TUI display. */
  static format(heatmap: SessionHeatmap): string {
    const title = heatmap.sessionTitle.length > 18
      ? heatmap.sessionTitle.slice(0, 15) + "..."
      : heatmap.sessionTitle.padEnd(18);
    const events = `${heatmap.totalEvents}ev`.padStart(5);
    const peak = heatmap.peakRate > 0 ? ` peak:${heatmap.peakRate}/min` : "";
    return `  ${title} ${heatmap.sparkline} ${events}${peak}`;
  }

  /** Format all heatmaps for TUI display. */
  formatAll(now = Date.now()): string[] {
    const heatmaps = this.getAllHeatmaps(now);
    if (heatmaps.length === 0) return ["  (no activity data yet)"];
    const lines: string[] = [];
    lines.push(`  Activity heatmap (last ${this.bucketCount}min, 1min buckets):`);
    for (const h of heatmaps) {
      lines.push(ActivityTracker.format(h));
    }
    return lines;
  }

  /** Get the number of tracked sessions (for testing). */
  get sessionCount(): number {
    return this.events.size;
  }

  private prune(sessionTitle: string, now: number): void {
    const cutoff = now - this.windowMs;
    const timestamps = this.events.get(sessionTitle);
    if (timestamps) {
      const pruned = timestamps.filter((t) => t >= cutoff);
      if (pruned.length === 0) this.events.delete(sessionTitle);
      else this.events.set(sessionTitle, pruned);
    }
  }
}
