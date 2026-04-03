// cost-anomaly-throttle.ts — auto-reduce poll rate for cost-anomalous sessions.
// monitors per-session cost burn rates and triggers throttling when a session's
// cost rate exceeds a configurable multiple of the fleet average.

export interface ThrottleState {
  burnRates: Map<string, number>;   // session -> $/hr burn rate
  throttled: Map<string, number>;   // session -> throttled poll interval multiplier
  fleetAvgRate: number;             // fleet average $/hr
  lastUpdate: number;
}

export interface ThrottleResult {
  sessionTitle: string;
  burnRate: number;         // $/hr
  fleetAvgRate: number;     // $/hr
  multiplier: number;       // how many X above fleet average
  action: "throttle" | "unthrottle" | "none";
  pollMultiplier: number;   // 1.0 = normal, 2.0 = half speed, etc.
}

/**
 * Create a fresh throttle state.
 */
export function createThrottleState(): ThrottleState {
  return {
    burnRates: new Map(),
    throttled: new Map(),
    fleetAvgRate: 0,
    lastUpdate: 0,
  };
}

/**
 * Update burn rate for a session. Call each tick with latest cost delta.
 */
export function updateBurnRate(state: ThrottleState, sessionTitle: string, costDeltaUsd: number, elapsedMs: number): void {
  if (elapsedMs <= 0) return;
  const rate = (costDeltaUsd / elapsedMs) * 3_600_000; // convert to $/hr
  // exponential moving average with alpha=0.3 for smoothing
  const prev = state.burnRates.get(sessionTitle) ?? rate;
  const smoothed = prev * 0.7 + rate * 0.3;
  state.burnRates.set(sessionTitle, Math.max(0, smoothed));
  // recompute fleet average
  const rates = Array.from(state.burnRates.values());
  state.fleetAvgRate = rates.length > 0 ? rates.reduce((a, b) => a + b, 0) / rates.length : 0;
  state.lastUpdate = Date.now();
}

/**
 * Evaluate all sessions and compute throttle recommendations.
 * Sessions burning > threshold * fleet average get throttled.
 */
export function evaluateThrottles(
  state: ThrottleState,
  activeSessions: string[],
  threshold = 3.0, // 3x fleet average triggers throttle
): ThrottleResult[] {
  const results: ThrottleResult[] = [];

  for (const title of activeSessions) {
    const burnRate = state.burnRates.get(title) ?? 0;
    const multiplier = state.fleetAvgRate > 0.001 ? burnRate / state.fleetAvgRate : 0;

    if (multiplier > threshold) {
      // throttle: poll multiplier scales with how far above threshold
      const pollMult = Math.min(4.0, 1.0 + (multiplier - threshold) * 0.5);
      state.throttled.set(title, pollMult);
      results.push({ sessionTitle: title, burnRate, fleetAvgRate: state.fleetAvgRate, multiplier, action: "throttle", pollMultiplier: pollMult });
    } else if (state.throttled.has(title) && multiplier < threshold * 0.7) {
      // unthrottle once burn rate drops below 70% of threshold
      state.throttled.delete(title);
      results.push({ sessionTitle: title, burnRate, fleetAvgRate: state.fleetAvgRate, multiplier, action: "unthrottle", pollMultiplier: 1.0 });
    } else {
      const pollMult = state.throttled.get(title) ?? 1.0;
      results.push({ sessionTitle: title, burnRate, fleetAvgRate: state.fleetAvgRate, multiplier, action: "none", pollMultiplier: pollMult });
    }
  }

  return results.sort((a, b) => b.multiplier - a.multiplier);
}

/**
 * Get the effective poll multiplier for a session (1.0 = normal).
 */
export function getPollMultiplier(state: ThrottleState, sessionTitle: string): number {
  return state.throttled.get(sessionTitle) ?? 1.0;
}

/**
 * Format throttle state for TUI display.
 */
export function formatThrottleState(results: ThrottleResult[]): string[] {
  if (results.length === 0) return ["  Cost throttle: no sessions tracked"];
  const throttled = results.filter((r) => r.action === "throttle" || r.pollMultiplier > 1.0);
  const lines: string[] = [];
  lines.push(`  Cost Anomaly Throttle (fleet avg: $${results[0]?.fleetAvgRate?.toFixed(2) ?? "0.00"}/hr):`);
  if (throttled.length === 0) {
    lines.push("  All sessions within normal cost range");
  } else {
    for (const r of throttled) {
      lines.push(`  ⚠ ${r.sessionTitle}: $${r.burnRate.toFixed(2)}/hr (${r.multiplier.toFixed(1)}x avg) → poll ${r.pollMultiplier.toFixed(1)}x slower`);
    }
  }
  // show top 3 by burn rate for context
  const top = results.slice(0, 3);
  lines.push("  Top burn rates:");
  for (const r of top) {
    const tag = r.pollMultiplier > 1.0 ? " [THROTTLED]" : "";
    lines.push(`    ${r.sessionTitle}: $${r.burnRate.toFixed(2)}/hr (${r.multiplier.toFixed(1)}x avg)${tag}`);
  }
  return lines;
}
