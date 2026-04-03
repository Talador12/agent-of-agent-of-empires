// session-context-diff.ts — show what changed in context files between
// ticks. tracks content hashes per file and reports which files were
// added, removed, or modified since the last check.

import { createHash } from "node:crypto";

export interface ContextFileChange {
  path: string;
  type: "added" | "removed" | "modified" | "unchanged";
  previousHash?: string;
  currentHash?: string;
}

export interface ContextDiffState {
  hashes: Map<string, string>; // path -> content hash
  lastDiffAt: number;
}

/**
 * Create context diff state.
 */
export function createContextDiffState(): ContextDiffState {
  return { hashes: new Map(), lastDiffAt: 0 };
}

/**
 * Hash a string for comparison.
 */
export function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

/**
 * Compute diff between current file contents and last known state.
 * Returns list of changes and updates internal state.
 */
export function diffContextFiles(
  state: ContextDiffState,
  currentFiles: Map<string, string>, // path -> content
  now = Date.now(),
): ContextFileChange[] {
  const changes: ContextFileChange[] = [];
  const currentPaths = new Set(currentFiles.keys());

  // check each current file against previous state
  for (const [path, content] of currentFiles) {
    const currentHash = hashContent(content);
    const previousHash = state.hashes.get(path);

    if (!previousHash) {
      changes.push({ path, type: "added", currentHash });
    } else if (currentHash !== previousHash) {
      changes.push({ path, type: "modified", previousHash, currentHash });
    } else {
      changes.push({ path, type: "unchanged" });
    }

    state.hashes.set(path, currentHash);
  }

  // check for removed files
  for (const [path] of state.hashes) {
    if (!currentPaths.has(path)) {
      changes.push({ path, type: "removed", previousHash: state.hashes.get(path) });
      state.hashes.delete(path);
    }
  }

  state.lastDiffAt = now;
  return changes;
}

/**
 * Get only changed files (not unchanged).
 */
export function getChangedFiles(changes: ContextFileChange[]): ContextFileChange[] {
  return changes.filter((c) => c.type !== "unchanged");
}

/**
 * Get summary counts.
 */
export function diffSummary(changes: ContextFileChange[]): { added: number; removed: number; modified: number; unchanged: number; total: number } {
  return {
    added: changes.filter((c) => c.type === "added").length,
    removed: changes.filter((c) => c.type === "removed").length,
    modified: changes.filter((c) => c.type === "modified").length,
    unchanged: changes.filter((c) => c.type === "unchanged").length,
    total: changes.length,
  };
}

/**
 * Format context diff for TUI display.
 */
export function formatContextDiff(changes: ContextFileChange[]): string[] {
  const summary = diffSummary(changes);
  const changed = getChangedFiles(changes);
  const lines: string[] = [];
  lines.push(`  Context Diff (+${summary.added} -${summary.removed} ~${summary.modified} =${summary.unchanged}):`);
  if (changed.length === 0) {
    lines.push("    No changes since last check");
  } else {
    for (const c of changed) {
      const icon = c.type === "added" ? "+" : c.type === "removed" ? "-" : "~";
      const basename = c.path.split("/").pop() ?? c.path;
      lines.push(`    ${icon} ${basename} [${c.type}]`);
    }
  }
  return lines;
}
