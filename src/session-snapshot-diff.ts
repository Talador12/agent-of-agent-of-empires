// session-snapshot-diff.ts — diff two snapshots of the same session to show
// what changed between polls. useful for understanding what happened while
// the operator was away.

export interface SessionDiff {
  sessionTitle: string;
  addedLines: string[];
  removedLines: string[];
  totalBefore: number;
  totalAfter: number;
}

/**
 * Compute a simple line-level diff between two output snapshots.
 */
export function diffSessionOutput(sessionTitle: string, before: string[], after: string[]): SessionDiff {
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  const added = after.filter((l) => !beforeSet.has(l));
  const removed = before.filter((l) => !afterSet.has(l));
  return { sessionTitle, addedLines: added, removedLines: removed, totalBefore: before.length, totalAfter: after.length };
}

/**
 * Format session diff for TUI display.
 */
export function formatSessionDiff(diff: SessionDiff, maxLines = 20): string[] {
  const lines: string[] = [];
  lines.push(`  Diff: "${diff.sessionTitle}" (${diff.totalBefore} → ${diff.totalAfter} lines, +${diff.addedLines.length} -${diff.removedLines.length})`);
  if (diff.addedLines.length > 0) {
    lines.push("  Added:");
    for (const l of diff.addedLines.slice(0, maxLines)) lines.push(`  + ${l.slice(0, 120)}`);
    if (diff.addedLines.length > maxLines) lines.push(`  ... +${diff.addedLines.length - maxLines} more`);
  }
  if (diff.removedLines.length > 0) {
    lines.push("  Removed:");
    for (const l of diff.removedLines.slice(0, maxLines)) lines.push(`  - ${l.slice(0, 120)}`);
    if (diff.removedLines.length > maxLines) lines.push(`  ... -${diff.removedLines.length - maxLines} more`);
  }
  if (diff.addedLines.length === 0 && diff.removedLines.length === 0) {
    lines.push("  (no changes)");
  }
  return lines;
}
