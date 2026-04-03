// fleet-utilization.ts — per-hour activity across the fleet for capacity planning.
// tracks activity events by hour-of-day and day-of-week to identify peak/quiet
// periods and inform scheduling decisions.

export interface HourBucket {
  hour: number;        // 0-23
  eventCount: number;
  sessionCount: number; // unique sessions active in this hour
}

export interface UtilizationReport {
  hourly: HourBucket[];       // 24 buckets
  peakHour: number;           // hour with most activity
  quietHour: number;          // hour with least activity
  totalEvents: number;
  avgEventsPerHour: number;
  activeSessions: Set<string>;
}

/**
 * Track fleet utilization by hour-of-day.
 */
export class FleetUtilizationTracker {
  private events: Array<{ timestamp: number; sessionTitle: string }> = [];
  private windowMs: number;

  constructor(windowMs = 24 * 60 * 60_000) { // 24-hour lookback
    this.windowMs = windowMs;
  }

  /** Record an activity event. */
  recordEvent(sessionTitle: string, now = Date.now()): void {
    this.events.push({ timestamp: now, sessionTitle });
    this.prune(now);
  }

  /** Compute utilization report. */
  getReport(now = Date.now()): UtilizationReport {
    this.prune(now);

    const hourly: HourBucket[] = Array.from({ length: 24 }, (_, h) => ({
      hour: h, eventCount: 0, sessionCount: 0,
    }));
    const sessionsByHour = Array.from({ length: 24 }, () => new Set<string>());
    const activeSessions = new Set<string>();

    for (const e of this.events) {
      const hour = new Date(e.timestamp).getHours();
      hourly[hour].eventCount++;
      sessionsByHour[hour].add(e.sessionTitle);
      activeSessions.add(e.sessionTitle);
    }

    for (let h = 0; h < 24; h++) {
      hourly[h].sessionCount = sessionsByHour[h].size;
    }

    const totalEvents = this.events.length;
    const avgPerHour = totalEvents / 24;
    const peakHour = hourly.reduce((best, b) => b.eventCount > best.eventCount ? b : best).hour;
    const quietHour = hourly.reduce((best, b) => b.eventCount < best.eventCount ? b : best).hour;

    return { hourly, peakHour, quietHour, totalEvents, avgEventsPerHour: avgPerHour, activeSessions };
  }

  /** Render ASCII utilization heatmap. */
  formatHeatmap(now = Date.now()): string[] {
    const report = this.getReport(now);
    if (report.totalEvents === 0) return ["  (no utilization data — waiting for activity)"];

    const max = Math.max(...report.hourly.map((h) => h.eventCount));
    const lines: string[] = [];
    lines.push(`  Fleet utilization (last 24h, ${report.totalEvents} events, ${report.activeSessions.size} sessions):`);
    lines.push(`  Peak: ${report.peakHour}:00  Quiet: ${report.quietHour}:00  Avg: ${report.avgEventsPerHour.toFixed(1)}/hr`);
    lines.push("");

    // ASCII bar chart
    const SPARK = " ▁▂▃▄▅▆▇█";
    const sparkline = report.hourly.map((h) => {
      if (max === 0) return " ";
      const idx = Math.round((h.eventCount / max) * (SPARK.length - 1));
      return SPARK[idx];
    }).join("");
    lines.push(`  ${sparkline}`);
    lines.push(`  ${"0".padStart(2)}${"".padStart(5)}${"6".padStart(1)}${"".padStart(5)}${"12".padStart(1)}${"".padStart(4)}${"18".padStart(2)}${"".padStart(4)}${"23".padStart(2)}`);

    // detailed view for peak hours
    const sorted = [...report.hourly].sort((a, b) => b.eventCount - a.eventCount);
    const topHours = sorted.slice(0, 5).filter((h) => h.eventCount > 0);
    if (topHours.length > 0) {
      lines.push("  Top hours:");
      for (const h of topHours) {
        const bar = "█".repeat(Math.min(20, Math.round((h.eventCount / max) * 20)));
        lines.push(`    ${String(h.hour).padStart(2)}:00 ${bar} ${h.eventCount}ev (${h.sessionCount} sessions)`);
      }
    }

    return lines;
  }

  private prune(now: number): void {
    const cutoff = now - this.windowMs;
    this.events = this.events.filter((e) => e.timestamp >= cutoff);
  }
}
