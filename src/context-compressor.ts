// context-compressor.ts — compress old observations before sending to LLM.
// summarizes older parts of the observation history into compact digests,
// keeping recent observations detailed while older ones are condensed.

export interface CompressedObservation {
  originalLineCount: number;
  compressedLineCount: number;
  compressionRatio: number;
  text: string;
}

/**
 * Compress observation text by keeping recent lines detailed and
 * summarizing older lines into compact digests.
 */
export function compressObservation(
  lines: string[],
  recentKeepCount = 30,
  maxCompressedLines = 10,
): CompressedObservation {
  if (lines.length <= recentKeepCount) {
    return {
      originalLineCount: lines.length,
      compressedLineCount: lines.length,
      compressionRatio: 1,
      text: lines.join("\n"),
    };
  }

  const oldLines = lines.slice(0, -recentKeepCount);
  const recentLines = lines.slice(-recentKeepCount);

  // summarize old lines: extract key events
  const summary = summarizeLines(oldLines, maxCompressedLines);
  const compressed = [`--- compressed ${oldLines.length} older lines ---`, ...summary, "--- recent output ---", ...recentLines];

  return {
    originalLineCount: lines.length,
    compressedLineCount: compressed.length,
    compressionRatio: compressed.length / lines.length,
    text: compressed.join("\n"),
  };
}

/**
 * Extract the most important lines from a block of text.
 * Prioritizes errors, commits, test results, and state changes.
 */
export function summarizeLines(lines: string[], maxLines: number): string[] {
  const scored: Array<{ line: string; score: number }> = [];

  for (const raw of lines) {
    const line = raw.replace(/\x1b\[[0-9;]*[mABCDHJKST]/g, "").trim();
    if (!line) continue;

    let score = 0;
    // errors are highest priority
    if (/error|ERR[!]|FAIL|panic|crash/i.test(line)) score += 10;
    // git operations
    if (/\[.*[a-f0-9]{7}\]|push|commit|merge/i.test(line)) score += 8;
    // test results
    if (/tests?\s+\d+|pass|fail\s+\d+/i.test(line)) score += 7;
    // file operations
    if (/^(Edit|Write|Read|Create|Delete)\s/i.test(line)) score += 3;
    // status changes
    if (/done|completed?|started|building|installing/i.test(line)) score += 5;
    // skip noise
    if (/^\s*[│├└─┌┐┘┤┬┴┼]+\s*$/.test(line)) continue; // box drawing
    if (/^\s*\d+:\s/.test(line)) score += 1; // line-numbered content

    if (score > 0) scored.push({ line, score });
  }

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, maxLines)
    .map((s) => `  [${s.score}] ${s.line.slice(0, 120)}`);
}

/**
 * Estimate token count for a string (rough: ~4 chars per token).
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Compress context to fit within a token budget.
 * Progressively reduces recentKeepCount until it fits.
 */
export function compressToTokenBudget(
  lines: string[],
  maxTokens: number,
  minRecentLines = 10,
): CompressedObservation {
  let keepCount = Math.min(lines.length, 50);
  while (keepCount >= minRecentLines) {
    const compressed = compressObservation(lines, keepCount);
    if (estimateTokens(compressed.text) <= maxTokens) return compressed;
    keepCount = Math.max(minRecentLines, Math.round(keepCount * 0.7));
  }
  return compressObservation(lines, minRecentLines);
}

/**
 * Format compression stats for TUI display.
 */
export function formatCompressionStats(stats: CompressedObservation): string {
  const pct = Math.round(stats.compressionRatio * 100);
  return `compressed ${stats.originalLineCount} → ${stats.compressedLineCount} lines (${pct}% of original, ~${estimateTokens(stats.text)} tokens)`;
}
