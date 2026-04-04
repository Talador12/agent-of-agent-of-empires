// daemon-graceful-shutdown.ts — drain active sessions before exit.
// tracks shutdown state, manages a drain period for in-flight work,
// generates a final state snapshot, and coordinates clean exit.

export type ShutdownPhase = "running" | "draining" | "saving" | "exiting" | "complete";

export interface ShutdownState {
  phase: ShutdownPhase;
  initiatedAt: number | null;
  drainTimeoutMs: number;
  activeSessions: string[];
  drainedSessions: string[];
  saveComplete: boolean;
  exitCode: number;
}

export interface ShutdownPlan {
  phase: ShutdownPhase;
  sessionsTodrain: string[];
  estimatedDrainMs: number;
  actions: string[];
}

/**
 * Create shutdown state.
 */
export function createShutdownState(drainTimeoutMs = 30_000): ShutdownState {
  return { phase: "running", initiatedAt: null, drainTimeoutMs, activeSessions: [], drainedSessions: [], saveComplete: false, exitCode: 0 };
}

/**
 * Initiate graceful shutdown. Returns a plan of what will happen.
 */
export function initiateShutdown(state: ShutdownState, activeSessions: string[], exitCode = 0, now = Date.now()): ShutdownPlan {
  state.phase = "draining";
  state.initiatedAt = now;
  state.activeSessions = [...activeSessions];
  state.exitCode = exitCode;

  const actions: string[] = [];
  actions.push("Stop accepting new tasks");
  if (activeSessions.length > 0) {
    actions.push(`Drain ${activeSessions.length} active session${activeSessions.length !== 1 ? "s" : ""}`);
    actions.push(`Timeout: ${Math.round(state.drainTimeoutMs / 1000)}s`);
  }
  actions.push("Save daemon state snapshot");
  actions.push("Write final audit entry");
  actions.push(`Exit with code ${exitCode}`);

  return {
    phase: "draining",
    sessionsTodrain: activeSessions,
    estimatedDrainMs: activeSessions.length > 0 ? state.drainTimeoutMs : 0,
    actions,
  };
}

/**
 * Mark a session as drained (completed its in-flight work).
 */
export function markDrained(state: ShutdownState, sessionTitle: string): void {
  if (!state.drainedSessions.includes(sessionTitle)) {
    state.drainedSessions.push(sessionTitle);
  }
}

/**
 * Check if drain is complete (all sessions drained or timeout).
 */
export function isDrainComplete(state: ShutdownState, now = Date.now()): boolean {
  if (state.phase !== "draining") return false;
  // all sessions drained
  if (state.activeSessions.every((s) => state.drainedSessions.includes(s))) return true;
  // timeout
  if (state.initiatedAt && now - state.initiatedAt >= state.drainTimeoutMs) return true;
  return false;
}

/**
 * Advance to next shutdown phase.
 */
export function advancePhase(state: ShutdownState, now = Date.now()): ShutdownPhase {
  if (state.phase === "draining" && isDrainComplete(state, now)) {
    state.phase = "saving";
  } else if (state.phase === "saving" && state.saveComplete) {
    state.phase = "exiting";
  } else if (state.phase === "exiting") {
    state.phase = "complete";
  }
  return state.phase;
}

/**
 * Mark state save as complete.
 */
export function markSaveComplete(state: ShutdownState): void {
  state.saveComplete = true;
}

/**
 * Get pending (not yet drained) sessions.
 */
export function pendingSessions(state: ShutdownState): string[] {
  return state.activeSessions.filter((s) => !state.drainedSessions.includes(s));
}

/**
 * Format shutdown state for TUI display.
 */
export function formatShutdownState(state: ShutdownState): string[] {
  const lines: string[] = [];
  if (state.phase === "running") {
    lines.push("  Graceful Shutdown: not initiated (daemon running)");
    return lines;
  }
  const pending = pendingSessions(state);
  const elapsed = state.initiatedAt ? Math.round((Date.now() - state.initiatedAt) / 1000) : 0;
  lines.push(`  Graceful Shutdown [${state.phase}] (${elapsed}s elapsed):`);
  lines.push(`    Drained: ${state.drainedSessions.length}/${state.activeSessions.length} sessions`);
  if (pending.length > 0) lines.push(`    Pending: ${pending.join(", ")}`);
  if (state.saveComplete) lines.push("    State saved ✓");
  lines.push(`    Exit code: ${state.exitCode}`);
  return lines;
}
