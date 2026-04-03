// session-output-dedup.ts — detect and collapse repeated output lines.
// when a session produces the same line N times in a row (e.g. spinner,
// polling, retry loops), collapse into a single line with a repeat count.

export interface DedupResult {
  originalLines: number;
  deduplicatedLines: number;
  collapsedRuns: number;
  savedLines: number;
  output: DedupLine[];
}

export interface DedupLine {
  text: string;
  count: number;      // 1 = unique, N = repeated N times
  collapsed: boolean;  // true if this was a run of repeats
}

/**
 * Deduplicate consecutive repeated lines.
 */
export function deduplicateOutput(lines: string[], minRepeat = 2): DedupResult {
  if (lines.length === 0) return { originalLines: 0, deduplicatedLines: 0, collapsedRuns: 0, savedLines: 0, output: [] };

  const output: DedupLine[] = [];
  let i = 0;
  let collapsedRuns = 0;

  while (i < lines.length) {
    const current = lines[i];
    let count = 1;
    while (i + count < lines.length && lines[i + count] === current) count++;

    if (count >= minRepeat) {
      output.push({ text: current, count, collapsed: true });
      collapsedRuns++;
    } else {
      for (let j = 0; j < count; j++) {
        output.push({ text: current, count: 1, collapsed: false });
      }
    }
    i += count;
  }

  return {
    originalLines: lines.length,
    deduplicatedLines: output.length,
    collapsedRuns,
    savedLines: lines.length - output.length,
    output,
  };
}

/**
 * Render deduplicated output back to string lines.
 */
export function renderDeduped(result: DedupResult): string[] {
  return result.output.map((l) => {
    if (l.collapsed) return `${l.text} (×${l.count})`;
    return l.text;
  });
}

/**
 * Get dedup stats.
 */
export function dedupStats(result: DedupResult): { compressionPct: number; collapsedRuns: number; savedLines: number } {
  return {
    compressionPct: result.originalLines > 0 ? Math.round((result.savedLines / result.originalLines) * 100) : 0,
    collapsedRuns: result.collapsedRuns,
    savedLines: result.savedLines,
  };
}

/**
 * Format dedup result for TUI display.
 */
export function formatDedup(result: DedupResult): string[] {
  const stats = dedupStats(result);
  const lines: string[] = [];
  lines.push(`  Output Dedup (${result.originalLines} → ${result.deduplicatedLines} lines, ${stats.compressionPct}% saved, ${stats.collapsedRuns} runs collapsed):`);
  if (stats.savedLines === 0) {
    lines.push("    No repeated lines detected");
  } else {
    const collapsed = result.output.filter((l) => l.collapsed);
    for (const l of collapsed.slice(0, 5)) {
      const stripped = l.text.replace(/\x1b\[[0-9;]*[mABCDHJKST]/g, "").slice(0, 50);
      lines.push(`    ×${l.count}: "${stripped}"`);
    }
  }
  return lines;
}
