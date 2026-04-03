// fleet-search.ts — search across all session outputs simultaneously.
// ranked full-text search with match highlighting and session attribution.

export interface SearchHit {
  sessionTitle: string;
  sessionId: string;
  lineNumber: number;
  line: string;
  matchStart: number;
  matchEnd: number;
  score: number;       // relevance score (higher = better match)
}

export interface FleetSearchResult {
  query: string;
  totalHits: number;
  hits: SearchHit[];
  sessionCounts: Map<string, number>; // hits per session
}

/**
 * Search across all session outputs for a pattern.
 * Returns ranked results with match positions.
 */
export function searchFleet(
  sessionOutputs: Map<string, { title: string; lines: string[] }>,
  query: string,
  maxResults = 50,
): FleetSearchResult {
  const hits: SearchHit[] = [];
  const sessionCounts = new Map<string, number>();
  const queryLower = query.toLowerCase();
  const isRegex = query.startsWith("/") && query.endsWith("/");

  let regex: RegExp | null = null;
  if (isRegex) {
    try { regex = new RegExp(query.slice(1, -1), "gi"); }
    catch { regex = null; }
  }

  for (const [sessionId, { title, lines }] of sessionOutputs) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const clean = line.replace(/\x1b\[[0-9;]*[mABCDHJKST]/g, "");

      let matchStart = -1;
      let matchEnd = -1;
      let score = 0;

      if (regex) {
        regex.lastIndex = 0;
        const m = regex.exec(clean);
        if (m) {
          matchStart = m.index;
          matchEnd = m.index + m[0].length;
          score = 10; // regex matches score high
        }
      } else {
        const idx = clean.toLowerCase().indexOf(queryLower);
        if (idx >= 0) {
          matchStart = idx;
          matchEnd = idx + query.length;
          // score: exact case match > case-insensitive, recent lines > old
          score = clean.includes(query) ? 5 : 3;
          score += Math.max(0, (i / lines.length) * 2); // recency boost
        }
      }

      if (matchStart >= 0) {
        hits.push({ sessionTitle: title, sessionId, lineNumber: i + 1, line: clean.slice(0, 200), matchStart, matchEnd, score });
        sessionCounts.set(title, (sessionCounts.get(title) ?? 0) + 1);
      }
    }
  }

  // sort by score desc, then by recency (line number desc)
  hits.sort((a, b) => b.score - a.score || b.lineNumber - a.lineNumber);

  return {
    query,
    totalHits: hits.length,
    hits: hits.slice(0, maxResults),
    sessionCounts,
  };
}

/**
 * Format search results for TUI display.
 */
export function formatFleetSearchResults(result: FleetSearchResult): string[] {
  if (result.totalHits === 0) return [`  fleet-search: no matches for "${result.query}"`];
  const lines: string[] = [];
  lines.push(`  fleet-search: ${result.totalHits} match${result.totalHits !== 1 ? "es" : ""} for "${result.query}" across ${result.sessionCounts.size} session${result.sessionCounts.size !== 1 ? "s" : ""}:`);

  // session summary
  for (const [title, count] of result.sessionCounts) {
    lines.push(`    ${title}: ${count} match${count !== 1 ? "es" : ""}`);
  }
  lines.push("");

  // top hits
  const shown = result.hits.slice(0, 15);
  for (const hit of shown) {
    const preview = hit.line.length > 100 ? hit.line.slice(0, 97) + "..." : hit.line;
    lines.push(`  [${hit.sessionTitle}:${hit.lineNumber}] ${preview}`);
  }
  if (result.hits.length > 15) lines.push(`  ... and ${result.hits.length - 15} more`);

  return lines;
}
