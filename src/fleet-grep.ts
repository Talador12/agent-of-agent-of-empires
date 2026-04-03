// fleet-grep.ts — regex search across archived session outputs.
// searches gzipped archive files for matches, returning results with context.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { gunzipSync } from "node:zlib";

const ARCHIVE_DIR = join(homedir(), ".aoaoe", "output-archive");

export interface GrepHit {
  archive: string;
  lineNumber: number;
  line: string;
  matchStart: number;
  matchEnd: number;
}

export interface GrepResult {
  pattern: string;
  totalHits: number;
  filesSearched: number;
  hits: GrepHit[];
}

/**
 * Search across all archived outputs for a regex pattern.
 */
export function grepArchives(pattern: string, maxResults = 50, maxFiles = 20): GrepResult {
  if (!existsSync(ARCHIVE_DIR)) return { pattern, totalHits: 0, filesSearched: 0, hits: [] };

  let regex: RegExp;
  try { regex = new RegExp(pattern, "gi"); }
  catch { return { pattern, totalHits: 0, filesSearched: 0, hits: [] }; }

  const files = readdirSync(ARCHIVE_DIR)
    .filter((f) => f.endsWith(".txt.gz"))
    .sort()
    .reverse()
    .slice(0, maxFiles);

  const hits: GrepHit[] = [];
  let totalHits = 0;

  for (const file of files) {
    try {
      const compressed = readFileSync(join(ARCHIVE_DIR, file));
      const content = gunzipSync(compressed).toString("utf-8");
      const lines = content.split("\n");

      for (let i = 0; i < lines.length; i++) {
        regex.lastIndex = 0;
        const match = regex.exec(lines[i]);
        if (match) {
          totalHits++;
          if (hits.length < maxResults) {
            hits.push({
              archive: file,
              lineNumber: i + 1,
              line: lines[i].slice(0, 200),
              matchStart: match.index,
              matchEnd: match.index + match[0].length,
            });
          }
        }
      }
    } catch { /* skip unreadable archives */ }
  }

  return { pattern, totalHits, filesSearched: files.length, hits };
}

/**
 * Format grep results for TUI display.
 */
export function formatGrepResult(result: GrepResult): string[] {
  if (result.totalHits === 0) return [`  fleet-grep: no matches for "${result.pattern}" in ${result.filesSearched} archives`];
  const lines: string[] = [];
  lines.push(`  fleet-grep: ${result.totalHits} match${result.totalHits !== 1 ? "es" : ""} for "${result.pattern}" in ${result.filesSearched} archives:`);
  for (const h of result.hits.slice(0, 15)) {
    const preview = h.line.length > 80 ? h.line.slice(0, 77) + "..." : h.line;
    lines.push(`  [${h.archive.slice(0, 30)}:${h.lineNumber}] ${preview}`);
  }
  if (result.hits.length > 15) lines.push(`  ... and ${result.hits.length - 15} more`);
  return lines;
}
