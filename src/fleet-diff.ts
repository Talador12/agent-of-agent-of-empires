// fleet-diff.ts — CLI command for comparing two fleet snapshots.
// shows changes in sessions, health, costs, and tasks between snapshots.

import { listFleetSnapshots, loadFleetSnapshot, diffFleetSnapshots, formatFleetSnapshot } from "./fleet-snapshot.js";
import type { FleetSnapshot } from "./fleet-snapshot.js";

export interface FleetDiffResult {
  olderFilename: string;
  newerFilename: string;
  diff: string[];
  olderSummary: string[];
  newerSummary: string[];
}

/**
 * Compare two fleet snapshots by filename or index.
 * Index 0 = most recent, 1 = second most recent, etc.
 */
export function compareSnapshots(olderRef: string | number, newerRef: string | number): FleetDiffResult | null {
  const snapshots = listFleetSnapshots();
  if (snapshots.length < 2) return null;

  const resolve = (ref: string | number): { filename: string; snapshot: FleetSnapshot } | null => {
    if (typeof ref === "number") {
      const entry = snapshots[ref];
      if (!entry) return null;
      const snapshot = loadFleetSnapshot(entry.filename);
      return snapshot ? { filename: entry.filename, snapshot } : null;
    }
    const snapshot = loadFleetSnapshot(ref);
    return snapshot ? { filename: ref, snapshot } : null;
  };

  const older = resolve(olderRef);
  const newer = resolve(newerRef);
  if (!older || !newer) return null;

  return {
    olderFilename: older.filename,
    newerFilename: newer.filename,
    diff: diffFleetSnapshots(older.snapshot, newer.snapshot),
    olderSummary: formatFleetSnapshot(older.snapshot),
    newerSummary: formatFleetSnapshot(newer.snapshot),
  };
}

/**
 * Compare the two most recent snapshots (quick diff).
 */
export function compareLatestSnapshots(): FleetDiffResult | null {
  return compareSnapshots(1, 0); // index 1 = second newest, 0 = newest
}

/**
 * Format a fleet diff result for CLI or TUI display.
 */
export function formatFleetDiff(result: FleetDiffResult): string[] {
  const lines: string[] = [];
  lines.push(`  Fleet diff: ${result.olderFilename} → ${result.newerFilename}`);
  lines.push("");
  for (const line of result.diff) lines.push(line);
  return lines;
}

/**
 * List available snapshots for the CLI.
 */
export function formatSnapshotList(): string[] {
  const snapshots = listFleetSnapshots();
  if (snapshots.length === 0) return ["  (no fleet snapshots available)"];
  const lines: string[] = [];
  lines.push(`  ${snapshots.length} fleet snapshots available:`);
  for (let i = 0; i < Math.min(snapshots.length, 20); i++) {
    const s = snapshots[i];
    lines.push(`  [${i}] ${s.filename} (${s.timestamp})`);
  }
  if (snapshots.length > 20) lines.push(`  ... and ${snapshots.length - 20} more`);
  return lines;
}
