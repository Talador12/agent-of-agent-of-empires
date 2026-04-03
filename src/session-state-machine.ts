// session-state-machine.ts — formalize session lifecycle as a state machine
// with explicit states, valid transitions, and transition guards. prevents
// illegal state changes and provides a clear audit trail.

export type SessionState =
  | "pending"    // registered but not yet started
  | "starting"   // being launched
  | "active"     // running and producing output
  | "idle"       // running but no recent output
  | "stuck"      // active but making no progress
  | "error"      // encountering errors
  | "paused"     // manually or auto-paused
  | "completing" // finishing up (goal detected as done)
  | "completed"  // task finished
  | "failed"     // task failed permanently
  | "removed";   // session torn down

export interface StateTransition {
  from: SessionState;
  to: SessionState;
  guard?: string; // human-readable guard condition
}

/** All valid transitions in the session lifecycle. */
const VALID_TRANSITIONS: StateTransition[] = [
  { from: "pending", to: "starting", guard: "pool slot available" },
  { from: "pending", to: "removed", guard: "operator cancels" },
  { from: "starting", to: "active", guard: "first output received" },
  { from: "starting", to: "error", guard: "launch fails" },
  { from: "starting", to: "removed", guard: "operator cancels" },
  { from: "active", to: "idle", guard: "no output for N ticks" },
  { from: "active", to: "stuck", guard: "no progress despite output" },
  { from: "active", to: "error", guard: "error detected in output" },
  { from: "active", to: "paused", guard: "budget exceeded or manual" },
  { from: "active", to: "completing", guard: "goal completion detected" },
  { from: "active", to: "removed", guard: "operator removes" },
  { from: "idle", to: "active", guard: "new output received" },
  { from: "idle", to: "stuck", guard: "idle too long" },
  { from: "idle", to: "paused", guard: "auto-pause after idle" },
  { from: "idle", to: "removed", guard: "operator removes" },
  { from: "stuck", to: "active", guard: "progress resumes after nudge" },
  { from: "stuck", to: "error", guard: "stuck escalates to error" },
  { from: "stuck", to: "paused", guard: "auto-pause" },
  { from: "stuck", to: "removed", guard: "operator removes" },
  { from: "error", to: "active", guard: "error resolves" },
  { from: "error", to: "starting", guard: "auto-restart" },
  { from: "error", to: "paused", guard: "too many errors" },
  { from: "error", to: "failed", guard: "max retries exceeded" },
  { from: "error", to: "removed", guard: "operator removes" },
  { from: "paused", to: "active", guard: "operator resumes" },
  { from: "paused", to: "starting", guard: "restart after pause" },
  { from: "paused", to: "removed", guard: "operator removes" },
  { from: "completing", to: "completed", guard: "verification passes" },
  { from: "completing", to: "active", guard: "verification fails, revert" },
  { from: "completed", to: "removed", guard: "cleanup" },
  { from: "failed", to: "starting", guard: "manual retry" },
  { from: "failed", to: "removed", guard: "cleanup" },
];

export interface TransitionResult {
  allowed: boolean;
  from: SessionState;
  to: SessionState;
  guard?: string;
  reason?: string; // why it was blocked
}

/**
 * Check whether a state transition is valid.
 */
export function canTransition(from: SessionState, to: SessionState): TransitionResult {
  const match = VALID_TRANSITIONS.find((t) => t.from === from && t.to === to);
  if (match) return { allowed: true, from, to, guard: match.guard };
  return { allowed: false, from, to, reason: `No valid transition from "${from}" to "${to}"` };
}

/**
 * Get all valid next states from a given state.
 */
export function validNextStates(from: SessionState): { state: SessionState; guard?: string }[] {
  return VALID_TRANSITIONS
    .filter((t) => t.from === from)
    .map((t) => ({ state: t.to, guard: t.guard }));
}

/**
 * Get all valid transitions for documentation/display.
 */
export function allTransitions(): StateTransition[] {
  return [...VALID_TRANSITIONS];
}

/**
 * Attempt a state transition. Returns the new state if allowed, or the
 * old state with a reason if blocked.
 */
export function tryTransition(current: SessionState, target: SessionState): { newState: SessionState; result: TransitionResult } {
  const result = canTransition(current, target);
  return { newState: result.allowed ? target : current, result };
}

/**
 * Format the state machine diagram for TUI display.
 */
export function formatStateMachine(currentState?: SessionState): string[] {
  const lines: string[] = [];
  lines.push("  Session State Machine:");
  const states: SessionState[] = ["pending", "starting", "active", "idle", "stuck", "error", "paused", "completing", "completed", "failed", "removed"];
  for (const s of states) {
    const marker = s === currentState ? " ← current" : "";
    const nexts = validNextStates(s).map((n) => n.state);
    lines.push(`  ${s === currentState ? "▶" : " "} ${s.padEnd(12)} → ${nexts.join(", ") || "(terminal)"}${marker}`);
  }
  return lines;
}

/**
 * Format a transition result for TUI display.
 */
export function formatTransitionResult(result: TransitionResult): string[] {
  if (result.allowed) {
    return [`  ✓ Transition ${result.from} → ${result.to} (guard: ${result.guard ?? "none"})`];
  }
  return [`  ✗ Blocked: ${result.reason}`];
}
