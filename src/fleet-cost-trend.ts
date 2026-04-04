// fleet-cost-trend.ts — week-over-week cost trend with projection.
// records daily cost snapshots, computes rolling averages, detects
// trend direction, and projects future spend.

export interface DailyCostSnapshot {
  date: string; // YYYY-MM-DD
  totalCostUsd: number;
}

export interface CostTrend {
  currentWeekAvg: number;
  previousWeekAvg: number;
  changePercent: number;
  direction: "increasing" | "decreasing" | "stable";
  projectedWeeklyCost: number;
  projectedMonthlyCost: number;
  dataPoints: number;
}

/**
 * Stateful cost trend tracker.
 */
export class FleetCostTrend {
  private snapshots: DailyCostSnapshot[] = [];
  private maxDays: number;

  constructor(maxDays = 60) { this.maxDays = maxDays; }

  /** Record a daily cost snapshot. */
  recordDay(date: string, totalCostUsd: number): void {
    // replace if same date exists
    const idx = this.snapshots.findIndex((s) => s.date === date);
    if (idx >= 0) this.snapshots[idx].totalCostUsd = totalCostUsd;
    else this.snapshots.push({ date, totalCostUsd });
    if (this.snapshots.length > this.maxDays) this.snapshots = this.snapshots.slice(-this.maxDays);
    this.snapshots.sort((a, b) => a.date.localeCompare(b.date));
  }

  /** Compute the cost trend. */
  computeTrend(): CostTrend {
    if (this.snapshots.length < 2) {
      return { currentWeekAvg: 0, previousWeekAvg: 0, changePercent: 0, direction: "stable", projectedWeeklyCost: 0, projectedMonthlyCost: 0, dataPoints: this.snapshots.length };
    }

    const recent7 = this.snapshots.slice(-7);
    const prev7 = this.snapshots.slice(-14, -7);

    const currentAvg = recent7.reduce((a, s) => a + s.totalCostUsd, 0) / recent7.length;
    const prevAvg = prev7.length > 0 ? prev7.reduce((a, s) => a + s.totalCostUsd, 0) / prev7.length : currentAvg;

    const change = prevAvg > 0 ? Math.round(((currentAvg - prevAvg) / prevAvg) * 100) : 0;
    const direction: CostTrend["direction"] = change > 5 ? "increasing" : change < -5 ? "decreasing" : "stable";

    return {
      currentWeekAvg: Math.round(currentAvg * 100) / 100,
      previousWeekAvg: Math.round(prevAvg * 100) / 100,
      changePercent: change,
      direction,
      projectedWeeklyCost: Math.round(currentAvg * 7 * 100) / 100,
      projectedMonthlyCost: Math.round(currentAvg * 30 * 100) / 100,
      dataPoints: this.snapshots.length,
    };
  }

  /** Get sparkline of daily costs. */
  sparkline(): string {
    const costs = this.snapshots.map((s) => s.totalCostUsd);
    if (costs.length === 0) return "";
    const max = Math.max(...costs, 1);
    const chars = "▁▂▃▄▅▆▇█";
    return costs.slice(-14).map((c) => chars[Math.min(7, Math.round((c / max) * 7))]).join("");
  }

  /** Get snapshot count. */
  dayCount(): number { return this.snapshots.length; }
}

/**
 * Format cost trend for TUI display.
 */
export function formatCostTrend(tracker: FleetCostTrend): string[] {
  const trend = tracker.computeTrend();
  const spark = tracker.sparkline();
  const icon = trend.direction === "increasing" ? "↑" : trend.direction === "decreasing" ? "↓" : "→";
  const lines: string[] = [];
  lines.push(`  Cost Trend ${icon} [${trend.direction}] (${trend.dataPoints} days):`);
  lines.push(`    This week avg: $${trend.currentWeekAvg}/day | Last week: $${trend.previousWeekAvg}/day | Change: ${trend.changePercent >= 0 ? "+" : ""}${trend.changePercent}%`);
  lines.push(`    Projected: $${trend.projectedWeeklyCost}/week, $${trend.projectedMonthlyCost}/month`);
  if (spark) lines.push(`    Trend: ${spark}`);
  return lines;
}
