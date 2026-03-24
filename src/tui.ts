// tui.ts — block-style terminal UI for aoaoe daemon
// OpenCode-inspired design: box-drawn panels, 256-color palette, phase spinner,
// visual hierarchy. no external deps — raw ANSI escape codes only.
//
// layout (top to bottom):
//   ╔═ header bar (1 row, BG_DARK) — brand │ poll# │ agents │ phase │ countdown ═╗
//   ╠═ column headers: NAME │ TASK │ STATUS │ ACTION ═══════════════════════════╣
//   ║  session rows (one per agent, colored by status)                          ║
//   ╚══════════════════════════════════════════════════════════════════════════╝
//   ── ◉ activity ─────────────────────────── sparkline ────── hints ──────────
//   │  activity scroll region (colored gutter bar per tag)                     │
//   ╭─ ▸ you ──────────────────────────────────────────────────────────────────╮
//   │  [pending chips]  input line                                             │
//   ╰──────────────────────────────────────────────────────────────────────────╯
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { DaemonSessionState, DaemonPhase, ConfidenceLevel, TaskDefinition } from "./types.js";
import {
  BOLD, DIM, RESET, GREEN, YELLOW, RED, CYAN, WHITE,
  BG_DARK, BG_HEADER2, BG_HOVER, BG_INPUT, BG_SECTION,
  BG_INDIGO, BG_SKY, BG_LIME, BG_ROSE, BG_AMBER, BG_TEAL,
  INDIGO, TEAL, AMBER, SLATE, ROSE, LIME, SKY,
  PURPLE, ORANGE, PINK, GOLD, SILVER, STEEL,
  BOX, SPINNER, DOT, GLYPH,
  PROGRESS_BLOCKS, PROGRESS_IDLE, PROGRESS_TIP,
} from "./colors.js";
import { appendHistoryEntry } from "./tui-history.js";
import type { HistoryEntry } from "./tui-history.js";
import { analysePaneOutput, classifyVibe, formatVibe } from "./vibe.js";

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

