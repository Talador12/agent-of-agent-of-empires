// budget-predictor.ts — estimate when a session will exceed its cost budget
// based on observed cost burn rate. tracks cost samples over time to compute
// a linear regression slope, then projects time-to-budget.

import { parseCostUsd, getEffectiveBudget } from "./cost-budget.js";
import type { CostBudgetConfig } from "./cost-budget.js";

export interface CostSample {
  timestamp: number;
  costUsd: number;
}

export interface BudgetPrediction {
  sessionTitle: string;
  currentCostUsd: number;
  budgetUsd: number;
  burnRateUsdPerHour: number; // $/hr based on recent samples
  estimatedExhaustionMs: number; // ms from now until budget exceeded (-1 = never/stable)
  estimatedExhaustionLabel: string; // human-readable label ("2h 15m", "never")
  warningLevel: "ok" | "approaching" | "imminent" | "exceeded";
}

/**
 * Track cost samples per session and predict budget exhaustion.
 */
export class BudgetPredictor {
  private samples = new Map<string, CostSample[]>();
  private windowMs: number;

  constructor(windowMs = 60 * 60 * 1000) { // 1 hour lookback for burn rate
    this.windowMs = windowMs;
  }

  /** Record a cost observation for a session. */
  recordCost(sessionTitle: string, costStr: string | undefined, now = Date.now()): void {
    const cost = parseCostUsd(costStr);
    if (cost === null) return;
    if (!this.samples.has(sessionTitle)) this.samples.set(sessionTitle, []);
    const samples = this.samples.get(sessionTitle)!;
    // deduplicate: don't record if cost hasn't changed
    if (samples.length > 0 && samples[samples.length - 1].costUsd === cost) return;
    samples.push({ timestamp: now, costUsd: cost });
    this.prune(sessionTitle, now);
  }

  /** Predict when a session will exhaust its budget. */
  predict(sessionTitle: string, config: CostBudgetConfig, now = Date.now()): BudgetPrediction | null {
    const budget = getEffectiveBudget(sessionTitle, config);
    if (budget === null) return null;

    const samples = this.samples.get(sessionTitle);
    if (!samples || samples.length < 2) return null;

    const currentCost = samples[samples.length - 1].costUsd;

    // compute burn rate via linear regression on recent samples
    const burnRate = this.computeBurnRate(samples, now);

    if (burnRate <= 0) {
      return {
        sessionTitle,
        currentCostUsd: currentCost,
        budgetUsd: budget,
        burnRateUsdPerHour: 0,
        estimatedExhaustionMs: -1,
        estimatedExhaustionLabel: "stable",
        warningLevel: currentCost >= budget ? "exceeded" : "ok",
      };
    }

    const remaining = budget - currentCost;
    if (remaining <= 0) {
      return {
        sessionTitle,
        currentCostUsd: currentCost,
        budgetUsd: budget,
        burnRateUsdPerHour: burnRate * 3_600_000, // per ms -> per hr
        estimatedExhaustionMs: 0,
        estimatedExhaustionLabel: "exceeded",
        warningLevel: "exceeded",
      };
    }

    const msToExhaustion = remaining / burnRate; // burnRate is $/ms
    const hoursToExhaustion = msToExhaustion / 3_600_000;
    const burnRatePerHour = burnRate * 3_600_000;

    const warningLevel: BudgetPrediction["warningLevel"] =
      hoursToExhaustion <= 0.5 ? "imminent" :
      hoursToExhaustion <= 2 ? "approaching" :
      "ok";

    return {
      sessionTitle,
      currentCostUsd: currentCost,
      budgetUsd: budget,
      burnRateUsdPerHour: burnRatePerHour,
      estimatedExhaustionMs: msToExhaustion,
      estimatedExhaustionLabel: formatDuration(msToExhaustion),
      warningLevel,
    };
  }

  /** Get predictions for all tracked sessions. */
  predictAll(config: CostBudgetConfig, now = Date.now()): BudgetPrediction[] {
    const results: BudgetPrediction[] = [];
    for (const title of this.samples.keys()) {
      const p = this.predict(title, config, now);
      if (p) results.push(p);
    }
    return results;
  }

  /** Format a prediction for TUI display. */
  static format(p: BudgetPrediction): string {
    const icon = p.warningLevel === "exceeded" ? "🔴"
      : p.warningLevel === "imminent" ? "🟡"
      : p.warningLevel === "approaching" ? "🟠"
      : "🟢";
    const rate = p.burnRateUsdPerHour > 0 ? `$${p.burnRateUsdPerHour.toFixed(2)}/hr` : "stable";
    const eta = p.estimatedExhaustionLabel;
    return `  ${icon} ${p.sessionTitle}: $${p.currentCostUsd.toFixed(2)}/$${p.budgetUsd.toFixed(2)} (${rate}, ${eta})`;
  }

  /** Get sample count for a session (for testing). */
  getSampleCount(sessionTitle: string): number {
    return this.samples.get(sessionTitle)?.length ?? 0;
  }

  private computeBurnRate(samples: CostSample[], now: number): number {
    // use last N samples within the window for linear regression
    const cutoff = now - this.windowMs;
    const recent = samples.filter((s) => s.timestamp >= cutoff);
    if (recent.length < 2) return 0;

    // simple: (last cost - first cost) / (last time - first time) = $/ms
    const first = recent[0];
    const last = recent[recent.length - 1];
    const dt = last.timestamp - first.timestamp;
    if (dt <= 0) return 0;
    const dcost = last.costUsd - first.costUsd;
    if (dcost <= 0) return 0;
    return dcost / dt; // $/ms
  }

  private prune(sessionTitle: string, now: number): void {
    const cutoff = now - this.windowMs * 2; // keep 2x window for smoothing
    const samples = this.samples.get(sessionTitle);
    if (samples) {
      const pruned = samples.filter((s) => s.timestamp >= cutoff);
      if (pruned.length === 0) this.samples.delete(sessionTitle);
      else this.samples.set(sessionTitle, pruned);
    }
  }
}

function formatDuration(ms: number): string {
  if (ms <= 0) return "exceeded";
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  const hours = Math.floor(ms / 3_600_000);
  const mins = Math.round((ms % 3_600_000) / 60_000);
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}
