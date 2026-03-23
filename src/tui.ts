// tui.ts — block-style terminal UI for aoaoe daemon
// OpenCode-inspired design: box-drawn panels, 256-color palette, phase spinner,
// visual hierarchy. no external deps — raw ANSI escape codes only.
//
// layout (top to bottom):
//   ┌─ header bar (1 row, BG_DARK) ─────────────────────────────────────────┐
//   │ sessions panel (box-drawn, 1 row per session + 2 border rows)         │
//   ├─ separator with hints ────────────────────────────────────────────────┤
//   │ activity scroll region (all daemon output scrolls here)               │
//   └─ input line (phase-aware prompt) ─────────────────────────────────────┘
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { DaemonSessionState, DaemonPhase } from "./types.js";
import {
  BOLD, DIM, RESET, GREEN, YELLOW, RED, CYAN, WHITE,
  BG_DARK, BG_HOVER,
  INDIGO, TEAL, AMBER, SLATE, ROSE, LIME, SKY,
  BOX, SPINNER, DOT,
} from "./colors.js";
import { appendHistoryEntry } from "./tui-history.js";
import type { HistoryEntry } from "./tui-history.js";

// ── ANSI helpers ────────────────────────────────────────────────────────────

const ESC = "\x1b";
const CSI = `${ESC}[`;

// screen management
const ALT_SCREEN_ON = `${CSI}?1049h`;
const ALT_SCREEN_OFF = `${CSI}?1049l`;
const CLEAR_SCREEN = `${CSI}2J`;
const CLEAR_LINE = `${CSI}2K`;
const CURSOR_HIDE = `${CSI}?25l`;
const CURSOR_SHOW = `${CSI}?25h`;
const SAVE_CURSOR = `${ESC}7`;
const RESTORE_CURSOR = `${ESC}8`;

// mouse tracking (SGR extended mode — any-event tracking + extended coordinates)
// ?1003h = report all mouse events including motion (needed for hover)
// ?1006h = SGR extended format (supports large coordinates)
const MOUSE_ON = `${CSI}?1003h${CSI}?1006h`;
const MOUSE_OFF = `${CSI}?1003l${CSI}?1006l`;

// cursor movement
const moveTo = (row: number, col: number) => `${CSI}${row};${col}H`;
const setScrollRegion = (top: number, bottom: number) => `${CSI}${top};${bottom}r`;
const resetScrollRegion = () => `${CSI}r`;

// ── Sort modes ──────────────────────────────────────────────────────────────

export type SortMode = "default" | "status" | "name" | "activity";
const SORT_MODES: SortMode[] = ["default", "status", "name", "activity"];

const STATUS_PRIORITY: Record<string, number> = {
  error: 0, waiting: 1, working: 2, running: 2,
  idle: 3, done: 4, stopped: 5, unknown: 6,
};

/** Sort sessions by mode. Pinned sessions always sort first (stable). Returns a new array (never mutates). */
function sortSessions(
  sessions: DaemonSessionState[],
  mode: SortMode,
  lastChangeAt?: Map<string, number>,
  pinnedIds?: Set<string>,
): DaemonSessionState[] {
  const copy = sessions.slice();
  switch (mode) {
    case "status":
      copy.sort((a, b) => (STATUS_PRIORITY[a.status] ?? 6) - (STATUS_PRIORITY[b.status] ?? 6));
      break;
    case "name":
      copy.sort((a, b) => a.title.toLowerCase().localeCompare(b.title.toLowerCase()));
      break;
    case "activity":
      copy.sort((a, b) => (lastChangeAt?.get(b.id) ?? 0) - (lastChangeAt?.get(a.id) ?? 0));
      break;
    // "default" — preserve original order
  }
  // stable-sort pinned to top (preserves mode order within each group)
  if (pinnedIds && pinnedIds.size > 0) {
    copy.sort((a, b) => (pinnedIds.has(a.id) ? 0 : 1) - (pinnedIds.has(b.id) ? 0 : 1));
  }
  return copy;
}

/** Cycle to the next sort mode. */
function nextSortMode(current: SortMode): SortMode {
  const idx = SORT_MODES.indexOf(current);
  return SORT_MODES[(idx + 1) % SORT_MODES.length];
}

// ── Bell notifications ──────────────────────────────────────────────────────

/** Cooldown between terminal bells to avoid buzzing. */
export const BELL_COOLDOWN_MS = 5000;

/** Determine if an activity entry should trigger a terminal bell. High-signal events only. */
export function shouldBell(tag: string, text: string): boolean {
  if (tag === "! action" || tag === "error") return true;
  if (tag === "+ action" && text.toLowerCase().includes("complete")) return true;
  return false;
}

// ── Bookmarks ───────────────────────────────────────────────────────────────

export interface Bookmark {
  index: number;  // activity buffer index at time of bookmarking
  label: string;  // auto-generated from entry: "HH:MM:SS tag"
}

/** Max number of bookmarks. */
export const MAX_BOOKMARKS = 20;

/**
 * Compute the scroll offset needed to show a bookmarked entry.
 * Centers the entry in the visible region when possible.
 * Returns 0 (live) if the entry is within the visible tail.
 */
export function computeBookmarkOffset(
  bookmarkIndex: number,
  bufferLen: number,
  visibleLines: number,
): number {
  // entry position from the end of the buffer
  const fromEnd = bufferLen - 1 - bookmarkIndex;
  // if entry is within the visible tail, no scroll needed
  if (fromEnd < visibleLines) return 0;
  // center the entry in the visible region
  const half = Math.floor(visibleLines / 2);
  return Math.max(0, fromEnd - half);
}

// ── Compact mode ────────────────────────────────────────────────────────────

/** Max name length in compact token. */
const COMPACT_NAME_LEN = 10;

/** Pin indicator for pinned sessions. */
const PIN_ICON = "▲";

/**
 * Format sessions as inline compact tokens, wrapped to fit maxWidth.
 * Each token: "{idx}{pin?}{mute?}{dot}{name}{health?}" — e.g. "1▲●Alpha" for pinned, "2◌●Bravo" for muted.
 * Returns array of formatted row strings (one per display row).
 */
function formatCompactRows(sessions: DaemonSessionState[], maxWidth: number, pinnedIds?: Set<string>, mutedIds?: Set<string>, noteIds?: Set<string>, healthScores?: Map<string, number>, activityRates?: Map<string, number>): string[] {
  if (sessions.length === 0) return [`${DIM}no agents connected${RESET}`];

  const tokens: string[] = [];
  const widths: number[] = [];

  for (let i = 0; i < sessions.length; i++) {
    const s = sessions[i];
    const idx = String(i + 1);
    const dot = STATUS_DOT[s.status] ?? `${AMBER}${DOT.filled}${RESET}`;
    const pinned = pinnedIds?.has(s.id) ?? false;
    const muted = mutedIds?.has(s.id) ?? false;
    const noted = noteIds?.has(s.id) ?? false;
    const pin = pinned ? `${AMBER}${PIN_ICON}${RESET}` : "";
    const muteIcon = muted ? `${DIM}${MUTE_ICON}${RESET}` : "";
    const noteIcon = noted ? `${TEAL}${NOTE_ICON}${RESET}` : "";
    const name = truncatePlain(s.title, COMPACT_NAME_LEN);
    // health indicator: single ⬡ glyph when score < HEALTH_GOOD, colored by severity
    const score = healthScores?.get(s.id);
    const healthGlyph = (score !== undefined && score < HEALTH_GOOD)
      ? `${score < HEALTH_WARN ? ROSE : AMBER}${HEALTH_ICON}${RESET}` : "";
    const healthWidth = (score !== undefined && score < HEALTH_GOOD) ? 1 : 0;
    // activity rate badge: "3/m" when rate > 0
    const rate = activityRates?.get(s.id) ?? 0;
    const rateBadge = formatActivityRateBadge(rate);
    const rateVisible = rateBadge ? stripAnsiForLen(rateBadge) : 0;
    tokens.push(`${SLATE}${idx}${RESET}${pin}${muteIcon}${noteIcon}${dot}${BOLD}${name}${RESET}${healthGlyph}${rateBadge}`);
    widths.push(idx.length + (pinned ? 1 : 0) + (muted ? 1 : 0) + (noted ? 1 : 0) + 1 + name.length + healthWidth + rateVisible);
  }

  const rows: string[] = [];
  let currentRow = "";
  let currentWidth = 0;

  for (let i = 0; i < tokens.length; i++) {
    const gap = currentWidth > 0 ? 2 : 0;
    if (currentWidth + gap + widths[i] > maxWidth && currentWidth > 0) {
      rows.push(currentRow);
      currentRow = tokens[i];
      currentWidth = widths[i];
    } else {
      currentRow += (currentWidth > 0 ? "  " : "") + tokens[i];
      currentWidth += gap + widths[i];
    }
  }
  if (currentRow) rows.push(currentRow);
  return rows;
}

/** Compute how many display rows compact mode needs (minimum 1). */
function computeCompactRowCount(sessions: DaemonSessionState[], maxWidth: number): number {
  return Math.max(1, formatCompactRows(sessions, maxWidth).length);
}

// ── Activity rate helpers (pure, exported for testing) ───────────────────────

/** Window for computing per-session activity rate (5 minutes). */
export const ACTIVITY_RATE_WINDOW_MS = 5 * 60_000;

/**
 * Compute messages-per-minute for a session from the activity buffer.
 * Only counts entries within the last ACTIVITY_RATE_WINDOW_MS.
 * Returns 0 when no activity in window.
 */
export function computeSessionActivityRate(
  buffer: readonly { sessionId?: string }[],
  timestamps: readonly number[],
  sessionId: string,
  now?: number,
  windowMs = ACTIVITY_RATE_WINDOW_MS,
): number {
  const nowMs = now ?? Date.now();
  const cutoff = nowMs - windowMs;
  let count = 0;
  for (let i = 0; i < buffer.length; i++) {
    if (buffer[i].sessionId === sessionId && (timestamps[i] ?? 0) >= cutoff) count++;
  }
  return count === 0 ? 0 : (count / windowMs) * 60_000;
}

/**
 * Format activity rate as a compact badge for compact mode tokens.
 * Returns empty string when rate is 0 (no clutter for quiet sessions).
 * Format: "3/m" (rounded to nearest integer messages/min).
 */
export function formatActivityRateBadge(rate: number): string {
  if (rate <= 0) return "";
  const rounded = Math.max(1, Math.round(rate));
  return `${DIM}${rounded}/m${RESET}`;
}

// ── Header status tag helpers (pure, exported for testing) ──────────────────

/** Format watchdog status tag for the header (empty string when disabled). */
export function formatWatchdogTag(thresholdMs: number | null): string {
  if (thresholdMs === null) return "";
  const mins = Math.round(thresholdMs / 60_000);
  return `⊛${mins}m`;
}

/** Format group filter tag for the header (empty string when no filter). */
export function formatGroupFilterTag(groupFilter: string | null): string {
  if (!groupFilter) return "";
  return `${GROUP_ICON}${groupFilter}`;
}

// ── Status rendering ────────────────────────────────────────────────────────

const STATUS_DOT: Record<string, string> = {
  working: `${LIME}${DOT.filled}${RESET}`,
  running: `${LIME}${DOT.filled}${RESET}`,
  idle:    `${SLATE}${DOT.hollow}${RESET}`,
  waiting: `${AMBER}${DOT.half}${RESET}`,
  done:    `${GREEN}${DOT.filled}${RESET}`,
  error:   `${ROSE}${DOT.filled}${RESET}`,
  stopped: `${SLATE}${DOT.hollow}${RESET}`,
};

// phase colors and labels
function phaseDisplay(phase: DaemonPhase, paused: boolean, spinnerFrame: number): string {
  if (paused) return `${AMBER}${BOLD}PAUSED${RESET}`;
  const frame = SPINNER[spinnerFrame % SPINNER.length];
  switch (phase) {
    case "reasoning":  return `${SKY}${frame} reasoning${RESET}`;
    case "executing":  return `${AMBER}${frame} executing${RESET}`;
    case "polling":    return `${LIME}${frame} polling${RESET}`;
    case "interrupted": return `${ROSE}${BOLD}interrupted${RESET}`;
    case "sleeping":   return `${SLATE}sleeping${RESET}`;
    default:           return `${SLATE}${phase}${RESET}`;
  }
}

// ── Activity log entry ──────────────────────────────────────────────────────

export interface ActivityEntry {
  time: string;   // "HH:MM:SS"
  tag: string;    // "observation", "reasoner", "explain", "+ action", "! action", "you", "system", "status"
  text: string;   // the message
  sessionId?: string; // optional: ties entry to a specific session (for muting)
}

// ── Mute helpers ──────────────────────────────────────────────────────────────

/** Mute indicator for muted sessions (shown dim beside session card). */
const MUTE_ICON = "◌";

// ── Notes ─────────────────────────────────────────────────────────────────────

/** Note indicator for sessions with notes. */
const NOTE_ICON = "✎";

/** Max length for a session note (visible chars). */
export const MAX_NOTE_LEN = 80;

/** Truncate a note to the max length. */
export function truncateNote(text: string): string {
  return text.length > MAX_NOTE_LEN ? text.slice(0, MAX_NOTE_LEN - 2) + ".." : text;
}

/** Determine if an activity entry should be hidden due to muting. */
export function shouldMuteEntry(entry: ActivityEntry, mutedIds: Set<string>): boolean {
  if (!entry.sessionId) return false;
  return mutedIds.has(entry.sessionId);
}

/** Format a suppressed entry count badge for muted sessions. Returns empty string for 0. */
export function formatMuteBadge(count: number): string {
  if (count <= 0) return "";
  const label = count > 999 ? "999+" : String(count);
  return `${DIM}(${label})${RESET}`;
}

/** Check if an activity entry matches a tag filter (case-insensitive, supports pipe-separated multi-tag). */
export function matchesTagFilter(entry: ActivityEntry, tag: string): boolean {
  if (!tag) return true;
  const lower = entry.tag.toLowerCase();
  if (tag.includes("|")) return tag.toLowerCase().split("|").some((t) => lower === t.trim());
  return lower === tag.toLowerCase();
}

/** Built-in filter presets: name → pipe-separated tag pattern. */
export const FILTER_PRESETS: Record<string, string> = {
  errors: "error|! action",
  actions: "+ action|! action",
  system: "system|status",
  config: "config",
};

/** Resolve a filter string — expands preset names, returns raw tag otherwise. */
export function resolveFilterPreset(input: string): string {
  return FILTER_PRESETS[input.toLowerCase()] ?? input;
}

/** Format the tag filter indicator text for the separator bar. */
export function formatTagFilterIndicator(tag: string, matchCount: number, totalCount: number): string {
  return `${SLATE}filter:${RESET} ${AMBER}${tag}${RESET} ${DIM}(${matchCount}/${totalCount})${RESET}`;
}

// ── Clip ─────────────────────────────────────────────────────────────────────

/** Default number of entries for /clip when no count specified. */
export const CLIP_DEFAULT_COUNT = 20;

/** Format activity entries as plain text for clipboard/export. One line per entry. */
export function formatClipText(entries: readonly ActivityEntry[], n?: number): string {
  const count = n ?? CLIP_DEFAULT_COUNT;
  const slice = entries.slice(-Math.max(1, count));
  return slice.map((e) => `[${e.time}] ${e.tag}: ${e.text}`).join("\n") + "\n";
}

// ── Auto-pin ─────────────────────────────────────────────────────────────────

/** Determine if a log entry should trigger auto-pin (error-like tags). */
export function shouldAutoPin(tag: string): boolean {
  const lower = tag.toLowerCase();
  return lower === "! action" || lower === "error";
}

// ── Uptime ───────────────────────────────────────────────────────────────────

/** Format milliseconds as human-readable uptime: "2h 15m", "45m", "3d 2h", "< 1m". */
export function formatUptime(ms: number): string {
  if (ms < 0) return "< 1m";
  const totalMin = Math.floor(ms / 60_000);
  if (totalMin < 1) return "< 1m";
  const days = Math.floor(totalMin / 1440);
  const hours = Math.floor((totalMin % 1440) / 60);
  const minutes = totalMin % 60;
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  return `${minutes}m`;
}

// ── Idle-since formatting ─────────────────────────────────────────────────────

/**
 * Format milliseconds since last activity as a human-readable "idle N" string.
 * Returns empty string if under threshold (< thresholdMs, default 2 min — not worth showing).
 */
export function formatIdleSince(ms: number, thresholdMs = 2 * 60_000): string {
  if (ms < 0 || ms < thresholdMs) return "";
  return `idle ${formatUptime(ms)}`;
}

// ── Error trend (pure, exported for testing) ──────────────────────────────────

/** Error trend: compare recent half of window vs older half. */
export type ErrorTrend = "rising" | "stable" | "falling";

/**
 * Compute error trend from a list of recent error timestamps.
 * Splits the window in half; if recent half has significantly more → rising, fewer → falling.
 * "Significant" = difference of at least 1 error.
 */
export function computeErrorTrend(
  timestamps: readonly number[],
  now?: number,
  windowMs = 10 * 60_000,
): ErrorTrend {
  if (timestamps.length === 0) return "stable";
  const nowMs = now ?? Date.now();
  const cutoff = nowMs - windowMs;
  const halfMs = windowMs / 2;
  const midpoint = nowMs - halfMs;
  let older = 0, newer = 0;
  for (const ts of timestamps) {
    if (ts < cutoff) continue;
    if (ts < midpoint) older++;
    else newer++;
  }
  if (newer > older) return "rising";
  if (older > newer) return "falling";
  return "stable";
}

/** Format error trend as a directional arrow. */
export function formatErrorTrend(trend: ErrorTrend): string {
  switch (trend) {
    case "rising":  return `${ROSE}↑${RESET}`;
    case "falling": return `${LIME}↓${RESET}`;
    default:        return `${SLATE}→${RESET}`;
  }
}

// ── Session timeline (pure, exported for testing) ────────────────────────────

/** Default number of entries shown by /timeline. */
export const TIMELINE_DEFAULT_COUNT = 30;

/**
 * Filter the activity buffer to entries for a specific session, most-recent-last.
 * Returns up to `count` entries.
 */
export function filterSessionTimeline(
  buffer: readonly ActivityEntry[],
  sessionId: string,
  count = TIMELINE_DEFAULT_COUNT,
): ActivityEntry[] {
  const matching = buffer.filter((e) => e.sessionId === sessionId);
  return matching.slice(-count);
}

// ── Quiet status (pure, exported for testing) ────────────────────────────────

/**
 * Given quiet-hours ranges and current hour, return a human-readable status string.
 * Returns { active, message } where message explains current state.
 */