export type SortMode = "default" | "status" | "name" | "activity" | "health";
const SORT_MODES: SortMode[] = ["default", "status", "name", "activity", "health"];

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
function formatCompactRows(
  sessions: DaemonSessionState[],
  maxWidth: number,
  pinnedIds?: Set<string>,
  mutedIds?: Set<string>,
  noteIds?: Set<string>,
  healthScores?: Map<string, number>,
  activityRates?: Map<string, number>,
  sessionColors?: Map<string, string>, // session ID → accent color name (from /color)
): string[] {
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

    // session accent color — used to colorize the name in compact mode
    const accentColorName = sessionColors?.get(s.id);
    const accentAnsi = accentColorName ? colorNameToAnsi(accentColorName) : "";
    const nameColor = accentAnsi || "";
    const name = truncatePlain(s.title, COMPACT_NAME_LEN);

    // health indicator: ⬡ glyph colored by severity when unhealthy,
    // or by the session's accent color when healthy + accent is set
    const score = healthScores?.get(s.id);
    let healthGlyph = "";
    let healthWidth = 0;
    if (score !== undefined && score < HEALTH_GOOD) {
      // unhealthy: severity color overrides accent
      const healthColor = score < HEALTH_WARN ? ROSE : AMBER;
      healthGlyph = `${healthColor}${HEALTH_ICON}${RESET}`;
      healthWidth = 1;
    } else if (score !== undefined && accentAnsi) {
      // healthy but has accent: show glyph in accent color as a style marker
      healthGlyph = `${accentAnsi}${HEALTH_ICON}${RESET}`;
      healthWidth = 1;
    }

    // activity rate badge: "3/m" when rate > 0
    const rate = activityRates?.get(s.id) ?? 0;
    const rateBadge = formatActivityRateBadge(rate);
    const rateVisible = rateBadge ? stripAnsiForLen(rateBadge) : 0;

    tokens.push(`${SLATE}${idx}${RESET}${pin}${muteIcon}${noteIcon}${dot}${nameColor}${BOLD}${name}${RESET}${healthGlyph}${rateBadge}`);
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

/** How often /stats-live refreshes (ms). */
export const STATS_REFRESH_INTERVAL_MS = 5_000;

// ── Trust Ladder ────────────────────────────────────────────────────────────
// Auto-escalate observe → dry-run → confirm → autopilot based on stable behavior.

export const TRUST_LEVELS = ["observe", "dry-run", "confirm", "autopilot"] as const;
export type TrustLevel = typeof TRUST_LEVELS[number];

/** Consecutive stable ticks before auto-promoting to the next trust level. */
export const TRUST_STABLE_TICKS_TO_ESCALATE = 10;

/**
 * Compute whether the trust level should escalate.
 * Returns the next level and whether an escalation happened.
 * Only escalates when auto is enabled and stableTicks >= threshold.
 */
export function computeTrustEscalation(
  currentLevel: TrustLevel,
  stableTicks: number,
  autoEnabled: boolean,
): { nextLevel: TrustLevel; escalated: boolean } {
  if (!autoEnabled) return { nextLevel: currentLevel, escalated: false };
  const idx = TRUST_LEVELS.indexOf(currentLevel);
  if (idx < 0 || idx >= TRUST_LEVELS.length - 1) return { nextLevel: currentLevel, escalated: false };
  if (stableTicks < TRUST_STABLE_TICKS_TO_ESCALATE) return { nextLevel: currentLevel, escalated: false };
  const next = TRUST_LEVELS[idx + 1];
  return { nextLevel: next, escalated: true };
}

/**
 * Demote trust level back to observe on any failure.
 * Always returns "observe" regardless of current level.
 */
export function computeTrustDemotion(_currentLevel: TrustLevel): TrustLevel {
  return "observe";
}

/**
 * Format a human-readable trust ladder status string.
 */
export function formatTrustLadderStatus(
  level: TrustLevel,
  stableTicks: number,
  autoEnabled: boolean,
): string {
  const idx = TRUST_LEVELS.indexOf(level);
  const ladder = TRUST_LEVELS.map((l, i) => {
    if (i === idx) return `[${l}]`;
    if (i < idx) return `${l} ✓`;
    return l;
  }).join(" → ");
  const autoLabel = autoEnabled ? "auto" : "manual";
  const threshold = TRUST_STABLE_TICKS_TO_ESCALATE;
  const progress = idx < TRUST_LEVELS.length - 1
    ? ` (${stableTicks}/${threshold} stable ticks to next)`
    : " (max level)";
  return `trust: ${ladder}${progress} [${autoLabel}]`;
}

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

/**
 * Format a confidence badge for the header bar.
 * high → lime ▲ high    medium → nothing (no noise when neutral)
 * low  → rose ▼ low
 * Returns empty string for null/medium so the badge only appears when it matters.
 */
export function formatConfidenceBadge(confidence: ConfidenceLevel | null): string {
  if (!confidence || confidence === "medium") return "";
  if (confidence === "high") return `${LIME}▲ high${RESET}`;
  return `${ROSE}▼ low${RESET}`;
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

// ── Sessions table (pure, exported for testing) ────────────────────────────────

/**
 * Format sessions as a rich table for /sessions command output.
 * Returns array of lines (one per session + header).
 */
export function formatSessionsTable(
  sessions: readonly DaemonSessionState[],
  opts: {
    groups: ReadonlyMap<string, string>;
    tags: ReadonlyMap<string, ReadonlySet<string>>;
    colors: ReadonlyMap<string, string>;
    notes: ReadonlyMap<string, string>;
    labels: ReadonlyMap<string, string>;
    aliases: ReadonlyMap<string, string>;
    drainingIds: ReadonlySet<string>;
    healthScores: ReadonlyMap<string, number>;
    costs: ReadonlyMap<string, string>;
    firstSeen: ReadonlyMap<string, number>;
  },
  now?: number,
): string[] {
  if (sessions.length === 0) return ["  no sessions"];
  const nowMs = now ?? Date.now();
  const lines: string[] = [];
  lines.push(`  ${"#".padEnd(3)} ${"title".padEnd(20)} ${"status".padEnd(9)} ${"hlth".padEnd(5)} ${"group".padEnd(10)} ${"cost".padEnd(7)} ${"uptime".padEnd(8)} flags`);
  lines.push(`  ${"-".repeat(3)} ${"-".repeat(20)} ${"-".repeat(9)} ${"-".repeat(5)} ${"-".repeat(10)} ${"-".repeat(7)} ${"-".repeat(8)} -----`);
  for (let i = 0; i < sessions.length; i++) {
    const s = sessions[i];
    const alias = opts.aliases.get(s.id);
    const titleStr = (alias || s.title).slice(0, 20).padEnd(20);
    const statusStr = s.status.slice(0, 9).padEnd(9);
    const health = opts.healthScores.get(s.id) ?? 100;
    const healthStr = String(health).padEnd(5);
    const group = opts.groups.get(s.id) ?? "";
    const groupStr = group.slice(0, 10).padEnd(10);
    const cost = opts.costs.get(s.id) ?? "";
    const costStr = cost.slice(0, 7).padEnd(7);
    const fs = opts.firstSeen.get(s.id);
    const uptimeStr = fs !== undefined ? formatUptime(nowMs - fs).padEnd(8) : "?".padEnd(8);
    // flags: D=drain, ⊹=tag, ✎=note, ·=label
    const flags = [
      opts.drainingIds.has(s.id) ? "D" : "",
      (opts.tags.get(s.id)?.size ?? 0) > 0 ? "T" : "",
      opts.notes.has(s.id) ? "N" : "",
      opts.labels.has(s.id) ? "L" : "",
    ].filter(Boolean).join("") || "-";
    lines.push(`  ${String(i + 1).padEnd(3)} ${titleStr} ${statusStr} ${healthStr} ${groupStr} ${costStr} ${uptimeStr} ${flags}`);
  }
  return lines;
}

// ── Session note history ─────────────────────────────────────────────────────

/** Max notes stored per session (in history before clear). */
export const MAX_NOTE_HISTORY = 5;

// ── Session label ────────────────────────────────────────────────────────────

/** Max length of a session label (displayed below title in cards). */
export const MAX_LABEL_LEN = 40;

/** Truncate a label to the max length. */
export function truncateLabel(label: string): string {
  return label.length > MAX_LABEL_LEN ? label.slice(0, MAX_LABEL_LEN - 2) + ".." : label;
}

// ── Session drain mode helpers ────────────────────────────────────────────────

/** Drain icon shown in session cards for draining sessions. */
export const DRAIN_ICON = "⇣";

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
/** Default goal for fan-out generated tasks. */
export const FAN_OUT_DEFAULT_GOAL = "Continue the roadmap in claude.md";

/**
 * Generate a task definition list from visible sessions, merging with existing tasks.
 * Existing tasks (matched by sessionTitle, case-insensitive) are preserved as-is.
 * New sessions get a default goal and "existing" mode.
 * Returns { defs, added } where `added` lists the titles of newly created entries.
 */
export function buildFanOutTemplate(
  sessions: readonly DaemonSessionState[],
  existingTasks: readonly TaskDefinition[],
): { defs: TaskDefinition[]; added: string[] } {
  // index existing tasks by normalized title for fast lookup
  const existingByTitle = new Map<string, TaskDefinition>();
  for (const t of existingTasks) {
    const key = (t.sessionTitle ?? t.repo).toLowerCase();
    existingByTitle.set(key, t);
  }

  const defs: TaskDefinition[] = [...existingTasks]; // preserve all existing
  const added: string[] = [];

  for (const s of sessions) {
    const key = s.title.toLowerCase();
    if (existingByTitle.has(key)) continue; // already tracked

    const def: TaskDefinition = {
      repo: s.path ?? s.title,
      sessionTitle: s.title,
      sessionMode: "existing",
      tool: s.tool || "opencode",
      goal: FAN_OUT_DEFAULT_GOAL,
    };
    defs.push(def);
    added.push(s.title);
  }

  return { defs, added };
}

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

/** Return the raw ANSI escape for a session color name (for compact mode colorizing). */
export function colorNameToAnsi(colorName: string): string {
  return SESSION_COLOR_MAP[colorName.toLowerCase() as SessionColorName] ?? "";
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
  "/health-trend", "/alert-mute", "/flap-log", "/drain", "/undrain", "/export-all",
  "/note-history", "/label", "/sessions",
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
  private sessionNoteHistory = new Map<string, string[]>(); // session ID → last N notes before clear
  private sessionLabels = new Map<string, string>(); // session ID → freeform display label
  private sessionBudgets = new Map<string, number>(); // session ID → USD budget
  private globalBudget: number | null = null;          // global fallback budget in USD
  private budgetAlerted = new Map<string, number>();   // session ID → epoch ms of last budget alert
  private sessionStatusHistory = new Map<string, StatusChange[]>(); // session ID → status change log
  private prevSessionStatus = new Map<string, string>(); // session ID → last known status (for change detection)
  private flapAlerted = new Map<string, number>(); // session ID → epoch ms of last flap alert
  private alertMutePatterns = new Set<string>(); // substrings to hide from /alert-log display
  private drainingIds = new Set<string>(); // session IDs marked as draining (skip by reasoner)
  private sessionIcons = new Map<string, string>(); // session ID → single emoji icon
  private sessionVibes = new Map<string, string>(); // session ID → pre-computed formatted vibe cell
   private flapLog: { sessionId: string; title: string; ts: number; count: number }[] = []; // recent flap events

   // /stats-live: periodic auto-refresh of per-session stats
   private statsRefreshTimer: ReturnType<typeof setInterval> | null = null;
   private statsRefreshCallback: (() => void) | null = null;

   // trust ladder: auto-escalate observe → dry-run → confirm → autopilot
   private trustLevel: TrustLevel = "observe";
   private trustStableTicks = 0;
   private trustAutoEnabled = true; // auto-escalation on by default

   // session replay: play back stored pane output frame-by-frame
   private replayState: SessionReplayState | null = null;
   private replayTimer: ReturnType<typeof setInterval> | null = null;

   // per-session notification filters
   private sessionNotifyFilters = new Map<string, Set<import("./types.js").NotificationEvent>>();

   // context compaction: tracks when each session was last sent a compaction nudge
   private compactionNudged = new Map<string, number>(); // session ID → epoch ms

   // cross-session message relay rules
   private relayRules: RelayRule[] = [];

   // OOM restart tracking per session
   private oomRestarts = new Map<string, { lastAt: number; count: number }>();

   // per-session action throttle overrides (ms)
   private sessionThrottles = new Map<string, number>();

   // session output snapshots for diffing
   private outputSnapshots = new Map<string, string[]>(); // session ID → snapshot lines

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
  private lastConfidence: ConfidenceLevel | null = null; // most recent reasoner confidence signal
  private version = "";
  private reasonerName = "";
  private nextTickAt = 0;    // epoch ms for poll countdown display
  private nextReasonAt = 0;  // epoch ms for reasoning countdown (separate from poll)

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
      // repaint header (countdown + spinner animation)
      if (this.phase !== "sleeping" || this.nextTickAt > 0) {
        this.paintHeader();
      }
      // repaint session panel every 1s (4 ticks) so vibe/idle/health
      // update live without waiting for a state-change event
      if (this.spinnerFrame % 4 === 0 && this.viewMode === "overview") {
        this.paintSessions();
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
      // push current note into history before clearing
      const current = this.sessionNotes.get(sessionId);
      if (current) {
        const hist = this.sessionNoteHistory.get(sessionId) ?? [];
        hist.push(current);
        if (hist.length > MAX_NOTE_HISTORY) hist.shift();
        this.sessionNoteHistory.set(sessionId, hist);
      }
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

  /** Return note history for a session (oldest first). */
  getNoteHistory(id: string): readonly string[] {
    return this.sessionNoteHistory.get(id) ?? [];
  }

  // ── Session labels ───────────────────────────────────────────────────────

  /**
   * Set or clear a label for a session (by 1-indexed number, ID, or title).
   * Label is displayed below the session title in normal cards.
   * Returns true if session found.
   */
  setLabel(sessionIdOrIndex: string | number, label: string | null): boolean {
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
    if (!label || label.trim() === "") {
      this.sessionLabels.delete(sessionId);
    } else {
      this.sessionLabels.set(sessionId, truncateLabel(label.trim()));
    }
    if (this.active) this.paintSessions();
    return true;
  }

  /** Get the label for a session ID (or undefined). */
  getLabel(id: string): string | undefined {
    return this.sessionLabels.get(id);
  }

  /** Return all session labels. */
  getAllLabels(): ReadonlyMap<string, string> {
    return this.sessionLabels;
  }

  /**
   * Pin all sessions currently marked as draining.
   * Returns the count of newly pinned sessions.
   */
  pinDraining(): number {
    let pinned = 0;
    for (const id of this.drainingIds) {
      if (!this.pinnedIds.has(id)) {
        this.pinnedIds.add(id);
        pinned++;
      }
    }
    if (pinned > 0) {
      this.sessions = sortSessions(this.sessions, this.sortMode, this.lastChangeAt, this.pinnedIds);
      if (this.active) this.paintSessions();
    }
    return pinned;
  }

  /** Set or clear a single emoji icon for a session (shown in the table NAME cell). */
  setIcon(sessionIdOrIndex: string | number, emoji: string | null): boolean {
    let sessionId: string | undefined;
    if (typeof sessionIdOrIndex === "number") {
      sessionId = this.sessions[sessionIdOrIndex - 1]?.id;
    } else {
      const needle = sessionIdOrIndex.toLowerCase();
      sessionId = this.sessions.find(
        (s) => s.id === sessionIdOrIndex || s.id.startsWith(needle) || s.title.toLowerCase() === needle
      )?.id;
    }
    if (!sessionId) return false;
    if (!emoji) {
      this.sessionIcons.delete(sessionId);
    } else {
      this.sessionIcons.set(sessionId, emoji.trim().slice(0, 2)); // cap at 2 chars (1 emoji)
    }
    if (this.active) this.paintSessions();
    return true;
  }

  /** Get the emoji icon for a session, or undefined. */
  getIcon(id: string): string | undefined {
    return this.sessionIcons.get(id);
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

  /** Record the confidence level from the most recent reasoning cycle. Triggers a header repaint. */
  setLastConfidence(confidence: ConfidenceLevel | null): void {
    this.lastConfidence = confidence ?? null;
    if (this.active) this.paintHeader();
  }

  /** Return the most recent reasoner confidence level, or null if none recorded yet. */
  getLastConfidence(): ConfidenceLevel | null {
    return this.lastConfidence;
  }

  // ── /stats-live: periodic auto-refresh ──────────────────────────────────

  /**
   * Start auto-refreshing stats every STATS_REFRESH_INTERVAL_MS.
   * The callback should gather + log stats (same logic as /stats handler).
   * Calling this while already refreshing is a no-op — use stopStatsRefresh first.
   */
  startStatsRefresh(callback: () => void): void {
    if (this.statsRefreshTimer) return; // already running
    this.statsRefreshCallback = callback;
    // fire once immediately, then repeat
    callback();
    this.statsRefreshTimer = setInterval(callback, STATS_REFRESH_INTERVAL_MS);
  }

  /** Stop the auto-refresh timer. */
  stopStatsRefresh(): void {
    if (this.statsRefreshTimer) {
      clearInterval(this.statsRefreshTimer);
      this.statsRefreshTimer = null;
    }
    this.statsRefreshCallback = null;
  }

  /** Whether /stats-live is currently running. */
  isStatsRefreshing(): boolean {
    return this.statsRefreshTimer !== null;
  }

  // ── Session replay ──────────────────────────────────────────────────────

  /**
   * Start replaying a session's output. Enters drilldown for that session
   * and plays back its stored lines frame-by-frame.
   * Returns false if session not found or has no output.
   */
  startReplay(sessionIdOrIndex: string | number, linesPerSecond?: number): boolean {
    const output = this.getSessionOutput(sessionIdOrIndex);
    if (!output || output.length === 0) return false;

    // resolve session
    let session: DaemonSessionState | undefined;
    if (typeof sessionIdOrIndex === "number") {
      session = this.sessions[sessionIdOrIndex - 1];
    } else {
      const needle = sessionIdOrIndex.toLowerCase();
      session = this.sessions.find(
        (s) => s.id === sessionIdOrIndex || s.id.startsWith(needle) || s.title.toLowerCase() === needle,
      );
    }
    if (!session) return false;

    const state = createReplayState(session.id, session.title, output, linesPerSecond);
    if (!state) return false;

    this.stopReplay(); // stop any existing replay
    this.replayState = state;

    // tick at configured speed
    const intervalMs = Math.round(1000 / state.linesPerSecond);
    this.replayTimer = setInterval(() => {
      if (!this.replayState) { this.stopReplay(); return; }
      const { newLines, done, updatedState } = advanceReplay(this.replayState, 1);
      this.replayState = updatedState;
      if (newLines.length > 0) {
        for (const line of newLines) {
          this.log("replay", `${DIM}${line}${RESET}`);
        }
      }
      if (done) {
        this.log("system", formatReplayStatusBar(this.replayState));
        this.stopReplay();
      }
    }, intervalMs);

    this.log("system", formatReplayStatusBar(state));
    return true;
  }

  /** Stop the current replay and clear the timer. */
  stopReplay(): void {
    if (this.replayTimer) {
      clearInterval(this.replayTimer);
      this.replayTimer = null;
    }
    this.replayState = null;
  }

  /** Whether a replay is currently active. */
  isReplaying(): boolean {
    return this.replayState !== null;
  }

  /** Get replay state for display purposes. */
  getReplayState(): SessionReplayState | null {
    return this.replayState;
  }

  /** Pause/resume the current replay. */
  toggleReplayPause(): boolean {
    if (!this.replayState) return false;
    this.replayState = { ...this.replayState, paused: !this.replayState.paused };
    this.log("system", formatReplayStatusBar(this.replayState));
    return true;
  }

  // ── Per-session notification filters ────────────────────────────────────

  /** Set a per-session notification filter. Empty set = block all events for that session. */
  setSessionNotifyFilter(sessionTitle: string, events: Set<import("./types.js").NotificationEvent>): void {
    this.sessionNotifyFilters.set(sessionTitle, events);
  }

  /** Get the filter for a session, or undefined if none set. */
  getSessionNotifyFilter(sessionTitle: string): Set<import("./types.js").NotificationEvent> | undefined {
    return this.sessionNotifyFilters.get(sessionTitle);
  }

  /** Clear a per-session filter (reverts to global behavior). */
  clearSessionNotifyFilter(sessionTitle: string): boolean {
    return this.sessionNotifyFilters.delete(sessionTitle);
  }

  /** Get all per-session notification filters. */
  getAllSessionNotifyFilters(): ReadonlyMap<string, Set<import("./types.js").NotificationEvent>> {
    return this.sessionNotifyFilters;
  }

  // ── Context compaction ──────────────────────────────────────────────────

  /** Record that a compaction nudge was sent to a session. */
  recordCompactionNudge(sessionId: string, now?: number): void {
    this.compactionNudged.set(sessionId, now ?? Date.now());
  }

  /** Get the last compaction nudge timestamp for a session. */
  getCompactionNudgeAt(sessionId: string): number | undefined {
    return this.compactionNudged.get(sessionId);
  }

  /** Get all compaction nudge timestamps. */
  getAllCompactionNudges(): ReadonlyMap<string, number> {
    return this.compactionNudged;
  }

  // ── Cross-session relay ────────────────────────────────────────────────

  /** Add a relay rule. Returns the created rule. */
  addRelayRule(source: string, target: string, pattern: string): RelayRule {
    const rule = createRelayRule(source, target, pattern);
    this.relayRules.push(rule);
    return rule;
  }

  /** Remove a relay rule by ID. Returns true if found and removed. */
  removeRelayRule(id: number): boolean {
    const idx = this.relayRules.findIndex((r) => r.id === id);
    if (idx < 0) return false;
    this.relayRules.splice(idx, 1);
    return true;
  }

  /** Get all relay rules. */
  getRelayRules(): readonly RelayRule[] {
    return this.relayRules;
  }

  // ── OOM restart tracking ──────────────────────────────────────────────

  /** Record an OOM restart for a session. */
  recordOOMRestart(sessionId: string, now?: number): void {
    const ts = now ?? Date.now();
    const prev = this.oomRestarts.get(sessionId);
    this.oomRestarts.set(sessionId, { lastAt: ts, count: (prev?.count ?? 0) + 1 });
  }

  /** Get OOM restart info for a session. */
  getOOMRestartInfo(sessionId: string): { lastAt: number; count: number } | undefined {
    return this.oomRestarts.get(sessionId);
  }

  /** Reset OOM restart counter for a session (e.g. after manual intervention). */
  resetOOMCounter(sessionId: string): void {
    this.oomRestarts.delete(sessionId);
  }

  // ── Per-session action throttle ────────────────────────────────────────

  /** Set a per-session action throttle override (in ms). */
  setSessionThrottle(sessionId: string, ms: number): void {
    this.sessionThrottles.set(sessionId, Math.max(0, ms));
  }

  /** Get the throttle override for a session, or undefined if using global. */
  getSessionThrottle(sessionId: string): number | undefined {
    return this.sessionThrottles.get(sessionId);
  }

  /** Clear a per-session throttle (reverts to global). */
  clearSessionThrottle(sessionId: string): boolean {
    return this.sessionThrottles.delete(sessionId);
  }

  /** Get all per-session throttle overrides. */
  getAllSessionThrottles(): ReadonlyMap<string, number> {
    return this.sessionThrottles;
  }

  // ── Session output snapshots for diffing ──────────────────────────────

  /** Save a snapshot of a session's current output for later diffing. */
  saveOutputSnapshot(sessionIdOrIndex: string | number): string | null {
    const output = this.getSessionOutput(sessionIdOrIndex);
    if (!output) return null;
    // resolve ID
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
    this.outputSnapshots.set(sessionId, [...output]);
    return sessionId;
  }

  /** Get a previously saved snapshot. */
  getOutputSnapshot(sessionId: string): string[] | null {
    return this.outputSnapshots.get(sessionId) ?? null;
  }

  /** Check if a snapshot exists for a session. */
  hasOutputSnapshot(sessionId: string): boolean {
    return this.outputSnapshots.has(sessionId);
  }

  // ── Trust ladder ─────────────────────────────────────────────────────────

  /** Get current trust level. */
  getTrustLevel(): TrustLevel { return this.trustLevel; }

  /** Get consecutive stable ticks since last failure. */
  getTrustStableTicks(): number { return this.trustStableTicks; }

  /** Whether auto-escalation is enabled. */
  isTrustAutoEnabled(): boolean { return this.trustAutoEnabled; }

  /** Manually set the trust level. Resets stable tick counter. */
  setTrustLevel(level: TrustLevel): void {
    this.trustLevel = level;
    this.trustStableTicks = 0;
  }

  /** Toggle or explicitly set auto-escalation. */
  setTrustAuto(enabled: boolean): void {
    this.trustAutoEnabled = enabled;
  }

  /**
   * Record a stable tick (no errors, no failed actions).
   * Returns the new trust level and whether an escalation happened.
   */
  recordStableTick(): { level: TrustLevel; escalated: boolean } {
    this.trustStableTicks++;
    const { nextLevel, escalated } = computeTrustEscalation(
      this.trustLevel, this.trustStableTicks, this.trustAutoEnabled,
    );
    if (escalated) {
      this.trustLevel = nextLevel;
      this.trustStableTicks = 0; // reset counter for next rung
    }
    return { level: this.trustLevel, escalated };
  }

  /**
   * Record a failure (error session, failed action).
   * Demotes trust to observe and resets counter.
   */
  recordTrustFailure(): void {
    this.trustLevel = computeTrustDemotion(this.trustLevel);
    this.trustStableTicks = 0;
  }

  /** Return health history for a session (for sparkline). */
  getSessionHealthHistory(id: string): readonly HealthSnapshot[] {
    return this.sessionHealthHistory.get(id) ?? [];
  }

  // ── Session drain mode ───────────────────────────────────────────────────

  /** Mark a session as draining (by index, ID, or title). Returns true if found. */
  drainSession(sessionIdOrIndex: string | number): boolean {
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
    this.drainingIds.add(sessionId);
    if (this.active) this.paintSessions();
    return true;
  }

  /** Remove drain mark from a session. Returns true if it was draining. */
  undrainSession(sessionIdOrIndex: string | number): boolean {
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
    const had = this.drainingIds.delete(sessionId);
    if (had && this.active) this.paintSessions();
    return had;
  }

  /** Check if a session is draining. */
  isDraining(id: string): boolean {
    return this.drainingIds.has(id);
  }

  /** Return all draining session IDs (for reasoner prompt and display). */
  getDrainingIds(): ReadonlySet<string> {
    return this.drainingIds;
  }

  // ── Flap log ─────────────────────────────────────────────────────────────

  /** Return recent flap events (newest last). */
  getFlapLog(): readonly { sessionId: string; title: string; ts: number; count: number }[] {
    return this.flapLog;
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
    nextReasonAt?: number;
    pendingCount?: number;
  }): void {
    if (opts.phase !== undefined) this.phase = opts.phase;
    if (opts.pollCount !== undefined) this.pollCount = opts.pollCount;
    if (opts.paused !== undefined) this.paused = opts.paused;
    if (opts.reasonerName !== undefined) this.reasonerName = opts.reasonerName;
    if (opts.nextTickAt !== undefined) this.nextTickAt = opts.nextTickAt;
    if (opts.nextReasonAt !== undefined) this.nextReasonAt = opts.nextReasonAt;
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
              const flapCount = statusHist.filter((c) => c.ts >= now - FLAP_WINDOW_MS).length;
              this.flapLog.push({ sessionId: s.id, title: s.title, ts: now, count: flapCount });
              if (this.flapLog.length > 50) this.flapLog.shift();
              this.log("status", `flap: ${s.title} is oscillating rapidly (${flapCount} status changes in ${Math.round(FLAP_WINDOW_MS / 60_000)}m)`, s.id);
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

  /** Store full session outputs (called each tick from main loop) and recompute vibes. */
  setSessionOutputs(outputs: Map<string, string>): void {
    for (const [id, text] of outputs) {
      const prevLen = this.sessionOutputs.get(id)?.length ?? 0;
      const lines = text.split("\n");
      this.sessionOutputs.set(id, lines);

      // recompute vibe from real pane analysis
      const session = this.sessions.find((s) => s.id === id);
      if (session) {
        const lastChange = this.lastChangeAt.get(id);
        const idleSinceMs = lastChange !== undefined ? Date.now() - lastChange : undefined;
        const analysis = analysePaneOutput(text);
        const result = classifyVibe(analysis, {
          userActive: session.userActive ?? false,
          status: session.status,
          idleSinceMs,
          consecutiveErrors: this.sessionErrorCounts.get(id) ?? 0,
        });
        this.sessionVibes.set(id, formatVibe(result));
      }
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
    // inputRow is ALWAYS the last row — nothing writes below it.
    // scrollBottom is rows-2 to leave the input row fully owned by paintInputLine.
    this.inputRow = this.rows;

    if (this.viewMode === "drilldown") {
      this.sessionRows = 0;
      this.separatorRow = this.headerHeight + 1;
      this.scrollTop = this.separatorRow + 1;
      this.scrollBottom = this.rows - 2;
    } else {
      // Reserve at least MIN_ACTIVITY_ROWS rows for the activity log.
      // Kept small so the agents panel can expand to show the full table.
      // header(1) + separator(1) + input(1) + MIN_ACTIVITY_ROWS = fixed overhead.
      const MIN_ACTIVITY_ROWS = 4;
      const fixedOverhead = this.headerHeight + 1 /* separator */ + 1 /* input reserve */ + MIN_ACTIVITY_ROWS;
      const maxSessionRows = Math.max(2, this.rows - fixedOverhead);

      const visibleSessions = this.getVisibleSessions();

      // auto-compact if sessions won't fit at full height
      let useCompact = this.compactMode;
      if (!useCompact) {
        // full mode: top border + col header + N session rows + bottom border = N+3
        const fullRows = Math.max(sessionCount, 1) + 3;
        if (fullRows > maxSessionRows) useCompact = true;
      }

      const sessBodyRows = useCompact
        ? computeCompactRowCount(visibleSessions, this.cols - 2)
        : Math.max(sessionCount, 1);

      // full mode: +3 (top border, col header row, bottom border)
      // compact mode: +2 (section label row, bottom border only)
      const chromRows = useCompact ? 2 : 3;
      const rawSessionRows = sessBodyRows + chromRows;

      // clamp to available space
      this.sessionRows = Math.min(rawSessionRows, maxSessionRows);
      this.separatorRow = this.headerHeight + this.sessionRows + 1;
      this.scrollTop = this.separatorRow + 1;
      this.scrollBottom = this.rows - 2;
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
      // ── brand pill ──────────────────────────────────────────────────────────
      const brand = `${BG_INDIGO}${BOLD} aoaoe ${RESET}${BG_DARK} ${STEEL}${this.version}${RESET}${BG_DARK}`;

      // ── poll counter ────────────────────────────────────────────────────────
      const poll = `${STEEL}${BOX.v}${RESET}${BG_DARK} ${SLATE}#${this.pollCount}${RESET}${BG_DARK}`;

      // ── fleet health dot ────────────────────────────────────────────────────
      // Single composited health indicator (opencode StatusPopover pattern):
      // one dot summarising the entire fleet — any error = rose, any waiting = amber,
      // all working/done = lime, empty or all idle = steel.
      const fleetDot = (() => {
        if (this.sessions.length === 0) return `${STEEL}${DOT.hollow}${RESET}`;
        const statuses = this.sessions.map((s) => s.status);
        if (statuses.some((st) => st === "error"))   return `${ROSE}${DOT.filled}${RESET}`;
        if (statuses.some((st) => st === "waiting")) return `${AMBER}${DOT.filled}${RESET}`;
        if (statuses.some((st) => st === "working" || st === "running")) return `${LIME}${DOT.filled}${RESET}`;
        return `${STEEL}${DOT.hollow}${RESET}`;
      })();

      // ── agent count ─────────────────────────────────────────────────────────
      const visCount = this.getVisibleCount();
      const sessCountStr = this.focusMode
        ? `${visCount}/${this.sessions.length}`
        : `${this.sessions.length}`;
      const agentLabel = this.sessions.length !== 1 ? "agents" : "agent";
      const activeCount = this.sessions.filter((s) => s.userActive).length;
      const activeChip = activeCount > 0 ? ` ${BG_AMBER}${BOLD} ${activeCount} you ${RESET}${BG_DARK}` : "";
      const agents = `${STEEL}${BOX.v}${RESET}${BG_DARK} ${fleetDot} ${BOLD}${sessCountStr}${RESET}${BG_DARK} ${STEEL}${agentLabel}${RESET}${BG_DARK}${activeChip}`;

      // ── phase + progress ────────────────────────────────────────────────────
      const phaseChunk = formatPhaseChunk(this.phase, this.paused, this.spinnerFrame, this.nextTickAt, this.nextReasonAt, this.cols);

      // ── reasoner badge ──────────────────────────────────────────────────────
      const reasonerChunk = this.reasonerName
        ? ` ${STEEL}${BOX.v}${RESET}${BG_DARK} ${TEAL}${this.reasonerName}${RESET}${BG_DARK}`
        : "";

      // ── watchdog badge ──────────────────────────────────────────────────────
      const wdMin = this.watchdogThresholdMs !== null ? Math.round(this.watchdogThresholdMs / 60_000) : null;
      const watchdogChunk = wdMin !== null
        ? ` ${STEEL}${BOX.v}${RESET}${BG_DARK} ${AMBER}⊛${wdMin}m${RESET}${BG_DARK}`
        : "";

      // ── group filter badge ───────────────────────────────────────────────────
      const groupFilterChunk = this.groupFilter
        ? ` ${STEEL}${BOX.v}${RESET}${BG_DARK} ${TEAL}${GROUP_ICON}${this.groupFilter}${RESET}${BG_DARK}`
        : "";

      // ── confidence badge ─────────────────────────────────────────────────────
      // Only shown for non-neutral signals: lime ▲ high or rose ▼ low.
      // medium is intentionally silent — no noise when the reasoner is doing fine.
      const confBadge = formatConfidenceBadge(this.lastConfidence);
      const confidenceChunk = confBadge
        ? ` ${STEEL}${BOX.v}${RESET}${BG_DARK} ${confBadge}${BG_DARK}`
        : "";

      line = ` ${brand}  ${poll}  ${agents}  ${phaseChunk}${reasonerChunk}${watchdogChunk}${groupFilterChunk}${confidenceChunk}`;
    }
    process.stderr.write(
      SAVE_CURSOR +
      moveTo(1, 1) + CLEAR_LINE + BG_DARK + WHITE +
      truncateAnsi(line, this.cols) + padToWidth(line, this.cols) + RESET +
      RESTORE_CURSOR
    );
  }

  private paintSessions(): void {
    const startRow = this.headerHeight + 1;
    const innerWidth = this.cols - 2;
    const visibleSessions = this.getVisibleSessions();
    const visibleCount = visibleSessions.length;

    // Determine if we are forced into compact due to screen size.
    // computeLayout already set sessionRows to the clamped value — use
    // that to decide: if sessionRows < sessions+3 we must be compact.
    const MIN_ACTIVITY_ROWS = 4;
    const fixedOverhead = this.headerHeight + 1 + 1 + MIN_ACTIVITY_ROWS;
    const maxSessionRows = Math.max(2, this.rows - fixedOverhead);
    const fullRowsNeeded = Math.max(visibleCount, 1) + 3; // +3: top border, col header, bottom border
    const forceCompact = !this.compactMode && fullRowsNeeded > maxSessionRows;
    const useCompact = this.compactMode || forceCompact;

    // ── top border: rounded box art ──────────────────────────────────────────
    const focusTag = this.focusMode ? "focus" : "";
    const sortTag = this.sortMode !== "default" ? this.sortMode : "";
    const compactTag = (useCompact && this.compactMode) ? "compact" : "";
    const autoTag = forceCompact ? "auto-compact" : "";
    const groupTag = this.groupFilter ? `group:${this.groupFilter}` : "";
    const tagTag = this.tagFilter2 ? `tag:${this.tagFilter2}` : "";
    const modeTags = [focusTag, compactTag, autoTag, sortTag, groupTag, tagTag].filter(Boolean).join(", ");
    const sectionLabel = `${SILVER}${BOLD} ${GLYPH.agent} AGENTS${modeTags ? ` ${STEEL}(${SLATE}${modeTags}${STEEL})` : ""} ${RESET}`;
    const sectionLabelWidth = stripAnsiForLen(sectionLabel);
    const borderFill = Math.max(0, this.cols - sectionLabelWidth - 2); // -2 for ╭ and ╮
    const topBorder =
      `${STEEL}${BOX.rtl}${BOX.h}${RESET}` +
      `${BG_SECTION}${sectionLabel}${RESET}` +
      `${STEEL}${BOX.h.repeat(borderFill)}${BOX.rtr}${RESET}`;
    process.stderr.write(SAVE_CURSOR + moveTo(startRow, 1) + CLEAR_LINE + truncateAnsi(topBorder, this.cols));

    if (visibleSessions.length === 0) {
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
      process.stderr.write(moveTo(startRow + 1, 1) + CLEAR_LINE +
        `${STEEL}${BOX.v}${RESET}  ${msg}`);
    } else if (useCompact) {
      // compact: inline tokens with left border gutter
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
      const compactRows = formatCompactRows(visibleSessions, this.cols - 3, this.pinnedIds, this.mutedIds, noteIdSet, compactHealthScores, compactActivityRates, this.sessionColors);
      for (let r = 0; r < compactRows.length; r++) {
        process.stderr.write(moveTo(startRow + 1 + r, 1) + CLEAR_LINE +
          `${STEEL}${BOX.v}${RESET} ${compactRows[r]}`);
      }
    } else {
      // full table mode — column header only when there's room
      const colHeaderRow = formatSessionTableHeader(innerWidth);
      process.stderr.write(moveTo(startRow + 1, 1) + CLEAR_LINE + truncateAnsi(colHeaderRow, this.cols));

      const nowMs = Date.now();
      for (let i = 0; i < visibleSessions.length; i++) {
        const s = visibleSessions[i];
        const isHovered = this.hoverSessionIdx === i + 1;
        const pinned = this.pinnedIds.has(s.id);
        const muted = this.mutedIds.has(s.id);
        const noted = this.sessionNotes.has(s.id);
        const group = this.sessionGroups.get(s.id);
        const errTs = this.sessionErrorTimestamps.get(s.id);
        const errSparkline = errTs ? formatSessionErrorSparkline(errTs, nowMs) : "";
        const lastChange = this.lastChangeAt.get(s.id);
        const idleSinceMs = lastChange !== undefined ? nowMs - lastChange : undefined;
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
        const displayName = this.sessionAliases.get(s.id);
        const colorName = this.sessionColors.get(s.id);
        const draining = this.drainingIds.has(s.id);
        const sessionLabel = this.sessionLabels.get(s.id);
        const sTags = this.sessionTags.get(s.id);
        const line = formatSessionTableRow({
          s, idx: i + 1, innerWidth, isHovered,
          pinned, muted, noted, group,
          errSparkline: errSparkline || undefined,
          idleSinceMs, healthScore, displayName,
          colorName, draining, sessionLabel, sTags,
          mutedCount: this.mutedEntryCounts.get(s.id) ?? 0,
          noteText: this.sessionNotes.get(s.id),
          icon: this.sessionIcons.get(s.id),
          vibeCell: this.sessionVibes.get(s.id),
          burnRate,
          budgetUSD: this.sessionBudgets.get(s.id) ?? this.globalBudget ?? null,
        });
        const padded = padBoxLineHover(line, this.cols, isHovered);
        process.stderr.write(moveTo(startRow + 2 + i, 1) + CLEAR_LINE + padded);
      }
    }

    // ── bottom border: matching rounded corners ───────────────────────────────
    const bodyRows = useCompact
      ? computeCompactRowCount(visibleSessions, this.cols - 3)
      : Math.max(visibleCount, 1) + 1; // +1 for column header row
    const bottomRow = startRow + 1 + bodyRows;
    const bottomBorder =
      `${STEEL}${BOX.rbl}${BOX.h.repeat(Math.max(0, this.cols - 2))}${BOX.rbr}${RESET}`;
    process.stderr.write(moveTo(bottomRow, 1) + CLEAR_LINE + truncateAnsi(bottomBorder, this.cols));

    // clear leftover rows between box bottom and separator
    for (let r = bottomRow + 1; r < this.separatorRow; r++) {
      process.stderr.write(moveTo(r, 1) + CLEAR_LINE);
    }

    process.stderr.write(RESTORE_CURSOR);
  }

  /** Repaint a single session table row by 1-indexed position (for hover updates). */
  private repaintSessionCard(idx: number): void {
    if (!this.active || this.viewMode !== "overview") return;
    const i = idx - 1;
    const visibleSessions = this.getVisibleSessions();
    if (i < 0 || i >= visibleSessions.length) return;
    // +2: skip top border + column header row
    const startRow = this.headerHeight + 1;
    const innerWidth = this.cols - 2;
    const s = visibleSessions[i];
    const nowMs = Date.now();
    const isHovered = this.hoverSessionIdx === idx;
    const lastChange = this.lastChangeAt.get(s.id);
    const idleSinceMs = lastChange !== undefined ? nowMs - lastChange : undefined;
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
    const errTs = this.sessionErrorTimestamps.get(s.id);
    const errSparkline = errTs ? formatSessionErrorSparkline(errTs, nowMs) : "";
    const line = formatSessionTableRow({
      s, idx, innerWidth, isHovered,
      pinned: this.pinnedIds.has(s.id),
      muted: this.mutedIds.has(s.id),
      noted: this.sessionNotes.has(s.id),
      group: this.sessionGroups.get(s.id),
      errSparkline: errSparkline || undefined,
      idleSinceMs, healthScore,
      displayName: this.sessionAliases.get(s.id),
      colorName: this.sessionColors.get(s.id),
      draining: this.drainingIds.has(s.id),
      sessionLabel: this.sessionLabels.get(s.id),
      sTags: this.sessionTags.get(s.id),
      mutedCount: this.mutedEntryCounts.get(s.id) ?? 0,
      noteText: this.sessionNotes.get(s.id),
      icon: this.sessionIcons.get(s.id),
      vibeCell: this.sessionVibes.get(s.id),
      burnRate,
      budgetUSD: this.sessionBudgets.get(s.id) ?? this.globalBudget ?? null,
    });
    const padded = padBoxLineHover(line, this.cols, isHovered);
    process.stderr.write(SAVE_CURSOR + moveTo(startRow + 2 + i, 1) + CLEAR_LINE + padded + RESTORE_CURSOR);
  }

  private paintSeparator(): void {
    // ── left: colored section label ──────────────────────────────────────────
    const label = ` ${GLYPH.activity} ACTIVITY `;
    const labelWidth = stripAnsiForLen(label);

    // ── middle: sparkline or filter/scroll info ───────────────────────────────
    const suppressedSuffix = this.suppressedTags.size > 0
      ? `  ${DIM}${MUTE_ICON}errors${RESET}` : "";
    let hints: string;
    if (this.filterTag) {
      const source = this.applyDisplayFilters(this.activityBuffer.filter((e) => !isSuppressedEntry(e, this.suppressedTags)));
      const matchCount = source.filter((e) => matchesTagFilter(e, this.filterTag!)).length;
      hints = `${AMBER}` + formatTagFilterIndicator(this.filterTag, matchCount, source.length) + `${RESET}` + suppressedSuffix;
    } else if (this.searchPattern) {
      const filtered = this.activityBuffer.filter((e) => matchesSearch(e, this.searchPattern!));
      hints = `${SKY}` + formatSearchIndicator(this.searchPattern, filtered.length, this.activityBuffer.length) + `${RESET}`;
    } else if (this.scrollOffset > 0) {
      hints = `${SLATE}` + formatScrollIndicator(this.scrollOffset, this.activityBuffer.length, this.scrollBottom - this.scrollTop + 1, this.newWhileScrolled) + `${RESET}`;
    } else {
      const spark = formatSparkline(computeSparkline(this.activityTimestamps));
      hints = spark ? ` ${spark} ` : `${STEEL} /help for commands ${RESET}`;
    }
    const hintsWidth = stripAnsiForLen(hints);

    // ── fill: single-line rule keeps hierarchy clear below the agents box ────
    const fill = Math.max(0, this.cols - labelWidth - hintsWidth);
    const line = `${STEEL}${BOX.h}${RESET}${BG_SECTION}${SILVER}${BOLD}${label}${RESET}${STEEL}${BOX.h.repeat(Math.max(0, fill - 1))}${RESET}${hints}`;
    process.stderr.write(
      SAVE_CURSOR + moveTo(this.separatorRow, 1) + CLEAR_LINE + truncateAnsi(line, this.cols) + RESTORE_CURSOR
    );
  }

  private writeActivityLine(entry: ActivityEntry): void {
    // Write at scrollBottom then newline — this triggers the terminal's scroll
    // region to scroll up one line within [scrollTop, scrollBottom], which never
    // touches inputRow (rows) since scrollBottom = rows-2.
    const line = formatActivity(entry, this.cols);
    process.stderr.write(
      SAVE_CURSOR +
      moveTo(this.scrollBottom, 1) + "\n" + line +
      RESTORE_CURSOR
    );
    // Always repaint input: the terminal scroll region scroll does not affect
    // rows outside [scrollTop, scrollBottom], but cursor save/restore can leave
    // the terminal in an odd state on some emulators.
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
    const line = formatInputLine(this.phase, this.paused, this.pendingCount, this.cols);
    process.stderr.write(
      SAVE_CURSOR +
      moveTo(this.inputRow, 1) + CLEAR_LINE + line +
      RESTORE_CURSOR
    );
  }
}

// ── Phase chunk (header) ────────────────────────────────────────────────────

/**
 * Format the phase section of the header bar.
 * - reasoning: OpenCode-style bouncing blue-tip sweep animation over grey blocks
 * - sleeping:  static left-fill countdown bar (grey → blue as deadline approaches)
 * - other:     spinner + phase label
 */
function formatPhaseChunk(
  phase: DaemonPhase,
  paused: boolean,
  spinnerFrame: number,
  nextTickAt: number,
  nextReasonAt: number,
  _cols: number,
): string {
  const sep = `${STEEL}${BOX.v}${RESET}${BG_DARK}`;

  if (paused) {
    return `${sep} ${AMBER}${BOLD}⏸ paused${RESET}${BG_DARK}`;
  }

  if (phase === "reasoning") {
    // OpenCode-style bouncing blue-tip sweep over grey blocks
    const tip = spinnerFrame % PROGRESS_BLOCKS;
    const bar = Array.from({ length: PROGRESS_BLOCKS }, (_, i) => {
      if (i === tip) return `${PROGRESS_TIP}▓${RESET}`;
      if (i === (tip + 1) % PROGRESS_BLOCKS) return `${PROGRESS_TIP}▒${RESET}`;
      return `${PROGRESS_IDLE}░${RESET}`;
    }).join("");
    return `${sep} ${SKY}${BOLD}thinking${RESET}${BG_DARK} ${bar}`;
  }

  if (phase === "sleeping") {
    const now = Date.now();

    // Poll countdown bar (time to next observation tick)
    let pollBar = "";
    if (nextTickAt > 0) {
      const pollRemaining = Math.max(0, nextTickAt - now);
      const POLL_WINDOW = 15_000; // typical poll interval for display purposes
      const pollElapsed = Math.max(0, POLL_WINDOW - pollRemaining);
      const pollFilled = Math.min(PROGRESS_BLOCKS / 2, Math.round((pollElapsed / POLL_WINDOW) * (PROGRESS_BLOCKS / 2)));
      pollBar = Array.from({ length: Math.floor(PROGRESS_BLOCKS / 2) }, (_, i) =>
        i < pollFilled ? `${TEAL}▪${RESET}` : `${PROGRESS_IDLE}·${RESET}`
      ).join("");
    }

    // Reason countdown (time to next LLM call) — only show when distinct from poll
    let reasonPart = "";
    if (nextReasonAt > 0) {
      const reasonRemaining = Math.max(0, nextReasonAt - now);
      const reasonSecs = Math.ceil(reasonRemaining / 1000);
      const REASON_WINDOW = 60_000;
      const reasonElapsed = Math.max(0, REASON_WINDOW - reasonRemaining);
      const reasonFilled = Math.min(PROGRESS_BLOCKS, Math.round((reasonElapsed / REASON_WINDOW) * PROGRESS_BLOCKS));
      const reasonBar = Array.from({ length: PROGRESS_BLOCKS }, (_, i) =>
        i < reasonFilled ? `${PROGRESS_TIP}▓${RESET}` : `${PROGRESS_IDLE}░${RESET}`
      ).join("");
      reasonPart = ` ${sep} ${SLATE}${GLYPH.thinking} ${reasonSecs}s${RESET}${BG_DARK} ${reasonBar}`;
    } else if (nextTickAt > 0) {
      const remaining = Math.max(0, nextTickAt - now);
      const secs = Math.ceil(remaining / 1000);
      reasonPart = ` ${STEEL}${GLYPH.clock} ${secs}s${RESET}${BG_DARK}`;
    }

    return `${sep} ${STEEL}${GLYPH.clock} poll${RESET}${BG_DARK} ${pollBar}${reasonPart}`;
  }

  if (phase === "polling") {
    return `${sep} ${TEAL}${SPINNER[spinnerFrame]} polling${RESET}${BG_DARK}`;
  }

  if (phase === "executing") {
    return `${sep} ${AMBER}${SPINNER[spinnerFrame]} executing${RESET}${BG_DARK}`;
  }

  if (phase === "interrupted") {
    return `${sep} ${ROSE}${BOLD}✗ interrupted${RESET}${BG_DARK}`;
  }

  const spin = SPINNER[spinnerFrame % SPINNER.length];
  return `${sep} ${SLATE}${spin} ${phase}${RESET}${BG_DARK}`;
}

// ── Session table (overview panel) ──────────────────────────────────────────

// Column widths for NAME | TASK | STATUS | HEALTH | CTX | COST table
// These are target widths; they flex based on terminal width.
const COL_NAME_MIN   = 12;
const COL_TASK_MIN   = 18;
const COL_STATUS_MIN =  8;
const COL_HEALTH_MIN =  6; // "⬡100" or colored badge
const COL_CTX_MIN    =  7; // "137kt" context tokens
const COL_COST_MIN   =  7; // "$3.42"
const COL_SEP = `${STEEL} ${BOX.v} ${RESET}`; // colored column separator
const COL_SEP_W = 3; // " │ " = 3 visible chars
const COL_COUNT = 6; // NAME TASK STATUS HEALTH CTX COST

/** Compute column widths given total inner width */
function computeTableCols(innerWidth: number): { name: number; task: number; status: number; health: number; ctx: number; cost: number } {
  // Fixed columns: separators + status + health + ctx + cost + 2 for left border space
  const fixed = COL_SEP_W * (COL_COUNT - 1) + COL_STATUS_MIN + COL_HEALTH_MIN + COL_CTX_MIN + COL_COST_MIN + 2;
  const flex = Math.max(COL_NAME_MIN + COL_TASK_MIN, innerWidth - fixed);
  // Name gets 35% of flex, task gets 65%
  const name = Math.max(COL_NAME_MIN, Math.floor(flex * 0.35));
  const task = Math.max(COL_TASK_MIN, flex - name);
  return { name, task, status: COL_STATUS_MIN, health: COL_HEALTH_MIN, ctx: COL_CTX_MIN, cost: COL_COST_MIN };
}

/** Column header row — DIM with double-line separator below */
function formatSessionTableHeader(innerWidth: number): string {
  const c = computeTableCols(innerWidth);
  const h = (label: string, w: number) =>
    `${STEEL}${BOLD}${label.padEnd(w)}${RESET}`;
  const divRow =
    `${STEEL}${BOX.v}${RESET} ` +
    h("NAME",   c.name)   + COL_SEP +
    h("TASK",   c.task)   + COL_SEP +
    h("STATUS", c.status) + COL_SEP +
    h("HEALTH", c.health) + COL_SEP +
    h("CTX",    c.ctx)    + COL_SEP +
    h("COST",   c.cost);
  // pad to full width with right border
  const padded = padBoxLine(divRow, innerWidth + 2);
  return padded;
}

/** Map session status → colored STATUS cell */
function formatStatusCell(s: DaemonSessionState, idleSinceMs: number | undefined): string {
  switch (s.status) {
    case "working":
    case "running":   return `${BG_LIME}\x1b[38;5;232m working ${RESET}`;
    case "waiting":   return `${BG_AMBER}\x1b[38;5;232m waiting ${RESET}`;
    case "error":     return `${BG_ROSE}\x1b[38;5;232m  error  ${RESET}`;
    case "done":      return `${LIME}done${RESET}    `;
    case "idle": {
      const label = idleSinceMs !== undefined ? formatIdleSince(idleSinceMs) : "idle";
      return `${SLATE}${label.padEnd(COL_STATUS_MIN)}${RESET}`;
    }
    case "stopped":   return `${DIM}stopped ${RESET}`;
    default:          return `${SLATE}${s.status.slice(0, COL_STATUS_MIN).padEnd(COL_STATUS_MIN)}${RESET}`;
  }
}

/** Infer vibe from session state heuristics */
function inferVibe(s: DaemonSessionState, errorCount: number, idleSinceMs: number | undefined): string {
  if (s.userActive) return `${AMBER}you     ${RESET}`;
  if (s.status === "error" && errorCount >= 3) return `${ROSE}${BOLD}lost    ${RESET}`;
  if (s.status === "error") return `${ROSE}fixing  ${RESET}`;
  if (s.status === "working" || s.status === "running") {
    if (errorCount > 0) return `${AMBER}focused ${RESET}`;
    return `${LIME}flowing ${RESET}`;
  }
  if (s.status === "waiting") return `${AMBER}needs↑  ${RESET}`;
  if (s.status === "done") return `${GOLD}done    ${RESET}`;
  if (idleSinceMs !== undefined && idleSinceMs > 120_000) return `${SLATE}idle    ${RESET}`;
  return `${SLATE}idle    ${RESET}`;
}

/** One session row in the NAME | TASK | STATUS | HEALTH | CTX | COST table */
function formatSessionTableRow(opts: {
  s: DaemonSessionState;
  idx: number;
  innerWidth: number;
  isHovered: boolean;
  pinned: boolean;
  muted: boolean;
  noted: boolean;
  group: string | undefined;
  errSparkline: string | undefined;
  idleSinceMs: number | undefined;
  healthScore: number;
  displayName: string | undefined;
  colorName: string | undefined;
  draining: boolean;
  sessionLabel: string | undefined;
  sTags: Set<string> | undefined;
  mutedCount: number;
  noteText: string | undefined;
  icon?: string | undefined;
  vibeCell?: string | undefined; // pre-computed from vibe.ts (kept for compat; unused in table)
  burnRate?: number | null;      // tokens/min from context history — for CTX direction arrow
  budgetUSD?: number | null;     // session budget — for COST threshold coloring
}): string {
  const { s, idx, innerWidth, isHovered, pinned, muted, noted, group,
    errSparkline, idleSinceMs, healthScore, displayName, colorName, draining,
    sessionLabel, sTags, mutedCount, icon, burnRate, budgetUSD } = opts;

  const bg = isHovered ? BG_HOVER : "";
  const c = computeTableCols(innerWidth);

  // ── NAME column ───────────────────────────────────────────────────────────
  // Tint the status dot with the session's assigned accent color (opencode tint pattern):
  // each agent gets a unique color, applied to the primary indicator dot so agents
  // are visually distinct at a glance without needing a separate color-dot glyph.
  const baseDot = STATUS_DOT[s.status] ?? `${AMBER}${DOT.filled}${RESET}`;
  const dot = colorName ? `${formatColorDot(colorName)}${RESET}` : baseDot;
  const colorDot = "";
  const drainMark = draining ? `${DIM}${DRAIN_ICON}${RESET}` : "";
  const pinMark   = pinned   ? `${AMBER}${PIN_ICON}${RESET}` : "";
  const muteMark  = muted    ? `${DIM}${MUTE_ICON}${RESET}` : "";
  const noteMark  = noted    ? `${TEAL}${NOTE_ICON}${RESET}` : "";
  const iconPrefix = icon ? `${icon} ` : "";
  const idxStr    = `${SLATE}${String(idx).padStart(2)}${RESET}`;
  const nameStr   = displayName
    ? `${BOLD}${truncatePlain(displayName, c.name - 6)}${RESET}`
    : `${BOLD}${truncatePlain(s.title, c.name - 6)}${RESET}`;
  const toolStr   = `${SLATE}${s.tool.slice(0, 6)}${RESET}`;
  const iconStr   = `${pinMark}${muteMark}${noteMark}${drainMark}${colorDot}`;
  const nameCell  = `${bg}${idxStr} ${dot} ${iconPrefix}${iconStr}${nameStr} ${toolStr}`;

  // ── TASK column ───────────────────────────────────────────────────────────
  const rawTask = s.currentTask ?? s.lastActivity ?? "";
  // strip opencode UI chrome: lines that are just ctrl hints / tmux helpers
  const cleanTask = rawTask
    .replace(/\x1b\[[0-9;]*[mABCDHJKST]/g, "")  // strip ANSI
    .replace(/\r/g, "")
    .split("\n")
    .map(l => l.trim())
    .filter(l => l && !/^(ctrl\+|─{3,}|Agents|Sessions|Tasks|Commands|\$|>|Press|Type|Use |Tab |Esc)/i.test(l))
    .join(" ")
    .slice(0, c.task * 2);
  // error sparkline trails the task text when there are recent errors
  const spark    = errSparkline ?? "";
  // reserve space for sparkline (5 chars + 1 space) when present
  const taskMax  = spark ? Math.max(4, c.task - 7) : c.task;
  const taskStr  = `${DIM}${truncatePlain(cleanTask, taskMax)}${RESET}${spark ? `  ${spark}` : ""}`;

  // ── STATUS column ─────────────────────────────────────────────────────────
  const statusCell = formatStatusCell(s, idleSinceMs);

  // ── HEALTH column ─────────────────────────────────────────────────────────
  // Compact health score: ⬡100 colored by severity. Fits in 4 visible chars.
  const healthColor = healthScore >= HEALTH_GOOD ? LIME : healthScore >= HEALTH_WARN ? AMBER : ROSE;
  const healthCell  = `${healthColor}${HEALTH_ICON}${healthScore}${RESET}`;

  // ── CTX column ────────────────────────────────────────────────────────────
  // Percentage fill from parseContextCeiling (opencode ProgressCircle equivalent).
  // Appends a ↑ direction arrow when burn rate exceeds threshold — opencode's
  // DebugBar "bad" threshold pattern: value exceeds limit → go red.
  const ceiling = parseContextCeiling(s.contextTokens);
  const burning = burnRate !== null && burnRate !== undefined && burnRate > CONTEXT_BURN_THRESHOLD;
  const burnArrow = burning ? `${ROSE}↑${RESET}` : "";
  let ctxCell: string;
  if (ceiling) {
    const pct = Math.round((ceiling.current / ceiling.max) * 100);
    // color ramp: slate <70%, amber 70–89%, rose ≥90%
    const ctxColor = pct >= 90 ? ROSE : pct >= 70 ? AMBER : SLATE;
    ctxCell = `${ctxColor}${pct}%${RESET}${burnArrow}`;
  } else if (s.contextTokens) {
    const raw = s.contextTokens.replace(/,/g, "").replace(/\s*tokens?.*$/i, "").trim();
    const n   = parseInt(raw, 10);
    const base = isNaN(n)
      ? `${DIM}${truncatePlain(raw, c.ctx)}${RESET}`
      : n >= 1_000_000
        ? `${ROSE}${(n / 1_000_000).toFixed(1)}Mt${RESET}`
        : n >= 1_000
          ? `${n >= 100_000 ? AMBER : SLATE}${Math.round(n / 1_000)}kt${RESET}`
          : `${SLATE}${n}t${RESET}`;
    ctxCell = `${base}${burnArrow}`;
  } else {
    ctxCell = `${DIM}—${RESET}`;
  }

  // ── COST column ───────────────────────────────────────────────────────────
  // Budget-aware coloring (opencode DebugBar "bad" threshold pattern):
  // over budget → rose, under budget → lime, no budget set → teal, no data → dim dash.
  const costRaw = s.costStr ?? "";
  let costCell: string;
  if (costRaw) {
    const costVal = parseCostValue(costRaw);
    const overBudget = budgetUSD != null && costVal !== null && costVal >= budgetUSD;
    const underBudget = budgetUSD != null && costVal !== null && costVal < budgetUSD;
    const costColor = overBudget ? ROSE : underBudget ? LIME : TEAL;
    costCell = `${costColor}${truncatePlain(costRaw, c.cost)}${RESET}`;
  } else {
    costCell = `${DIM}—${RESET}`;
  }

  return (
    `${bg}${STEEL}${BOX.v}${RESET} ` +
    `${nameCell.slice(0, nameCell.length)}${COL_SEP}` +
    `${bg}${taskStr}${COL_SEP}` +
    `${bg}${statusCell}${COL_SEP}` +
    `${bg}${healthCell}${COL_SEP}` +
    `${bg}${ctxCell}${COL_SEP}` +
    `${bg}${costCell}`
  );
}

// ── Formatting helpers ──────────────────────────────────────────────────────

// format a session as a card-style line (inside the box)
// errorSparkline: optional pre-formatted ROSE sparkline string (5 chars) for recent errors
// idleSinceMs: optional ms since last activity change (shown when idle/stopped)
// healthBadge: optional pre-formatted health score badge ("⬡83" colored)
// displayName: optional custom name override (from /rename)
// ageStr: optional session age string (from createdAt)
// label: optional freeform label shown as DIM subtitle
function formatSessionCard(s: DaemonSessionState, maxWidth: number, errorSparkline?: string, idleSinceMs?: number, healthBadge?: string, displayName?: string, ageStr?: string, label?: string): string {
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
  const labelSuffix = label ? ` ${DIM}· ${label}${RESET}` : "";
  return truncateAnsi(`${dot} ${healthPrefix}${name} ${toolBadge}${contextBadge} ${SLATE}${BOX.h}${RESET} ${desc}${ageSuffix}${labelSuffix}${sparkSuffix}`, maxWidth);
}

// colorize an activity entry based on its tag
// Each tag gets a colored left gutter bar (┃) for fast visual scanning
function formatActivity(entry: ActivityEntry, maxCols: number): string {
  const { time, tag, text } = entry;
  let gutterColor = STEEL;
  let labelColor  = SLATE;
  let label       = tag;
  let textColor   = "";

  switch (tag) {
    case "observation":
      gutterColor = STEEL; labelColor = STEEL; label = "obs"; break;
    case "reasoner":
      gutterColor = SKY;   labelColor = SKY;   label = "reasoner"; textColor = DIM; break;
    case "explain":
      gutterColor = TEAL;  labelColor = `${BOLD}${TEAL}`; label = "AI"; textColor = BOLD; break;
    case "+ action":
    case "action":
      gutterColor = LIME;  labelColor = LIME;  label = "→ action"; break;
    case "! action":
    case "error":
      gutterColor = ROSE;  labelColor = ROSE;  label = "✗ error"; textColor = ROSE; break;
    case "you":
      gutterColor = LIME;  labelColor = `${BOLD}${LIME}`; label = "you"; textColor = BOLD; break;
    case "system":
      gutterColor = SLATE; labelColor = SLATE; label = "sys"; textColor = DIM; break;
    case "status":
      gutterColor = SLATE; labelColor = STEEL; label = "status"; textColor = DIM; break;
    case "config":
      gutterColor = TEAL;  labelColor = TEAL;  label = "⚙ config"; break;
    default:
      gutterColor = STEEL; labelColor = STEEL; break;
  }

  const gutter    = `${gutterColor}${GLYPH.pipe}${RESET}`;
  const timeStr   = `${STEEL}${time}${RESET}`;
  const labelStr  = `${labelColor}${label.padEnd(8)}${RESET}`;
  const textStr   = `${textColor}${text}${textColor ? RESET : ""}`;
  const formatted = ` ${gutter} ${timeStr} ${labelStr} ${textStr}`;
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

// ── Input line (pure, exported for testing) ──────────────────────────────────

/**
 * Format the full input row.
 *
 * Layout:  ╭─ ▸ you ── [pending chips] ────────────────── phase hint ─╮
 *           the cursor sits after the prompt glyph
 *
 * Pending messages are always shown as chips so the user knows their
 * input is registered even when the reasoner is idle or paused.
 */
function formatInputLine(phase: DaemonPhase, paused: boolean, pendingCount: number, cols: number): string {
  // left accent: colored by phase
  let accentColor: string;
  let phaseHint: string;
  if (paused) {
    accentColor = AMBER;
    phaseHint = `${AMBER}paused${RESET}`;
  } else if (phase === "reasoning") {
    accentColor = SKY;
    phaseHint = `${SKY}thinking…${RESET}`;
  } else if (phase === "polling") {
    accentColor = TEAL;
    phaseHint = `${TEAL}polling${RESET}`;
  } else {
    accentColor = LIME;
    phaseHint = "";
  }

  // pending chips: shown always if there are queued messages
  const pendingChip = pendingCount > 0
    ? ` ${BG_AMBER}\x1b[38;5;232m ${pendingCount} queued ${RESET}`
    : "";

  // left border + prompt glyph
  const left = `${accentColor}${BOX.v}${RESET}${BG_INPUT} ${accentColor}${BOLD}${GLYPH.input} you${RESET}${BG_INPUT}${pendingChip}${BG_INPUT} `;
  const leftWidth = stripAnsiForLen(left);

  // right: phase hint
  const right = phaseHint ? ` ${phaseHint}${BG_INPUT} ${accentColor}${BOX.v}${RESET}` : `${accentColor}${BOX.v}${RESET}`;
  const rightWidth = stripAnsiForLen(right);

  const fill = Math.max(0, cols - leftWidth - rightWidth);
  return left + " ".repeat(fill) + right;
}

// keep formatPrompt for backward compat with tests
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

// ── Automatic context compaction ────────────────────────────────────────────

/** Compaction nudge threshold: suggest compaction when context exceeds this fraction. */
export const CONTEXT_COMPACTION_THRESHOLD = 0.80;

/** Cooldown between compaction nudges for the same session (10 minutes). */
export const COMPACTION_COOLDOWN_MS = 10 * 60_000;

/**
 * Determine whether a compaction nudge should be sent to a session.
 * Returns true when context fraction exceeds threshold and the cooldown has elapsed.
 */
export function shouldCompactContext(
  fraction: number,
  lastNudgeAt: number | undefined,
  now: number,
  cooldownMs: number = COMPACTION_COOLDOWN_MS,
  threshold: number = CONTEXT_COMPACTION_THRESHOLD,
): boolean {
  if (fraction < threshold) return false;
  if (lastNudgeAt !== undefined && now - lastNudgeAt < cooldownMs) return false;
  return true;
}

/**
 * Format the compaction nudge message to send to a session.
 * This message asks the agent to summarize and compact its context.
 */
export function formatCompactionNudge(title: string, pct: number): string {
  return `Your context is at ${pct}% capacity. Please summarize your progress so far and compact your context — drop any file contents, tool outputs, or intermediate reasoning you no longer need. Keep only the essential state needed to continue your current task.`;
}

/**
 * Format a compaction alert for the activity log.
 */
export function formatCompactionAlert(title: string, pct: number): string {
  return `${title}: context at ${pct}% — sent compaction nudge`;
}

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

// ── Smart session context budget ────────────────────────────────────────────
// Dynamically allocate per-session context token budgets based on activity.
// Active sessions get more budget; idle/stopped sessions get less.

/** Activity weight per session status — higher weight = larger budget share. */
export const CTX_BUDGET_WEIGHTS: Record<string, number> = {
  working: 3,
  running: 3,
  error:   2,
  waiting: 1,
  idle:    1,
  stopped: 0,
};

/** Default global context budget when not configured (200k tokens). */
export const CTX_BUDGET_DEFAULT_GLOBAL = 200_000;

export interface ContextBudgetAllocation {
  sessionId: string;
  title: string;
  status: string;
  weight: number;
  budgetTokens: number;   // allocated token budget for this session
  currentTokens: number | null; // current usage if known
  usagePct: number | null;      // currentTokens / budgetTokens as %, or null
}

/**
 * Allocate context budgets across sessions proportional to activity weight.
 * Sessions with weight 0 (stopped) get nothing.
 * When all sessions are equal weight, budget splits evenly.
 */
export function computeContextBudgets(
  sessions: readonly DaemonSessionState[],
  globalMaxTokens: number = CTX_BUDGET_DEFAULT_GLOBAL,
): ContextBudgetAllocation[] {
  if (sessions.length === 0) return [];

  const entries = sessions.map((s) => {
    const weight = CTX_BUDGET_WEIGHTS[s.status] ?? 1;
    const ceiling = parseContextCeiling(s.contextTokens);
    const currentTokens = ceiling ? ceiling.current : parseContextTokenNumber(s.contextTokens);
    return { sessionId: s.id, title: s.title, status: s.status, weight, currentTokens };
  });

  const totalWeight = entries.reduce((sum, e) => sum + e.weight, 0);

  return entries.map((e) => {
    const budgetTokens = totalWeight > 0
      ? Math.round((e.weight / totalWeight) * globalMaxTokens)
      : 0;
    const usagePct = budgetTokens > 0 && e.currentTokens !== null
      ? Math.round((e.currentTokens / budgetTokens) * 100)
      : null;
    return {
      sessionId: e.sessionId,
      title: e.title,
      status: e.status,
      weight: e.weight,
      budgetTokens,
      currentTokens: e.currentTokens,
      usagePct,
    };
  });
}

/**
 * Format context budget allocations as a human-readable table for /ctx-budget.
 */
export function formatContextBudgetTable(allocations: readonly ContextBudgetAllocation[], globalMax: number): string[] {
  if (allocations.length === 0) return ["(no sessions)"];
  const lines: string[] = [];
  lines.push(`context budget: ${(globalMax / 1000).toFixed(0)}kt total across ${allocations.length} sessions`);
  for (const a of allocations) {
    const budget = `${(a.budgetTokens / 1000).toFixed(0)}kt`;
    const usage = a.currentTokens !== null ? `${(a.currentTokens / 1000).toFixed(0)}kt` : "?";
    const pct = a.usagePct !== null ? `${a.usagePct}%` : "—";
    const bar = a.usagePct !== null
      ? (a.usagePct >= 90 ? `${ROSE}█${RESET}` : a.usagePct >= 70 ? `${AMBER}▓${RESET}` : `${LIME}░${RESET}`)
      : `${DIM}·${RESET}`;
    lines.push(`  ${bar} ${BOLD}${a.title}${RESET} ${DIM}(${a.status}, w=${a.weight})${RESET}  ${usage}/${budget} ${pct}`);
  }
  return lines;
}

// ── Multi-profile support ───────────────────────────────────────────────────
// Manage sessions across multiple AoE profiles simultaneously.

export interface ProfileSession {
  profile: string;
  sessionId: string;
  title: string;
}

/**
 * Resolve the list of profiles to poll from config.
 * Supports both the new `profiles` array and the legacy single `profile` field.
 * Always returns at least ["default"].
 */
export function resolveProfiles(config: { aoe?: { profile?: string; profiles?: string[] } }): string[] {
  if (config.aoe?.profiles && Array.isArray(config.aoe.profiles) && config.aoe.profiles.length > 0) {
    return [...new Set(config.aoe.profiles)]; // deduplicate
  }
  return [config.aoe?.profile ?? "default"];
}

/**
 * Merge sessions from multiple profiles into a single list.
 * Each session is tagged with its source profile.
 * Deduplicates by session ID (first occurrence wins if same ID appears in multiple profiles).
 */
export function mergeProfileSessions(
  profileSessions: ReadonlyMap<string, readonly { id: string; title: string }[]>,
): ProfileSession[] {
  const seen = new Set<string>();
  const merged: ProfileSession[] = [];
  for (const [profile, sessions] of profileSessions) {
    for (const s of sessions) {
      if (seen.has(s.id)) continue;
      seen.add(s.id);
      merged.push({ profile, sessionId: s.id, title: s.title });
    }
  }
  return merged;
}

/**
 * Format a profile summary showing each profile and its session count.
 */
export function formatProfileSummary(
  profileCounts: ReadonlyMap<string, number>,
  activeProfile?: string,
): string[] {
  if (profileCounts.size === 0) return ["(no profiles configured)"];
  const lines: string[] = [];
  const total = [...profileCounts.values()].reduce((a, b) => a + b, 0);
  lines.push(`profiles: ${profileCounts.size} active, ${total} total sessions`);
  for (const [name, count] of profileCounts) {
    const marker = name === activeProfile ? `${LIME}●${RESET} ` : `${DIM}○${RESET} `;
    const label = count === 1 ? "session" : "sessions";
    lines.push(`  ${marker}${BOLD}${name}${RESET} ${DIM}(${count} ${label})${RESET}`);
  }
  return lines;
}

// ── Session Replay in TUI ───────────────────────────────────────────────────
// Play back a session's stored pane output frame-by-frame in the drill-down view.

/** Default replay speed: lines per second. */
export const REPLAY_DEFAULT_LPS = 10;
/** Max replay speed. */
export const REPLAY_MAX_LPS = 100;

export interface SessionReplayState {
  sessionId: string;
  title: string;
  lines: readonly string[];     // full output to replay
  frameIndex: number;           // current line being displayed (0-based)
  linesPerSecond: number;       // playback speed
  paused: boolean;
  startedAt: number;            // epoch ms
}

/**
 * Create a new replay state for a session.
 * Returns null if the session has no stored output.
 */
export function createReplayState(
  sessionId: string,
  title: string,
  lines: readonly string[],
  linesPerSecond: number = REPLAY_DEFAULT_LPS,
): SessionReplayState | null {
  if (lines.length === 0) return null;
  return {
    sessionId,
    title,
    lines,
    frameIndex: 0,
    linesPerSecond: Math.max(1, Math.min(REPLAY_MAX_LPS, linesPerSecond)),
    paused: false,
    startedAt: Date.now(),
  };
}

/**
 * Advance the replay by one tick. Returns the batch of new lines to display
 * and the updated state. Returns empty batch when paused or finished.
 */
export function advanceReplay(
  state: SessionReplayState,
  batchSize: number = 1,
): { newLines: string[]; done: boolean; updatedState: SessionReplayState } {
  if (state.paused || state.frameIndex >= state.lines.length) {
    return { newLines: [], done: state.frameIndex >= state.lines.length, updatedState: state };
  }
  const end = Math.min(state.frameIndex + batchSize, state.lines.length);
  const newLines = state.lines.slice(state.frameIndex, end) as string[];
  const updatedState = { ...state, frameIndex: end };
  return { newLines, done: end >= state.lines.length, updatedState };
}

/**
 * Format a replay status bar for the drill-down separator.
 */
export function formatReplayStatusBar(state: SessionReplayState): string {
  const pct = state.lines.length > 0
    ? Math.round((state.frameIndex / state.lines.length) * 100)
    : 0;
  const status = state.paused ? "⏸ paused" : state.frameIndex >= state.lines.length ? "⏹ done" : "▶ playing";
  return `${BOLD}REPLAY${RESET} ${state.title} ${DIM}${state.frameIndex}/${state.lines.length} (${pct}%) ${status} @ ${state.linesPerSecond} lps${RESET}`;
}

// ── Session dependency graph ────────────────────────────────────────────────
// Detect relationships between sessions based on path containment and
// cross-references in task goals / current activity.

export interface SessionDependencyEdge {
  from: string;    // session title (the one that depends)
  to: string;      // session title (the dependency)
  reason: string;  // why: "path containment" | "goal reference" | "task reference"
}

export interface SessionDependencyGraph {
  edges: SessionDependencyEdge[];
  roots: string[];   // sessions with no outgoing dependencies
  leaves: string[];  // sessions that no one depends on
}

/**
 * Build a dependency graph from session state and task goals.
 * Detection heuristics:
 *   1. Path containment: session A's path is a parent of session B's path → A watches B
 *   2. Goal reference: a task's goal text mentions another session's title
 *   3. Task reference: currentTask text mentions another session's title
 */
export function buildSessionDependencyGraph(
  sessions: readonly DaemonSessionState[],
  taskGoals?: ReadonlyMap<string, string>,  // sessionTitle → goal text
): SessionDependencyGraph {
  const edges: SessionDependencyEdge[] = [];
  const titles = sessions.map((s) => s.title);
  const titleSet = new Set(titles.map((t) => t.toLowerCase()));

  for (const a of sessions) {
    for (const b of sessions) {
      if (a.id === b.id) continue;

      // 1. path containment: A's path contains B's path → A depends on B
      if (a.path && b.path && a.path !== b.path) {
        const aPath = a.path.replace(/\/+$/, "");
        const bPath = b.path.replace(/\/+$/, "");
        if (bPath.startsWith(aPath + "/")) {
          edges.push({ from: a.title, to: b.title, reason: "path containment" });
          continue; // don't double-count
        }
      }

      // 2. goal reference: task goal for A mentions B's title
      if (taskGoals) {
        const goalA = taskGoals.get(a.title);
        if (goalA && mentionsTitle(goalA, b.title)) {
          edges.push({ from: a.title, to: b.title, reason: "goal reference" });
          continue;
        }
      }

      // 3. task reference: currentTask for A mentions B's title
      if (a.currentTask && mentionsTitle(a.currentTask, b.title)) {
        edges.push({ from: a.title, to: b.title, reason: "task reference" });
      }
    }
  }

  // deduplicate edges (same from→to, keep first reason)
  const seen = new Set<string>();
  const deduped: SessionDependencyEdge[] = [];
  for (const e of edges) {
    const key = `${e.from}→${e.to}`;
    if (!seen.has(key)) { seen.add(key); deduped.push(e); }
  }

  const fromSet = new Set(deduped.map((e) => e.from));
  const toSet = new Set(deduped.map((e) => e.to));
  const allTitles = new Set(titles);

  const roots = titles.filter((t) => !fromSet.has(t));
  const leaves = titles.filter((t) => !toSet.has(t));

  return { edges: deduped, roots, leaves };
}

/** Check if text mentions a session title (case-insensitive, word boundary). */
function mentionsTitle(text: string, title: string): boolean {
  if (title.length < 3) return false; // skip very short titles to avoid false positives
  return text.toLowerCase().includes(title.toLowerCase());
}

/**
 * Format the dependency graph for TUI display.
 */
export function formatDependencyGraph(graph: SessionDependencyGraph): string[] {
  if (graph.edges.length === 0) return ["(no dependencies detected between sessions)"];
  const lines: string[] = [];
  lines.push(`session dependencies: ${graph.edges.length} edge${graph.edges.length !== 1 ? "s" : ""}`);
  for (const e of graph.edges) {
    lines.push(`  ${BOLD}${e.from}${RESET} ${DIM}→${RESET} ${BOLD}${e.to}${RESET} ${DIM}(${e.reason})${RESET}`);
  }
  if (graph.roots.length > 0) {
    lines.push(`  ${DIM}roots (no deps):${RESET} ${graph.roots.join(", ")}`);
  }
  if (graph.leaves.length > 0) {
    lines.push(`  ${DIM}leaves (no dependents):${RESET} ${graph.leaves.join(", ")}`);
  }
  return lines;
}

// ── Cross-session message relay ─────────────────────────────────────────────

export interface RelayRule {
  id: number;         // auto-incrementing rule ID
  source: string;     // source session title (case-insensitive match)
  target: string;     // target session title
  pattern: string;    // substring to match in source output (case-insensitive)
  createdAt: number;
}

/** Global counter for relay rule IDs. */
let nextRelayId = 1;

/** Reset the relay ID counter (for testing). */
export function resetRelayIdCounter(): void { nextRelayId = 1; }

/**
 * Create a new relay rule.
 */
export function createRelayRule(source: string, target: string, pattern: string): RelayRule {
  return {
    id: nextRelayId++,
    source: source.trim(),
    target: target.trim(),
    pattern: pattern.trim(),
    createdAt: Date.now(),
  };
}

/**
 * Check if a line of output from a source session matches any relay rules.
 * Returns the matching rules (there may be multiple for the same source).
 */
export function matchRelayRules(
  sourceTitle: string,
  line: string,
  rules: readonly RelayRule[],
): RelayRule[] {
  const srcLower = sourceTitle.toLowerCase();
  const lineLower = line.toLowerCase();
  return rules.filter((r) =>
    r.source.toLowerCase() === srcLower && lineLower.includes(r.pattern.toLowerCase()),
  );
}

/**
 * Format relay rules for display.
 */
export function formatRelayRules(rules: readonly RelayRule[]): string[] {
  if (rules.length === 0) return ["(no relay rules configured)"];
  const lines: string[] = [];
  lines.push(`relay rules: ${rules.length}`);
  for (const r of rules) {
    lines.push(`  ${DIM}#${r.id}${RESET} ${BOLD}${r.source}${RESET} ${DIM}→${RESET} ${BOLD}${r.target}${RESET} ${DIM}when output contains "${r.pattern}"${RESET}`);
  }
  return lines;
}

// ── Automatic session restart on OOM ────────────────────────────────────────

/** Cooldown between OOM restart attempts for the same session (5 minutes). */
export const OOM_RESTART_COOLDOWN_MS = 5 * 60_000;

/** Max OOM restarts per session before giving up (avoid restart loops). */
export const OOM_MAX_RESTARTS = 3;

/**
 * Detect out-of-memory or heap exhaustion patterns in pane output lines.
 * Returns the first matching line, or null if no OOM detected.
 */
export function detectOOM(lines: readonly string[]): string | null {
  for (const raw of lines) {
    const line = raw.replace(/\x1b\[[0-9;]*[mABCDHJKST]/g, "").toLowerCase();
    if (
      line.includes("javascript heap out of memory") ||
      line.includes("fatal error: reached heap limit") ||
      line.includes("allocation failed - javascript heap") ||
      line.includes("fatal process oom") ||
      line.includes("out of memory") && line.includes("kill") ||
      line.includes("enomem") ||
      line.includes("cannot allocate memory") ||
      line.includes("heap limit allocation failed")
    ) {
      return raw;
    }
  }
  return null;
}

/**
 * Check whether an OOM restart should be attempted for a session.
 */
export function shouldRestartOnOOM(
  lastRestartAt: number | undefined,
  restartCount: number,
  now: number,
  cooldownMs: number = OOM_RESTART_COOLDOWN_MS,
  maxRestarts: number = OOM_MAX_RESTARTS,
): boolean {
  if (restartCount >= maxRestarts) return false;
  if (lastRestartAt !== undefined && now - lastRestartAt < cooldownMs) return false;
  return true;
}

/**
 * Format an OOM alert for the activity log.
 */
export function formatOOMAlert(title: string, matchedLine: string, restarting: boolean): string {
  const action = restarting ? "restarting session" : "max restarts reached, not restarting";
  const snippet = matchedLine.replace(/\x1b\[[0-9;]*[mABCDHJKST]/g, "").trim().slice(0, 80);
  return `${title}: OOM detected — "${snippet}" — ${action}`;
}

// ── Session output search index ─────────────────────────────────────────────

export interface SearchResult {
  sessionTitle: string;
  sessionId: string;
  score: number;         // higher = more relevant
  matchCount: number;    // total keyword hits in this session
  snippets: string[];    // up to 3 matching lines with context
}

/** Max snippets per session in search results. */
export const SEARCH_MAX_SNIPPETS = 3;

/**
 * Search across all session outputs for a query string.
 * Supports multi-word queries (all terms must appear, scored by frequency).
 * Returns results ranked by match score (descending).
 */
export function searchSessionOutputs(
  outputs: ReadonlyMap<string, string[]>,
  sessionMeta: ReadonlyMap<string, { id: string }>,
  query: string,
): SearchResult[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];

  const results: SearchResult[] = [];

  for (const [title, lines] of outputs) {
    const meta = sessionMeta.get(title);
    if (!meta) continue;

    let matchCount = 0;
    const matchingLines: { lineNum: number; line: string; hits: number }[] = [];

    for (let i = 0; i < lines.length; i++) {
      const lower = lines[i].replace(/\x1b\[[0-9;]*[mABCDHJKST]/g, "").toLowerCase();
      let lineHits = 0;
      for (const term of terms) {
        // count occurrences of this term in the line
        let idx = 0;
        while ((idx = lower.indexOf(term, idx)) !== -1) {
          lineHits++;
          idx += term.length;
        }
      }
      if (lineHits > 0) {
        matchCount += lineHits;
        matchingLines.push({ lineNum: i + 1, line: lines[i], hits: lineHits });
      }
    }

    if (matchCount === 0) continue;

    // check that all terms appear at least once across all matching lines
    const allText = matchingLines.map((m) => m.line.replace(/\x1b\[[0-9;]*[mABCDHJKST]/g, "").toLowerCase()).join(" ");
    const allTermsPresent = terms.every((t) => allText.includes(t));
    if (!allTermsPresent) continue;

    // score: match count * inverse doc length (shorter docs with more hits rank higher)
    const docLen = Math.max(1, lines.length);
    const score = Math.round((matchCount / Math.sqrt(docLen)) * 1000);

    // top snippets by hit count
    const sorted = matchingLines.sort((a, b) => b.hits - a.hits).slice(0, SEARCH_MAX_SNIPPETS);
    const snippets = sorted.map((m) => {
      const clean = m.line.replace(/\x1b\[[0-9;]*[mABCDHJKST]/g, "").trim().slice(0, 120);
      return `L${m.lineNum}: ${clean}`;
    });

    results.push({ sessionTitle: title, sessionId: meta.id, score, matchCount, snippets });
  }

  return results.sort((a, b) => b.score - a.score);
}

/**
 * Format search results for TUI display.
 */
export function formatSearchResults(results: readonly SearchResult[], query: string): string[] {
  if (results.length === 0) return [`no results for "${query}"`];
  const total = results.reduce((sum, r) => sum + r.matchCount, 0);
  const lines: string[] = [];
  lines.push(`search "${query}": ${total} hits across ${results.length} session${results.length !== 1 ? "s" : ""}`);
  for (const r of results) {
    lines.push(`  ${BOLD}${r.sessionTitle}${RESET} ${DIM}(${r.matchCount} hits, score ${r.score})${RESET}`);
    for (const s of r.snippets) {
      lines.push(`    ${DIM}${s}${RESET}`);
    }
  }
  return lines;
}

// ── Configurable action throttle per session ────────────────────────────────

/** Default global action cooldown (ms). */
export const DEFAULT_ACTION_COOLDOWN_MS = 30_000;

/**
 * Get the effective throttle (cooldown) for a session.
 * Per-session override takes priority, then falls back to the global value.
 */
export function getEffectiveThrottle(
  sessionId: string,
  perSessionMap: ReadonlyMap<string, number>,
  globalMs: number = DEFAULT_ACTION_COOLDOWN_MS,
): number {
  const override = perSessionMap.get(sessionId);
  return override !== undefined ? override : globalMs;
}

/**
 * Format the current throttle configuration for display.
 */
export function formatThrottleConfig(
  perSessionMap: ReadonlyMap<string, number>,
  globalMs: number,
  sessionTitles?: ReadonlyMap<string, string>, // id → title for display
): string[] {
  const lines: string[] = [];
  lines.push(`action throttle: global ${(globalMs / 1000).toFixed(0)}s`);
  if (perSessionMap.size === 0) {
    lines.push(`  (no per-session overrides)`);
  } else {
    for (const [id, ms] of perSessionMap) {
      const title = sessionTitles?.get(id) ?? id;
      lines.push(`  ${BOLD}${title}${RESET} ${DIM}→ ${(ms / 1000).toFixed(1)}s${RESET}`);
    }
  }
  return lines;
}

// ── Session output diffing ──────────────────────────────────────────────────

export type DiffLineType = "same" | "added" | "removed";

export interface DiffLine {
  type: DiffLineType;
  text: string;
}

/**
 * Compute a line-level diff between two string arrays (old vs new).
 * Uses a simple O(n*m) LCS approach — fine for typical pane outputs (<500 lines).
 * Returns an array of DiffLine entries.
 */
export function diffSessionOutput(
  oldLines: readonly string[],
  newLines: readonly string[],
): DiffLine[] {
  const n = oldLines.length;
  const m = newLines.length;

  // LCS table
  const dp: number[][] = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      dp[i][j] = oldLines[i - 1] === newLines[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  // backtrack to build diff
  const result: DiffLine[] = [];
  let i = n, j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      result.push({ type: "same", text: oldLines[i - 1] });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.push({ type: "added", text: newLines[j - 1] });
      j--;
    } else {
      result.push({ type: "removed", text: oldLines[i - 1] });
      i--;
    }
  }

  return result.reverse();
}

/**
 * Summarize a diff: count of added, removed, unchanged lines.
 */
export function summarizeDiff(diff: readonly DiffLine[]): { added: number; removed: number; same: number } {
  let added = 0, removed = 0, same = 0;
  for (const d of diff) {
    if (d.type === "added") added++;
    else if (d.type === "removed") removed++;
    else same++;
  }
  return { added, removed, same };
}

/**
 * Format a session output diff for TUI display.
 * Shows only changed lines (added/removed) with a few context lines around them.
 */
export function formatSessionDiff(
  title: string,
  diff: readonly DiffLine[],
  contextLines: number = 2,
): string[] {
  const { added, removed, same } = summarizeDiff(diff);
  if (added === 0 && removed === 0) return [`${title}: no changes since snapshot`];

  const lines: string[] = [];
  lines.push(`${title}: ${LIME}+${added}${RESET} ${ROSE}-${removed}${RESET} ${DIM}(${same} unchanged)${RESET}`);

  // find which lines to show (changed + context)
  const showLine = new Array(diff.length).fill(false);
  for (let i = 0; i < diff.length; i++) {
    if (diff[i].type !== "same") {
      for (let c = Math.max(0, i - contextLines); c <= Math.min(diff.length - 1, i + contextLines); c++) {
        showLine[c] = true;
      }
    }
  }

  let lastShown = -1;
  for (let i = 0; i < diff.length; i++) {
    if (!showLine[i]) continue;
    if (lastShown >= 0 && i - lastShown > 1) {
      lines.push(`${DIM}  ...${RESET}`);
    }
    const d = diff[i];
    const prefix = d.type === "added" ? `${LIME}+ ` : d.type === "removed" ? `${ROSE}- ` : `${DIM}  `;
    const text = d.text.replace(/\x1b\[[0-9;]*[mABCDHJKST]/g, "").slice(0, 120);
    lines.push(`${prefix}${text}${RESET}`);
    lastShown = i;
  }

  return lines;
}

// ── Exported pure helpers (for testing) ─────────────────────────────────────

export { formatActivity, formatSessionCard, truncateAnsi, truncatePlain, padBoxLine, padBoxLineHover, padToWidth, stripAnsiForLen, phaseDisplay, computeScrollSlice, formatScrollIndicator, formatDrilldownScrollIndicator, formatPrompt, formatDrilldownHeader, matchesSearch, formatSearchIndicator, computeSparkline, formatSparkline, sortSessions, nextSortMode, SORT_MODES, formatCompactRows, computeCompactRowCount, COMPACT_NAME_LEN, PIN_ICON, MUTE_ICON, NOTE_ICON };
