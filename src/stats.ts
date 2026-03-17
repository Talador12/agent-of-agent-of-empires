// stats.ts — aggregate daemon statistics from actions.log and tui-history.jsonl.
// pure exported functions for testability.

import { toActionLogEntry } from "./types.js";
import type { ActionLogEntry } from "./types.js";
import type { HistoryEntry } from "./tui-history.js";
import {
  BOLD, RESET, DIM, GREEN, RED, YELLOW, SLATE, AMBER, LIME, SKY, CYAN,
} from "./colors.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ActionStats {
  total: number;
  succeeded: number;
  failed: number;
  byType: Map<string, number>;
  bySession: Map<string, { total: number; ok: number; fail: number }>;
  firstTs: number;
  lastTs: number;
}

export interface HistoryStats {
  total: number;
  byTag: Map<string, number>;
  byHour: number[];    // 24 buckets (0-23) for heatmap
  firstTs: number;
  lastTs: number;
}

export interface CombinedStats {
  actions: ActionStats | null;
  history: HistoryStats | null;
  timeRange: { start: number; end: number } | null;
}

// ── Parsing ───────────────────────────────────────────────────────────────────

/**
 * Parse action log lines into aggregate stats.
 * Skips malformed lines and wait actions.
 */
export function parseActionStats(
  lines: string[],
  maxAgeMs?: number,
  now?: number,
): ActionStats | null {
  const cutoff = maxAgeMs ? (now ?? Date.now()) - maxAgeMs : 0;
  const byType = new Map<string, number>();
  const bySession = new Map<string, { total: number; ok: number; fail: number }>();
  let total = 0;
  let succeeded = 0;
  let failed = 0;
  let firstTs = Infinity;
  let lastTs = 0;

  for (const line of lines) {
    try {
      const entry = toActionLogEntry(JSON.parse(line));
      if (!entry) continue;
      if (entry.action.action === "wait") continue;
      if (entry.timestamp < cutoff) continue;

      total++;
      if (entry.success) succeeded++;
      else failed++;

      if (entry.timestamp < firstTs) firstTs = entry.timestamp;
      if (entry.timestamp > lastTs) lastTs = entry.timestamp;

      const type = entry.action.action;
      byType.set(type, (byType.get(type) ?? 0) + 1);

      const session = entry.action.title ?? entry.action.session?.slice(0, 8) ?? "unknown";
      const existing = bySession.get(session) ?? { total: 0, ok: 0, fail: 0 };
      existing.total++;
      if (entry.success) existing.ok++;
      else existing.fail++;
      bySession.set(session, existing);
    } catch {
      // skip malformed
    }
  }

  if (total === 0) return null;
  return { total, succeeded, failed, byType, bySession, firstTs, lastTs };
}

/**
 * Parse tui-history entries into aggregate stats.
 */
export function parseHistoryStats(
  entries: HistoryEntry[],
  maxAgeMs?: number,
  now?: number,
): HistoryStats | null {
  const cutoff = maxAgeMs ? (now ?? Date.now()) - maxAgeMs : 0;
  const byTag = new Map<string, number>();
  const byHour = new Array<number>(24).fill(0);
  let total = 0;
  let firstTs = Infinity;
  let lastTs = 0;

  for (const entry of entries) {
    if (entry.ts < cutoff) continue;
    total++;
    if (entry.ts < firstTs) firstTs = entry.ts;
    if (entry.ts > lastTs) lastTs = entry.ts;
    byTag.set(entry.tag, (byTag.get(entry.tag) ?? 0) + 1);
    byHour[new Date(entry.ts).getHours()]++;
  }

  if (total === 0) return null;
  return { total, byTag, byHour, firstTs, lastTs };
}

/**
 * Combine action and history stats into a unified stats object.
 */
export function combineStats(
  actions: ActionStats | null,
  history: HistoryStats | null,
): CombinedStats {
  let start = Infinity;
  let end = 0;
  if (actions) {
    if (actions.firstTs < start) start = actions.firstTs;
    if (actions.lastTs > end) end = actions.lastTs;
  }
  if (history) {
    if (history.firstTs < start) start = history.firstTs;
    if (history.lastTs > end) end = history.lastTs;
  }
  const timeRange = start < Infinity && end > 0 ? { start, end } : null;
  return { actions, history, timeRange };
}

// ── Formatting ────────────────────────────────────────────────────────────────

/**
 * Format a duration in ms as a human-friendly string.
 */
