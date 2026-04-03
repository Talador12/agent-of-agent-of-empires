// session-output-diff.ts — compute and display line-level diffs between
// consecutive session output captures. highlights additions, removals,
// and unchanged context for quick visual scanning.

export interface DiffLine {
  type: "add" | "remove" | "context";
  lineNum: number;
  text: string;
}

export interface OutputDiff {
  sessionTitle: string;
  addedCount: number;
  removedCount: number;
  unchangedCount: number;
  lines: DiffLine[];
  timestamp: number;
}

/**
 * Compute a simple line-level diff between two output snapshots.
 * Uses a longest-common-subsequence approach for small inputs,
 * falls back to tail-diff for large inputs.
 */
export function computeOutputDiff(
  sessionTitle: string,
  previous: string,
  current: string,
  contextLines = 2,
): OutputDiff {
  const prevLines = previous.split("\n");
  const currLines = current.split("\n");

  // for large outputs, use simple tail-diff (new lines at end)
  if (prevLines.length > 500 || currLines.length > 500) {
    return tailDiff(sessionTitle, prevLines, currLines);
  }

  // build set of previous lines for fast lookup
  const prevSet = new Set(prevLines.map((l, i) => `${i}:${l}`));
  const currSet = new Set(currLines.map((l, i) => `${i}:${l}`));

  // find common lines (by content, order-preserving)
  const prevIdx = new Map<string, number[]>();
  for (let i = 0; i < prevLines.length; i++) {
    const key = prevLines[i];
    if (!prevIdx.has(key)) prevIdx.set(key, []);
    prevIdx.get(key)!.push(i);
  }

  // simple diff: walk current lines, mark as add/context based on content match
  const allDiffLines: DiffLine[] = [];
  const usedPrevLines = new Set<number>();

  let prevPointer = 0;
  for (let i = 0; i < currLines.length; i++) {
    const line = currLines[i];
    const candidates = prevIdx.get(line) ?? [];
    const matchIdx = candidates.find((idx) => idx >= prevPointer && !usedPrevLines.has(idx));

    if (matchIdx !== undefined) {
      // mark skipped previous lines as removed
      for (let j = prevPointer; j < matchIdx; j++) {
        if (!usedPrevLines.has(j)) {
          allDiffLines.push({ type: "remove", lineNum: j + 1, text: prevLines[j] });
          usedPrevLines.add(j);
        }
      }
      allDiffLines.push({ type: "context", lineNum: i + 1, text: line });
      usedPrevLines.add(matchIdx);
      prevPointer = matchIdx + 1;
    } else {
      allDiffLines.push({ type: "add", lineNum: i + 1, text: line });
    }
  }

  // remaining previous lines are removed
  for (let j = prevPointer; j < prevLines.length; j++) {
    if (!usedPrevLines.has(j)) {
      allDiffLines.push({ type: "remove", lineNum: j + 1, text: prevLines[j] });
    }
  }

  // filter to only show context around changes
  const changeIndices = new Set<number>();
  allDiffLines.forEach((l, i) => {
    if (l.type !== "context") {
      for (let c = Math.max(0, i - contextLines); c <= Math.min(allDiffLines.length - 1, i + contextLines); c++) {
        changeIndices.add(c);
      }
    }
  });

  const filteredLines = allDiffLines.filter((_, i) => changeIndices.has(i));

  const added = filteredLines.filter((l) => l.type === "add").length;
  const removed = filteredLines.filter((l) => l.type === "remove").length;
  const unchanged = filteredLines.filter((l) => l.type === "context").length;

  return { sessionTitle, addedCount: added, removedCount: removed, unchangedCount: unchanged, lines: filteredLines, timestamp: Date.now() };
}

/** Fast tail-diff for large outputs — just show new lines at the end. */
function tailDiff(sessionTitle: string, prevLines: string[], currLines: string[]): OutputDiff {
  // find where current diverges from previous
  const minLen = Math.min(prevLines.length, currLines.length);
  let commonPrefix = 0;
  for (let i = 0; i < minLen; i++) {
    if (prevLines[i] === currLines[i]) commonPrefix++;
    else break;
  }

  const lines: DiffLine[] = [];
  for (let i = commonPrefix; i < currLines.length; i++) {
    lines.push({ type: "add", lineNum: i + 1, text: currLines[i] });
  }

  return { sessionTitle, addedCount: lines.length, removedCount: 0, unchangedCount: commonPrefix, lines: lines.slice(-30), timestamp: Date.now() };
}

/**
 * Format output diff for TUI display.
 */
export function formatOutputDiff(diff: OutputDiff): string[] {
  if (diff.lines.length === 0) return [`  Output diff [${diff.sessionTitle}]: no changes`];
  const lines: string[] = [];
  lines.push(`  Output Diff [${diff.sessionTitle}] (+${diff.addedCount} -${diff.removedCount} ~${diff.unchangedCount}):`);
  for (const d of diff.lines.slice(0, 30)) {
    const prefix = d.type === "add" ? "+" : d.type === "remove" ? "-" : " ";
    const stripped = d.text.replace(/\x1b\[[0-9;]*[mABCDHJKST]/g, "").slice(0, 100);
    lines.push(`  ${prefix} ${stripped}`);
  }
  if (diff.lines.length > 30) {
    lines.push(`  ... ${diff.lines.length - 30} more lines`);
  }
  return lines;
}
