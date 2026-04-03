// daemon-watchdog.ts — self-recovery if main loop stalls beyond a
// configurable threshold. tracks tick timestamps and detects stalls.
// can trigger recovery actions: log warning, restart loop, or exit.

export type WatchdogAction = "warn" | "restart" | "exit";

export interface WatchdogState {
  lastTickAt: number;
  tickCount: number;
  stallCount: number;
  lastStallAt: number | null;
  thresholdMs: number;
  action: WatchdogAction;
  enabled: boolean;
}

export interface WatchdogCheck {
  stalled: boolean;
  stalledMs: number;
  recommendation: WatchdogAction | "ok";
  message: string;
}

/**
 * Create watchdog state.
 */
export function createWatchdog(thresholdMs = 120_000, action: WatchdogAction = "warn"): WatchdogState {
  return {
    lastTickAt: Date.now(),
    tickCount: 0,
    stallCount: 0,
    lastStallAt: null,
    thresholdMs,
    action,
    enabled: true,
  };
}

/**
 * Record a successful tick (heartbeat). Call at the end of each daemon tick.
 */
export function tickWatchdog(state: WatchdogState, now = Date.now()): void {
  state.lastTickAt = now;
  state.tickCount++;
}

/**
 * Check if the daemon is stalled.
 */
export function checkWatchdog(state: WatchdogState, now = Date.now()): WatchdogCheck {
  if (!state.enabled) return { stalled: false, stalledMs: 0, recommendation: "ok", message: "watchdog disabled" };

  const elapsed = now - state.lastTickAt;
  if (elapsed < state.thresholdMs) {
    return { stalled: false, stalledMs: 0, recommendation: "ok", message: `last tick ${Math.round(elapsed / 1000)}s ago` };
  }

  state.stallCount++;
  state.lastStallAt = now;

  const stalledMs = elapsed;
  const mins = Math.round(stalledMs / 60_000);

  // escalate based on how long stalled
  let recommendation: WatchdogAction = state.action;
  if (stalledMs > state.thresholdMs * 3) {
    recommendation = "exit"; // triple threshold = force exit
  } else if (stalledMs > state.thresholdMs * 2) {
    recommendation = "restart"; // double threshold = restart
  }

  return {
    stalled: true,
    stalledMs,
    recommendation,
    message: `daemon stalled for ${mins}m (threshold: ${Math.round(state.thresholdMs / 60_000)}m, stall #${state.stallCount})`,
  };
}

/**
 * Enable or disable the watchdog.
 */
export function setWatchdogEnabled(state: WatchdogState, enabled: boolean): void {
  state.enabled = enabled;
}

/**
 * Update watchdog threshold.
 */
export function setWatchdogThreshold(state: WatchdogState, thresholdMs: number): void {
  state.thresholdMs = Math.max(10_000, thresholdMs); // min 10s
}

/**
 * Format watchdog state for TUI display.
 */
export function formatWatchdog(state: WatchdogState, now = Date.now()): string[] {
  const check = checkWatchdog(state, now);
  const lines: string[] = [];
  const status = !state.enabled ? "DISABLED" : check.stalled ? "STALLED" : "OK";
  const icon = check.stalled ? "🔴" : state.enabled ? "🟢" : "⭘";
  lines.push(`  Watchdog ${icon} [${status}]: ${check.message}`);
  lines.push(`    Ticks: ${state.tickCount} | Stalls: ${state.stallCount} | Threshold: ${Math.round(state.thresholdMs / 1000)}s | Action: ${state.action}`);
  if (state.lastStallAt) {
    const ago = Math.round((now - state.lastStallAt) / 60_000);
    lines.push(`    Last stall: ${ago}m ago`);
  }
  return lines;
}
