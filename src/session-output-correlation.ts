// session-output-correlation.ts — find related changes across sessions.
// compares recent output keywords between sessions to detect when
// sessions are working on related things simultaneously.

export interface CorrelationPair {
  sessionA: string;
  sessionB: string;
  sharedKeywords: string[];
  similarityScore: number; // 0-100
}

const STOPWORDS = new Set(["the", "a", "an", "and", "or", "in", "on", "to", "for", "of", "is", "it", "be", "do", "this", "that", "with", "from"]);

/**
 * Extract meaningful keywords from output text.
 */
export function extractOutputKeywords(output: string, maxKeywords = 30): string[] {
  const words = output
    .toLowerCase()
    .replace(/\x1b\[[0-9;]*[mABCDHJKST]/g, "")
    .replace(/[^a-z0-9\s-_.]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOPWORDS.has(w) && !/^\d+$/.test(w));

  // count frequency
  const freq = new Map<string, number>();
  for (const w of words) freq.set(w, (freq.get(w) ?? 0) + 1);

  // return top N by frequency
  return Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxKeywords)
    .map(([w]) => w);
}

/**
 * Compute keyword overlap between two sessions.
 */
export function computeCorrelation(titleA: string, kwA: string[], titleB: string, kwB: string[]): CorrelationPair {
  const setA = new Set(kwA);
  const setB = new Set(kwB);
  const shared = kwA.filter((w) => setB.has(w));
  const union = new Set([...kwA, ...kwB]).size;
  const similarity = union > 0 ? Math.round((shared.length / union) * 100) : 0;

  return { sessionA: titleA, sessionB: titleB, sharedKeywords: shared, similarityScore: similarity };
}

/**
 * Find all correlated session pairs above a threshold.
 */
export function findCorrelations(sessions: Array<{ title: string; output: string }>, threshold = 15): CorrelationPair[] {
  const keywords = sessions.map((s) => ({ title: s.title, kw: extractOutputKeywords(s.output) }));
  const pairs: CorrelationPair[] = [];

  for (let i = 0; i < keywords.length; i++) {
    for (let j = i + 1; j < keywords.length; j++) {
      const pair = computeCorrelation(keywords[i].title, keywords[i].kw, keywords[j].title, keywords[j].kw);
      if (pair.similarityScore >= threshold) pairs.push(pair);
    }
  }

  return pairs.sort((a, b) => b.similarityScore - a.similarityScore);
}

/**
 * Format correlations for TUI display.
 */
export function formatCorrelationPairs(pairs: CorrelationPair[]): string[] {
  if (pairs.length === 0) return ["  Output Correlation: no related sessions detected"];
  const lines: string[] = [];
  lines.push(`  Output Correlation (${pairs.length} related pairs):`);
  for (const p of pairs.slice(0, 6)) {
    lines.push(`    ${p.sessionA} ↔ ${p.sessionB}: ${p.similarityScore}% (${p.sharedKeywords.slice(0, 5).join(", ")})`);
  }
  return lines;
}
