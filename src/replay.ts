// replay.ts — play back tui-history.jsonl like a movie.
// shows what the daemon did with simulated timing or instant output.
// reuses formatTailEntry from tail.ts for consistent rendering.
// pure exported functions for testability.

import { readFileSync, existsSync } from "node:fs";
import { TUI_HISTORY_FILE, type HistoryEntry } from "./tui-history.js";
import { formatTailEntry, formatTailDate } from "./tail.js";
import { parseDuration } from "./export.js";
import { DIM, RESET, BOLD, SLATE, AMBER } from "./colors.js";

/**
 * Compute the delay between two entries, scaled by speed multiplier.
 * Caps individual delays to prevent long waits on idle periods.
 */
export function computeDelay(
  prevTs: number,
  currTs: number,
  speed: number,
  maxDelayMs: number = 3000,
): number {
  if (speed <= 0) return 0;
  const raw = currTs - prevTs;
  if (raw <= 0) return 0;
  return Math.min(Math.round(raw / speed), maxDelayMs);
}

/**
 * Format a speed multiplier for display.
 */
export function formatSpeed(speed: number): string {
  if (speed <= 0) return "instant";
  if (speed === 1) return "1x (realtime)";
  if (Number.isInteger(speed)) return `${speed}x`;
  return `${speed.toFixed(1)}x`;
}

/**
 * Parse a speed string ("2x", "10x", "0.5x", "instant") into a number.
 * Returns 0 for instant, null for invalid.
 */
export function parseSpeed(input: string): number | null {
  if (input === "instant" || input === "0") return 0;
  const match = input.match(/^(\d+(?:\.\d+)?)x?$/);
  if (!match) return null;
  const val = parseFloat(match[1]);
  if (!isFinite(val) || val < 0) return null;
  return val;
}

/**
 * Filter entries by time window.
 */
export function filterByWindow(
  entries: HistoryEntry[],
  maxAgeMs?: number,
  now?: number,
): HistoryEntry[] {
  if (!maxAgeMs) return entries;
  const cutoff = (now ?? Date.now()) - maxAgeMs;
  return entries.filter((e) => e.ts >= cutoff);
}

/**
 * Build the replay header.
 */
export function formatReplayHeader(
  entries: HistoryEntry[],
  speed: number,
  windowLabel?: string,
): string {
  if (entries.length === 0) return `${DIM}no entries to replay${RESET}`;

  const first = entries[0];
  const last = entries[entries.length - 1];
  const dateRange = formatTailDate(first.ts) === formatTailDate(last.ts)
    ? formatTailDate(first.ts)
    : `${formatTailDate(first.ts)} → ${formatTailDate(last.ts)}`;

  const span = last.ts - first.ts;
  const spanStr = span < 60_000 ? `${Math.floor(span / 1000)}s`
    : span < 3_600_000 ? `${Math.floor(span / 60_000)}m`
    : `${Math.floor(span / 3_600_000)}h ${Math.floor((span % 3_600_000) / 60_000)}m`;

  const speedStr = formatSpeed(speed);
  const windowStr = windowLabel ? ` (${windowLabel})` : "";

  return `${DIM}── replay: ${entries.length} entries, ${dateRange}, span ${spanStr}, ${AMBER}${speedStr}${RESET}${DIM}${windowStr} ──${RESET}`;
}

/**
 * Build the replay footer.
 */
export function formatReplayFooter(entries: HistoryEntry[]): string {
  if (entries.length === 0) return "";
  return `${DIM}── replay complete: ${entries.length} entries ──${RESET}`;
}

/**
 * Sleep for a given number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Load entries from the history file, optionally filtering by time window.
 */
export function loadReplayEntries(
  maxAgeMs?: number,
  filePath: string = TUI_HISTORY_FILE,
): HistoryEntry[] {
  try {
    if (!existsSync(filePath)) return [];
    const content = readFileSync(filePath, "utf-8");
    const lines = content.split("\n").filter((l) => l.trim());
    const entries: HistoryEntry[] = [];
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        if (isValidEntry(parsed)) entries.push(parsed);
      } catch {
        // skip malformed
      }
    }
    return filterByWindow(entries, maxAgeMs);
  } catch {
    return [];
  }
}

/**
 * Run the replay.
 * Prints entries with simulated delays between them.
 * Speed 0 = instant (no delays).
 * Ctrl+C stops playback.
 */
export async function runReplay(opts: {
  speed: number;
  last?: string;
  filePath?: string;
}): Promise<void> {
  const filePath = opts.filePath ?? TUI_HISTORY_FILE;
  const maxAgeMs = opts.last ? parseDuration(opts.last) ?? undefined : undefined;

  if (opts.last && maxAgeMs === undefined) {
    process.stderr.write(`error: --last must be like "1h", "6h", "24h", "7d", got "${opts.last}"\n`);
    process.exit(1);
  }

  const entries = loadReplayEntries(maxAgeMs, filePath);
  const windowLabel = opts.last ?? undefined;

  // header
  process.stderr.write(formatReplayHeader(entries, opts.speed, windowLabel) + "\n");

  if (entries.length === 0) return;

  // Ctrl+C cleanup
  let stopped = false;
  const onSignal = () => { stopped = true; };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  try {
    for (let i = 0; i < entries.length; i++) {
      if (stopped) break;

      // delay between entries
      if (i > 0 && opts.speed > 0) {
        const delay = computeDelay(entries[i - 1].ts, entries[i].ts, opts.speed);
        if (delay > 0) await sleep(delay);
      }

      if (stopped) break;
      process.stderr.write(formatTailEntry(entries[i]) + "\n");
    }
  } finally {
    process.removeListener("SIGINT", onSignal);
    process.removeListener("SIGTERM", onSignal);
  }

  // footer
  if (!stopped) {
    process.stderr.write(formatReplayFooter(entries) + "\n");
  }
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
