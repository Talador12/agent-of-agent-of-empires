// daemon-config-diff.ts — show what changed between config reloads.
// tracks config snapshots and computes field-level diffs for operator
// awareness when hot-reload or manual config changes happen.

export interface ConfigChange {
  path: string;     // dot-notation path (e.g. "policies.maxIdleBeforeNudgeMs")
  oldValue: unknown;
  newValue: unknown;
  type: "added" | "removed" | "changed";
}

export interface ConfigDiffResult {
  timestamp: number;
  changes: ConfigChange[];
  hasChanges: boolean;
}

export interface ConfigDiffState {
  snapshots: Array<{ timestamp: number; config: Record<string, unknown> }>;
  maxSnapshots: number;
}

/**
 * Create a fresh config diff state.
 */
export function createConfigDiffState(maxSnapshots = 20): ConfigDiffState {
  return { snapshots: [], maxSnapshots };
}

/**
 * Record a config snapshot. Call this after every config load/reload.
 */
export function recordConfig(state: ConfigDiffState, config: Record<string, unknown>, now = Date.now()): void {
  state.snapshots.push({ timestamp: now, config: deepClone(config) });
  if (state.snapshots.length > state.maxSnapshots) {
    state.snapshots = state.snapshots.slice(-state.maxSnapshots);
  }
}

/**
 * Compute the diff between the two most recent config snapshots.
 */
export function computeConfigDiff(state: ConfigDiffState): ConfigDiffResult | null {
  if (state.snapshots.length < 2) return null;
  const prev = state.snapshots[state.snapshots.length - 2];
  const curr = state.snapshots[state.snapshots.length - 1];
  const changes = diffObjects(prev.config, curr.config, "");
  return { timestamp: curr.timestamp, changes, hasChanges: changes.length > 0 };
}

/**
 * Get the most recent N diffs.
 */
export function recentDiffs(state: ConfigDiffState, limit = 5): ConfigDiffResult[] {
  const results: ConfigDiffResult[] = [];
  for (let i = state.snapshots.length - 1; i >= 1 && results.length < limit; i--) {
    const prev = state.snapshots[i - 1];
    const curr = state.snapshots[i];
    const changes = diffObjects(prev.config, curr.config, "");
    results.push({ timestamp: curr.timestamp, changes, hasChanges: changes.length > 0 });
  }
  return results;
}

/** Deep-compare two objects and return field-level diffs. */
function diffObjects(a: Record<string, unknown>, b: Record<string, unknown>, prefix: string): ConfigChange[] {
  const changes: ConfigChange[] = [];
  const allKeys = new Set([...Object.keys(a), ...Object.keys(b)]);

  for (const key of allKeys) {
    const path = prefix ? `${prefix}.${key}` : key;
    const va = a[key];
    const vb = b[key];

    if (!(key in a)) {
      changes.push({ path, oldValue: undefined, newValue: vb, type: "added" });
    } else if (!(key in b)) {
      changes.push({ path, oldValue: va, newValue: undefined, type: "removed" });
    } else if (typeof va === "object" && va !== null && typeof vb === "object" && vb !== null && !Array.isArray(va) && !Array.isArray(vb)) {
      changes.push(...diffObjects(va as Record<string, unknown>, vb as Record<string, unknown>, path));
    } else if (JSON.stringify(va) !== JSON.stringify(vb)) {
      changes.push({ path, oldValue: va, newValue: vb, type: "changed" });
    }
  }

  return changes;
}

function deepClone(obj: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Format config diff for TUI display.
 */
export function formatConfigDiff(result: ConfigDiffResult | null): string[] {
  if (!result) return ["  Config diff: only one snapshot recorded (need 2+ for diff)"];
  if (!result.hasChanges) return ["  Config diff: no changes detected"];
  const lines: string[] = [];
  const time = new Date(result.timestamp).toISOString().slice(11, 19);
  lines.push(`  Config Diff (${result.changes.length} changes at ${time}):`);
  for (const c of result.changes) {
    const icon = c.type === "added" ? "+" : c.type === "removed" ? "-" : "~";
    const old = c.type !== "added" ? JSON.stringify(c.oldValue) : "";
    const nw = c.type !== "removed" ? JSON.stringify(c.newValue) : "";
    if (c.type === "changed") {
      lines.push(`    ${icon} ${c.path}: ${old} → ${nw}`);
    } else {
      lines.push(`    ${icon} ${c.path}: ${c.type === "added" ? nw : old}`);
    }
  }
  return lines;
}
