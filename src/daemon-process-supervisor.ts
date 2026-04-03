// daemon-process-supervisor.ts — track process health and manage restart
// state for fork-exec recovery. records crash history, enforces max
// restart attempts with backoff, and tracks uptime streaks.

export interface RestartRecord {
  timestamp: number;
  reason: string;
  exitCode?: number;
}

export interface SupervisorState {
  restarts: RestartRecord[];
  maxRestarts: number;
  backoffBaseMs: number;
  backoffMaxMs: number;
  currentUptimeStartMs: number;
  longestUptimeMs: number;
  enabled: boolean;
}

export interface RestartDecision {
  shouldRestart: boolean;
  delayMs: number;
  reason: string;
  restartCount: number;
  inCooldown: boolean;
}

/**
 * Create supervisor state.
 */
export function createSupervisor(maxRestarts = 5, backoffBaseMs = 5000, backoffMaxMs = 300_000): SupervisorState {
  return {
    restarts: [],
    maxRestarts,
    backoffBaseMs,
    backoffMaxMs,
    currentUptimeStartMs: Date.now(),
    longestUptimeMs: 0,
    enabled: true,
  };
}

/**
 * Record a crash and decide whether to restart.
 */
export function recordCrash(state: SupervisorState, reason: string, exitCode?: number, now = Date.now()): RestartDecision {
  // update uptime tracking
  const uptimeMs = now - state.currentUptimeStartMs;
  if (uptimeMs > state.longestUptimeMs) state.longestUptimeMs = uptimeMs;

  state.restarts.push({ timestamp: now, reason, exitCode });

  if (!state.enabled) {
    return { shouldRestart: false, delayMs: 0, reason: "supervisor disabled", restartCount: state.restarts.length, inCooldown: false };
  }

  // count recent restarts (within last 10 minutes)
  const recentWindow = 600_000;
  const recentRestarts = state.restarts.filter((r) => now - r.timestamp < recentWindow);

  if (recentRestarts.length > state.maxRestarts) {
    return {
      shouldRestart: false,
      delayMs: 0,
      reason: `max restarts (${state.maxRestarts}) exceeded in 10m window`,
      restartCount: state.restarts.length,
      inCooldown: true,
    };
  }

  // exponential backoff: base * 2^(recent-1), capped at max
  const delay = Math.min(state.backoffMaxMs, state.backoffBaseMs * Math.pow(2, recentRestarts.length - 1));

  state.currentUptimeStartMs = now + delay;

  return {
    shouldRestart: true,
    delayMs: delay,
    reason: `restart #${recentRestarts.length} (delay ${Math.round(delay / 1000)}s)`,
    restartCount: state.restarts.length,
    inCooldown: false,
  };
}

/**
 * Get current uptime.
 */
export function currentUptime(state: SupervisorState, now = Date.now()): number {
  return Math.max(0, now - state.currentUptimeStartMs);
}

/**
 * Reset restart history (e.g. after stable operation).
 */
export function resetHistory(state: SupervisorState): void {
  state.restarts = [];
}

/**
 * Get supervisor stats.
 */
export function supervisorStats(state: SupervisorState, now = Date.now()): {
  totalRestarts: number; recentRestarts: number; longestUptimeMs: number;
  currentUptimeMs: number; enabled: boolean;
} {
  const recentRestarts = state.restarts.filter((r) => now - r.timestamp < 600_000).length;
  return {
    totalRestarts: state.restarts.length,
    recentRestarts,
    longestUptimeMs: state.longestUptimeMs,
    currentUptimeMs: currentUptime(state, now),
    enabled: state.enabled,
  };
}

/**
 * Format supervisor state for TUI display.
 */
export function formatSupervisor(state: SupervisorState, now = Date.now()): string[] {
  const stats = supervisorStats(state, now);
  const uptimeH = Math.round(stats.currentUptimeMs / 3_600_000 * 10) / 10;
  const longestH = Math.round(stats.longestUptimeMs / 3_600_000 * 10) / 10;
  const icon = stats.enabled ? "🟢" : "⭘";
  const lines: string[] = [];
  lines.push(`  Process Supervisor ${icon} (${stats.enabled ? "enabled" : "disabled"}):`);
  lines.push(`    Uptime: ${uptimeH}h | Longest: ${longestH}h | Restarts: ${stats.totalRestarts} (${stats.recentRestarts} recent)`);
  if (state.restarts.length > 0) {
    const last = state.restarts[state.restarts.length - 1];
    const ago = Math.round((now - last.timestamp) / 60_000);
    lines.push(`    Last restart: ${ago}m ago — ${last.reason}${last.exitCode !== undefined ? ` (exit ${last.exitCode})` : ""}`);
  }
  return lines;
}
