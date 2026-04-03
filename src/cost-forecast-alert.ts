// cost-forecast-alert.ts — proactive alerts when projected costs exceed
// configurable thresholds. uses burn rate data to project future costs
// at daily/weekly/monthly intervals and fires alerts before overspend.

export interface CostProjection {
  sessionTitle: string;
  currentCostUsd: number;
  burnRatePerHr: number;
  projectedDailyCostUsd: number;
  projectedWeeklyCostUsd: number;
  projectedMonthlyCostUsd: number;
}

export interface CostForecastAlert {
  sessionTitle: string;
  alertType: "daily-exceed" | "weekly-exceed" | "monthly-exceed" | "budget-breach-eta";
  severity: "warning" | "critical";
  message: string;
  projectedCostUsd: number;
  thresholdUsd: number;
  etaHours?: number; // hours until threshold breach
}

export interface CostThresholds {
  dailyLimitUsd: number;
  weeklyLimitUsd: number;
  monthlyLimitUsd: number;
}

const DEFAULT_THRESHOLDS: CostThresholds = {
  dailyLimitUsd: 25,
  weeklyLimitUsd: 100,
  monthlyLimitUsd: 300,
};

/**
 * Project costs for a session from current spend + burn rate.
 */
export function projectCosts(sessionTitle: string, currentCostUsd: number, burnRatePerHr: number): CostProjection {
  return {
    sessionTitle,
    currentCostUsd,
    burnRatePerHr: Math.max(0, burnRatePerHr),
    projectedDailyCostUsd: currentCostUsd + burnRatePerHr * 24,
    projectedWeeklyCostUsd: currentCostUsd + burnRatePerHr * 24 * 7,
    projectedMonthlyCostUsd: currentCostUsd + burnRatePerHr * 24 * 30,
  };
}

/**
 * Evaluate cost projections against thresholds and generate alerts.
 */
export function evaluateCostAlerts(
  projections: CostProjection[],
  thresholds: Partial<CostThresholds> = {},
): CostForecastAlert[] {
  const t = { ...DEFAULT_THRESHOLDS, ...thresholds };
  const alerts: CostForecastAlert[] = [];

  for (const p of projections) {
    // daily threshold
    if (p.projectedDailyCostUsd > t.dailyLimitUsd) {
      const overBy = p.projectedDailyCostUsd - t.dailyLimitUsd;
      const hoursUntil = p.burnRatePerHr > 0
        ? Math.max(0, (t.dailyLimitUsd - p.currentCostUsd) / p.burnRatePerHr)
        : -1;
      alerts.push({
        sessionTitle: p.sessionTitle,
        alertType: "daily-exceed",
        severity: hoursUntil >= 0 && hoursUntil < 2 ? "critical" : "warning",
        message: `Projected daily cost $${p.projectedDailyCostUsd.toFixed(2)} exceeds $${t.dailyLimitUsd} limit (+$${overBy.toFixed(2)})`,
        projectedCostUsd: p.projectedDailyCostUsd,
        thresholdUsd: t.dailyLimitUsd,
        etaHours: hoursUntil >= 0 ? Math.round(hoursUntil * 10) / 10 : undefined,
      });
    }

    // weekly threshold
    if (p.projectedWeeklyCostUsd > t.weeklyLimitUsd) {
      alerts.push({
        sessionTitle: p.sessionTitle,
        alertType: "weekly-exceed",
        severity: p.projectedWeeklyCostUsd > t.weeklyLimitUsd * 1.5 ? "critical" : "warning",
        message: `Projected weekly cost $${p.projectedWeeklyCostUsd.toFixed(2)} exceeds $${t.weeklyLimitUsd} limit`,
        projectedCostUsd: p.projectedWeeklyCostUsd,
        thresholdUsd: t.weeklyLimitUsd,
      });
    }

    // monthly threshold
    if (p.projectedMonthlyCostUsd > t.monthlyLimitUsd) {
      alerts.push({
        sessionTitle: p.sessionTitle,
        alertType: "monthly-exceed",
        severity: "warning",
        message: `Projected monthly cost $${p.projectedMonthlyCostUsd.toFixed(2)} exceeds $${t.monthlyLimitUsd} limit`,
        projectedCostUsd: p.projectedMonthlyCostUsd,
        thresholdUsd: t.monthlyLimitUsd,
      });
    }
  }

  return alerts.sort((a, b) => {
    const sev = { critical: 0, warning: 1 };
    return sev[a.severity] - sev[b.severity];
  });
}

/**
 * Format cost forecast alerts for TUI display.
 */
export function formatCostForecastAlerts(alerts: CostForecastAlert[]): string[] {
  if (alerts.length === 0) return ["  Cost forecast: all sessions within limits"];
  const lines: string[] = [];
  lines.push(`  Cost Forecast Alerts (${alerts.length}):`);
  for (const a of alerts) {
    const icon = a.severity === "critical" ? "🔴" : "🟡";
    const eta = a.etaHours !== undefined ? ` (breach in ~${a.etaHours}h)` : "";
    lines.push(`  ${icon} ${a.sessionTitle} [${a.alertType}]${eta}`);
    lines.push(`    ${a.message}`);
  }
  return lines;
}

/**
 * Format cost projections for TUI display.
 */
export function formatCostProjections(projections: CostProjection[]): string[] {
  if (projections.length === 0) return ["  Cost projections: no session data"];
  const lines: string[] = [];
  lines.push(`  Cost Projections (${projections.length} sessions):`);
  lines.push(`  ${"Session".padEnd(18)} ${"Now".padStart(8)} ${"$/hr".padStart(7)} ${"Daily".padStart(8)} ${"Weekly".padStart(9)} ${"Monthly".padStart(10)}`);
  for (const p of projections) {
    lines.push(`  ${p.sessionTitle.slice(0, 18).padEnd(18)} ${"$" + p.currentCostUsd.toFixed(2).padStart(7)} ${"$" + p.burnRatePerHr.toFixed(2).padStart(6)} ${"$" + p.projectedDailyCostUsd.toFixed(2).padStart(7)} ${"$" + p.projectedWeeklyCostUsd.toFixed(2).padStart(8)} ${"$" + p.projectedMonthlyCostUsd.toFixed(2).padStart(9)}`);
  }
  return lines;
}
