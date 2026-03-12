// tui-history.ts — persisted TUI activity history
// JSONL file at ~/.aoaoe/tui-history.jsonl with rotation at 500KB.
// pure exported functions for testability — no classes, no singletons.

import { appendFileSync, readFileSync, renameSync, statSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const AOAOE_DIR = join(homedir(), ".aoaoe");
const HISTORY_FILE = join(AOAOE_DIR, "tui-history.jsonl");
const HISTORY_OLD = join(AOAOE_DIR, "tui-history.jsonl.old");
const MAX_FILE_SIZE = 500 * 1024; // 500KB rotation threshold

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
 * Returns empty array if the file doesn't exist or is unreadable.
 */
export function loadTuiHistory(
  maxEntries: number = 200,
  filePath: string = HISTORY_FILE,
): HistoryEntry[] {
  try {
    if (!existsSync(filePath)) return [];
    const content = readFileSync(filePath, "utf-8");
    const lines = content.split("\n").filter((l) => l.trim());
    const recent = lines.slice(-maxEntries);
    const entries: HistoryEntry[] = [];
    for (const line of recent) {
      try {
        const parsed = JSON.parse(line);
        if (isValidEntry(parsed)) entries.push(parsed);
      } catch {
        // skip malformed lines
      }
    }
    return entries;
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