export function formatDuration(ms: number): string {
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s`;
  if (ms < 3_600_000) {
    const m = Math.floor(ms / 60_000);
    const s = Math.floor((ms % 60_000) / 1000);
    return s > 0 ? `${m}m ${s}s` : `${m}m`;
  }
  if (ms < 86_400_000) {
    const h = Math.floor(ms / 3_600_000);
    const m = Math.floor((ms % 3_600_000) / 60_000);
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  const d = Math.floor(ms / 86_400_000);
  const h = Math.floor((ms % 86_400_000) / 3_600_000);
  return h > 0 ? `${d}d ${h}h` : `${d}d`;
}

/**
 * Format a rate as "X per hour" or "X per day".
 */
export function formatRate(count: number, spanMs: number): string {
  if (spanMs <= 0) return `${count} total`;
  const hours = spanMs / 3_600_000;
  if (hours < 1) return `${count} total`;
  const perHour = count / hours;
  if (perHour >= 1) return `${perHour.toFixed(1)}/hr`;
  const perDay = perHour * 24;
  return `${perDay.toFixed(1)}/day`;
}

/**
 * Format the full stats display for terminal output.
 */
export function formatStats(stats: CombinedStats, windowLabel?: string): string {
  const lines: string[] = [];
  const hr = "─".repeat(54);

  lines.push("");
  lines.push(`  ${BOLD}aoaoe — stats${RESET}${windowLabel ? `  ${DIM}(${windowLabel})${RESET}` : ""}`);
  lines.push(`  ${hr}`);

  // time range
  if (stats.timeRange) {
    const { start, end } = stats.timeRange;
    const span = end - start;
    const startStr = new Date(start).toLocaleString();
    const endStr = new Date(end).toLocaleString();
    lines.push(`  ${DIM}from:${RESET}  ${startStr}`);
    lines.push(`  ${DIM}to:${RESET}    ${endStr}`);
    lines.push(`  ${DIM}span:${RESET}  ${formatDuration(span)}`);
  } else {
    lines.push(`  ${DIM}no data found${RESET}`);
    lines.push("");
    return lines.join("\n");
  }

  // actions
  if (stats.actions) {
    const a = stats.actions;
    const span = a.lastTs - a.firstTs;
    const rate = formatRate(a.total, span);

    lines.push("");
    lines.push(`  ${BOLD}actions${RESET}  ${DIM}(${rate})${RESET}`);

    const successRate = a.total > 0 ? Math.round((a.succeeded / a.total) * 100) : 0;
    const successColor = successRate >= 90 ? GREEN : successRate >= 70 ? YELLOW : RED;
    lines.push(`  total:    ${BOLD}${a.total}${RESET}  ${GREEN}${a.succeeded} ok${RESET}  ${a.failed > 0 ? `${RED}${a.failed} failed${RESET}` : `${DIM}0 failed${RESET}`}  ${successColor}(${successRate}%)${RESET}`);

    // by type — sorted by count descending
    const sorted = [...a.byType.entries()].sort((x, y) => y[1] - x[1]);
    for (const [type, count] of sorted) {
      const bar = "█".repeat(Math.min(20, Math.round((count / a.total) * 20)));
      const pct = Math.round((count / a.total) * 100);
      lines.push(`  ${AMBER}${type.padEnd(18)}${RESET} ${String(count).padStart(4)}  ${SLATE}${bar}${RESET} ${DIM}${pct}%${RESET}`);
    }

    // top sessions — sorted by total actions
    if (a.bySession.size > 0) {
      lines.push("");
      lines.push(`  ${BOLD}top sessions${RESET}`);
      const topSessions = [...a.bySession.entries()]
        .sort((x, y) => y[1].total - x[1].total)
        .slice(0, 8);
      for (const [name, counts] of topSessions) {
        const failTag = counts.fail > 0 ? `  ${RED}${counts.fail} fail${RESET}` : "";
        lines.push(`  ${CYAN}${name.padEnd(20)}${RESET} ${String(counts.total).padStart(4)} actions  ${GREEN}${counts.ok} ok${RESET}${failTag}`);
      }
    }
  } else {
    lines.push("");
    lines.push(`  ${DIM}no actions recorded${RESET}`);
  }

  // history activity breakdown
  if (stats.history) {
    const h = stats.history;

    lines.push("");
    lines.push(`  ${BOLD}activity${RESET}  ${DIM}(${h.total} events)${RESET}`);

    const tagOrder = ["observation", "reasoner", "explain", "+ action", "! action", "you", "system", "status"];
    const tagColors: Record<string, string> = {
      "observation": SLATE, "reasoner": SKY, "explain": CYAN,
      "+ action": AMBER, "! action": RED, "action": AMBER, "error": RED,
      "you": LIME, "system": SLATE, "status": SLATE,
    };

    // sort: known tags first in order, then unknown by count
    const knownTags = tagOrder.filter((t) => h.byTag.has(t));
    const unknownTags = [...h.byTag.keys()].filter((t) => !tagOrder.includes(t)).sort((a, b) => (h.byTag.get(b) ?? 0) - (h.byTag.get(a) ?? 0));
    const allTags = [...knownTags, ...unknownTags];

    for (const tag of allTags) {
      const count = h.byTag.get(tag) ?? 0;
      const color = tagColors[tag] ?? SLATE;
      const bar = "█".repeat(Math.min(20, Math.round((count / h.total) * 20)));
      const pct = Math.round((count / h.total) * 100);
      lines.push(`  ${color}${tag.padEnd(18)}${RESET} ${String(count).padStart(4)}  ${SLATE}${bar}${RESET} ${DIM}${pct}%${RESET}`);
    }
  }

  // hourly heatmap
  if (stats.history && stats.history.total > 0) {
    lines.push("");
    lines.push(`  ${BOLD}hourly activity${RESET}`);
    lines.push(`  ${formatHeatmap(stats.history.byHour)}`);
    lines.push(`  ${DIM}${"0".padEnd(6)}${"6".padEnd(6)}${"12".padEnd(6)}${"18".padEnd(5)}23${RESET}`);
  }

  lines.push(`  ${hr}`);
  lines.push("");
  return lines.join("\n");
}

// ── Heatmap ──────────────────────────────────────────────────────────────────

const HEAT_BLOCKS = [" ", "░", "▒", "▓", "█"];

/** Format a 24-element heatmap as a colored block string. */
export function formatHeatmap(counts: number[]): string {
  const max = Math.max(...counts);
  if (max === 0) return DIM + HEAT_BLOCKS[0].repeat(24) + RESET;
  return counts.map((c) => {
    if (c === 0) return `${SLATE}${HEAT_BLOCKS[0]}${RESET}`;
    const level = Math.min(HEAT_BLOCKS.length - 1, Math.ceil((c / max) * (HEAT_BLOCKS.length - 1)));
    const color = level <= 1 ? SLATE : level <= 2 ? SKY : level <= 3 ? AMBER : LIME;
    return `${color}${HEAT_BLOCKS[level]}${RESET}`;
  }).join("");
}
