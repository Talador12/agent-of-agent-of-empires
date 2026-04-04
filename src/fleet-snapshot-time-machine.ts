// fleet-snapshot-time-machine.ts — interactive snapshot browser with
// comparison. stores fleet snapshots at intervals and lets operators
// browse, compare, and diff any two points in time.

export interface TimeMachineSnapshot {
  id: number;
  timestamp: number;
  sessionCount: number;
  activeSessions: string[];
  healthScore: number;
  totalCostUsd: number;
  label?: string;
}

export interface SnapshotDiff {
  addedSessions: string[];
  removedSessions: string[];
  healthDelta: number;
  costDelta: number;
  sessionCountDelta: number;
}

export interface TimeMachineState {
  snapshots: TimeMachineSnapshot[];
  nextId: number;
  maxSnapshots: number;
}

/**
 * Create time machine state.
 */
export function createTimeMachine(maxSnapshots = 100): TimeMachineState {
  return { snapshots: [], nextId: 1, maxSnapshots };
}

/**
 * Take a snapshot of current fleet state.
 */
export function takeSnapshot(state: TimeMachineState, data: Omit<TimeMachineSnapshot, "id">, now = Date.now()): TimeMachineSnapshot {
  const snap: TimeMachineSnapshot = { ...data, id: state.nextId++, timestamp: now };
  state.snapshots.push(snap);
  if (state.snapshots.length > state.maxSnapshots) state.snapshots = state.snapshots.slice(-state.maxSnapshots);
  return snap;
}

/**
 * Get a snapshot by ID.
 */
export function getSnapshot(state: TimeMachineState, id: number): TimeMachineSnapshot | null {
  return state.snapshots.find((s) => s.id === id) ?? null;
}

/**
 * Get the most recent snapshot.
 */
export function latestSnapshot(state: TimeMachineState): TimeMachineSnapshot | null {
  return state.snapshots.length > 0 ? state.snapshots[state.snapshots.length - 1] : null;
}

/**
 * Compare two snapshots.
 */
export function compareSnapshots(a: TimeMachineSnapshot, b: TimeMachineSnapshot): SnapshotDiff {
  const setA = new Set(a.activeSessions);
  const setB = new Set(b.activeSessions);
  return {
    addedSessions: b.activeSessions.filter((s) => !setA.has(s)),
    removedSessions: a.activeSessions.filter((s) => !setB.has(s)),
    healthDelta: b.healthScore - a.healthScore,
    costDelta: Math.round((b.totalCostUsd - a.totalCostUsd) * 100) / 100,
    sessionCountDelta: b.sessionCount - a.sessionCount,
  };
}

/**
 * Find snapshots in a time range.
 */
export function snapshotsInRange(state: TimeMachineState, startMs: number, endMs: number): TimeMachineSnapshot[] {
  return state.snapshots.filter((s) => s.timestamp >= startMs && s.timestamp <= endMs);
}

/**
 * Format time machine state for TUI display.
 */
export function formatTimeMachine(state: TimeMachineState): string[] {
  const lines: string[] = [];
  lines.push(`  Time Machine (${state.snapshots.length} snapshots):`);
  if (state.snapshots.length === 0) { lines.push("    No snapshots taken yet"); return lines; }
  const recent = state.snapshots.slice(-5);
  for (const s of recent) {
    const time = new Date(s.timestamp).toISOString().slice(11, 19);
    lines.push(`    #${s.id} ${time}: ${s.sessionCount} sessions, ${s.healthScore}% health, $${s.totalCostUsd.toFixed(2)}${s.label ? ` [${s.label}]` : ""}`);
  }
  if (state.snapshots.length > 5) lines.push(`    ... ${state.snapshots.length - 5} older snapshots`);
  return lines;
}

/**
 * Format snapshot diff for TUI display.
 */
export function formatSnapshotDiff(diff: SnapshotDiff): string[] {
  const lines: string[] = [];
  lines.push(`  Snapshot Diff:`);
  lines.push(`    Sessions: ${diff.sessionCountDelta >= 0 ? "+" : ""}${diff.sessionCountDelta} | Health: ${diff.healthDelta >= 0 ? "+" : ""}${diff.healthDelta}% | Cost: ${diff.costDelta >= 0 ? "+" : ""}$${diff.costDelta.toFixed(2)}`);
  if (diff.addedSessions.length > 0) lines.push(`    Added: ${diff.addedSessions.join(", ")}`);
  if (diff.removedSessions.length > 0) lines.push(`    Removed: ${diff.removedSessions.join(", ")}`);
  return lines;
}