export function formatQuietStatus(
  ranges: ReadonlyArray<[number, number]>,
  now?: Date,
): { active: boolean; message: string } {
  if (ranges.length === 0) return { active: false, message: "quiet hours not configured" };
  const d = now ?? new Date();
  const hour = d.getHours();
  const active = isQuietHour(hour, ranges);
  const rangeStrs = ranges.map(([s, e]) => `${String(s).padStart(2, "0")}:00–${String(e).padStart(2, "0")}:00`);
  if (active) {
    return { active: true, message: `quiet hours ACTIVE — alerts suppressed (${rangeStrs.join(", ")})` };
  }
  return { active: false, message: `quiet hours inactive — configured: ${rangeStrs.join(", ")}` };
}

// ── Session age (pure, exported for testing) ──────────────────────────────────

/**
 * Parse a session creation time from an ISO 8601 string.
 * Returns null if unparseable.
 */
export function parseSessionAge(createdAt: string | undefined, now?: number): number | null {
  if (!createdAt) return null;
  const ts = Date.parse(createdAt);
  if (isNaN(ts)) return null;
  return (now ?? Date.now()) - ts;
}

/** Format session age as compact string: "3d", "2h", "45m", "< 1m". */
export function formatSessionAge(createdAt: string | undefined, now?: number): string {
  const ms = parseSessionAge(createdAt, now);
  if (ms === null) return "";
  return formatUptime(ms);
}

// ── Health history (pure, exported for testing) ───────────────────────────────

/** Max health score snapshots stored per session. */
export const MAX_HEALTH_HISTORY = 20;

export interface HealthSnapshot {
  score: number;
  ts: number; // epoch ms
}

/**
 * Format health history as a compact 5-bucket sparkline.
 * Each bucket covers 1/5 of the history window. Color: LIME/AMBER/ROSE by value.
 */
export function formatHealthSparkline(history: readonly HealthSnapshot[], now?: number): string {
  if (history.length === 0) return "";
  const BUCKETS = 5;
  const WINDOW_MS = 30 * 60_000; // last 30 minutes
  const nowMs = now ?? Date.now();
  const cutoff = nowMs - WINDOW_MS;
  const recent = history.filter((h) => h.ts >= cutoff);
  if (recent.length === 0) return "";
  const bucketMs = WINDOW_MS / BUCKETS;
  const buckets: number[] = Array(BUCKETS).fill(-1); // -1 = no data
  for (const h of recent) {
    const idx = Math.min(BUCKETS - 1, Math.floor((h.ts - cutoff) / bucketMs));
    // take the most recent reading per bucket
    if (buckets[idx] === -1 || h.ts > (recent.find((r) => r.ts >= cutoff + idx * bucketMs)?.ts ?? 0)) {
      buckets[idx] = h.score;
    }
  }
  return buckets.map((score) => {
    if (score === -1) return `${DIM}·${RESET}`;
    const color = score >= HEALTH_GOOD ? LIME : score >= HEALTH_WARN ? AMBER : ROSE;
    return `${color}${SPARK_BLOCKS[Math.min(SPARK_BLOCKS.length - 1, Math.floor(score / 100 * (SPARK_BLOCKS.length - 1)))]}${RESET}`;
  }).join("");
}

// ── Health trend chart (pure, exported for testing) ───────────────────────────

/**
 * Format health score history as a multi-line ASCII bar chart.
 * Returns an array of lines suitable for logging to the activity area.
 * Each column is one snapshot, ordered oldest→newest.
 * Bar height 0–8 rows. Color: LIME/AMBER/ROSE.
 */
export function formatHealthTrendChart(
  history: readonly HealthSnapshot[],
  title: string,
  height = 6,
): string[] {
  if (history.length === 0) return [`  ${title}: no health history`];
  const MAX_COLS = 40;
  const samples = history.slice(-MAX_COLS);
  const lines: string[] = [];

  // header
  const minScore = Math.min(...samples.map((h) => h.score));
  const maxScore = Math.max(...samples.map((h) => h.score));
  lines.push(`  ${DIM}${title}${RESET} health trend (${samples.length} samples, ${minScore}–${maxScore})`);

  // chart rows (top = high score, bottom = low score)
  for (let row = height - 1; row >= 0; row--) {
    const threshold = Math.round(((row + 1) / height) * 100);
    const prevThreshold = Math.round((row / height) * 100);
    const yLabel = row === height - 1 ? "100" : row === 0 ? "  0" : `   `;
    const bar = samples.map((h) => {
      if (h.score >= threshold) {
        const color = h.score >= HEALTH_GOOD ? LIME : h.score >= HEALTH_WARN ? AMBER : ROSE;
        return `${color}█${RESET}`;
      }
      if (h.score >= prevThreshold) {
        const color = h.score >= HEALTH_GOOD ? LIME : h.score >= HEALTH_WARN ? AMBER : ROSE;
        return `${color}▄${RESET}`;
      }
      return `${DIM}·${RESET}`;
    }).join("");
    lines.push(`  ${DIM}${yLabel}${RESET}│${bar}`);
  }
  lines.push(`     └${"─".repeat(samples.length)}`);

  return lines;
}

// ── Session flap detection (pure, exported for testing) ────────────────────────

/** Status change entry for flap detection. */
export interface StatusChange {
  status: string;
  ts: number;
}

/** Max status change entries stored per session. */
export const MAX_STATUS_HISTORY = 30;

/** Flap detection window: check for oscillation in the last N minutes. */
export const FLAP_WINDOW_MS = 10 * 60_000;

/** Min status changes in window to be considered flapping. */
export const FLAP_THRESHOLD = 5;

/**
 * Detect if a session is "flapping" — rapidly oscillating between statuses.
 * Returns true when there are >= FLAP_THRESHOLD status changes in FLAP_WINDOW_MS.
 */
export function isFlapping(
  changes: readonly StatusChange[],
  now?: number,
  windowMs = FLAP_WINDOW_MS,
  threshold = FLAP_THRESHOLD,
): boolean {
  const cutoff = (now ?? Date.now()) - windowMs;
  const recent = changes.filter((c) => c.ts >= cutoff);
  return recent.length >= threshold;
}

// ── Alert mute patterns (pure, exported for testing) ──────────────────────────

/**
 * Check if an alert text matches any suppressed pattern (case-insensitive substring).
 * Returns true when the alert should be hidden.
 */
export function isAlertMuted(text: string, patterns: ReadonlySet<string>): boolean {
  if (patterns.size === 0) return false;
  const lower = text.toLowerCase();
  for (const p of patterns) {
    if (lower.includes(p.toLowerCase())) return true;
  }
  return false;
}

// ── Cost summary (pure, exported for testing) ────────────────────────────────

/**
 * Parse a cost string like "$3.42" → 3.42, or null if unparseable.
 */
