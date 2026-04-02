// fleet-forecast.ts — aggregate all session budget predictions into a total
// fleet spend forecast. shows total burn rate, projected daily/weekly cost,
// and time until fleet-wide budget exhaustion.

import type { BudgetPrediction } from "./budget-predictor.js";

export interface FleetForecast {
  sessionCount: number;
  totalCurrentCostUsd: number;
  totalBudgetUsd: number;
  totalBurnRateUsdPerHour: number;
  projectedDailyCostUsd: number;
  projectedWeeklyCostUsd: number;
  earliestExhaustion: { session: string; label: string; ms: number } | null;
  overBudgetSessions: string[];
  imminentSessions: string[];
}

/**
 * Aggregate individual session predictions into a fleet-wide forecast.
 */
export function computeFleetForecast(predictions: BudgetPrediction[]): FleetForecast {
  let totalCost = 0;
  let totalBudget = 0;
  let totalBurnRate = 0;
  let earliest: { session: string; label: string; ms: number } | null = null;
  const overBudget: string[] = [];
  const imminent: string[] = [];

  for (const p of predictions) {
    totalCost += p.currentCostUsd;
    totalBudget += p.budgetUsd;
    totalBurnRate += p.burnRateUsdPerHour;

    if (p.warningLevel === "exceeded") {
      overBudget.push(p.sessionTitle);
    }
    if (p.warningLevel === "imminent") {
      imminent.push(p.sessionTitle);
    }

    if (p.estimatedExhaustionMs > 0) {
      if (!earliest || p.estimatedExhaustionMs < earliest.ms) {
        earliest = {
          session: p.sessionTitle,
          label: p.estimatedExhaustionLabel,
          ms: p.estimatedExhaustionMs,
        };
      }
    }
  }

  return {
    sessionCount: predictions.length,
    totalCurrentCostUsd: totalCost,
    totalBudgetUsd: totalBudget,
    totalBurnRateUsdPerHour: totalBurnRate,
    projectedDailyCostUsd: totalBurnRate * 24,
    projectedWeeklyCostUsd: totalBurnRate * 24 * 7,
    earliestExhaustion: earliest,
    overBudgetSessions: overBudget,
    imminentSessions: imminent,
  };
}

/**
 * Format fleet forecast for TUI display.
 */
export function formatFleetForecast(forecast: FleetForecast): string[] {
  const lines: string[] = [];
  lines.push(`  Fleet cost forecast (${forecast.sessionCount} sessions):`);
  lines.push(`  Current:  $${forecast.totalCurrentCostUsd.toFixed(2)} / $${forecast.totalBudgetUsd.toFixed(2)} total budget`);
  lines.push(`  Burn:     $${forecast.totalBurnRateUsdPerHour.toFixed(2)}/hr → $${forecast.projectedDailyCostUsd.toFixed(2)}/day → $${forecast.projectedWeeklyCostUsd.toFixed(2)}/week`);

  if (forecast.earliestExhaustion) {
    lines.push(`  Next hit:  "${forecast.earliestExhaustion.session}" in ${forecast.earliestExhaustion.label}`);
  }
  if (forecast.overBudgetSessions.length > 0) {
    lines.push(`  🔴 Over budget: ${forecast.overBudgetSessions.join(", ")}`);
  }
  if (forecast.imminentSessions.length > 0) {
    lines.push(`  🟡 Imminent: ${forecast.imminentSessions.join(", ")}`);
  }
  if (forecast.overBudgetSessions.length === 0 && forecast.imminentSessions.length === 0) {
    lines.push(`  ✅ All sessions within budget`);
  }

  return lines;
}
