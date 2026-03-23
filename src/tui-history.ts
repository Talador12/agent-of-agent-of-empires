// tui-history.ts — persisted TUI activity history
// JSONL file at ~/.aoaoe/tui-history.jsonl with rotation at 50MB.
// pure exported functions for testability — no classes, no singletons.

import { appendFileSync, readFileSync, renameSync, statSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const AOAOE_DIR = join(homedir(), ".aoaoe");
const HISTORY_FILE = join(AOAOE_DIR, "tui-history.jsonl");
const HISTORY_OLD = join(AOAOE_DIR, "tui-history.jsonl.old");
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB rotation threshold

/** JSONL entry format — extends ActivityEntry with epoch timestamp for filtering */
export interface HistoryEntry {
  ts: number;    // epoch ms
  time: string;  // "HH:MM:SS"
  tag: string;   // activity tag
  text: string;  // message text
}

/**
 * Append a single history entry to the JSONL file.
 * Fire-and-forget — errors are silently swallowed so they never block the TUI.
 * Rotates the file if it exceeds MAX_FILE_SIZE before appending.
 */
export function appendHistoryEntry(
  entry: HistoryEntry,
  filePath: string = HISTORY_FILE,
  maxSize: number = MAX_FILE_SIZE,
): void {
  try {
    const dir = join(filePath, "..");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    rotateTuiHistory(filePath, maxSize);
    const line = JSON.stringify(entry) + "\n";
    appendFileSync(filePath, line, "utf-8");
  } catch {
    // fire-and-forget — never crash the daemon over history persistence
  }
}

/**
 * Load recent TUI history entries from the JSONL file.
 * Returns the last `maxEntries` entries (default 200), newest last.
 * Filters out entries older than `maxAgeMs` (default: 7 days).
 * Returns empty array if the file doesn't exist or is unreadable.
 */
export function loadTuiHistory(
  maxEntries: number = 200,
  filePath: string = HISTORY_FILE,
  maxAgeMs: number = 7 * 24 * 60 * 60 * 1000,
): HistoryEntry[] {
  try {
    if (!existsSync(filePath)) return [];
    const content = readFileSync(filePath, "utf-8");
    const lines = content.split("\n").filter((l) => l.trim());
    const cutoff = Date.now() - maxAgeMs;
    const recent = lines.slice(-maxEntries * 2); // read extra to compensate for age filtering
    const entries: HistoryEntry[] = [];
    for (const line of recent) {
      try {
        const parsed = JSON.parse(line);
        if (isValidEntry(parsed) && parsed.ts >= cutoff) entries.push(parsed);
      } catch {
        // skip malformed lines
      }
    }
    return entries.slice(-maxEntries);
  } catch {
    return [];
  }
}

/**
 * Rotate the history file if it exceeds the size threshold.
 * Renames current file to .old (overwriting any previous .old) and starts fresh.
 */
export function rotateTuiHistory(
  filePath: string = HISTORY_FILE,
  maxSize: number = MAX_FILE_SIZE,
): boolean {
  try {
    if (!existsSync(filePath)) return false;
    const size = statSync(filePath).size;
    if (size < maxSize) return false;
    const oldPath = filePath + ".old";
    renameSync(filePath, oldPath);
    return true;
  } catch {
    return false;
  }
}

/** Validate that a parsed JSON value has the shape of a HistoryEntry */
function isValidEntry(val: unknown): val is HistoryEntry {
  if (typeof val !== "object" || val === null) return false;
  const obj = val as Record<string, unknown>;
  return (
    typeof obj.ts === "number" &&
    typeof obj.time === "string" &&
    typeof obj.tag === "string" &&
    typeof obj.text === "string"
  );
}

/** Default history file path (for wiring in index.ts) */
export const TUI_HISTORY_FILE = HISTORY_FILE;

export interface HistoryStats {
  totalEntries: number;
  uniqueTags: string[];
  tagCounts: Record<string, number>;   // tag → count, sorted desc
  entriesPerDay: Record<string, number>; // "YYYY-MM-DD" → count
  oldestTs: number | null;
  newestTs: number | null;
  spanDays: number;
}

/**
 * Compute aggregate statistics from a list of history entries.
 * Pure function — no file I/O.
 */
export function computeHistoryStats(entries: readonly HistoryEntry[]): HistoryStats {
  if (entries.length === 0) {
    return { totalEntries: 0, uniqueTags: [], tagCounts: {}, entriesPerDay: {}, oldestTs: null, newestTs: null, spanDays: 0 };
  }

  const tagCounts: Record<string, number> = {};
  const dayMap: Record<string, number> = {};
  let oldest = Infinity, newest = -Infinity;

  for (const e of entries) {
    tagCounts[e.tag] = (tagCounts[e.tag] ?? 0) + 1;
    const day = new Date(e.ts).toISOString().slice(0, 10);
    dayMap[day] = (dayMap[day] ?? 0) + 1;
    if (e.ts < oldest) oldest = e.ts;
    if (e.ts > newest) newest = e.ts;
  }

  // sort tagCounts by count desc
  const sortedTagCounts: Record<string, number> = Object.fromEntries(
    Object.entries(tagCounts).sort(([, a], [, b]) => b - a)
  );
  const spanDays = oldest === Infinity ? 0 : Math.max(1, Math.round((newest - oldest) / 86400000));

  return {
    totalEntries: entries.length,
    uniqueTags: Object.keys(sortedTagCounts),
    tagCounts: sortedTagCounts,
    entriesPerDay: dayMap,
    oldestTs: oldest === Infinity ? null : oldest,
    newestTs: newest === -Infinity ? null : newest,
    spanDays,
  };
}

/**
 * Search history entries by keyword (case-insensitive substring match on text and tag).
 * Returns up to `maxResults` most recent matching entries (newest last).
 * Searches both the current and .old history file.
 */
export function searchHistory(
  keyword: string,
  maxResults = 50,
  filePath: string = HISTORY_FILE,
  maxAgeMs: number = 7 * 24 * 60 * 60 * 1000,
): HistoryEntry[] {
  const lower = keyword.toLowerCase();
  const results: HistoryEntry[] = [];

  // helper: collect matches from one file
  const collectFrom = (fp: string) => {
    try {
      if (!existsSync(fp)) return;
      const content = readFileSync(fp, "utf-8");
      const cutoff = Date.now() - maxAgeMs;
      for (const line of content.split("\n")) {
        if (!line.trim()) continue;
        try {
          const e = JSON.parse(line);
          if (!isValidEntry(e) || e.ts < cutoff) continue;
          if (e.text.toLowerCase().includes(lower) || e.tag.toLowerCase().includes(lower)) {
            results.push(e);
          }
        } catch { /* skip malformed */ }
      }
    } catch { /* ignore unreadable file */ }
  };

  // search .old first (older), then current (newer)
  collectFrom(filePath + ".old");
  collectFrom(filePath);

  // deduplicate by ts+text, sort newest last, cap to maxResults
  const seen = new Set<string>();
  const deduped: HistoryEntry[] = [];
  for (const e of results) {
    const key = `${e.ts}:${e.text}`;
    if (!seen.has(key)) { seen.add(key); deduped.push(e); }
  }
  deduped.sort((a, b) => a.ts - b.ts);
  return deduped.slice(-maxResults);
}