export function parseCostValue(costStr: string | undefined): number | null {
  if (!costStr) return null;
  const m = costStr.match(/\$?([\d.]+)/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return isNaN(n) ? null : n;
}

export interface CostSummaryEntry {
  sessionId: string;
  title: string;
  costStr: string;
  costValue: number;
}

export interface CostSummary {
  total: number;
  totalStr: string;
  entries: CostSummaryEntry[]; // sorted by cost desc
  sessionCount: number;
}

/**
 * Compute a cost summary across all sessions.
 * Sessions without cost data are excluded.
 */
export function computeCostSummary(
  sessions: readonly DaemonSessionState[],
  costMap: ReadonlyMap<string, string>,
): CostSummary {
  const entries: CostSummaryEntry[] = [];
  for (const s of sessions) {
    const costStr = costMap.get(s.id);
    if (!costStr) continue;
    const costValue = parseCostValue(costStr);
    if (costValue === null) continue;
    entries.push({ sessionId: s.id, title: s.title, costStr, costValue });
  }
  entries.sort((a, b) => b.costValue - a.costValue);
  const total = entries.reduce((sum, e) => sum + e.costValue, 0);
  return {
    total,
    totalStr: `$${total.toFixed(2)}`,
    entries,
    sessionCount: entries.length,
  };
}

// ── Session report (pure, exported for testing) ───────────────────────────────

export interface SessionReportData {
  title: string;
  status: string;
  tool: string;
  group?: string;
  color?: string;
  tags: string[];
  note?: string;
  health: number;
  errors: number;
  errorTrend?: ErrorTrend;
  costStr?: string;
  contextTokens?: string;
  uptimeMs?: number;
  idleSinceMs?: number;
  burnRatePerMin?: number | null;
  goalHistory: string[];
  recentTimeline: ActivityEntry[];
  exportedAt: string;
}

/** Format a session report as a Markdown document. */
export function formatSessionReport(data: SessionReportData): string {
  const lines: string[] = [];
  lines.push(`# Session Report: ${data.title}`);
  lines.push(`_Generated: ${data.exportedAt}_`);
  lines.push("");
  lines.push("## Overview");
  lines.push(`- **Status:** ${data.status}`);
  lines.push(`- **Tool:** ${data.tool}`);
  if (data.group) lines.push(`- **Group:** ${data.group}`);
  if (data.tags.length > 0) lines.push(`- **Tags:** ${data.tags.join(", ")}`);
  if (data.color) lines.push(`- **Color:** ${data.color}`);
  if (data.note) lines.push(`- **Note:** ${data.note}`);
  lines.push("");
  lines.push("## Health");
  const trendStr = data.errorTrend === "rising" ? " ↑" : data.errorTrend === "falling" ? " ↓" : "";
  lines.push(`- **Score:** ${data.health}/100`);
  lines.push(`- **Errors:** ${data.errors}${trendStr}`);
  if (data.costStr) lines.push(`- **Cost:** ${data.costStr}`);
  if (data.contextTokens) lines.push(`- **Context:** ${data.contextTokens}`);
  if (data.uptimeMs !== undefined) lines.push(`- **Uptime:** ${formatUptime(data.uptimeMs)}`);
  if (data.idleSinceMs !== undefined) {
    const idleLabel = formatIdleSince(data.idleSinceMs);
    if (idleLabel) lines.push(`- **Idle:** ${idleLabel}`);
  }
  if (data.burnRatePerMin !== null && data.burnRatePerMin !== undefined && data.burnRatePerMin > 0) {
    lines.push(`- **Burn rate:** ~${Math.round(data.burnRatePerMin / 100) * 100} tokens/min`);
  }
  lines.push("");
  if (data.goalHistory.length > 0) {
    lines.push("## Goal History");
    for (let i = data.goalHistory.length - 1; i >= 0; i--) {
      lines.push(`- ${data.goalHistory[i]}`);
    }
    lines.push("");
  }
  if (data.recentTimeline.length > 0) {
    lines.push("## Recent Activity");
    for (const e of data.recentTimeline.slice(-20)) {
      lines.push(`- \`${e.time}\` **${e.tag}** ${e.text}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

// ── Session cost budget (pure, exported for testing) ─────────────────────────

/** Check if a cost string exceeds a budget value. Returns true when over budget. */
export function isOverBudget(costStr: string | undefined, budgetUSD: number): boolean {
  if (!costStr) return false;
  const val = parseCostValue(costStr);
  return val !== null && val > budgetUSD;
}

/** Format a budget-exceeded alert message. */
export function formatBudgetAlert(title: string, costStr: string, budgetUSD: number): string {
  return `${title}: cost ${costStr} exceeded budget $${budgetUSD.toFixed(2)}`;
}

// ── Duplicate session helpers (pure, exported for testing) ───────────────────

/**
 * Build args for duplicating a session: given a source session, return
 * { path, tool, title } for use in a create_agent action.
 * Returns null if source session not found or path/tool missing.
 */
export function buildDuplicateArgs(
  sessions: readonly DaemonSessionState[],
  sessionIdOrIndex: string | number,
  newTitle?: string,
): { path: string; tool: string; title: string } | null {
  let s: DaemonSessionState | undefined;
  if (typeof sessionIdOrIndex === "number") {
    s = sessions[sessionIdOrIndex - 1];
  } else {
    const needle = sessionIdOrIndex.toLowerCase();
    s = sessions.find(
      (x) => x.id === sessionIdOrIndex || x.id.startsWith(needle) || x.title.toLowerCase() === needle,
    );
  }
  if (!s || !s.path || !s.tool) return null;
  return {
    path: s.path,
    tool: s.tool,
    title: newTitle?.trim() || `${s.title}-copy`,
  };
}

// ── Quiet hours (pure, exported for testing) ──────────────────────────────────

/**
 * Check whether a given hour (0-23) falls within any quiet-hour range.
 * Ranges are inclusive, e.g. "22-06" wraps midnight.
 */
export function isQuietHour(hour: number, ranges: ReadonlyArray<[number, number]>): boolean {
  for (const [start, end] of ranges) {
    if (start <= end) {
      if (hour >= start && hour <= end) return true;
    } else {
      // wraps midnight
      if (hour >= start || hour <= end) return true;
    }
  }
  return false;
}

/**
 * Parse a quiet-hours string like "22-06" or "09-17" into a [start, end] tuple.
 * Returns null if invalid.
 */
export function parseQuietHoursRange(spec: string): [number, number] | null {
  const m = spec.trim().match(/^(\d{1,2})-(\d{1,2})$/);
  if (!m) return null;
  const start = parseInt(m[1], 10);
  const end = parseInt(m[2], 10);
  if (start < 0 || start > 23 || end < 0 || end > 23) return null;
  return [start, end];
}

// ── Session accent colors (pure, exported for testing) ────────────────────────

/** Supported accent color names for /color command. */
export const SESSION_COLOR_NAMES = ["lime", "amber", "rose", "teal", "sky", "slate", "indigo", "cyan"] as const;
export type SessionColorName = typeof SESSION_COLOR_NAMES[number];

const SESSION_COLOR_MAP: Record<SessionColorName, string> = {
  lime:   LIME,
  amber:  AMBER,
  rose:   ROSE,
  teal:   TEAL,
  sky:    SKY,
  slate:  SLATE,
  indigo: INDIGO,
  cyan:   CYAN,
};

/** Validate a color name. Returns null if valid, error string otherwise. */
export function validateColorName(name: string): string | null {
  if ((SESSION_COLOR_NAMES as readonly string[]).includes(name.toLowerCase())) return null;
  return `unknown color "${name}" — valid: ${SESSION_COLOR_NAMES.join(", ")}`;
}

/** Format a session color dot prefix for use in cards. Returns empty string for unknown colors. */
export function formatColorDot(colorName: string): string {
  const color = SESSION_COLOR_MAP[colorName.toLowerCase() as SessionColorName];
  if (!color) return "";
  return `${color}${DOT.filled}${RESET} `;
}

// ── Suppressed tags (mute-errors style) ──────────────────────────────────────

/**
 * Check if an activity entry's tag matches any tag in the suppressed set.
 * Handles pipe-separated patterns (same logic as matchesTagFilter).
 */
export function isSuppressedEntry(entry: ActivityEntry, suppressedTags: ReadonlySet<string>): boolean {
  if (suppressedTags.size === 0) return false;
  for (const pattern of suppressedTags) {
    if (matchesTagFilter(entry, pattern)) return true;
  }
  return false;
}

/** Default error-suppression pattern matching "! action" and "error" tags. */
export const MUTE_ERRORS_PATTERN = "error|! action";

// ── Per-session goal history ──────────────────────────────────────────────────

/** Max previous goals stored per session. */
export const MAX_GOAL_HISTORY = 5;

// ── Session multi-tags ────────────────────────────────────────────────────────

/** Max tags per session. */
export const MAX_SESSION_TAGS = 10;
/** Max length of a single session tag. */
export const MAX_SESSION_TAG_LEN = 20;

/** Validate a session tag name. Returns null if valid, error string if not. */
export function validateSessionTag(tag: string): string | null {
  if (!tag || tag.trim().length === 0) return "tag cannot be empty";
  const t = tag.trim();
  if (t.length > MAX_SESSION_TAG_LEN) return `tag too long (max ${MAX_SESSION_TAG_LEN})`;
  if (!/^[a-z0-9_-]+$/i.test(t)) return "tag must be alphanumeric (a-z, 0-9, - _)";
  return null;
}

/** Format a session tags badge for display in cards. Returns empty string if no tags. */
export function formatSessionTagsBadge(tags: ReadonlySet<string>): string {
  if (tags.size === 0) return "";
  return `${DIM}[${[...tags].sort().join(",")}]${RESET}`;
}

// ── Session stats ─────────────────────────────────────────────────────────────

export interface SessionStatEntry {
  title: string;
  displayName?: string;
  status: string;
  health: number;
  errors: number;
  errorTrend?: ErrorTrend;
  burnRatePerMin: number | null;
  contextPct: number | null;    // 0–100 or null if no ceiling info
  costStr?: string;             // "$N.NN" latest cost
  healthSparkline?: string;     // pre-rendered health history sparkline
  uptimeMs: number | null;
  idleSinceMs: number | null;
}

/**
 * Build stats entries for all sessions — pure, testable, no side effects.
 */
export function buildSessionStats(
  sessions: readonly DaemonSessionState[],
  errorCounts: ReadonlyMap<string, number>,
  burnRates: ReadonlyMap<string, number | null>,
  firstSeen: ReadonlyMap<string, number>,
  lastChangeAt: ReadonlyMap<string, number>,
  healthScores: ReadonlyMap<string, number>,
  sessionAliases: ReadonlyMap<string, string>,
  now?: number,
  errorTimestamps?: ReadonlyMap<string, readonly number[]>,
  sessionCosts?: ReadonlyMap<string, string>,
  healthHistories?: ReadonlyMap<string, readonly HealthSnapshot[]>,
): SessionStatEntry[] {
  const nowMs = now ?? Date.now();
  return sessions.map((s) => {
    const ceiling = parseContextCeiling(s.contextTokens);
    const ctxPct = ceiling ? Math.round((ceiling.current / ceiling.max) * 100) : null;
    const fs = firstSeen.get(s.id);
    const lc = lastChangeAt.get(s.id);
    const errTs = errorTimestamps?.get(s.id);
    const errTrend = errTs ? computeErrorTrend(errTs, nowMs) : undefined;
    const healthHist = healthHistories?.get(s.id);
    const healthSparkline = healthHist ? formatHealthSparkline(healthHist, nowMs) : undefined;
    return {
      title: s.title,
      displayName: sessionAliases.get(s.id),
      status: s.status,
      health: healthScores.get(s.id) ?? 100,
      errors: errorCounts.get(s.id) ?? 0,
      errorTrend: errTrend,
      burnRatePerMin: burnRates.get(s.id) ?? null,
      contextPct: ctxPct,
      costStr: sessionCosts?.get(s.id),
      healthSparkline: healthSparkline || undefined,
      uptimeMs: fs !== undefined ? nowMs - fs : null,
      idleSinceMs: lc !== undefined ? nowMs - lc : null,
    };
  });
}

/**
 * Format session stats entries as a multi-line activity-log-friendly string.
 * Each line is one session summary.
 */
export function formatSessionStatsLines(entries: SessionStatEntry[]): string[] {
  if (entries.length === 0) return ["  no sessions"];
  return entries.map((e) => {
    const label = e.displayName ? `${e.displayName} (${e.title})` : e.title;
    const healthStr = `⬡${e.health}`;
    const trendStr = e.errorTrend ? ` ${e.errorTrend === "rising" ? "↑" : e.errorTrend === "falling" ? "↓" : "→"}` : "";
    const errStr = e.errors > 0 ? ` ${e.errors}err${trendStr}` : "";
    const burnStr = e.burnRatePerMin !== null && e.burnRatePerMin > 0
      ? ` ${Math.round(e.burnRatePerMin / 100) * 100}tok/min` : "";
    const ctxStr = e.contextPct !== null ? ` ctx:${e.contextPct}%` : "";
    const costStr = e.costStr ? ` ${e.costStr}` : "";
    const sparkStr = e.healthSparkline ? ` ${e.healthSparkline}` : "";
    const upStr = e.uptimeMs !== null ? ` up:${formatUptime(e.uptimeMs)}` : "";
    const idleStr = e.idleSinceMs !== null ? ` ${formatIdleSince(e.idleSinceMs)}` : "";
    return `  ${label} [${e.status}] ${healthStr}${sparkStr}${errStr}${burnStr}${ctxStr}${costStr}${upStr}${idleStr}`;
  });
}

/** Format session stats entries as a JSON object for export. */
export function formatStatsJson(entries: SessionStatEntry[], version: string, now?: number): string {
  return JSON.stringify({
    version,
    exportedAt: new Date(now ?? Date.now()).toISOString(),
    sessions: entries,
  }, null, 2) + "\n";
}

// ── Session rename ────────────────────────────────────────────────────────────

/** Max visible length for a custom session display name. */
export const MAX_RENAME_LEN = 32;

/** Truncate a custom display name to the max length. */
export function truncateRename(name: string): string {
  return name.length > MAX_RENAME_LEN ? name.slice(0, MAX_RENAME_LEN - 2) + ".." : name;
}

// ── Watchdog ──────────────────────────────────────────────────────────────────

/** Default watchdog threshold: 10 minutes of no output change triggers alert. */
export const WATCHDOG_DEFAULT_MINUTES = 10;
/** Cooldown between watchdog alerts for the same session (5 minutes). */
export const WATCHDOG_ALERT_COOLDOWN_MS = 5 * 60_000;

// ── Aliases ──────────────────────────────────────────────────────────────────

/** Maximum number of user-defined aliases. */
export const MAX_ALIASES = 50;

/** All built-in slash commands that cannot be overridden by aliases. */
export const BUILTIN_COMMANDS = new Set([
  "/help", "/pause", "/resume", "/interrupt", "/status", "/dashboard",
  "/explain", "/verbose", "/clear", "/view", "/back", "/sort", "/compact",
  "/pin", "/bell", "/focus", "/mute", "/unmute-all", "/filter", "/who",
  "/uptime", "/auto-pin", "/note", "/notes", "/clip", "/diff", "/mark",
  "/jump", "/marks", "/search", "/alias", "/insist", "/task", "/tasks",
  "/group", "/groups", "/group-filter", "/burn-rate", "/snapshot", "/broadcast", "/watchdog", "/top", "/ceiling", "/rename", "/copy", "/stats", "/recall", "/pin-all-errors", "/export-stats",
  "/mute-errors", "/prev-goal", "/tag", "/tags", "/tag-filter", "/find", "/reset-health", "/timeline", "/color", "/clear-history",
  "/duplicate", "/color-all", "/quiet-hours", "/quiet-status", "/history-stats", "/cost-summary", "/session-report", "/alert-log",
  "/budget", "/budgets", "/budget-status", "/pause-all", "/resume-all",
  "/health-trend", "/alert-mute",
]);

/** Resolve a slash command through the alias map. Returns the expanded command or the original. */
export function resolveAlias(line: string, aliases: ReadonlyMap<string, string>): string {
  const [cmd] = line.split(/\s+/);
  const target = aliases.get(cmd);
  if (!target) return line;
  return target + line.slice(cmd.length);
}

/** Validate an alias name. Returns an error message or null if valid. */
export function validateAliasName(name: string): string | null {
  if (!name.startsWith("/")) return "alias must start with /";
  if (name.length < 2) return "alias name too short";
  if (BUILTIN_COMMANDS.has(name)) return `${name} is a built-in command`;
  if (!/^\/[a-z0-9-]+$/.test(name)) return "alias must be lowercase alphanumeric (a-z, 0-9, -)";
  return null;
}

// ── Session grouping ─────────────────────────────────────────────────────────

/** Group indicator icon shown in session cards. */
export const GROUP_ICON = "⊹";

/** Max visible length for a group name in a session card badge. */
export const MAX_GROUP_NAME_LEN = 16;

/** Validate a group name (alphanumeric, dash, underscore, 1-16 chars). */
export function validateGroupName(name: string): string | null {
  if (!name || name.trim().length === 0) return "group name cannot be empty";
  const cleaned = name.trim();
  if (cleaned.length > MAX_GROUP_NAME_LEN) return `group name too long (max ${MAX_GROUP_NAME_LEN})`;
  if (!/^[a-z0-9_-]+$/i.test(cleaned)) return "group name must be alphanumeric (a-z, 0-9, - _)";
  return null;
}

/** Format group badge for a session card — DIM colored with GROUP_ICON. */
export function formatGroupBadge(group: string): string {
  return `${DIM}${GROUP_ICON}${group}${RESET}`;
}

// ── Snapshot export ──────────────────────────────────────────────────────────

export interface SnapshotSession {
  id: string;
  title: string;
  status: string;
  tool: string;
  group?: string;
  note?: string;
  uptimeMs?: number;
  contextTokens?: string;
  currentTask?: string;
  errorCount?: number;
  burnRatePerMin?: number | null;
}

export interface SnapshotData {
  version: string;
  exportedAt: string;       // ISO 8601
  exportedAtMs: number;
  sessions: SnapshotSession[];
}

/** Build a SnapshotData object from current TUI state. */
export function buildSnapshotData(
  sessions: readonly DaemonSessionState[],
  groups: ReadonlyMap<string, string>,
  notes: ReadonlyMap<string, string>,
  firstSeen: ReadonlyMap<string, number>,
  errorCounts: ReadonlyMap<string, number>,
  burnRates: ReadonlyMap<string, number | null>,
  version: string,
  now?: number,
): SnapshotData {
  const nowMs = now ?? Date.now();
  return {
    version,
    exportedAt: new Date(nowMs).toISOString(),
    exportedAtMs: nowMs,
    sessions: sessions.map((s) => {
      const entry: SnapshotSession = {
        id: s.id,
        title: s.title,
        status: s.status,
        tool: s.tool,
      };
      const g = groups.get(s.id);
      if (g) entry.group = g;
      const n = notes.get(s.id);
      if (n) entry.note = n;
      const fs = firstSeen.get(s.id);
      if (fs !== undefined) entry.uptimeMs = nowMs - fs;
      if (s.contextTokens) entry.contextTokens = s.contextTokens;
      if (s.currentTask) entry.currentTask = s.currentTask;
      const ec = errorCounts.get(s.id);
      if (ec !== undefined && ec > 0) entry.errorCount = ec;
      const br = burnRates.get(s.id);
      if (br !== undefined) entry.burnRatePerMin = br;
      return entry;
    }),
  };
}

/** Format a SnapshotData as indented JSON. */
export function formatSnapshotJson(data: SnapshotData): string {
  return JSON.stringify(data, null, 2) + "\n";
}

/** Format a SnapshotData as a Markdown report. */
export function formatSnapshotMarkdown(data: SnapshotData): string {
  const lines: string[] = [];
  lines.push(`# aoaoe Snapshot — ${data.exportedAt}`);
  lines.push(`**aoaoe v${data.version}** · ${data.sessions.length} session${data.sessions.length !== 1 ? "s" : ""}`);
  lines.push("");
  if (data.sessions.length === 0) {
    lines.push("_No active sessions._");
  } else {
    for (const s of data.sessions) {
      lines.push(`## ${s.title}`);
      lines.push(`- **Status:** ${s.status}`);
      lines.push(`- **Tool:** ${s.tool}`);
      if (s.group) lines.push(`- **Group:** ${s.group}`);
      if (s.note) lines.push(`- **Note:** ${s.note}`);
      if (s.uptimeMs !== undefined) lines.push(`- **Uptime:** ${formatUptime(s.uptimeMs)}`);
      if (s.contextTokens) lines.push(`- **Context:** ${s.contextTokens}`);
      if (s.currentTask) lines.push(`- **Current task:** ${s.currentTask}`);
      if (s.errorCount) lines.push(`- **Errors:** ${s.errorCount}`);
      if (s.burnRatePerMin !== undefined && s.burnRatePerMin !== null && s.burnRatePerMin > 0) {
        lines.push(`- **Burn rate:** ~${Math.round(s.burnRatePerMin / 100) * 100} tokens/min`);
      }
      lines.push("");
    }
  }
  return lines.join("\n");
}

// ── Session health score ──────────────────────────────────────────────────────

/** Health score color thresholds. */
export const HEALTH_GOOD = 80;
export const HEALTH_WARN = 60;

/** Health score badge icon. */
export const HEALTH_ICON = "⬡";

/**
 * Compute a composite health score (0–100) for a session.
 * Higher = healthier. Deductions for: errors, high burn rate, context ceiling proximity, stall.
 */
export function computeHealthScore(opts: {
  errorCount: number;
  burnRatePerMin: number | null;
  contextFraction: number | null; // current / max, or null if unknown
  idleMs: number | null;
  watchdogThresholdMs: number | null;
}): number {
  let score = 100;

  // errors: -10 per error, cap deduction at 50
  const errDeduction = Math.min(50, opts.errorCount * 10);
  score -= errDeduction;

  // burn rate: -20 when above CONTEXT_BURN_THRESHOLD
  if (opts.burnRatePerMin !== null && opts.burnRatePerMin > CONTEXT_BURN_THRESHOLD) {
    score -= 20;
  }

  // context ceiling: -10 per 10% above 70% (so 80%→-10, 90%→-20, 100%→-30)
  if (opts.contextFraction !== null) {
    const overPct = Math.max(0, opts.contextFraction - 0.70);
    const tenPctSteps = Math.floor(overPct * 10); // number of 10% increments over 70%
    const ceDeduction = Math.min(30, tenPctSteps * 10);
    score -= ceDeduction;
  }

  // stall: -15 when idle longer than watchdog threshold
  if (opts.idleMs !== null && opts.watchdogThresholdMs !== null && opts.idleMs >= opts.watchdogThresholdMs) {
    score -= 15;
  }

  return Math.max(0, Math.min(100, score));
}

/**
 * Format a health score as a colored badge string: "⬡83" in LIME/AMBER/ROSE.
 * Returns empty string for score of exactly 100 (no badge clutter on healthy sessions).
 */
export function formatHealthBadge(score: number): string {
  if (score >= 100) return "";
  const color = score >= HEALTH_GOOD ? LIME : score >= HEALTH_WARN ? AMBER : ROSE;
  return `${color}${HEALTH_ICON}${score}${RESET}`;
}

// ── /top ranking helpers ──────────────────────────────────────────────────────

export type TopSortMode = "errors" | "burn" | "idle" | "default";
export const TOP_SORT_MODES: TopSortMode[] = ["default", "errors", "burn", "idle"];

export interface TopEntry {
  title: string;
  status: string;
  rank: number; // 1-indexed, lower = more attention needed
  errors: number;
  burnRatePerMin: number | null;
  idleMs: number | null;
}

/**
 * Rank sessions for /top output. Returns entries sorted by the given mode.
 * "default" = composite: errors first, then burn rate, then idle.
 */
export function rankSessions(
  sessions: readonly DaemonSessionState[],
  errorCounts: ReadonlyMap<string, number>,
  burnRates: ReadonlyMap<string, number | null>,
  lastChangeAt: ReadonlyMap<string, number>,
  mode: TopSortMode,
  now?: number,
): TopEntry[] {
  const nowMs = now ?? Date.now();
  const entries: TopEntry[] = sessions.map((s) => ({
    title: s.title,
    status: s.status,
    rank: 0,
    errors: errorCounts.get(s.id) ?? 0,
    burnRatePerMin: burnRates.get(s.id) ?? null,
    idleMs: lastChangeAt.has(s.id) ? nowMs - lastChangeAt.get(s.id)! : null,
  }));

  switch (mode) {
    case "errors":
      entries.sort((a, b) => b.errors - a.errors);
      break;
    case "burn":
      entries.sort((a, b) => (b.burnRatePerMin ?? 0) - (a.burnRatePerMin ?? 0));
      break;
    case "idle":
      entries.sort((a, b) => (b.idleMs ?? 0) - (a.idleMs ?? 0));
      break;
    default: {
      // composite: weight errors heavily, then burn rate, then idle
      const score = (e: TopEntry) =>
        e.errors * 10000 +
        (e.burnRatePerMin ?? 0) * 0.01 +
        (e.idleMs ?? 0) * 0.0001;
      entries.sort((a, b) => score(b) - score(a));
    }
  }

  entries.forEach((e, i) => { e.rank = i + 1; });
  return entries;
}

// ── Broadcast helpers ────────────────────────────────────────────────────────

/** Format a broadcast summary for the activity log. */
export function formatBroadcastSummary(count: number, group: string | null): string {
  if (count === 0) return group ? `no sessions in group "${group}"` : "no sessions to broadcast to";
  const target = group ? `group "${group}"` : "all sessions";
  return `broadcast to ${count} session${count !== 1 ? "s" : ""} (${target})`;
}

// ── Sticky prefs ─────────────────────────────────────────────────────────────

export interface TuiPrefs {
  sortMode?: string;
  compact?: boolean;
  focus?: boolean;
  bell?: boolean;
  autoPin?: boolean;
  tagFilter?: string | null;
  aliases?: Record<string, string>;
  sessionGroups?: Record<string, string>;
  sessionAliases?: Record<string, string>;
  sessionTags?: Record<string, string[]>;
  sessionColors?: Record<string, string>;
  quietHours?: string[]; // persisted quiet-hours specs, e.g. ["22-06"]
}

const PREFS_PATH = join(homedir(), ".aoaoe", "tui-prefs.json");

/** Load persisted TUI preferences. Returns empty object on any error. */
export function loadTuiPrefs(): TuiPrefs {
  try { return JSON.parse(readFileSync(PREFS_PATH, "utf-8")); } catch { return {}; }
}

/** Save TUI preferences to disk. Silently ignores errors. */
export function saveTuiPrefs(prefs: TuiPrefs): void {
  try { writeFileSync(PREFS_PATH, JSON.stringify(prefs) + "\n", "utf-8"); } catch { /* best effort */ }
}

export class TUI {
  private active = false;
  private countdownTimer: ReturnType<typeof setInterval> | null = null;
  private cols = 80;
  private rows = 24;
  private headerHeight = 1;      // top bar
  private sessionRows = 0;       // dynamic: 2 (borders) + N sessions
  private separatorRow = 0;      // line between sessions and activity
  private scrollTop = 0;         // first row of scroll region
  private scrollBottom = 0;      // last row of scroll region
  private inputRow = 0;          // bottom input line
  private activityBuffer: ActivityEntry[] = []; // ring buffer for activity log
  private maxActivity = 500;     // max entries to keep
  private spinnerFrame = 0;      // current spinner animation frame
  private scrollOffset = 0;      // 0 = live (bottom), >0 = scrolled back N entries
  private newWhileScrolled = 0;  // entries added while user is scrolled back
  private pendingCount = 0;      // queued user messages awaiting next tick
  private searchPattern: string | null = null; // active search filter pattern
  private filterTag: string | null = null;     // active tag filter (exact match on entry.tag)
  private hoverSessionIdx: number | null = null; // 1-indexed session under mouse cursor (null = none)
  private activityTimestamps: number[] = []; // epoch ms of each log() call for sparkline
  private sortMode: SortMode = "default";
  private lastChangeAt = new Map<string, number>();       // session ID → epoch ms of last activity change
  private prevLastActivity = new Map<string, string>();   // session ID → previous lastActivity string
  private compactMode = false;
  private pinnedIds = new Set<string>(); // pinned session IDs (always sort to top)
  private focusMode = false;             // focus mode: hide all sessions except pinned
  private bookmarks: Bookmark[] = [];    // saved positions in activity buffer
  private bellEnabled = false;
  private lastBellAt = 0;
  private mutedIds = new Set<string>(); // muted session IDs (activity entries hidden)
  private mutedEntryCounts = new Map<string, number>(); // session ID → suppressed entry count since mute
  private sessionNotes = new Map<string, string>(); // session ID → note text
  private sessionFirstSeen = new Map<string, number>(); // session ID → epoch ms when first observed
  private autoPinOnError = false; // auto-pin sessions that emit errors
  private sessionErrorCounts = new Map<string, number>(); // session ID → cumulative error count
  private sessionErrorTimestamps = new Map<string, number[]>(); // session ID → recent error epoch ms (last 100)
  private sessionContextHistory = new Map<string, ContextHistoryEntry[]>(); // session ID → context token history
  private burnRateAlerted = new Map<string, number>(); // session ID → epoch ms of last burn-rate alert (cooldown)
  private ceilingAlerted = new Map<string, number>(); // session ID → epoch ms of last ceiling alert (cooldown)
  private sessionGroups = new Map<string, string>(); // session ID → group tag
  private groupFilter: string | null = null; // active group filter (null = show all)
  private sessionAliases = new Map<string, string>(); // session ID → custom display name
  private watchdogThresholdMs: number | null = null; // null = disabled; ms of inactivity before alert
  private watchdogAlerted = new Map<string, number>(); // session ID → epoch ms of last watchdog alert
  private suppressedTags = new Set<string>();        // activity tags excluded from display (/mute-errors)
  private sessionGoalHistory = new Map<string, string[]>(); // session ID → last N goals (newest last)
  private sessionTags = new Map<string, Set<string>>(); // session ID → freeform tag set
  private tagFilter2: string | null = null; // active freeform tag filter on session panel
  private sessionColors = new Map<string, string>(); // session ID → accent color name
  private sessionCosts = new Map<string, string>(); // session ID → latest cost string ("$N.NN")
  private quietHoursRanges: Array<[number, number]> = []; // quiet-hour start/end pairs
  private sessionHealthHistory = new Map<string, HealthSnapshot[]>(); // session ID → health snapshots
  private alertLog: ActivityEntry[] = []; // recent auto-generated status alerts (ring buffer, max 100)
  private sessionBudgets = new Map<string, number>(); // session ID → USD budget
  private globalBudget: number | null = null;          // global fallback budget in USD
  private budgetAlerted = new Map<string, number>();   // session ID → epoch ms of last budget alert
  private sessionStatusHistory = new Map<string, StatusChange[]>(); // session ID → status change log
  private prevSessionStatus = new Map<string, string>(); // session ID → last known status (for change detection)
  private flapAlerted = new Map<string, number>(); // session ID → epoch ms of last flap alert
  private alertMutePatterns = new Set<string>(); // substrings to hide from /alert-log display

  // drill-down mode: show a single session's full output
  private viewMode: "overview" | "drilldown" = "overview";
  private drilldownSessionId: string | null = null;
  private sessionOutputs = new Map<string, string[]>(); // full output lines per session
  private drilldownScrollOffset = 0;  // 0 = live (tail), >0 = scrolled back N lines
  private drilldownNewWhileScrolled = 0; // lines added while scrolled back

  // current state for repaints
  private phase: DaemonPhase = "sleeping";
  private pollCount = 0;
  private sessions: DaemonSessionState[] = [];
  private paused = false;
  private version = "";
  private reasonerName = "";
  private nextTickAt = 0; // epoch ms for countdown display

  start(version: string): void {
    if (this.active) return;
    this.active = true;
    this.version = version;
    this.updateDimensions();

    // enter alternate screen, hide cursor, clear, enable mouse
    process.stderr.write(ALT_SCREEN_ON + CURSOR_HIDE + CLEAR_SCREEN + MOUSE_ON);

    // handle terminal resize
    process.stdout.on("resize", () => this.onResize());
    // tick timer: countdown + spinner animation (~4 fps for smooth braille spin)
    this.countdownTimer = setInterval(() => {
      if (!this.active) return;
      this.spinnerFrame = (this.spinnerFrame + 1) % SPINNER.length;
      // repaint header for countdown and spinner
      if (this.phase !== "sleeping" || this.nextTickAt > 0) {
        this.paintHeader();
      }
    }, 250);
    // initial layout
    this.computeLayout(0);
    this.paintAll();
  }

  stop(): void {
    if (!this.active) return;
    this.active = false;
    if (this.countdownTimer) { clearInterval(this.countdownTimer); this.countdownTimer = null; }
    // disable mouse, restore normal screen, show cursor, reset scroll region
    process.stderr.write(MOUSE_OFF + resetScrollRegion() + CURSOR_SHOW + ALT_SCREEN_OFF);
  }

  isActive(): boolean {
    return this.active;
  }

  /** Return the current number of visible sessions (for mouse hit testing) */
  getSessionCount(): number {
    return this.getVisibleCount();
  }

  /** Set the session sort mode and repaint. */
  setSortMode(mode: SortMode): void {
    if (mode === this.sortMode) return;
    this.sortMode = mode;
    // re-sort current sessions and repaint
    this.sessions = sortSessions(this.sessions, this.sortMode, this.lastChangeAt, this.pinnedIds);
    if (this.active) {
      this.paintSessions();
    }
  }

  /** Return the current sort mode. */
  getSortMode(): SortMode {
    return this.sortMode;
  }

  /** Toggle or set compact mode. Recomputes layout and repaints. */
  setCompact(enabled: boolean): void {
    if (enabled === this.compactMode) return;
    this.compactMode = enabled;
    if (this.active) {
      this.computeLayout(this.getVisibleCount());
      this.paintAll();
    }
  }

  /** Return whether compact mode is enabled. */
  isCompact(): boolean {
    return this.compactMode;
  }

  /**
   * Toggle pin for a session (by 1-indexed number, ID, ID prefix, or title).
   * Pinned sessions always sort to the top. Returns true if session found.
   */
  togglePin(sessionIdOrIndex: string | number): boolean {
    let sessionId: string | undefined;
    if (typeof sessionIdOrIndex === "number") {
      sessionId = this.sessions[sessionIdOrIndex - 1]?.id;
    } else {
      const needle = sessionIdOrIndex.toLowerCase();
      const match = this.sessions.find(
        (s) => s.id === sessionIdOrIndex || s.id.startsWith(needle) || s.title.toLowerCase() === needle,
      );
      sessionId = match?.id;
    }
    if (!sessionId) return false;
    if (this.pinnedIds.has(sessionId)) {
      this.pinnedIds.delete(sessionId);
    } else {
      this.pinnedIds.add(sessionId);
    }
    // re-sort and repaint
    this.sessions = sortSessions(this.sessions, this.sortMode, this.lastChangeAt, this.pinnedIds);
    if (this.active) {
      this.paintSessions();
    }
    return true;
  }

  /**
   * Pin all sessions currently in "error" status (or with any cumulative errors).
   * Returns the count of newly pinned sessions.
   */
  pinAllErrors(): number {
    let pinned = 0;
    for (const s of this.sessions) {
      if ((s.status === "error" || (this.sessionErrorCounts.get(s.id) ?? 0) > 0) && !this.pinnedIds.has(s.id)) {
        this.pinnedIds.add(s.id);
        pinned++;
      }
    }
    if (pinned > 0) {
      this.sessions = sortSessions(this.sessions, this.sortMode, this.lastChangeAt, this.pinnedIds);
      if (this.active) this.paintSessions();
    }
    return pinned;
  }

  /** Check if a session ID is pinned. */
  isPinned(id: string): boolean {
    return this.pinnedIds.has(id);
  }

  /** Return count of pinned sessions. */
  getPinnedCount(): number {
    return this.pinnedIds.size;
  }

  /** Enable or disable focus mode. When focused, only pinned sessions are visible. */
  setFocus(enabled: boolean): void {
    if (enabled === this.focusMode) return;
    this.focusMode = enabled;
    if (this.active) {
      this.computeLayout(this.getVisibleCount());
      this.paintAll();
    }
  }

  /** Return whether focus mode is enabled. */
  isFocused(): boolean {
    return this.focusMode;
  }

  /** Return count of visible sessions (filtered by focus mode and group filter). */
  private getVisibleCount(): number {
    return this.getVisibleSessions().length;
  }

  /** Return visible sessions array (focus mode + group filter + tag filter applied). */
  private getVisibleSessions(): DaemonSessionState[] {
    let sessions = this.sessions;
    if (this.focusMode) sessions = sessions.filter((s) => this.pinnedIds.has(s.id));
    if (this.groupFilter) sessions = sessions.filter((s) => this.sessionGroups.get(s.id) === this.groupFilter);
    if (this.tagFilter2) {
      const tf = this.tagFilter2;
      sessions = sessions.filter((s) => this.sessionTags.get(s.id)?.has(tf) ?? false);
    }
    return sessions;
  }

  /** Enable or disable terminal bell notifications. */
  setBell(enabled: boolean): void {
    this.bellEnabled = enabled;
  }

  /** Return whether terminal bell is enabled. */
  isBellEnabled(): boolean {
    return this.bellEnabled;
  }

  /** Enable or disable auto-pin on error. */
  setAutoPin(enabled: boolean): void {
    this.autoPinOnError = enabled;
  }

  /** Return whether auto-pin on error is enabled. */
  isAutoPinEnabled(): boolean {
    return this.autoPinOnError;
  }

  /**
   * Toggle mute for a session (by 1-indexed number, ID, ID prefix, or title).
   * Muted sessions' activity entries are hidden from the log (still buffered + persisted).
   * Returns true if session found.
   */
  toggleMute(sessionIdOrIndex: string | number): boolean {
    let sessionId: string | undefined;
    if (typeof sessionIdOrIndex === "number") {
      sessionId = this.sessions[sessionIdOrIndex - 1]?.id;
    } else {
      const needle = sessionIdOrIndex.toLowerCase();
      const match = this.sessions.find(
        (s) => s.id === sessionIdOrIndex || s.id.startsWith(needle) || s.title.toLowerCase() === needle,
      );
      sessionId = match?.id;
    }
    if (!sessionId) return false;
    if (this.mutedIds.has(sessionId)) {
      this.mutedIds.delete(sessionId);
      this.mutedEntryCounts.delete(sessionId);
    } else {
      this.mutedIds.add(sessionId);
      this.mutedEntryCounts.set(sessionId, 0);
    }
    // repaint sessions (mute icon) and activity (filter changes)
    if (this.active) {
      this.paintSessions();
      this.repaintActivityRegion();
    }
    return true;
  }

  /** Unmute all sessions at once. Returns count of sessions unmuted. */
  unmuteAll(): number {
    const count = this.mutedIds.size;
    if (count === 0) return 0;
    this.mutedIds.clear();
    this.mutedEntryCounts.clear();
    if (this.active) {
      this.paintSessions();
      this.repaintActivityRegion();
    }
    return count;
  }

  /** Check if a session ID is muted. */
  isMuted(id: string): boolean {
    return this.mutedIds.has(id);
  }

  /** Return count of muted sessions. */
  getMutedCount(): number {
    return this.mutedIds.size;
  }

  /** Return count of suppressed entries for a muted session (0 if not muted). */
  getMutedEntryCount(id: string): number {
    return this.mutedEntryCounts.get(id) ?? 0;
  }

  /**
   * Set a note on a session (by 1-indexed number, ID, ID prefix, or title).
   * Returns true if session found. Pass empty text to clear.
   */
  setNote(sessionIdOrIndex: string | number, text: string): boolean {
    let sessionId: string | undefined;
    if (typeof sessionIdOrIndex === "number") {
      sessionId = this.sessions[sessionIdOrIndex - 1]?.id;
    } else {
      const needle = sessionIdOrIndex.toLowerCase();
      const match = this.sessions.find(
        (s) => s.id === sessionIdOrIndex || s.id.startsWith(needle) || s.title.toLowerCase() === needle,
      );
      sessionId = match?.id;
    }
    if (!sessionId) return false;
    if (text.trim() === "") {
      this.sessionNotes.delete(sessionId);
    } else {
      this.sessionNotes.set(sessionId, truncateNote(text.trim()));
    }
    if (this.active) {
      this.paintSessions();
      if (this.viewMode === "drilldown" && this.drilldownSessionId === sessionId) {
        this.paintDrilldownSeparator();
      }
    }
    return true;
  }

  /** Get the note for a session ID (or undefined if none). */
  getNote(id: string): string | undefined {
    return this.sessionNotes.get(id);
  }

  /** Return count of sessions with notes. */
  getNoteCount(): number {
    return this.sessionNotes.size;
  }

  /** Return all session notes (for /notes listing). */
  getAllNotes(): ReadonlyMap<string, string> {
    return this.sessionNotes;
  }

  /** Return the current sessions (read-only, for resolving IDs to titles in the UI). */
  getSessions(): readonly DaemonSessionState[] {
    return this.sessions;
  }

  /** Return the uptime in ms for a session (0 if not tracked). */
  getUptime(id: string): number {
    const firstSeen = this.sessionFirstSeen.get(id);
    if (firstSeen === undefined) return 0;
    return Date.now() - firstSeen;
  }

  /** Return all session first-seen timestamps (for /uptime listing). */
  getAllFirstSeen(): ReadonlyMap<string, number> {
    return this.sessionFirstSeen;
  }

  /** Return the activity buffer (for /clip export). */
  getActivityBuffer(): readonly ActivityEntry[] {
    return this.activityBuffer;
  }

  // ── Suppressed tags ─────────────────────────────────────────────────────

  /** Toggle suppression of error-tagged entries ("! action" and "error"). */
  toggleMuteErrors(): boolean {
    if (this.suppressedTags.has(MUTE_ERRORS_PATTERN)) {
      this.suppressedTags.delete(MUTE_ERRORS_PATTERN);
      if (this.active) this.repaintActivityRegion();
      return false; // now unmuted
    }
    this.suppressedTags.add(MUTE_ERRORS_PATTERN);
    if (this.active) this.repaintActivityRegion();
    return true; // now muted
  }

  /** Return whether error tags are currently suppressed. */
  isErrorsMuted(): boolean {
    return this.suppressedTags.has(MUTE_ERRORS_PATTERN);
  }

  /** Return the full suppressed-tags set (readonly). */
  getSuppressedTags(): ReadonlySet<string> {
    return this.suppressedTags;
  }

  // ── Per-session goal history ─────────────────────────────────────────────

  /** Record a goal for a session (push to front of history, cap at MAX_GOAL_HISTORY). */
  pushGoalHistory(sessionId: string, goal: string): void {
    if (!goal || !goal.trim()) return;
    const hist = this.sessionGoalHistory.get(sessionId) ?? [];
    // avoid duplicating the same consecutive goal
    if (hist.length > 0 && hist[hist.length - 1] === goal.trim()) return;
    hist.push(goal.trim());
    if (hist.length > MAX_GOAL_HISTORY) hist.shift();
    this.sessionGoalHistory.set(sessionId, hist);
  }

  /** Get goal history for a session (oldest first, most recent last). */
  getGoalHistory(sessionId: string): readonly string[] {
    return this.sessionGoalHistory.get(sessionId) ?? [];
  }

  /** Restore a previous goal (1 = most recent, 2 = two back, etc.). Returns the goal string or null. */
  getPreviousGoal(sessionId: string, nBack = 1): string | null {
    const hist = this.sessionGoalHistory.get(sessionId) ?? [];
    const idx = hist.length - nBack;
    return idx >= 0 ? hist[idx] : null;
  }

  // ── Session multi-tags ───────────────────────────────────────────────────

  /**
   * Set tags for a session (replaces existing). Pass empty array to clear.
   * Returns true if session found.
   */
  setSessionTags(sessionIdOrIndex: string | number, tags: string[]): boolean {
    let sessionId: string | undefined;
    if (typeof sessionIdOrIndex === "number") {
      sessionId = this.sessions[sessionIdOrIndex - 1]?.id;
    } else {
      const needle = sessionIdOrIndex.toLowerCase();
      const match = this.sessions.find(
        (s) => s.id === sessionIdOrIndex || s.id.startsWith(needle) || s.title.toLowerCase() === needle,
      );
      sessionId = match?.id;
    }
    if (!sessionId) return false;
    if (tags.length === 0) {
      this.sessionTags.delete(sessionId);
    } else {
      const tagSet = new Set(tags.map((t) => t.trim().toLowerCase()).filter(Boolean));
      this.sessionTags.set(sessionId, tagSet);
    }
    if (this.active) this.paintSessions();
    return true;
  }

  /** Get tags for a session ID (empty set if none). */
  getSessionTags(id: string): ReadonlySet<string> {
    return this.sessionTags.get(id) ?? new Set();
  }

  /** Return all session tags (id → tag set). */
  getAllSessionTags(): ReadonlyMap<string, ReadonlySet<string>> {
    return this.sessionTags as ReadonlyMap<string, ReadonlySet<string>>;
  }

  /** Return sessions that have a given tag. */
  getSessionsWithTag(tag: string): DaemonSessionState[] {
    const lower = tag.toLowerCase();
    return this.sessions.filter((s) => this.sessionTags.get(s.id)?.has(lower));
  }

  /** Restore session tags from persisted prefs. */
  restoreSessionTags(tags: Record<string, string[]>): void {
    this.sessionTags.clear();
    for (const [id, arr] of Object.entries(tags)) {
      if (arr.length > 0) this.sessionTags.set(id, new Set(arr));
    }
  }

  // ── Session accent colors ────────────────────────────────────────────────

  setSessionColor(sessionIdOrIndex: string | number, colorName: string | null): boolean {
    let sessionId: string | undefined;
    if (typeof sessionIdOrIndex === "number") {
      sessionId = this.sessions[sessionIdOrIndex - 1]?.id;
    } else {
      const needle = sessionIdOrIndex.toLowerCase();
      const match = this.sessions.find(
        (s) => s.id === sessionIdOrIndex || s.id.startsWith(needle) || s.title.toLowerCase() === needle,
      );
      sessionId = match?.id;
    }
    if (!sessionId) return false;
    if (!colorName) {
      this.sessionColors.delete(sessionId);
    } else {
      this.sessionColors.set(sessionId, colorName.toLowerCase());
    }
    if (this.active) this.paintSessions();
    return true;
  }

  getSessionColor(id: string): string | undefined {
    return this.sessionColors.get(id);
  }

  getAllSessionColors(): ReadonlyMap<string, string> {
    return this.sessionColors;
  }

  restoreSessionColors(colors: Record<string, string>): void {
    this.sessionColors.clear();
    for (const [id, c] of Object.entries(colors)) this.sessionColors.set(id, c);
  }

  /** Set the same accent color on all currently visible sessions (or clear all). */
  setColorAll(colorName: string | null): number {
    let count = 0;
    for (const s of this.sessions) {
      if (!colorName) {
        this.sessionColors.delete(s.id);
      } else {
        this.sessionColors.set(s.id, colorName);
      }
      count++;
    }
    if (count > 0 && this.active) this.paintSessions();
    return count;
  }

  // ── Quiet hours ──────────────────────────────────────────────────────────

  /** Set quiet-hours ranges (suppresses watchdog/burn-rate alerts). */
  setQuietHours(ranges: Array<[number, number]>): void {
    this.quietHoursRanges = ranges;
  }

  /** Get current quiet-hours ranges. */
  getQuietHours(): ReadonlyArray<[number, number]> {
    return this.quietHoursRanges;
  }

  /** Check if current time is in a quiet-hours window. */
  isCurrentlyQuiet(now?: Date): boolean {
    if (this.quietHoursRanges.length === 0) return false;
    const hour = (now ?? new Date()).getHours();
    return isQuietHour(hour, this.quietHoursRanges);
  }

  /** Return the duplicate args for a session (for /duplicate wiring). */
  getDuplicateArgs(sessionIdOrIndex: string | number, newTitle?: string): { path: string; tool: string; title: string } | null {
    return buildDuplicateArgs(this.sessions, sessionIdOrIndex, newTitle);
  }

  // ── Session timeline ─────────────────────────────────────────────────────

  // ── Session cost budget ──────────────────────────────────────────────────

  /** Set a per-session budget in USD. Pass null to clear. */
  setSessionBudget(sessionIdOrIndex: string | number, budgetUSD: number | null): boolean {
    let sessionId: string | undefined;
    if (typeof sessionIdOrIndex === "number") {
      sessionId = this.sessions[sessionIdOrIndex - 1]?.id;
    } else {
      const needle = sessionIdOrIndex.toLowerCase();
      const match = this.sessions.find(
        (s) => s.id === sessionIdOrIndex || s.id.startsWith(needle) || s.title.toLowerCase() === needle,
      );
      sessionId = match?.id;
    }
    if (!sessionId) return false;
    if (budgetUSD === null) this.sessionBudgets.delete(sessionId);
    else this.sessionBudgets.set(sessionId, budgetUSD);
    return true;
  }

  /** Set global fallback budget (applies to all sessions without per-session budget). */
  setGlobalBudget(budgetUSD: number | null): void {
    this.globalBudget = budgetUSD;
  }

  /** Get the per-session budget (or null). */
  getSessionBudget(id: string): number | null {
    return this.sessionBudgets.get(id) ?? null;
  }

  /** Get the global budget (or null if not set). */
  getGlobalBudget(): number | null {
    return this.globalBudget;
  }

  /** Return all per-session budgets. */
  getAllSessionBudgets(): ReadonlyMap<string, number> {
    return this.sessionBudgets;
  }

  /** Return health history for a session (for sparkline). */
  getSessionHealthHistory(id: string): readonly HealthSnapshot[] {
    return this.sessionHealthHistory.get(id) ?? [];
  }

  /** Return all alert log entries (last 100 "status" tag entries), filtered by mute patterns. */
  getAlertLog(includeAll = false): readonly ActivityEntry[] {
    if (includeAll || this.alertMutePatterns.size === 0) return this.alertLog;
    return this.alertLog.filter((e) => !isAlertMuted(e.text, this.alertMutePatterns));
  }

  /** Return status change history for a session. */
  getSessionStatusHistory(id: string): readonly StatusChange[] {
    return this.sessionStatusHistory.get(id) ?? [];
  }

  /** Check if a session is currently flapping. */
  isSessionFlapping(id: string, now?: number): boolean {
    const hist = this.sessionStatusHistory.get(id);
    return hist ? isFlapping(hist, now) : false;
  }

  // ── Alert mute patterns ──────────────────────────────────────────────────

  /** Add a pattern to suppress from alert log display. */
  addAlertMutePattern(pattern: string): void {
    this.alertMutePatterns.add(pattern.toLowerCase().trim());
  }

  /** Remove a pattern from alert mute list. Returns true if it was present. */
  removeAlertMutePattern(pattern: string): boolean {
    return this.alertMutePatterns.delete(pattern.toLowerCase().trim());
  }

  /** Clear all alert mute patterns. */
  clearAlertMutePatterns(): void {
    this.alertMutePatterns.clear();
  }

  /** Return all alert mute patterns (for display/persistence). */
  getAlertMutePatterns(): ReadonlySet<string> {
    return this.alertMutePatterns;
  }

  /** Get the latest cost string for a session (or undefined). */
  getSessionCost(id: string): string | undefined {
    return this.sessionCosts.get(id);
  }

  /** Return all session costs (for /stats). */
  getAllSessionCosts(): ReadonlyMap<string, string> {
    return this.sessionCosts;
  }

  getSessionTimeline(sessionIdOrIndex: string | number, count = TIMELINE_DEFAULT_COUNT): ActivityEntry[] | null {
    let sessionId: string | undefined;
    if (typeof sessionIdOrIndex === "number") {
      sessionId = this.sessions[sessionIdOrIndex - 1]?.id;
    } else {
      const needle = sessionIdOrIndex.toLowerCase();
      const match = this.sessions.find(
        (s) => s.id === sessionIdOrIndex || s.id.startsWith(needle) || s.title.toLowerCase() === needle,
      );
      sessionId = match?.id;
    }
    if (!sessionId) return null;
    return filterSessionTimeline(this.activityBuffer, sessionId, count);
  }

  /** Set or clear the freeform tag filter (filters session panel). */
  setTagFilter2(tag: string | null): void {
    this.tagFilter2 = tag && tag.trim().length > 0 ? tag.trim().toLowerCase() : null;
    if (this.active) this.paintSessions();
  }

  /** Get the current freeform tag filter (or null if none). */
  getTagFilter2(): string | null {
    return this.tagFilter2;
  }

  /**
   * Reset health state for a session (by 1-indexed number, ID, or title).
   * Clears: error counts, error timestamps, context history, burn-rate alert timer, ceiling alert timer.
   * Returns true if session found.
   */
  resetSessionHealth(sessionIdOrIndex: string | number): boolean {
    let sessionId: string | undefined;
    if (typeof sessionIdOrIndex === "number") {
      sessionId = this.sessions[sessionIdOrIndex - 1]?.id;
    } else {
      const needle = sessionIdOrIndex.toLowerCase();
      const match = this.sessions.find(
        (s) => s.id === sessionIdOrIndex || s.id.startsWith(needle) || s.title.toLowerCase() === needle,
      );
      sessionId = match?.id;
    }
    if (!sessionId) return false;
    this.sessionErrorCounts.delete(sessionId);
    this.sessionErrorTimestamps.delete(sessionId);
    this.sessionContextHistory.delete(sessionId);
    this.burnRateAlerted.delete(sessionId);
    this.ceilingAlerted.delete(sessionId);
    this.watchdogAlerted.delete(sessionId);
    if (this.active) this.paintSessions();
    return true;
  }

  /** Return the activity timestamps (epoch ms per entry, parallel to activityBuffer). */
  getActivityTimestamps(): readonly number[] {
    return this.activityTimestamps;
  }

  /**
   * Return the stored pane output lines for a session (by 1-indexed number, ID, prefix, or title).
   * Returns null if session not found or no output stored.
   */
  getSessionOutput(sessionIdOrIndex: string | number): string[] | null {
    let sessionId: string | undefined;
    if (typeof sessionIdOrIndex === "number") {
      sessionId = this.sessions[sessionIdOrIndex - 1]?.id;
    } else {
      const needle = sessionIdOrIndex.toLowerCase();
      const match = this.sessions.find(
        (s) => s.id === sessionIdOrIndex || s.id.startsWith(needle) || s.title.toLowerCase() === needle,
      );
      sessionId = match?.id;
    }
    if (!sessionId) return null;
    return this.sessionOutputs.get(sessionId) ?? null;
  }

  /** Return the current drill-down session ID (for /copy default target). */
  getDrilldownId(): string | null {
    return this.drilldownSessionId;
  }

  /** Return per-session error counts (for /who). */
  getSessionErrorCounts(): ReadonlyMap<string, number> {
    return this.sessionErrorCounts;
  }

  /** Return recent error timestamps for a session (for sparkline rendering). */
  getSessionErrorTimestamps(id: string): readonly number[] {
    return this.sessionErrorTimestamps.get(id) ?? [];
  }

  /** Return context token history for a session (for burn-rate reporting). */
  getSessionContextHistory(id: string): readonly ContextHistoryEntry[] {
    return this.sessionContextHistory.get(id) ?? [];
  }

  /** Return parsed context ceiling for all sessions ({current, max} or null). */
  getAllContextCeilings(): Map<string, { current: number; max: number } | null> {
    const result = new Map<string, { current: number; max: number } | null>();
    for (const s of this.sessions) {
      result.set(s.id, parseContextCeiling(s.contextTokens));
    }
    return result;
  }

  /** Compute health scores for all sessions and return as a map (id → score). */
  getAllHealthScores(now?: number): Map<string, number> {
    const nowMs = now ?? Date.now();
    const result = new Map<string, number>();
    for (const s of this.sessions) {
      const ceiling = parseContextCeiling(s.contextTokens);
      const cf = ceiling ? ceiling.current / ceiling.max : null;
      const bh = this.sessionContextHistory.get(s.id);
      const br = bh ? computeContextBurnRate(bh, nowMs) : null;
      const lc = this.lastChangeAt.get(s.id);
      const idle = lc !== undefined ? nowMs - lc : null;
      result.set(s.id, computeHealthScore({
        errorCount: this.sessionErrorCounts.get(s.id) ?? 0,
        burnRatePerMin: br,
        contextFraction: cf,
        idleMs: idle,
        watchdogThresholdMs: this.watchdogThresholdMs,
      }));
    }
    return result;
  }

  /** Return all sessions with their current burn rates (tokens/min, null if insufficient data). */
  getAllBurnRates(now?: number): Map<string, number | null> {
    const result = new Map<string, number | null>();
    for (const s of this.sessions) {
      const hist = this.sessionContextHistory.get(s.id);
      result.set(s.id, hist && hist.length >= 2 ? computeContextBurnRate(hist, now) : null);
    }
    return result;
  }

  /**
   * Set or clear a group on a session (by 1-indexed number, ID, ID prefix, or title).
   * Returns true if session found. Pass empty/null group to clear.
   */
  setGroup(sessionIdOrIndex: string | number, group: string | null): boolean {
    let sessionId: string | undefined;
    if (typeof sessionIdOrIndex === "number") {
      sessionId = this.sessions[sessionIdOrIndex - 1]?.id;
    } else {
      const needle = sessionIdOrIndex.toLowerCase();
      const match = this.sessions.find(
        (s) => s.id === sessionIdOrIndex || s.id.startsWith(needle) || s.title.toLowerCase() === needle,
      );
      sessionId = match?.id;
    }
    if (!sessionId) return false;
    if (!group || group.trim() === "") {
      this.sessionGroups.delete(sessionId);
    } else {
      this.sessionGroups.set(sessionId, group.trim().toLowerCase());
    }
    if (this.active) this.paintSessions();
    return true;
  }

  /** Get the group tag for a session ID (or undefined if none). */
  getGroup(id: string): string | undefined {
    return this.sessionGroups.get(id);
  }

  /** Return all session groups (for /groups listing). */
  getAllGroups(): ReadonlyMap<string, string> {
    return this.sessionGroups;
  }

  /** Return all lastChangeAt timestamps (for idle-since reporting). */
  getAllLastChangeAt(): ReadonlyMap<string, number> {
    return this.lastChangeAt;
  }

  /** Set the watchdog threshold in ms (null = disabled). */
  setWatchdog(thresholdMs: number | null): void {
    this.watchdogThresholdMs = thresholdMs;
    if (thresholdMs === null) this.watchdogAlerted.clear();
  }

  /** Return the current watchdog threshold in ms (null = disabled). */
  getWatchdogThreshold(): number | null {
    return this.watchdogThresholdMs;
  }

  /** Return last watchdog alert time for a session (0 if never alerted). */
  getWatchdogAlertedAt(id: string): number {
    return this.watchdogAlerted.get(id) ?? 0;
  }

  /** Return count of sessions with a group assigned. */
  getGroupCount(): number {
    return this.sessionGroups.size;
  }

  /** Set session groups from persisted prefs (bulk restore). */
  restoreGroups(groups: Record<string, string>): void {
    this.sessionGroups.clear();
    for (const [id, g] of Object.entries(groups)) this.sessionGroups.set(id, g);
  }

  /** Set or clear the group filter. Repaints sessions. */
  setGroupFilter(group: string | null): void {
    this.groupFilter = group && group.trim().length > 0 ? group.trim().toLowerCase() : null;
    if (this.active) this.paintSessions();
  }

  /** Get the current group filter (or null if none). */
  getGroupFilter(): string | null {
    return this.groupFilter;
  }

  /**
   * Set or clear a custom display name for a session (by 1-indexed number, ID, ID prefix, or title).
   * Returns true if session found. Pass empty/null to clear.
   */
  renameSession(sessionIdOrIndex: string | number, displayName: string | null): boolean {
    let sessionId: string | undefined;
    if (typeof sessionIdOrIndex === "number") {
      sessionId = this.sessions[sessionIdOrIndex - 1]?.id;
    } else {
      const needle = sessionIdOrIndex.toLowerCase();
      const match = this.sessions.find(
        (s) => s.id === sessionIdOrIndex || s.id.startsWith(needle) || s.title.toLowerCase() === needle,
      );
      sessionId = match?.id;
    }
    if (!sessionId) return false;
    if (!displayName || displayName.trim() === "") {
      this.sessionAliases.delete(sessionId);
    } else {
      this.sessionAliases.set(sessionId, truncateRename(displayName.trim()));
    }
    if (this.active) this.paintSessions();
    return true;
  }

  /** Get the custom display name for a session (or undefined if not renamed). */
  getSessionAlias(id: string): string | undefined {
    return this.sessionAliases.get(id);
  }

  /** Return all session aliases (for persistence and listing). */
  getAllSessionAliases(): ReadonlyMap<string, string> {
    return this.sessionAliases;
  }

  /** Restore session aliases from persisted prefs (bulk restore). */
  restoreSessionAliases(aliases: Record<string, string>): void {
    this.sessionAliases.clear();
    for (const [id, name] of Object.entries(aliases)) this.sessionAliases.set(id, name);
  }

  /**
   * Add a bookmark at the current activity position.
   * Returns the bookmark number (1-indexed) or 0 if buffer is empty.
   */
  addBookmark(): number {
    if (this.activityBuffer.length === 0) return 0;
    // bookmark the entry at the current view position
    const visibleLines = this.scrollBottom - this.scrollTop + 1;
    const { start } = computeScrollSlice(this.activityBuffer.length, visibleLines, this.scrollOffset);
    const entry = this.activityBuffer[start];
    if (!entry) return 0;
    const bm: Bookmark = { index: start, label: `${entry.time} ${entry.tag}` };
    this.bookmarks.push(bm);
    if (this.bookmarks.length > MAX_BOOKMARKS) {
      this.bookmarks = this.bookmarks.slice(-MAX_BOOKMARKS);
    }
    return this.bookmarks.length;
  }

  /**
   * Jump to a bookmark by number (1-indexed). Returns false if not found.
   * Adjusts scroll offset to center the bookmarked entry.
   */
  jumpToBookmark(num: number): boolean {
    const bm = this.bookmarks[num - 1];
    if (!bm) return false;
    // clamp index to current buffer
    if (bm.index >= this.activityBuffer.length) return false;
    const visibleLines = this.scrollBottom - this.scrollTop + 1;
    this.scrollOffset = computeBookmarkOffset(bm.index, this.activityBuffer.length, visibleLines);
    if (this.scrollOffset === 0) this.newWhileScrolled = 0;
    if (this.active && this.viewMode === "overview") {
      this.repaintActivityRegion();
      this.paintSeparator();
    }
    return true;
  }

  /** Return all bookmarks (for /marks listing). */
  getBookmarks(): readonly Bookmark[] {
    return this.bookmarks;
  }

  /** Return bookmark count. */
  getBookmarkCount(): number {
    return this.bookmarks.length;
  }

  // ── State updates ───────────────────────────────────────────────────────

  updateState(opts: {
    phase?: DaemonPhase;
    pollCount?: number;
    sessions?: DaemonSessionState[];
    paused?: boolean;
    reasonerName?: string;
    nextTickAt?: number;
    pendingCount?: number;
  }): void {
    if (opts.phase !== undefined) this.phase = opts.phase;
    if (opts.pollCount !== undefined) this.pollCount = opts.pollCount;
    if (opts.paused !== undefined) this.paused = opts.paused;
    if (opts.reasonerName !== undefined) this.reasonerName = opts.reasonerName;
    if (opts.nextTickAt !== undefined) this.nextTickAt = opts.nextTickAt;
    if (opts.pendingCount !== undefined) this.pendingCount = opts.pendingCount;
    if (opts.sessions !== undefined) {
      // track activity changes for sort-by-activity + first-seen for uptime
      const now = Date.now();
       const BURN_ALERT_COOLDOWN_MS = 5 * 60 * 1000; // max one alert per session per 5 minutes
       const quietNow = this.isCurrentlyQuiet(new Date(now));
       for (const s of opts.sessions) {
        if (!this.sessionFirstSeen.has(s.id)) this.sessionFirstSeen.set(s.id, now);
        // track status changes for flap detection
        const prevStatus = this.prevSessionStatus.get(s.id);
        if (prevStatus !== undefined && prevStatus !== s.status) {
          const statusHist = this.sessionStatusHistory.get(s.id) ?? [];
          statusHist.push({ status: s.status, ts: now });
          if (statusHist.length > MAX_STATUS_HISTORY) statusHist.shift();
          this.sessionStatusHistory.set(s.id, statusHist);
          // check for flapping
          if (isFlapping(statusHist, now) && !quietNow) {
            const lastFlapAlert = this.flapAlerted.get(s.id) ?? 0;
            if (now - lastFlapAlert >= 5 * 60_000) {
              this.flapAlerted.set(s.id, now);
              this.log("status", `flap: ${s.title} is oscillating rapidly (${statusHist.filter((c) => c.ts >= now - FLAP_WINDOW_MS).length} status changes in ${Math.round(FLAP_WINDOW_MS / 60_000)}m)`, s.id);
            }
          }
        }
        this.prevSessionStatus.set(s.id, s.status);
        const prev = this.prevLastActivity.get(s.id);
        if (s.lastActivity !== undefined && s.lastActivity !== prev) {
          this.lastChangeAt.set(s.id, now);
        }
        if (s.lastActivity !== undefined) this.prevLastActivity.set(s.id, s.lastActivity);
        // track cost string + check budget
        if (s.costStr) {
          this.sessionCosts.set(s.id, s.costStr);
          const budget = this.sessionBudgets.get(s.id) ?? this.globalBudget;
          if (budget !== null && isOverBudget(s.costStr, budget) && !quietNow) {
            const lastAlert = this.budgetAlerted.get(s.id) ?? 0;
            if (now - lastAlert >= 5 * 60_000) {
              this.budgetAlerted.set(s.id, now);
              this.log("status", formatBudgetAlert(s.title, s.costStr, budget), s.id);
            }
          }
        }
        // track context token history for burn-rate alerts
        const tokens = parseContextTokenNumber(s.contextTokens);
        if (tokens !== null) {
          const hist = this.sessionContextHistory.get(s.id) ?? [];
          hist.push({ tokens, ts: now });
          if (hist.length > MAX_CONTEXT_HISTORY) hist.splice(0, hist.length - MAX_CONTEXT_HISTORY);
          this.sessionContextHistory.set(s.id, hist);
          // check burn rate and emit alert if above threshold (with cooldown)
          const burnRate = computeContextBurnRate(hist, now);
          if (burnRate !== null && burnRate > CONTEXT_BURN_THRESHOLD && !quietNow) {
            const lastAlert = this.burnRateAlerted.get(s.id) ?? 0;
            if (now - lastAlert >= BURN_ALERT_COOLDOWN_MS) {
              this.burnRateAlerted.set(s.id, now);
              this.log("status", formatBurnRateAlert(s.title, burnRate), s.id);
            }
          }
        }
        // check context ceiling and emit alert if above threshold (with cooldown)
        const ceiling = parseContextCeiling(s.contextTokens);
        if (ceiling !== null && ceiling.current / ceiling.max >= CONTEXT_CEILING_THRESHOLD && !quietNow) {
          const lastCeiling = this.ceilingAlerted.get(s.id) ?? 0;
          if (now - lastCeiling >= BURN_ALERT_COOLDOWN_MS) {
            this.ceilingAlerted.set(s.id, now);
            this.log("status", formatContextCeilingAlert(s.title, ceiling.current, ceiling.max), s.id);
          }
        }
      }
      // watchdog: alert if session has been idle longer than threshold (skip during quiet hours)
      if (this.watchdogThresholdMs !== null && !quietNow) {
        for (const s of opts.sessions) {
          const lastChange = this.lastChangeAt.get(s.id);
          if (lastChange === undefined) continue; // not yet tracked
          const idleMs = now - lastChange;
          if (idleMs >= this.watchdogThresholdMs) {
            const lastAlert = this.watchdogAlerted.get(s.id) ?? 0;
            if (now - lastAlert >= WATCHDOG_ALERT_COOLDOWN_MS) {
              this.watchdogAlerted.set(s.id, now);
              const idleStr = formatUptime(idleMs);
              this.log("status", `watchdog: ${s.title} has had no output change for ${idleStr}`, s.id);
            }
          }
        }
      }
       // prune context history for sessions that no longer exist
       const currentIds = new Set(opts.sessions.map((s) => s.id));
       for (const id of this.sessionContextHistory.keys()) {
         if (!currentIds.has(id)) this.sessionContextHistory.delete(id);
       }
       // record health snapshots
       for (const s of opts.sessions) {
         const ceiling2 = parseContextCeiling(s.contextTokens);
         const cf2 = ceiling2 ? ceiling2.current / ceiling2.max : null;
         const bh2 = this.sessionContextHistory.get(s.id);
         const br2 = bh2 ? computeContextBurnRate(bh2, now) : null;
         const lc2 = this.lastChangeAt.get(s.id);
         const idle2 = lc2 !== undefined ? now - lc2 : null;
         const hs = computeHealthScore({
           errorCount: this.sessionErrorCounts.get(s.id) ?? 0,
           burnRatePerMin: br2,
           contextFraction: cf2,
           idleMs: idle2,
           watchdogThresholdMs: this.watchdogThresholdMs,
         });
         const hist = this.sessionHealthHistory.get(s.id) ?? [];
         hist.push({ score: hs, ts: now });
         if (hist.length > MAX_HEALTH_HISTORY) hist.shift();
         this.sessionHealthHistory.set(s.id, hist);
       }
       const sorted = sortSessions(opts.sessions, this.sortMode, this.lastChangeAt, this.pinnedIds);
      const prevVisibleCount = this.getVisibleCount();
      this.sessions = sorted;
      const newVisibleCount = this.getVisibleCount();
      if (newVisibleCount !== prevVisibleCount) {
        this.computeLayout(newVisibleCount);
        this.paintAll();
        return;
      }
    }
    // repaint header + sessions (cheap)
    if (this.active) {
      this.paintHeader();
      this.paintSessions();
      this.paintInputLine();
    }
  }

  // ── Activity log ────────────────────────────────────────────────────────

  // push a new activity entry — this is the primary way to show output
  // sessionId optionally ties the entry to a specific session (for mute filtering)
  log(tag: string, text: string, sessionId?: string): void {
    const now = new Date();
    const time = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;
    const entry: ActivityEntry = { time, tag, text, ...(sessionId ? { sessionId } : {}) };
    this.activityBuffer.push(entry);
    this.activityTimestamps.push(now.getTime());
    if (this.activityBuffer.length > this.maxActivity) {
      this.activityBuffer = this.activityBuffer.slice(-this.maxActivity);
      this.activityTimestamps = this.activityTimestamps.slice(-this.maxActivity);
    }
    // terminal bell for high-signal events (with cooldown)
    if (this.bellEnabled && shouldBell(tag, text)) {
      const nowMs = now.getTime();
      if (nowMs - this.lastBellAt >= BELL_COOLDOWN_MS) {
        this.lastBellAt = nowMs;
        process.stderr.write("\x07");
      }
    }
    // collect "status" alerts into alert log (for /alert-log)
    if (tag === "status") {
      this.alertLog.push(entry);
      if (this.alertLog.length > 100) this.alertLog.shift();
    }
    // track per-session error counts + timestamps (for sparklines)
    if (sessionId && shouldAutoPin(tag)) {
      this.sessionErrorCounts.set(sessionId, (this.sessionErrorCounts.get(sessionId) ?? 0) + 1);
      const errTs = this.sessionErrorTimestamps.get(sessionId) ?? [];
      errTs.push(now.getTime());
      if (errTs.length > MAX_ERROR_TIMESTAMPS) errTs.splice(0, errTs.length - MAX_ERROR_TIMESTAMPS);
      this.sessionErrorTimestamps.set(sessionId, errTs);
    }
    // auto-pin sessions that emit errors (when enabled)
    if (this.autoPinOnError && sessionId && shouldAutoPin(tag) && !this.pinnedIds.has(sessionId)) {
      this.pinnedIds.add(sessionId);
      if (this.active) this.paintSessions();
    }
    // track suppressed entry counts regardless of active state (for badge accuracy)
    if (shouldMuteEntry(entry, this.mutedIds) && entry.sessionId) {
      this.mutedEntryCounts.set(entry.sessionId, (this.mutedEntryCounts.get(entry.sessionId) ?? 0) + 1);
    }
    if (this.active) {
      // muted entries are still buffered + persisted but hidden from display
      if (shouldMuteEntry(entry, this.mutedIds)) {
        // silently skip display — entry is in buffer for scroll-back if unmuted later
      } else if (isSuppressedEntry(entry, this.suppressedTags)) {
        // suppressed tag (e.g. /mute-errors) — silently buffered, hidden from display
      } else if (this.filterTag && !matchesTagFilter(entry, this.filterTag)) {
        // tag filter active: silently skip non-matching entries
      } else if (this.searchPattern) {
        // search active: only show new entry if it matches
        if (matchesSearch(entry, this.searchPattern)) {
          if (this.scrollOffset > 0) {
            this.newWhileScrolled++;
            this.paintSeparator();
          } else {
            this.writeActivityLine(entry);
          }
        }
        // non-matching entries are silently buffered — visible when search is cleared
      } else if (this.scrollOffset > 0) {
        // user is scrolled back — don't auto-scroll, just show indicator
        this.newWhileScrolled++;
        this.paintSeparator();
      } else {
        this.writeActivityLine(entry);
      }
    }
    // persist to disk (fire-and-forget, never blocks)
    appendHistoryEntry({ ts: now.getTime(), time, tag, text });
  }

  // populate activity buffer from persisted history before start()
  // entries are loaded from the JSONL file and added to the in-memory buffer
  replayHistory(entries: HistoryEntry[]): void {
    for (const e of entries) {
      this.activityBuffer.push({ time: e.time, tag: e.tag, text: e.text });
    }
    // trim to max
    if (this.activityBuffer.length > this.maxActivity) {
      this.activityBuffer = this.activityBuffer.slice(-this.maxActivity);
    }
  }

  /** Apply all active display filters to an entry array: mute, suppress, tag, search. */
  private applyDisplayFilters(entries: ActivityEntry[]): ActivityEntry[] {
    let out = entries;
    if (this.mutedIds.size > 0) out = out.filter((e) => !shouldMuteEntry(e, this.mutedIds));
    if (this.suppressedTags.size > 0) out = out.filter((e) => !isSuppressedEntry(e, this.suppressedTags));
    if (this.filterTag) out = out.filter((e) => matchesTagFilter(e, this.filterTag!));
    if (this.searchPattern) out = out.filter((e) => matchesSearch(e, this.searchPattern!));
    return out;
  }

  // ── Scroll navigation ────────────────────────────────────────────────────

  scrollUp(lines?: number): void {
    if (!this.active) return;
    const visibleLines = this.scrollBottom - this.scrollTop + 1;
    const n = lines ?? Math.max(1, Math.floor(visibleLines / 2));
    const entryCount = this.applyDisplayFilters(this.activityBuffer).length;
    const maxOffset = Math.max(0, entryCount - visibleLines);
    this.scrollOffset = Math.min(maxOffset, this.scrollOffset + n);
    this.repaintActivityRegion();
    this.paintSeparator();
  }

  scrollDown(lines?: number): void {
    if (!this.active) return;
    const visibleLines = this.scrollBottom - this.scrollTop + 1;
    const n = lines ?? Math.max(1, Math.floor(visibleLines / 2));
    const wasScrolled = this.scrollOffset > 0;
    this.scrollOffset = Math.max(0, this.scrollOffset - n);
    if (wasScrolled && this.scrollOffset === 0) this.newWhileScrolled = 0;
    this.repaintActivityRegion();
    this.paintSeparator();
  }

  scrollToTop(): void {
    if (!this.active) return;
    const visibleLines = this.scrollBottom - this.scrollTop + 1;
    const entryCount = this.applyDisplayFilters(this.activityBuffer).length;
    this.scrollOffset = Math.max(0, entryCount - visibleLines);
    this.repaintActivityRegion();
    this.paintSeparator();
  }

  scrollToBottom(): void {
    if (!this.active) return;
    this.scrollOffset = 0;
    this.newWhileScrolled = 0;
    this.repaintActivityRegion();
    this.paintSeparator();
  }

  isScrolledBack(): boolean {
    return this.scrollOffset > 0;
  }

  // ── Drill-down scroll ─────────────────────────────────────────────────

  scrollDrilldownUp(lines?: number): void {
    if (!this.active || this.viewMode !== "drilldown" || !this.drilldownSessionId) return;
    const outputLines = this.sessionOutputs.get(this.drilldownSessionId) ?? [];
    const visibleLines = this.scrollBottom - this.scrollTop + 1;
    const n = lines ?? Math.max(1, Math.floor(visibleLines / 2));
    const maxOffset = Math.max(0, outputLines.length - visibleLines);
    this.drilldownScrollOffset = Math.min(maxOffset, this.drilldownScrollOffset + n);
    this.repaintDrilldownContent();
    this.paintDrilldownSeparator();
  }

  scrollDrilldownDown(lines?: number): void {
    if (!this.active || this.viewMode !== "drilldown") return;
    const visibleLines = this.scrollBottom - this.scrollTop + 1;
    const n = lines ?? Math.max(1, Math.floor(visibleLines / 2));
    const wasScrolled = this.drilldownScrollOffset > 0;
    this.drilldownScrollOffset = Math.max(0, this.drilldownScrollOffset - n);
    if (wasScrolled && this.drilldownScrollOffset === 0) this.drilldownNewWhileScrolled = 0;
    this.repaintDrilldownContent();
    this.paintDrilldownSeparator();
  }

  scrollDrilldownToBottom(): void {
    if (!this.active || this.viewMode !== "drilldown") return;
    this.drilldownScrollOffset = 0;
    this.drilldownNewWhileScrolled = 0;
    this.repaintDrilldownContent();
    this.paintDrilldownSeparator();
  }

  isDrilldownScrolledBack(): boolean {
    return this.drilldownScrollOffset > 0;
  }

  // ── Drill-down mode ────────────────────────────────────────────────────

  /** Store full session outputs (called each tick from main loop) */
  setSessionOutputs(outputs: Map<string, string>): void {
    for (const [id, text] of outputs) {
      const prevLen = this.sessionOutputs.get(id)?.length ?? 0;
      const lines = text.split("\n");
      this.sessionOutputs.set(id, lines);
      // track new lines while scrolled back in drill-down
      if (this.viewMode === "drilldown" && this.drilldownSessionId === id && this.drilldownScrollOffset > 0) {
        const newLines = Math.max(0, lines.length - prevLen);
        this.drilldownNewWhileScrolled += newLines;
      }
    }
    // repaint drill-down view if we're watching this session
    if (this.active && this.viewMode === "drilldown" && this.drilldownSessionId) {
      this.repaintDrilldownContent();
      this.paintDrilldownSeparator();
    }
  }

  /** Enter drill-down view for a session. Returns false if session not found. */
  enterDrilldown(sessionIdOrIndex: string | number): boolean {
    let sessionId: string | undefined;
    if (typeof sessionIdOrIndex === "number") {
      const idx = sessionIdOrIndex - 1; // 1-indexed for user
      if (idx >= 0 && idx < this.sessions.length) {
        sessionId = this.sessions[idx].id;
      }
    } else {
      // match by id prefix or title (case-insensitive)
      const needle = sessionIdOrIndex.toLowerCase();
      const match = this.sessions.find(
        (s) => s.id === sessionIdOrIndex || s.id.startsWith(needle) || s.title.toLowerCase() === needle,
      );
      sessionId = match?.id;
    }
    if (!sessionId) return false;
    this.viewMode = "drilldown";
    this.drilldownSessionId = sessionId;
    this.drilldownScrollOffset = 0;
    this.drilldownNewWhileScrolled = 0;
    this.hoverSessionIdx = null;
    if (this.active) {
      this.computeLayout(this.getVisibleCount());
      this.paintAll();
    }
    return true;
  }

  /** Exit drill-down, return to overview */
  exitDrilldown(): void {
    if (this.viewMode === "overview") return;
    this.viewMode = "overview";
    this.drilldownSessionId = null;
    this.drilldownScrollOffset = 0;
    this.drilldownNewWhileScrolled = 0;
    this.hoverSessionIdx = null;
    if (this.active) {
      this.computeLayout(this.getVisibleCount());
      this.paintAll();
    }
  }

  /** Get current view mode */
  getViewMode(): "overview" | "drilldown" {
    return this.viewMode;
  }

  /** Get drill-down session ID (or null) */
  getDrilldownSessionId(): string | null {
    return this.drilldownSessionId;
  }

  // ── Search ──────────────────────────────────────────────────────────────

  /** Set or clear the search filter. Resets scroll and repaints. */
  setSearch(pattern: string | null): void {
    this.searchPattern = pattern && pattern.length > 0 ? pattern : null;
    this.scrollOffset = 0;
    this.newWhileScrolled = 0;
    if (this.active && this.viewMode === "overview") {
      this.repaintActivityRegion();
      this.paintSeparator();
    }
  }

  /** Get the current search pattern (or null if no active search). */
  getSearchPattern(): string | null {
    return this.searchPattern;
  }

  // ── Tag filter ─────────────────────────────────────────────────────────

  /** Set or clear the tag filter. Resolves presets (e.g. "errors"). Resets scroll and repaints. */
  setTagFilter(tag: string | null): void {
    this.filterTag = tag && tag.length > 0 ? resolveFilterPreset(tag) : null;
    this.scrollOffset = 0;
    this.newWhileScrolled = 0;
    if (this.active && this.viewMode === "overview") {
      this.repaintActivityRegion();
      this.paintSeparator();
    }
  }

  /** Get the current tag filter (or null if none active). */
  getTagFilter(): string | null {
    return this.filterTag;
  }

  // ── Hover ───────────────────────────────────────────────────────────────

  /** Set the hovered session index (1-indexed) or null to clear. Only repaints the affected cards. */
  setHoverSession(idx: number | null): void {
    if (idx === this.hoverSessionIdx) return; // no change
    const prev = this.hoverSessionIdx;
    this.hoverSessionIdx = idx;
    if (this.active && this.viewMode === "overview") {
      // repaint only the affected session cards (previous and new hover)
      if (prev !== null) this.repaintSessionCard(prev);
      if (idx !== null) this.repaintSessionCard(idx);
    }
  }

  /** Get the current hovered session index (1-indexed, null if none). */
  getHoverSession(): number | null {
    return this.hoverSessionIdx;
  }

  // ── Layout computation ──────────────────────────────────────────────────

  private updateDimensions(): void {
    this.cols = process.stderr.columns || 80;
    this.rows = process.stderr.rows || 24;
  }

  private computeLayout(sessionCount: number): void {
    this.updateDimensions();
    if (this.viewMode === "drilldown") {
      // drilldown: header (1) + separator (1) + content + input (1)
      this.sessionRows = 0;
      this.separatorRow = this.headerHeight + 1;
      this.inputRow = this.rows;
      this.scrollTop = this.separatorRow + 1;
      this.scrollBottom = this.rows - 1;
    } else {
      // overview: header (1) + sessions box + separator + activity + input
      const visibleSessions = this.getVisibleSessions();
      const sessBodyRows = this.compactMode
        ? computeCompactRowCount(visibleSessions, this.cols - 2)
        : Math.max(sessionCount, 1);
      this.sessionRows = sessBodyRows + 2; // + top/bottom borders
      this.separatorRow = this.headerHeight + this.sessionRows + 1;
      this.inputRow = this.rows;
      this.scrollTop = this.separatorRow + 1;
      this.scrollBottom = this.rows - 1;
    }

    if (this.active) {
      process.stderr.write(setScrollRegion(this.scrollTop, this.scrollBottom));
    }
  }

  private onResize(): void {
    this.computeLayout(this.getVisibleCount());
    this.paintAll();
  }

  // ── Painting ────────────────────────────────────────────────────────────

  private paintAll(): void {
    if (!this.active) return;
    process.stderr.write(CLEAR_SCREEN);
    process.stderr.write(setScrollRegion(this.scrollTop, this.scrollBottom));
    this.paintHeader();
    if (this.viewMode === "drilldown") {
      this.paintDrilldownSeparator();
      this.repaintDrilldownContent();
    } else {
      this.paintSessions();
      this.paintSeparator();
      this.repaintActivityRegion();
    }
    this.paintInputLine();
  }

  private paintHeader(): void {
    let line: string;
    if (this.viewMode === "drilldown" && this.drilldownSessionId) {
      line = formatDrilldownHeader(this.drilldownSessionId, this.sessions, this.phase, this.paused, this.spinnerFrame, this.cols);
    } else {
      const phaseText = phaseDisplay(this.phase, this.paused, this.spinnerFrame);
      const visCount = this.getVisibleCount();
      const sessCount = this.focusMode
        ? `${visCount}/${this.sessions.length} agent${this.sessions.length !== 1 ? "s" : ""}`
        : `${this.sessions.length} agent${this.sessions.length !== 1 ? "s" : ""}`;
      const activeCount = this.sessions.filter((s) => s.userActive).length;
      const activeTag = activeCount > 0 ? `  ${SLATE}│${RESET}  ${AMBER}${activeCount} user${RESET}` : "";

      // countdown to next tick (only in sleeping phase)
      let countdownTag = "";
      if (this.phase === "sleeping" && this.nextTickAt > 0) {
        const remaining = Math.max(0, Math.ceil((this.nextTickAt - Date.now()) / 1000));
        countdownTag = `  ${SLATE}│${RESET}  ${SLATE}${remaining}s${RESET}`;
      }

      // reasoner badge
      const reasonerTag = this.reasonerName ? `  ${SLATE}│${RESET}  ${TEAL}${this.reasonerName}${RESET}` : "";

      // watchdog indicator — show threshold when active
      const wdMin = this.watchdogThresholdMs !== null ? Math.round(this.watchdogThresholdMs / 60_000) : null;
      const watchdogTag = wdMin !== null ? `  ${SLATE}│${RESET}  ${AMBER}⊛${wdMin}m${RESET}` : "";

      // group filter indicator
      const groupFilterTag = this.groupFilter ? `  ${SLATE}│${RESET}  ${TEAL}${GROUP_ICON}${this.groupFilter}${RESET}` : "";

      line = ` ${INDIGO}${BOLD}aoaoe${RESET} ${SLATE}${this.version}${RESET}  ${SLATE}│${RESET}  #${this.pollCount}  ${SLATE}│${RESET}  ${sessCount}  ${SLATE}│${RESET}  ${phaseText}${activeTag}${countdownTag}${watchdogTag}${groupFilterTag}${reasonerTag}`;
    }
    process.stderr.write(
      SAVE_CURSOR +
      moveTo(1, 1) + CLEAR_LINE + BG_DARK + WHITE + truncateAnsi(line, this.cols) + padToWidth(line, this.cols) + RESET +
      RESTORE_CURSOR
    );
  }

  private paintSessions(): void {
    const startRow = this.headerHeight + 1;
    const innerWidth = this.cols - 2; // inside the box borders
    const visibleSessions = this.getVisibleSessions();
    const visibleCount = visibleSessions.length;

    // top border with label (includes focus/compact/sort/group filter tags)
    const focusTag = this.focusMode ? "focus" : "";
    const sortTag = this.sortMode !== "default" ? this.sortMode : "";
    const compactTag = this.compactMode ? "compact" : "";
    const groupTag = this.groupFilter ? `group:${this.groupFilter}` : "";
    const tagTag = this.tagFilter2 ? `tag:${this.tagFilter2}` : "";
    const tags = [focusTag, compactTag, sortTag, groupTag, tagTag].filter(Boolean).join(", ");
    const label = tags ? ` agents (${tags}) ` : " agents ";
    const borderAfterLabel = Math.max(0, innerWidth - label.length);
    const topBorder = `${SLATE}${BOX.rtl}${BOX.h}${RESET}${SLATE}${label}${RESET}${SLATE}${BOX.h.repeat(borderAfterLabel)}${BOX.rtr}${RESET}`;
    process.stderr.write(SAVE_CURSOR + moveTo(startRow, 1) + CLEAR_LINE + truncateAnsi(topBorder, this.cols));

    if (visibleSessions.length === 0) {
      // empty state — distinguish between filter states
      let msg: string;
      if (this.tagFilter2 && this.sessions.length > 0) {
        msg = `${DIM}no agents with tag "${this.tagFilter2}" — /tag <N> <tag> to assign, /tag-filter to exit${RESET}`;
      } else if (this.groupFilter && this.sessions.length > 0) {
        msg = `${DIM}no agents in group "${this.groupFilter}" — /group <N> <tag> to assign, /group-filter to exit${RESET}`;
      } else if (this.focusMode && this.sessions.length > 0) {
        msg = `${DIM}no pinned agents — /pin to add, /focus to exit${RESET}`;
      } else {
        msg = `${DIM}no agents connected${RESET}`;
      }
      const empty = `${SLATE}${BOX.v}${RESET}  ${msg}`;
      const padded = padBoxLine(empty, this.cols);
      process.stderr.write(moveTo(startRow + 1, 1) + CLEAR_LINE + padded);
    } else if (this.compactMode) {
      // compact: inline tokens, multiple per row (with pin indicators + health glyphs)
      const nowMsCompact = Date.now();
      const noteIdSet = new Set(this.sessionNotes.keys());
      const compactHealthScores = new Map<string, number>();
      for (const s of visibleSessions) {
        const ceilingC = parseContextCeiling(s.contextTokens);
        const cfC = ceilingC ? ceilingC.current / ceilingC.max : null;
        const bhC = this.sessionContextHistory.get(s.id);
        const brC = bhC ? computeContextBurnRate(bhC, nowMsCompact) : null;
        const lcC = this.lastChangeAt.get(s.id);
        const idleC = lcC !== undefined ? nowMsCompact - lcC : null;
        compactHealthScores.set(s.id, computeHealthScore({
          errorCount: this.sessionErrorCounts.get(s.id) ?? 0,
          burnRatePerMin: brC,
          contextFraction: cfC,
          idleMs: idleC,
          watchdogThresholdMs: this.watchdogThresholdMs,
        }));
      }
      const compactActivityRates = new Map<string, number>();
      for (const s of visibleSessions) {
        compactActivityRates.set(s.id, computeSessionActivityRate(
          this.activityBuffer, this.activityTimestamps, s.id, nowMsCompact
        ));
      }
      const compactRows = formatCompactRows(visibleSessions, innerWidth - 1, this.pinnedIds, this.mutedIds, noteIdSet, compactHealthScores, compactActivityRates);
      for (let r = 0; r < compactRows.length; r++) {
        const line = `${SLATE}${BOX.v}${RESET} ${compactRows[r]}`;
        const padded = padBoxLine(line, this.cols);
        process.stderr.write(moveTo(startRow + 1 + r, 1) + CLEAR_LINE + padded);
      }
    } else {
      const nowMs = Date.now();
      for (let i = 0; i < visibleSessions.length; i++) {
        const s = visibleSessions[i];
        const isHovered = this.hoverSessionIdx === i + 1; // 1-indexed
        const bg = isHovered ? BG_HOVER : "";
        const pinned = this.pinnedIds.has(s.id);
        const muted = this.mutedIds.has(s.id);
        const noted = this.sessionNotes.has(s.id);
        const group = this.sessionGroups.get(s.id);
        const errTs = this.sessionErrorTimestamps.get(s.id);
        const errSparkline = errTs ? formatSessionErrorSparkline(errTs, nowMs) : "";
        const lastChange = this.lastChangeAt.get(s.id);
        const idleSinceMs = lastChange !== undefined ? nowMs - lastChange : undefined;
        // compute health score
        const ceiling = parseContextCeiling(s.contextTokens);
        const contextFraction = ceiling ? ceiling.current / ceiling.max : null;
        const burnHist = this.sessionContextHistory.get(s.id);
        const burnRate = burnHist ? computeContextBurnRate(burnHist, nowMs) : null;
        const healthScore = computeHealthScore({
          errorCount: this.sessionErrorCounts.get(s.id) ?? 0,
          burnRatePerMin: burnRate,
          contextFraction,
          idleMs: idleSinceMs ?? null,
          watchdogThresholdMs: this.watchdogThresholdMs,
        });
        const healthBadge = formatHealthBadge(healthScore);
        const displayName = this.sessionAliases.get(s.id);
        const sTags = this.sessionTags.get(s.id);
        const tagsBadge = sTags && sTags.size > 0 ? `${formatSessionTagsBadge(sTags)} ` : "";
        const tagsBadgeWidth = sTags && sTags.size > 0 ? stripAnsiForLen(formatSessionTagsBadge(sTags)) + 1 : 0;
        const colorName = this.sessionColors.get(s.id);
        const colorDot = colorName ? formatColorDot(colorName) : "";
        const colorDotWidth = colorName ? 2 : 0; // dot + space
        const muteBadge = muted ? formatMuteBadge(this.mutedEntryCounts.get(s.id) ?? 0) : "";
        const muteBadgeWidth = muted ? String(Math.min(this.mutedEntryCounts.get(s.id) ?? 0, 9999)).length + 2 : 0; // "(N)" visible chars, 0 when count is 0
        const actualBadgeWidth = (this.mutedEntryCounts.get(s.id) ?? 0) > 0 ? muteBadgeWidth + 1 : 0; // +1 for trailing space
        const groupBadgeWidth = group ? group.length + 1 + 1 : 0; // icon + name + space
        const pin = pinned ? `${AMBER}${PIN_ICON}${RESET} ` : "";
        const mute = muted ? `${DIM}${MUTE_ICON}${RESET} ` : "";
        const note = noted ? `${TEAL}${NOTE_ICON}${RESET} ` : "";
        const groupBadge = group ? `${formatGroupBadge(group)} ` : "";
        const badgeSuffix = muteBadge ? `${muteBadge} ` : "";
        const iconsWidth = (pinned ? 2 : 0) + (muted ? 2 : 0) + (noted ? 2 : 0) + actualBadgeWidth + groupBadgeWidth + tagsBadgeWidth + colorDotWidth;
        const cardWidth = innerWidth - 1 - iconsWidth;
        const cardAge = s.createdAt ? formatSessionAge(s.createdAt, nowMs) : undefined;
        const line = `${bg}${SLATE}${BOX.v}${RESET}${bg} ${pin}${mute}${badgeSuffix}${note}${groupBadge}${tagsBadge}${colorDot}${formatSessionCard(s, cardWidth, errSparkline || undefined, idleSinceMs, healthBadge || undefined, displayName, cardAge || undefined)}`;
        const padded = padBoxLineHover(line, this.cols, isHovered);
        process.stderr.write(moveTo(startRow + 1 + i, 1) + CLEAR_LINE + padded);
      }
    }

    // bottom border
    const bodyRows = this.compactMode
      ? computeCompactRowCount(visibleSessions, innerWidth)
      : Math.max(visibleCount, 1);
    const bottomRow = startRow + 1 + bodyRows;
    const bottomBorder = `${SLATE}${BOX.rbl}${BOX.h.repeat(Math.max(0, this.cols - 2))}${BOX.rbr}${RESET}`;
    process.stderr.write(moveTo(bottomRow, 1) + CLEAR_LINE + truncateAnsi(bottomBorder, this.cols));

    // clear any leftover rows below the box
    for (let r = bottomRow + 1; r < this.separatorRow; r++) {
      process.stderr.write(moveTo(r, 1) + CLEAR_LINE);
    }

    process.stderr.write(RESTORE_CURSOR);
  }

  /** Repaint a single session card by 1-indexed position (for hover updates). */
  private repaintSessionCard(idx: number): void {
    if (!this.active || this.viewMode !== "overview") return;
    const i = idx - 1; // 0-indexed
    const visibleSessions = this.getVisibleSessions();
    if (i < 0 || i >= visibleSessions.length) return;
    const startRow = this.headerHeight + 1;
    const innerWidth = this.cols - 2;
    const s = visibleSessions[i];
    const isHovered = this.hoverSessionIdx === idx;
    const bg = isHovered ? BG_HOVER : "";
    const pinned = this.pinnedIds.has(s.id);
    const muted = this.mutedIds.has(s.id);
    const noted = this.sessionNotes.has(s.id);
    const group = this.sessionGroups.get(s.id);
    const nowMs2 = Date.now();
    const errTs = this.sessionErrorTimestamps.get(s.id);
    const errSparkline = errTs ? formatSessionErrorSparkline(errTs, nowMs2) : "";
    const lastChange = this.lastChangeAt.get(s.id);
    const idleSinceMs = lastChange !== undefined ? nowMs2 - lastChange : undefined;
    const ceiling2 = parseContextCeiling(s.contextTokens);
    const contextFraction2 = ceiling2 ? ceiling2.current / ceiling2.max : null;
    const burnHist2 = this.sessionContextHistory.get(s.id);
    const burnRate2 = burnHist2 ? computeContextBurnRate(burnHist2, nowMs2) : null;
    const healthScore2 = computeHealthScore({
      errorCount: this.sessionErrorCounts.get(s.id) ?? 0,
      burnRatePerMin: burnRate2,
      contextFraction: contextFraction2,
      idleMs: idleSinceMs ?? null,
      watchdogThresholdMs: this.watchdogThresholdMs,
    });
    const healthBadge2 = formatHealthBadge(healthScore2);
    const displayName2 = this.sessionAliases.get(s.id);
    const sTags2 = this.sessionTags.get(s.id);
    const tagsBadge2 = sTags2 && sTags2.size > 0 ? `${formatSessionTagsBadge(sTags2)} ` : "";
    const tagsBadgeWidth2 = sTags2 && sTags2.size > 0 ? stripAnsiForLen(formatSessionTagsBadge(sTags2)) + 1 : 0;
    const colorName2 = this.sessionColors.get(s.id);
    const colorDot2 = colorName2 ? formatColorDot(colorName2) : "";
    const colorDotWidth2 = colorName2 ? 2 : 0;
    const muteBadge = muted ? formatMuteBadge(this.mutedEntryCounts.get(s.id) ?? 0) : "";
    const actualBadgeWidth = (this.mutedEntryCounts.get(s.id) ?? 0) > 0
      ? String(Math.min(this.mutedEntryCounts.get(s.id) ?? 0, 9999)).length + 3 : 0; // "(N) " visible chars
    const groupBadgeWidth = group ? group.length + 1 + 1 : 0; // icon + name + space
    const pin = pinned ? `${AMBER}${PIN_ICON}${RESET} ` : "";
    const mute = muted ? `${DIM}${MUTE_ICON}${RESET} ` : "";
    const note = noted ? `${TEAL}${NOTE_ICON}${RESET} ` : "";
    const groupBadge = group ? `${formatGroupBadge(group)} ` : "";
    const badgeSuffix = muteBadge ? `${muteBadge} ` : "";
    const iconsWidth = (pinned ? 2 : 0) + (muted ? 2 : 0) + (noted ? 2 : 0) + actualBadgeWidth + groupBadgeWidth + tagsBadgeWidth2 + colorDotWidth2;
    const cardWidth = innerWidth - 1 - iconsWidth;
    const cardAge2 = s.createdAt ? formatSessionAge(s.createdAt, nowMs2) : undefined;
    const line = `${bg}${SLATE}${BOX.v}${RESET}${bg} ${pin}${mute}${badgeSuffix}${note}${groupBadge}${tagsBadge2}${colorDot2}${formatSessionCard(s, cardWidth, errSparkline || undefined, idleSinceMs, healthBadge2 || undefined, displayName2, cardAge2 || undefined)}`;
    const padded = padBoxLineHover(line, this.cols, isHovered);
    process.stderr.write(SAVE_CURSOR + moveTo(startRow + 1 + i, 1) + CLEAR_LINE + padded + RESTORE_CURSOR);
  }

  private paintSeparator(): void {
    const prefix = `${BOX.h}${BOX.h} activity `;
    let hints: string;
    // suppressed-errors indicator when active (shown before other filters)
    const suppressedSuffix = this.suppressedTags.size > 0
      ? `  ${DIM}${MUTE_ICON}errors${RESET}` : "";
    if (this.filterTag) {
      // tag filter takes precedence in the separator display
      const source = this.applyDisplayFilters(this.activityBuffer.filter((e) => !isSuppressedEntry(e, this.suppressedTags)));
      const matchCount = source.filter((e) => matchesTagFilter(e, this.filterTag!)).length;
      hints = formatTagFilterIndicator(this.filterTag, matchCount, source.length) + suppressedSuffix;
    } else if (this.searchPattern) {
      const filtered = this.activityBuffer.filter((e) => matchesSearch(e, this.searchPattern!));
      hints = formatSearchIndicator(this.searchPattern, filtered.length, this.activityBuffer.length);
    } else if (this.scrollOffset > 0) {
      hints = formatScrollIndicator(this.scrollOffset, this.activityBuffer.length, this.scrollBottom - this.scrollTop + 1, this.newWhileScrolled);
    } else {
      // live mode: show sparkline + minimal hints
      const spark = formatSparkline(computeSparkline(this.activityTimestamps));
      hints = spark ? ` ${spark}  /help ` : " click agent to view  esc esc: interrupt  /help ";
    }
    const totalLen = prefix.length + hints.length;
    const fill = Math.max(0, this.cols - totalLen);
    const left = Math.floor(fill / 2);
    const right = Math.ceil(fill / 2);
    const line = `${SLATE}${prefix}${BOX.h.repeat(left)}${DIM}${hints}${RESET}${SLATE}${BOX.h.repeat(right)}${RESET}`;
    process.stderr.write(
      SAVE_CURSOR + moveTo(this.separatorRow, 1) + CLEAR_LINE + truncateAnsi(line, this.cols) + RESTORE_CURSOR
    );
  }

  private writeActivityLine(entry: ActivityEntry): void {
    // move cursor to bottom of scroll region, write line (auto-scrolls region)
    const line = formatActivity(entry, this.cols);
    process.stderr.write(
      SAVE_CURSOR +
      moveTo(this.scrollBottom, 1) + "\n" + line +
      RESTORE_CURSOR
    );
    // repaint input line since scroll may have pushed it
    this.paintInputLine();
  }

  private repaintActivityRegion(): void {
    const visibleLines = this.scrollBottom - this.scrollTop + 1;
    // filter pipeline: muted → suppressed → tag → search
    const source = this.applyDisplayFilters(this.activityBuffer);
    const { start, end } = computeScrollSlice(source.length, visibleLines, this.scrollOffset);
    const entries = source.slice(start, end);
    for (let i = 0; i < visibleLines; i++) {
      const row = this.scrollTop + i;
      if (i < entries.length) {
        const line = formatActivity(entries[i], this.cols);
        process.stderr.write(moveTo(row, 1) + CLEAR_LINE + line);
      } else {
        process.stderr.write(moveTo(row, 1) + CLEAR_LINE);
      }
    }
  }

  // ── Drill-down rendering ──────────────────────────────────────────────

  private paintDrilldownSeparator(): void {
    const session = this.sessions.find((s) => s.id === this.drilldownSessionId);
    const title = session ? session.title : this.drilldownSessionId ?? "?";
    const noteText = this.drilldownSessionId ? this.sessionNotes.get(this.drilldownSessionId) : undefined;
    const noteSuffix = noteText ? `"${noteText}" ` : "";
    const firstSeen = this.drilldownSessionId ? this.sessionFirstSeen.get(this.drilldownSessionId) : undefined;
    const uptimeSuffix = firstSeen !== undefined ? `${DIM}${formatUptime(Date.now() - firstSeen)}${RESET} ` : "";
    const prefix = `${BOX.h}${BOX.h} ${title} ${uptimeSuffix}${noteSuffix}`;
    let hints: string;
    if (this.drilldownScrollOffset > 0) {
      const outputLines = this.sessionOutputs.get(this.drilldownSessionId ?? "") ?? [];
      const visibleLines = this.scrollBottom - this.scrollTop + 1;
      hints = formatDrilldownScrollIndicator(this.drilldownScrollOffset, outputLines.length, visibleLines, this.drilldownNewWhileScrolled);
    } else {
      hints = " click or /back: overview  scroll: navigate  /view N: switch ";
    }
    const totalLen = prefix.length + hints.length;
    const fill = Math.max(0, this.cols - totalLen);
    const left = Math.floor(fill / 2);
    const right = Math.ceil(fill / 2);
    const line = `${SLATE}${prefix}${BOX.h.repeat(left)}${DIM}${hints}${RESET}${SLATE}${BOX.h.repeat(right)}${RESET}`;
    process.stderr.write(
      SAVE_CURSOR + moveTo(this.separatorRow, 1) + CLEAR_LINE + truncateAnsi(line, this.cols) + RESTORE_CURSOR
    );
  }

  private repaintDrilldownContent(): void {
    if (!this.drilldownSessionId) return;
    const outputLines = this.sessionOutputs.get(this.drilldownSessionId) ?? [];
    const visibleLines = this.scrollBottom - this.scrollTop + 1;
    // use scroll offset: 0 = tail (live), >0 = scrolled back
    const { start, end } = computeScrollSlice(outputLines.length, visibleLines, this.drilldownScrollOffset);
    const visible = outputLines.slice(start, end);
    for (let i = 0; i < visibleLines; i++) {
      const row = this.scrollTop + i;
      if (i < visible.length) {
        const line = `  ${visible[i]}`;
        process.stderr.write(moveTo(row, 1) + CLEAR_LINE + truncateAnsi(line, this.cols));
      } else {
        process.stderr.write(moveTo(row, 1) + CLEAR_LINE);
      }
    }
  }

  private paintInputLine(): void {
    const prompt = formatPrompt(this.phase, this.paused, this.pendingCount);
    process.stderr.write(
      SAVE_CURSOR +
      moveTo(this.inputRow, 1) + CLEAR_LINE + prompt +
      RESTORE_CURSOR
    );
  }
}

// ── Formatting helpers ──────────────────────────────────────────────────────

// format a session as a card-style line (inside the box)
// errorSparkline: optional pre-formatted ROSE sparkline string (5 chars) for recent errors
// idleSinceMs: optional ms since last activity change (shown when idle/stopped)
// healthBadge: optional pre-formatted health score badge ("⬡83" colored)
// displayName: optional custom name override (from /rename)
// ageStr: optional session age string (from createdAt)
function formatSessionCard(s: DaemonSessionState, maxWidth: number, errorSparkline?: string, idleSinceMs?: number, healthBadge?: string, displayName?: string, ageStr?: string): string {
  const dot = STATUS_DOT[s.status] ?? `${AMBER}${DOT.filled}${RESET}`;
  const title = displayName ?? s.title;
  const name = displayName ? `${BOLD}${displayName}${DIM} (${s.title})${RESET}` : `${BOLD}${s.title}${RESET}`;
  const toolBadge = `${SLATE}${s.tool}${RESET}`;
  const contextBadge = s.contextTokens ? ` ${DIM}(${s.contextTokens})${RESET}` : "";
  const sparkSuffix = errorSparkline ? ` ${errorSparkline}` : "";
  const healthPrefix = healthBadge ? `${healthBadge} ` : "";
  const healthPrefixWidth = healthBadge ? stripAnsiForLen(healthBadge) + 1 : 0;
  // sparkline + health badge take fixed space so status desc gets less room
  const sparkWidth = errorSparkline ? SESSION_SPARK_BUCKETS + 1 : 0;

  // idle-since label: show when session is idle/stopped and stale > 2min
  const idleLabel = (idleSinceMs !== undefined && (s.status === "idle" || s.status === "stopped" || s.status === "done"))
    ? formatIdleSince(idleSinceMs)
    : "";

  // status description
  let desc: string;
  if (s.userActive) {
    desc = `${AMBER}you're active${RESET}`;
  } else if (s.status === "working" || s.status === "running") {
    desc = s.currentTask
      ? truncatePlain(s.currentTask, Math.max(20, maxWidth - title.length - s.tool.length - 16 - sparkWidth))
      : `${LIME}working${RESET}`;
  } else if (s.status === "idle" || s.status === "stopped") {
    desc = idleLabel ? `${SLATE}${idleLabel}${RESET}` : `${SLATE}idle${RESET}`;
  } else if (s.status === "error") {
    desc = `${ROSE}error${RESET}`;
  } else if (s.status === "done") {
    desc = idleLabel ? `${GREEN}done ${DIM}${idleLabel}${RESET}` : `${GREEN}done${RESET}`;
  } else if (s.status === "waiting") {
    desc = `${AMBER}waiting${RESET}`;
  } else {
    desc = `${SLATE}${s.status}${RESET}`;
  }

  const ageSuffix = ageStr ? ` ${DIM}age:${ageStr}${RESET}` : "";
  return truncateAnsi(`${dot} ${healthPrefix}${name} ${toolBadge}${contextBadge} ${SLATE}${BOX.h}${RESET} ${desc}${ageSuffix}${sparkSuffix}`, maxWidth);
}

// colorize an activity entry based on its tag
function formatActivity(entry: ActivityEntry, maxCols: number): string {
  const { time, tag, text } = entry;
  let color = SLATE;
  let prefix = tag;

  switch (tag) {
    case "observation": color = SLATE; prefix = "obs"; break;
    case "reasoner":    color = SKY; break;
    case "explain":     color = `${BOLD}${CYAN}`; prefix = "AI"; break;
    case "+ action": case "action": color = AMBER; prefix = "→ action"; break;
    case "! action": case "error":  color = ROSE; prefix = "✗ error"; break;
    case "you":         color = LIME; break;
    case "system":      color = SLATE; break;
    case "status":      color = SLATE; break;
    case "config":      color = TEAL; prefix = "⚙ config"; break;
    default:            color = SLATE; break;
  }

  const formatted = `  ${SLATE}${time}${RESET} ${color}${prefix}${RESET} ${DIM}│${RESET} ${text}`;
  return truncateAnsi(formatted, maxCols);
}

// pad a box line to end with the right border character
function padBoxLine(line: string, totalWidth: number): string {
  const visible = stripAnsiForLen(line);
  const pad = Math.max(0, totalWidth - visible - 1); // -1 for closing border
  return line + " ".repeat(pad) + `${SLATE}${BOX.v}${RESET}`;
}

// pad a box line with optional hover background that extends through the padding
function padBoxLineHover(line: string, totalWidth: number, hovered: boolean): string {
  const visible = stripAnsiForLen(line);
  const pad = Math.max(0, totalWidth - visible - 1);
  if (hovered) {
    return line + `${BG_HOVER}${" ".repeat(pad)}${RESET}${SLATE}${BOX.v}${RESET}`;
  }
  return line + " ".repeat(pad) + `${SLATE}${BOX.v}${RESET}`;
}

// pad the header bar to fill the full width with background color
function padToWidth(line: string, totalWidth: number): string {
  const visible = stripAnsiForLen(line);
  const pad = Math.max(0, totalWidth - visible);
  return " ".repeat(pad);
}

// count visible characters (strip ANSI escapes)
function stripAnsiForLen(str: string): number {
  return str.replace(/\x1b\[[0-9;]*m/g, "").length;
}

// truncate a string with ANSI codes to fit a column width (approximate)
function truncateAnsi(str: string, maxCols: number): string {
  // strip ANSI to count visible chars
  const visible = str.replace(/\x1b\[[0-9;]*m/g, "");
  if (visible.length <= maxCols) return str;
  // rough truncation — may cut mid-escape but it's decorative
  const overhead = str.length - visible.length;
  return str.slice(0, maxCols + overhead - 1) + RESET;
}

function truncatePlain(str: string, max: number): string {
  return str.length > max ? str.slice(0, max - 2) + ".." : str;
}

/**
 * Format a session state as a plain-English sentence.
 * Kept for backward compatibility — used by non-TUI output paths.
 */
export function formatSessionSentence(s: DaemonSessionState, maxCols: number): string {
  const dot = STATUS_DOT[s.status] ?? `${AMBER}${DOT.filled}${RESET}`;
  const name = s.title;
  const tool = `${SLATE}(${s.tool})${RESET}`;

  let statusDesc: string;
  if (s.userActive) {
    statusDesc = `${AMBER}you're working here${RESET}`;
  } else if (s.status === "working") {
    if (s.currentTask) {
      statusDesc = truncatePlain(s.currentTask, Math.max(30, maxCols - name.length - s.tool.length - 20));
    } else {
      statusDesc = `${LIME}working${RESET}`;
    }
  } else if (s.status === "idle" || s.status === "stopped") {
    statusDesc = `${SLATE}idle${RESET}`;
  } else if (s.status === "error") {
    statusDesc = `${ROSE}hit an error${RESET}`;
  } else if (s.status === "done") {
    statusDesc = `${GREEN}finished${RESET}`;
  } else if (s.status === "waiting") {
    statusDesc = `${AMBER}waiting for input${RESET}`;
  } else {
    statusDesc = s.status;
  }

  return truncateAnsi(`${dot} ${BOLD}${name}${RESET} ${tool} ${SLATE}—${RESET} ${statusDesc}`, maxCols);
}

// ── Drill-down helpers (pure, exported for testing) ─────────────────────────

// format the header line for drill-down view
function formatDrilldownHeader(
  sessionId: string,
  sessions: DaemonSessionState[],
  phase: DaemonPhase,
  paused: boolean,
  spinnerFrame: number,
  _cols: number,
): string {
  const session = sessions.find((s) => s.id === sessionId);
  const phaseText = phaseDisplay(phase, paused, spinnerFrame);
  if (!session) {
    return ` ${INDIGO}${BOLD}aoaoe${RESET}  ${SLATE}│${RESET}  ${DIM}session not found${RESET}  ${SLATE}│${RESET}  ${phaseText}`;
  }
  const dot = STATUS_DOT[session.status] ?? `${AMBER}${DOT.filled}${RESET}`;
  const name = `${BOLD}${session.title}${RESET}`;
  const toolBadge = `${SLATE}${session.tool}${RESET}`;
  const statusText = session.status === "working" || session.status === "running"
    ? `${LIME}${session.status}${RESET}`
    : session.status === "error"
    ? `${ROSE}error${RESET}`
    : `${SLATE}${session.status}${RESET}`;
  const taskTag = session.currentTask ? `  ${SLATE}│${RESET}  ${DIM}${truncatePlain(session.currentTask, 40)}${RESET}` : "";
  return ` ${dot} ${name} ${toolBadge}  ${SLATE}│${RESET}  ${statusText}${taskTag}  ${SLATE}│${RESET}  ${phaseText}`;
}

// ── Prompt helpers (pure, exported for testing) ─────────────────────────────

// format the input prompt based on phase, pause state, and pending queue count
function formatPrompt(phase: DaemonPhase, paused: boolean, pendingCount: number): string {
  const queueTag = pendingCount > 0 ? `${AMBER}${pendingCount} queued${RESET} ` : "";
  if (paused) return `${queueTag}${AMBER}${BOLD}paused >${RESET} `;
  if (phase === "reasoning") return `${queueTag}${SKY}thinking >${RESET} `;
  return `${queueTag}${LIME}>${RESET} `;
}

// ── Scroll helpers (pure, exported for testing) ─────────────────────────────

// compute the slice indices for the activity buffer given scroll state
function computeScrollSlice(bufferLen: number, visibleLines: number, scrollOffset: number): { start: number; end: number } {
  const end = Math.max(0, bufferLen - scrollOffset);
  const start = Math.max(0, end - visibleLines);
  return { start, end };
}

// format the scroll indicator text for the separator bar
function formatScrollIndicator(offset: number, totalEntries: number, visibleLines: number, newCount: number): string {
  const position = totalEntries - offset;
  const newTag = newCount > 0 ? `  ${newCount} new ↓` : "";
  return ` ↑ ${offset} older  │  ${position}/${totalEntries}  │  PgUp/PgDn  End=live${newTag} `;
}

// format the scroll indicator for drill-down separator bar
function formatDrilldownScrollIndicator(offset: number, totalLines: number, visibleLines: number, newCount: number): string {
  const position = totalLines - offset;
  const newTag = newCount > 0 ? `  ${newCount} new ↓` : "";
  return ` ↑ ${offset} lines  │  ${position}/${totalLines}  │  scroll: navigate  End=live${newTag} `;
}

// ── Sparkline helpers (pure, exported for testing) ──────────────────────────

const SPARK_BLOCKS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"] as const;
const SPARK_BUCKETS = 20; // number of time buckets
const SPARK_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

/** Compute sparkline bucket counts from activity timestamps. Returns array of SPARK_BUCKETS counts. */
function computeSparkline(timestamps: number[], now?: number, buckets?: number, windowMs?: number): number[] {
  const n = buckets ?? SPARK_BUCKETS;
  const window = windowMs ?? SPARK_WINDOW_MS;
  const nowMs = now ?? Date.now();
  const cutoff = nowMs - window;
  const bucketSize = window / n;
  const counts = new Array<number>(n).fill(0);
  for (const ts of timestamps) {
    if (ts < cutoff) continue;
    const idx = Math.min(n - 1, Math.floor((ts - cutoff) / bucketSize));
    counts[idx]++;
  }
  return counts;
}

/** Format sparkline bucket counts as a colored Unicode block string. Returns empty string if all zeros. */
function formatSparkline(counts: number[]): string {
  const max = Math.max(...counts);
  if (max === 0) return "";
  const blocks = counts.map((c) => {
    if (c === 0) return `${SLATE} ${RESET}`;
    const level = Math.min(SPARK_BLOCKS.length - 1, Math.floor((c / max) * (SPARK_BLOCKS.length - 1)));
    // color gradient: low=SLATE, mid=SKY, high=LIME
    const color = level < 3 ? SLATE : level < 6 ? SKY : LIME;
    return `${color}${SPARK_BLOCKS[level]}${RESET}`;
  });
  return blocks.join("");
}

// ── Context ceiling warning (pure, exported for testing) ─────────────────────

/**
 * Parse a context token string that may include a ceiling: "137,918 / 200,000 tokens".
 * Returns { current, max } if both values are present, null otherwise.
 */
export function parseContextCeiling(contextTokens: string | undefined): { current: number; max: number } | null {
  if (!contextTokens) return null;
  const stripped = contextTokens.replace(/,/g, "");
  const match = stripped.match(/(\d+)\s*\/\s*(\d+)/);
  if (!match) return null;
  const current = parseInt(match[1], 10);
  const max = parseInt(match[2], 10);
  if (isNaN(current) || isNaN(max) || max <= 0) return null;
  return { current, max };
}

/** Alert threshold: fire ceiling warning when context usage exceeds this fraction. */
export const CONTEXT_CEILING_THRESHOLD = 0.90;

/** Format a context ceiling alert for the activity log. */
export function formatContextCeilingAlert(title: string, current: number, max: number): string {
  const pct = Math.round((current / max) * 100);
  return `${title}: context at ${pct}% (${current.toLocaleString()} / ${max.toLocaleString()} tokens) — approaching limit`;
}

// ── Context burn-rate tracking (pure, exported for testing) ─────────────────

/** Parse a context token string like "137,918 tokens" to a raw number, or null if unparseable. */
export function parseContextTokenNumber(contextTokens: string | undefined): number | null {
  if (!contextTokens) return null;
  const match = contextTokens.replace(/,/g, "").match(/(\d+)/);
  if (!match) return null;
  const n = parseInt(match[1], 10);
  return isNaN(n) ? null : n;
}

/** Context history entry: token count at a timestamp. */
export interface ContextHistoryEntry {
  tokens: number;
  ts: number; // epoch ms
}

/** Default alert threshold: tokens per minute that triggers a burn-rate nudge. */
export const CONTEXT_BURN_THRESHOLD = 5_000;
/** Burn-rate window: compare token counts over the last 2 minutes. */
export const CONTEXT_BURN_WINDOW_MS = 2 * 60 * 1000;
/** Max context history entries stored per session (keeps memory bounded). */
export const MAX_CONTEXT_HISTORY = 30;

/**
 * Compute tokens-per-minute burn rate over the last windowMs.
 * Returns null if fewer than 2 data points are within the window.
 */
export function computeContextBurnRate(history: readonly ContextHistoryEntry[], now?: number, windowMs?: number): number | null {
  const cutoff = (now ?? Date.now()) - (windowMs ?? CONTEXT_BURN_WINDOW_MS);
  const recent = history.filter((h) => h.ts >= cutoff);
  if (recent.length < 2) return null;
  const oldest = recent[0];
  const newest = recent[recent.length - 1];
  const deltaTokens = newest.tokens - oldest.tokens;
  const deltaMs = newest.ts - oldest.ts;
  if (deltaMs <= 0) return null;
  return (deltaTokens / deltaMs) * 60_000; // convert ms to per-minute
}

/** Format a burn-rate alert message for the activity log. */
export function formatBurnRateAlert(title: string, tokensPerMin: number): string {
  const rounded = Math.round(tokensPerMin / 100) * 100; // round to nearest 100
  return `${title}: context burning at ~${rounded.toLocaleString()} tokens/min — context limit approaching`;
}

// ── Session error sparkline (pure, exported for testing) ────────────────────

/** Number of buckets in a per-session error sparkline (compact: 5 chars wide). */
export const SESSION_SPARK_BUCKETS = 5;
/** Time window for per-session error sparkline (last 5 minutes). */
export const SESSION_SPARK_WINDOW_MS = 5 * 60 * 1000;
/** Max error timestamps stored per session (keeps memory bounded). */
export const MAX_ERROR_TIMESTAMPS = 100;

/**
 * Format a per-session error sparkline from recent error timestamps.
 * Returns a 5-char ROSE-colored block string, or empty string if no recent errors.
 */
export function formatSessionErrorSparkline(timestamps: readonly number[], now?: number): string {
  if (timestamps.length === 0) return "";
  const counts = computeSparkline([...timestamps], now, SESSION_SPARK_BUCKETS, SESSION_SPARK_WINDOW_MS);
  const max = Math.max(...counts);
  if (max === 0) return "";
  return counts.map((c) => {
    if (c === 0) return `${DIM} ${RESET}`;
    const level = Math.min(SPARK_BLOCKS.length - 1, Math.floor((c / max) * (SPARK_BLOCKS.length - 1)));
    return `${ROSE}${SPARK_BLOCKS[level]}${RESET}`;
  }).join("");
}

// ── Search helpers (pure, exported for testing) ─────────────────────────────

/** Case-insensitive substring match against an activity entry's tag, text, and time. */
function matchesSearch(entry: ActivityEntry, pattern: string): boolean {
  if (!pattern) return true;
  const lower = pattern.toLowerCase();
  return (
    entry.tag.toLowerCase().includes(lower) ||
    entry.text.toLowerCase().includes(lower) ||
    entry.time.toLowerCase().includes(lower)
  );
}

/** Format the search indicator text for the separator bar. */
function formatSearchIndicator(pattern: string, matchCount: number, totalCount: number): string {
  return ` search: "${pattern}"  │  ${matchCount} of ${totalCount}  │  /search: clear `;
}

// ── Mouse hit testing (pure, exported for testing) ──────────────────────────

/**
 * Hit-test a mouse click row against the session panel.
 * Returns 1-indexed session number if the click hit a session card, null otherwise.
 *
 * Session cards occupy rows: headerHeight + 2 through headerHeight + 1 + sessionCount
 * (row = headerHeight + 2 + i for 0-indexed session i)
 */
export function hitTestSession(row: number, headerHeight: number, sessionCount: number): number | null {
  if (sessionCount <= 0) return null;
  const firstSessionRow = headerHeight + 2; // top border is headerHeight+1, first card is +2
  const lastSessionRow = firstSessionRow + sessionCount - 1;
  if (row < firstSessionRow || row > lastSessionRow) return null;
  return row - firstSessionRow + 1; // 1-indexed
}

// ── Exported pure helpers (for testing) ─────────────────────────────────────

export { formatActivity, formatSessionCard, truncateAnsi, truncatePlain, padBoxLine, padBoxLineHover, padToWidth, stripAnsiForLen, phaseDisplay, computeScrollSlice, formatScrollIndicator, formatDrilldownScrollIndicator, formatPrompt, formatDrilldownHeader, matchesSearch, formatSearchIndicator, computeSparkline, formatSparkline, sortSessions, nextSortMode, SORT_MODES, formatCompactRows, computeCompactRowCount, COMPACT_NAME_LEN, PIN_ICON, MUTE_ICON, NOTE_ICON };
