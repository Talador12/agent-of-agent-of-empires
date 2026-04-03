// fleet-capacity-forecaster.ts — predict when pool slots will be exhausted
// from current task queue depth and historical completion rates.

export interface CapacitySnapshot {
  timestamp: number;
  activeSlots: number;
  maxSlots: number;
  queuedTasks: number;
  completionsPerHour: number;
  arrivalsPerHour: number;
}

export interface CapacityForecast {
  currentUtilization: number;     // 0-100%
  queueDepth: number;
  completionsPerHour: number;
  arrivalsPerHour: number;
  queueGrowthRate: number;        // tasks/hr (positive = growing)
  exhaustionEtaHours: number | null; // null if not growing
  recommendation: "ok" | "scale-up" | "throttle-intake" | "critical";
}

/**
 * Stateful capacity tracker.
 */
export class FleetCapacityForecaster {
  private snapshots: CapacitySnapshot[] = [];
  private maxSnapshots: number;

  constructor(maxSnapshots = 100) {
    this.maxSnapshots = maxSnapshots;
  }

  /** Record a capacity snapshot (call each tick). */
  record(activeSlots: number, maxSlots: number, queuedTasks: number, completionsPerHour: number, arrivalsPerHour: number, now = Date.now()): void {
    this.snapshots.push({ timestamp: now, activeSlots, maxSlots, queuedTasks, completionsPerHour, arrivalsPerHour });
    if (this.snapshots.length > this.maxSnapshots) {
      this.snapshots = this.snapshots.slice(-this.maxSnapshots);
    }
  }

  /** Compute capacity forecast from recent data. */
  forecast(): CapacityForecast {
    if (this.snapshots.length === 0) {
      return { currentUtilization: 0, queueDepth: 0, completionsPerHour: 0, arrivalsPerHour: 0, queueGrowthRate: 0, exhaustionEtaHours: null, recommendation: "ok" };
    }

    const latest = this.snapshots[this.snapshots.length - 1];
    const utilization = latest.maxSlots > 0 ? Math.round((latest.activeSlots / latest.maxSlots) * 100) : 0;

    // average completion and arrival rates over recent snapshots
    const recent = this.snapshots.slice(-10);
    const avgCompletions = recent.reduce((a, b) => a + b.completionsPerHour, 0) / recent.length;
    const avgArrivals = recent.reduce((a, b) => a + b.arrivalsPerHour, 0) / recent.length;
    const growthRate = avgArrivals - avgCompletions;

    // ETA until queue overflows available capacity
    let exhaustionEta: number | null = null;
    if (growthRate > 0 && latest.maxSlots > 0) {
      const remainingCapacity = latest.maxSlots - latest.activeSlots + (latest.queuedTasks > 0 ? 0 : latest.maxSlots);
      exhaustionEta = Math.max(0, remainingCapacity / growthRate);
    }

    // recommendation
    let recommendation: CapacityForecast["recommendation"] = "ok";
    if (utilization >= 95 && latest.queuedTasks > latest.maxSlots) {
      recommendation = "critical";
    } else if (utilization >= 80 || (growthRate > 0 && exhaustionEta !== null && exhaustionEta < 2)) {
      recommendation = "scale-up";
    } else if (growthRate > avgCompletions * 0.5) {
      recommendation = "throttle-intake";
    }

    return {
      currentUtilization: utilization,
      queueDepth: latest.queuedTasks,
      completionsPerHour: Math.round(avgCompletions * 10) / 10,
      arrivalsPerHour: Math.round(avgArrivals * 10) / 10,
      queueGrowthRate: Math.round(growthRate * 10) / 10,
      exhaustionEtaHours: exhaustionEta !== null ? Math.round(exhaustionEta * 10) / 10 : null,
      recommendation,
    };
  }

  /** Get snapshot count. */
  snapshotCount(): number {
    return this.snapshots.length;
  }
}

/**
 * Format capacity forecast for TUI display.
 */
export function formatCapacityForecast(forecaster: FleetCapacityForecaster): string[] {
  const f = forecaster.forecast();
  const lines: string[] = [];
  const icon = f.recommendation === "critical" ? "🔴" : f.recommendation === "scale-up" ? "🟡" : f.recommendation === "throttle-intake" ? "🟠" : "🟢";
  lines.push(`  Fleet Capacity Forecast ${icon} [${f.recommendation}]:`);
  lines.push(`    Utilization: ${f.currentUtilization}% | Queue: ${f.queueDepth} tasks`);
  lines.push(`    Completions: ${f.completionsPerHour}/hr | Arrivals: ${f.arrivalsPerHour}/hr | Growth: ${f.queueGrowthRate >= 0 ? "+" : ""}${f.queueGrowthRate}/hr`);
  if (f.exhaustionEtaHours !== null) {
    lines.push(`    Exhaustion ETA: ${f.exhaustionEtaHours}h`);
  }
  return lines;
}
