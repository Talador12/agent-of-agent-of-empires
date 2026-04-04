// daemon-distributed-lock.ts — prevent concurrent daemon instances.
// uses a PID-based lockfile with staleness detection. if a lock is
// stale (process no longer running), it's automatically reclaimed.

export interface LockState {
  locked: boolean;
  pid: number | null;
  lockedAt: number | null;
  lockPath: string;
  staleThresholdMs: number;
}

export interface LockResult {
  acquired: boolean;
  reason: string;
  existingPid?: number;
  stale?: boolean;
}

/**
 * Create lock state (in-memory representation).
 */
export function createLockState(lockPath = "~/.aoaoe/daemon.lock", staleThresholdMs = 300_000): LockState {
  return { locked: false, pid: null, lockedAt: null, lockPath, staleThresholdMs };
}

/**
 * Attempt to acquire the lock.
 */
export function acquireLock(state: LockState, pid: number, now = Date.now()): LockResult {
  if (!state.locked) {
    state.locked = true;
    state.pid = pid;
    state.lockedAt = now;
    return { acquired: true, reason: "lock acquired" };
  }

  // check if existing lock is stale
  if (state.lockedAt && now - state.lockedAt > state.staleThresholdMs) {
    const oldPid = state.pid;
    state.locked = true;
    state.pid = pid;
    state.lockedAt = now;
    return { acquired: true, reason: `reclaimed stale lock (previous pid: ${oldPid})`, existingPid: oldPid ?? undefined, stale: true };
  }

  return { acquired: false, reason: `locked by pid ${state.pid}`, existingPid: state.pid ?? undefined };
}

/**
 * Release the lock.
 */
export function releaseLock(state: LockState, pid: number): boolean {
  if (!state.locked || state.pid !== pid) return false;
  state.locked = false;
  state.pid = null;
  state.lockedAt = null;
  return true;
}

/**
 * Check if the lock is held.
 */
export function isLocked(state: LockState): boolean {
  return state.locked;
}

/**
 * Check if the lock is stale (held but likely abandoned).
 */
export function isStale(state: LockState, now = Date.now()): boolean {
  if (!state.locked || !state.lockedAt) return false;
  return now - state.lockedAt > state.staleThresholdMs;
}

/**
 * Get lock age in milliseconds.
 */
export function lockAge(state: LockState, now = Date.now()): number {
  if (!state.lockedAt) return 0;
  return now - state.lockedAt;
}

/**
 * Format lock state for TUI display.
 */
export function formatLockState(state: LockState, now = Date.now()): string[] {
  const lines: string[] = [];
  if (!state.locked) {
    lines.push("  Daemon Lock: unlocked (no active instance)");
  } else {
    const age = Math.round(lockAge(state, now) / 60_000);
    const stale = isStale(state, now);
    const icon = stale ? "⚠" : "🔒";
    lines.push(`  Daemon Lock ${icon}: locked by pid ${state.pid} (${age}m)${stale ? " — STALE" : ""}`);
    lines.push(`    Path: ${state.lockPath}`);
  }
  return lines;
}
