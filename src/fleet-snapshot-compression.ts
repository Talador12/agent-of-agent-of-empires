// fleet-snapshot-compression.ts — delta-encode fleet snapshots for storage
// efficiency. instead of storing full snapshots each time, store only what
// changed since the last snapshot (additions, removals, modifications).

export interface SnapshotDelta {
  baseTimestamp: number;
  deltaTimestamp: number;
  added: Record<string, unknown>;
  removed: string[];
  modified: Record<string, { from: unknown; to: unknown }>;
  compressionRatio: number; // % size reduction vs full snapshot
}

export interface CompressionState {
  baseSnapshot: Record<string, unknown> | null;
  baseTimestamp: number;
  deltas: SnapshotDelta[];
  maxDeltas: number;
  totalSavedBytes: number;
}

/**
 * Create compression state.
 */
export function createCompressionState(maxDeltas = 50): CompressionState {
  return { baseSnapshot: null, baseTimestamp: 0, deltas: [], maxDeltas, totalSavedBytes: 0 };
}

/**
 * Compute a delta between two snapshots.
 */
export function computeDelta(base: Record<string, unknown>, current: Record<string, unknown>, baseTs: number, currentTs: number): SnapshotDelta {
  const added: Record<string, unknown> = {};
  const removed: string[] = [];
  const modified: Record<string, { from: unknown; to: unknown }> = {};

  // find added and modified
  for (const [key, val] of Object.entries(current)) {
    if (!(key in base)) {
      added[key] = val;
    } else if (JSON.stringify(base[key]) !== JSON.stringify(val)) {
      modified[key] = { from: base[key], to: val };
    }
  }

  // find removed
  for (const key of Object.keys(base)) {
    if (!(key in current)) removed.push(key);
  }

  const fullSize = JSON.stringify(current).length;
  const deltaSize = JSON.stringify({ added, removed, modified }).length;
  const compressionRatio = fullSize > 0 ? Math.round((1 - deltaSize / fullSize) * 100) : 0;

  return { baseTimestamp: baseTs, deltaTimestamp: currentTs, added, removed, modified, compressionRatio };
}

/**
 * Record a snapshot — stores full or delta as appropriate.
 */
export function recordSnapshot(state: CompressionState, snapshot: Record<string, unknown>, now = Date.now()): { isDelta: boolean; savedBytes: number } {
  if (!state.baseSnapshot) {
    state.baseSnapshot = JSON.parse(JSON.stringify(snapshot));
    state.baseTimestamp = now;
    return { isDelta: false, savedBytes: 0 };
  }

  const delta = computeDelta(state.baseSnapshot, snapshot, state.baseTimestamp, now);

  // if delta is larger than 60% of full, store new base instead
  const fullSize = JSON.stringify(snapshot).length;
  const deltaSize = JSON.stringify(delta).length;
  if (deltaSize > fullSize * 0.6) {
    state.baseSnapshot = JSON.parse(JSON.stringify(snapshot));
    state.baseTimestamp = now;
    state.deltas = [];
    return { isDelta: false, savedBytes: 0 };
  }

  state.deltas.push(delta);
  if (state.deltas.length > state.maxDeltas) {
    // compact: new base = apply all deltas to old base
    state.baseSnapshot = JSON.parse(JSON.stringify(snapshot));
    state.baseTimestamp = now;
    state.deltas = [];
  }

  const saved = fullSize - deltaSize;
  state.totalSavedBytes += Math.max(0, saved);
  return { isDelta: true, savedBytes: Math.max(0, saved) };
}

/**
 * Get compression stats.
 */
export function compressionStats(state: CompressionState): { deltaCount: number; totalSavedBytes: number; avgCompressionPct: number } {
  const avgComp = state.deltas.length > 0
    ? Math.round(state.deltas.reduce((a, d) => a + d.compressionRatio, 0) / state.deltas.length)
    : 0;
  return { deltaCount: state.deltas.length, totalSavedBytes: state.totalSavedBytes, avgCompressionPct: avgComp };
}

/**
 * Format compression stats for TUI display.
 */
export function formatCompressionStats(state: CompressionState): string[] {
  const stats = compressionStats(state);
  const lines: string[] = [];
  const savedKB = Math.round(stats.totalSavedBytes / 1024);
  lines.push(`  Snapshot Compression (${stats.deltaCount} deltas, ${savedKB}KB saved, ${stats.avgCompressionPct}% avg compression):`);
  if (state.deltas.length === 0) {
    lines.push("    No deltas yet (storing full snapshots)");
  } else {
    const recent = state.deltas.slice(-3);
    for (const d of recent) {
      const addCount = Object.keys(d.added).length;
      const modCount = Object.keys(d.modified).length;
      lines.push(`    delta: +${addCount} ~${modCount} -${d.removed.length} (${d.compressionRatio}% saved)`);
    }
  }
  return lines;
}
