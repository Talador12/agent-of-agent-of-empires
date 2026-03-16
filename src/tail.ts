// tail.ts — live-stream daemon activity to a separate terminal.
// reads from tui-history.jsonl, optionally follows for new entries.
// pure exported functions for testability.

import { readFileSync, statSync, existsSync, openSync, readSync, closeSync } from "node:fs";
import { watch, type FSWatcher } from "node:fs";
import { TUI_HISTORY_FILE, type HistoryEntry } from "./tui-history.js";
import {
  SLATE, RESET, DIM, BOLD, CYAN,
  AMBER, ROSE, LIME, SKY,
} from "./colors.js";

/**
 * Format a HistoryEntry as a colorized terminal line.
 * Matches TUI formatActivity style but for plain scrolling output.
 */
export function formatTailEntry(entry: HistoryEntry): string {
  let color = SLATE;
  let prefix = entry.tag;

  switch (entry.tag) {
    case "observation": color = SLATE; prefix = "obs"; break;
    case "reasoner":    color = SKY; break;
    case "explain":     color = `${BOLD}${CYAN}`; prefix = "AI"; break;
    case "+ action": case "action": color = AMBER; prefix = "→ action"; break;
    case "! action": case "error":  color = ROSE; prefix = "✗ error"; break;
    case "you":         color = LIME; break;
    case "system":      color = SLATE; break;
    case "status":      color = SLATE; break;
    default:            color = SLATE; break;
  }

  return `${SLATE}${entry.time}${RESET} ${color}${prefix}${RESET} ${DIM}│${RESET} ${entry.text}`;
}

/**
 * Format a date string for the tail header.
 */
export function formatTailDate(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Load the last N entries from the history file.
 * Returns entries newest-last (chronological order).
 */
export function loadTailEntries(
  count: number,
  filePath: string = TUI_HISTORY_FILE,
): HistoryEntry[] {
  try {
    if (!existsSync(filePath)) return [];
    const content = readFileSync(filePath, "utf-8");
    const lines = content.split("\n").filter((l) => l.trim());
    const entries: HistoryEntry[] = [];
    // read from the end to minimize parsing
    const start = Math.max(0, lines.length - count);
    for (let i = start; i < lines.length; i++) {
      try {
        const parsed = JSON.parse(lines[i]);
        if (isValidEntry(parsed)) entries.push(parsed);
      } catch {
        // skip malformed
      }
    }
    return entries;
  } catch {
    return [];
  }
}

/**
 * Get the current file size (for follow mode to detect appends).
 */
export function getFileSize(filePath: string): number {
  try {
    return statSync(filePath).size;
  } catch {
    return 0;
  }
}

/**
 * Read new bytes appended since a given offset, parse into entries.
 */
export function readNewEntries(
  filePath: string,
  fromByte: number,
): { entries: HistoryEntry[]; newSize: number } {
  try {
    const size = statSync(filePath).size;
    if (size === 0) return { entries: [], newSize: 0 };
    // file was truncated/rotated — read from start
    const start = size < fromByte ? 0 : fromByte;
    if (start === size) return { entries: [], newSize: size };
    const buf = Buffer.alloc(size - start);
    const fd = openSync(filePath, "r");
    readSync(fd, buf, 0, buf.length, start);
    closeSync(fd);
    const text = buf.toString("utf-8");
    const lines = text.split("\n").filter((l) => l.trim());
    const entries: HistoryEntry[] = [];
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        if (isValidEntry(parsed)) entries.push(parsed);
      } catch {
        // skip
      }
    }
    return { entries, newSize: size };
  } catch {
    return { entries: [], newSize: fromByte };
  }
}

/**
 * Print entries to stderr (colorized).
 */
export function printEntries(entries: HistoryEntry[]): void {
  for (const e of entries) {
    process.stderr.write(formatTailEntry(e) + "\n");
  }
}

/**
 * Run the tail command.
 * Without follow: print last N entries, exit.
 * With follow: print last N, then watch for new entries (blocks until Ctrl+C).
 */
export async function runTail(opts: {
  count: number;
  follow: boolean;
  filePath?: string;
}): Promise<void> {
  const filePath = opts.filePath ?? TUI_HISTORY_FILE;

  // print initial entries
  const entries = loadTailEntries(opts.count, filePath);
  if (entries.length === 0) {
    process.stderr.write(`${DIM}no history entries found${RESET}\n`);
    if (!opts.follow) return;
    process.stderr.write(`${DIM}waiting for new entries... (Ctrl+C to stop)${RESET}\n`);
  } else {
    // date header
    const firstDate = formatTailDate(entries[0].ts);
    const lastDate = formatTailDate(entries[entries.length - 1].ts);
    const dateRange = firstDate === lastDate ? firstDate : `${firstDate} → ${lastDate}`;
    process.stderr.write(`${DIM}── ${entries.length} entries (${dateRange}) ──${RESET}\n`);
    printEntries(entries);
  }

  if (!opts.follow) return;

  // follow mode: watch file for changes
  process.stderr.write(`${DIM}── following (Ctrl+C to stop) ──${RESET}\n`);
  let lastSize = getFileSize(filePath);

  return new Promise<void>((_resolve) => {
    let watcher: FSWatcher | null = null;
    try {
      watcher = watch(filePath, { persistent: true }, () => {
        const { entries: newEntries, newSize } = readNewEntries(filePath, lastSize);
        if (newEntries.length > 0) {
          printEntries(newEntries);
        }
        lastSize = newSize;
      });
      watcher.on("error", () => {
        // file may be rotated — try to recover
        lastSize = 0;
      });
    } catch {
      process.stderr.write(`${ROSE}failed to watch ${filePath}${RESET}\n`);
    }

    // Ctrl+C cleanup
    const cleanup = () => {
      if (watcher) { try { watcher.close(); } catch {} }
      process.exit(0);
    };
    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);
  });
}

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
