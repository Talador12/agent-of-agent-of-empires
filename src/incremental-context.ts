// incremental-context.ts — only reload context files that changed since
// last tick. tracks file mtimes and sizes, skips re-reads for unchanged
// files, reducing I/O and context rebuild overhead.

import { statSync } from "node:fs";

export interface FileFingerprint {
  path: string;
  mtimeMs: number;
  size: number;
}

export interface IncrementalContextState {
  fingerprints: Map<string, FileFingerprint>;
  lastCheckAt: number;
  totalReloads: number;
  totalSkips: number;
}

export interface ChangeDetectionResult {
  path: string;
  changed: boolean;
  reason: "new" | "modified" | "size-changed" | "unchanged" | "deleted";
  previousMtime?: number;
  currentMtime?: number;
}

/**
 * Create a fresh incremental context state.
 */
export function createIncrementalState(): IncrementalContextState {
  return {
    fingerprints: new Map(),
    lastCheckAt: 0,
    totalReloads: 0,
    totalSkips: 0,
  };
}

/**
 * Check which files have changed since last check.
 * Returns an array of change detection results.
 */
export function detectChanges(
  state: IncrementalContextState,
  filePaths: string[],
  now = Date.now(),
): ChangeDetectionResult[] {
  const results: ChangeDetectionResult[] = [];
  const currentPaths = new Set(filePaths);

  for (const path of filePaths) {
    const prev = state.fingerprints.get(path);

    let current: FileFingerprint | null = null;
    try {
      const stat = statSync(path);
      current = { path, mtimeMs: stat.mtimeMs, size: stat.size };
    } catch {
      // file doesn't exist or can't be read
      if (prev) {
        results.push({ path, changed: true, reason: "deleted", previousMtime: prev.mtimeMs });
        state.fingerprints.delete(path);
        state.totalReloads++;
      }
      continue;
    }

    if (!prev) {
      // new file
      results.push({ path, changed: true, reason: "new", currentMtime: current.mtimeMs });
      state.fingerprints.set(path, current);
      state.totalReloads++;
    } else if (current.mtimeMs !== prev.mtimeMs) {
      results.push({ path, changed: true, reason: "modified", previousMtime: prev.mtimeMs, currentMtime: current.mtimeMs });
      state.fingerprints.set(path, current);
      state.totalReloads++;
    } else if (current.size !== prev.size) {
      results.push({ path, changed: true, reason: "size-changed", previousMtime: prev.mtimeMs, currentMtime: current.mtimeMs });
      state.fingerprints.set(path, current);
      state.totalReloads++;
    } else {
      results.push({ path, changed: false, reason: "unchanged" });
      state.totalSkips++;
    }
  }

  // detect removed files (were tracked but no longer in the list)
  for (const [path] of state.fingerprints) {
    if (!currentPaths.has(path)) {
      results.push({ path, changed: true, reason: "deleted" });
      state.fingerprints.delete(path);
      state.totalReloads++;
    }
  }

  state.lastCheckAt = now;
  return results;
}

/**
 * Get only the changed file paths (for selective re-read).
 */
export function changedPaths(results: ChangeDetectionResult[]): string[] {
  return results.filter((r) => r.changed).map((r) => r.path);
}

/**
 * Get incremental context efficiency stats.
 */
export function contextStats(state: IncrementalContextState): { reloads: number; skips: number; hitRate: number; trackedFiles: number } {
  const total = state.totalReloads + state.totalSkips;
  return {
    reloads: state.totalReloads,
    skips: state.totalSkips,
    hitRate: total > 0 ? Math.round((state.totalSkips / total) * 100) : 0,
    trackedFiles: state.fingerprints.size,
  };
}

/**
 * Format incremental context state for TUI display.
 */
export function formatIncrementalContext(state: IncrementalContextState, recentResults?: ChangeDetectionResult[]): string[] {
  const stats = contextStats(state);
  const lines: string[] = [];
  lines.push(`  Incremental Context (${stats.trackedFiles} files tracked, ${stats.hitRate}% cache hit rate):`);
  lines.push(`    Reloads: ${stats.reloads} | Skips: ${stats.skips}`);

  if (recentResults && recentResults.length > 0) {
    const changed = recentResults.filter((r) => r.changed);
    if (changed.length === 0) {
      lines.push("    Last check: all files unchanged");
    } else {
      lines.push(`    Last check: ${changed.length} changed:`);
      for (const r of changed.slice(0, 5)) {
        const basename = r.path.split("/").pop() ?? r.path;
        lines.push(`      ${r.reason}: ${basename}`);
      }
    }
  }

  return lines;
}
