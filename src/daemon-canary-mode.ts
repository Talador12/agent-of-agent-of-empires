// daemon-canary-mode.ts — run new config/rules on a single canary session
// before fleet-wide rollout. tracks canary health, compares metrics against
// the fleet baseline, and recommends promote or rollback.

export type CanaryStatus = "active" | "healthy" | "degraded" | "rolled-back" | "promoted";

export interface CanaryConfig {
  sessionTitle: string;
  overrides: Record<string, unknown>; // config overrides for the canary
  startedAt: number;
  durationMs: number; // how long to run before auto-promote decision
}

export interface CanaryState {
  canary: CanaryConfig | null;
  status: CanaryStatus;
  healthSamples: number[];    // health scores during canary period
  baselineHealth: number;     // fleet avg health when canary started
  baselineCostRate: number;   // fleet avg $/hr when canary started
  canaryCostRate: number;     // canary session $/hr
}

/**
 * Create a fresh canary state (no active canary).
 */
export function createCanaryState(): CanaryState {
  return {
    canary: null,
    status: "rolled-back",
    healthSamples: [],
    baselineHealth: 0,
    baselineCostRate: 0,
    canaryCostRate: 0,
  };
}

/**
 * Start a canary run on a specific session.
 */
export function startCanary(
  state: CanaryState,
  sessionTitle: string,
  overrides: Record<string, unknown>,
  baselineHealth: number,
  baselineCostRate: number,
  durationMs = 600_000, // 10 min default
  now = Date.now(),
): void {
  state.canary = { sessionTitle, overrides, startedAt: now, durationMs };
  state.status = "active";
  state.healthSamples = [];
  state.baselineHealth = baselineHealth;
  state.baselineCostRate = baselineCostRate;
  state.canaryCostRate = 0;
}

/**
 * Record a health sample for the canary session.
 */
export function recordCanaryHealth(state: CanaryState, health: number, costRate: number): void {
  if (!state.canary || state.status !== "active") return;
  state.healthSamples.push(Math.max(0, Math.min(100, health)));
  state.canaryCostRate = costRate;
}

/**
 * Evaluate the canary: compare against baseline and decide promote/rollback.
 */
export function evaluateCanary(state: CanaryState, now = Date.now()): {
  recommendation: "promote" | "rollback" | "continue";
  reason: string;
  canaryAvgHealth: number;
  baselineHealth: number;
} {
  if (!state.canary || state.status !== "active") {
    return { recommendation: "continue", reason: "no active canary", canaryAvgHealth: 0, baselineHealth: 0 };
  }

  const elapsed = now - state.canary.startedAt;
  const samples = state.healthSamples;
  const canaryAvg = samples.length > 0 ? Math.round(samples.reduce((a, b) => a + b, 0) / samples.length) : 0;

  // not enough data yet
  if (samples.length < 3) {
    return { recommendation: "continue", reason: "insufficient data (need 3+ samples)", canaryAvgHealth: canaryAvg, baselineHealth: state.baselineHealth };
  }

  // health degraded significantly
  if (canaryAvg < state.baselineHealth - 20) {
    state.status = "degraded";
    return { recommendation: "rollback", reason: `canary health ${canaryAvg}% is ${state.baselineHealth - canaryAvg}% below baseline`, canaryAvgHealth: canaryAvg, baselineHealth: state.baselineHealth };
  }

  // cost too high
  if (state.canaryCostRate > state.baselineCostRate * 2 && state.baselineCostRate > 0) {
    state.status = "degraded";
    return { recommendation: "rollback", reason: `canary cost $${state.canaryCostRate.toFixed(2)}/hr is >2x baseline $${state.baselineCostRate.toFixed(2)}/hr`, canaryAvgHealth: canaryAvg, baselineHealth: state.baselineHealth };
  }

  // duration complete and healthy
  if (elapsed >= state.canary.durationMs) {
    state.status = "healthy";
    return { recommendation: "promote", reason: `canary healthy for ${Math.round(elapsed / 60_000)}m (avg health ${canaryAvg}%)`, canaryAvgHealth: canaryAvg, baselineHealth: state.baselineHealth };
  }

  return { recommendation: "continue", reason: `${Math.round((state.canary.durationMs - elapsed) / 60_000)}m remaining`, canaryAvgHealth: canaryAvg, baselineHealth: state.baselineHealth };
}

/**
 * Promote the canary (apply overrides fleet-wide).
 */
export function promoteCanary(state: CanaryState): Record<string, unknown> | null {
  if (!state.canary) return null;
  const overrides = { ...state.canary.overrides };
  state.status = "promoted";
  return overrides;
}

/**
 * Rollback the canary (revert to baseline).
 */
export function rollbackCanary(state: CanaryState): void {
  state.status = "rolled-back";
  state.canary = null;
  state.healthSamples = [];
}

/**
 * Format canary state for TUI display.
 */
export function formatCanaryState(state: CanaryState): string[] {
  const lines: string[] = [];
  if (!state.canary) {
    lines.push("  Canary Mode: inactive (no canary running)");
    return lines;
  }

  const eval_ = evaluateCanary(state);
  const elapsed = Math.round((Date.now() - state.canary.startedAt) / 60_000);
  lines.push(`  Canary Mode: ${state.status} [${state.canary.sessionTitle}] (${elapsed}m elapsed)`);
  lines.push(`    Health: canary ${eval_.canaryAvgHealth}% vs baseline ${eval_.baselineHealth}%`);
  lines.push(`    Cost: canary $${state.canaryCostRate.toFixed(2)}/hr vs baseline $${state.baselineCostRate.toFixed(2)}/hr`);
  lines.push(`    Recommendation: ${eval_.recommendation} — ${eval_.reason}`);

  const overrideKeys = Object.keys(state.canary.overrides);
  if (overrideKeys.length > 0) {
    lines.push(`    Overrides: ${overrideKeys.join(", ")}`);
  }

  return lines;
}
