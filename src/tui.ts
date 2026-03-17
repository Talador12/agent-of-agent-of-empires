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

// ── Compact mode ────────────────────────────────────────────────────────────

/** Max name length in compact token. */
const COMPACT_NAME_LEN = 10;

/** Pin indicator for pinned sessions. */
const PIN_ICON = "▲";

/**
 * Format sessions as inline compact tokens, wrapped to fit maxWidth.
 * Each token: "{idx}{pin?}{dot}{name}" — e.g. "1▲●Alpha" for pinned, "2●Bravo" for unpinned.
 * Returns array of formatted row strings (one per display row).
 */
function formatCompactRows(sessions: DaemonSessionState[], maxWidth: number, pinnedIds?: Set<string>): string[] {
  if (sessions.length === 0) return [`${DIM}no agents connected${RESET}`];

  const tokens: string[] = [];
  const widths: number[] = [];

  for (let i = 0; i < sessions.length; i++) {
    const s = sessions[i];
    const idx = String(i + 1);
    const dot = STATUS_DOT[s.status] ?? `${AMBER}${DOT.filled}${RESET}`;
    const pinned = pinnedIds?.has(s.id) ?? false;
    const pin = pinned ? `${AMBER}${PIN_ICON}${RESET}` : "";
    const name = truncatePlain(s.title, COMPACT_NAME_LEN);
    tokens.push(`${SLATE}${idx}${RESET}${pin}${dot}${BOLD}${name}${RESET}`);
    widths.push(idx.length + (pinned ? 1 : 0) + 1 + name.length);
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
}

// ── TUI class ───────────────────────────────────────────────────────────────

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
  private hoverSessionIdx: number | null = null; // 1-indexed session under mouse cursor (null = none)
  private activityTimestamps: number[] = []; // epoch ms of each log() call for sparkline
  private sortMode: SortMode = "default";
  private lastChangeAt = new Map<string, number>();       // session ID → epoch ms of last activity change
  private prevLastActivity = new Map<string, string>();   // session ID → previous lastActivity string
  private compactMode = false;
  private pinnedIds = new Set<string>(); // pinned session IDs (always sort to top)
  private bellEnabled = false;
  private lastBellAt = 0;

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

  /** Return the current number of sessions (for mouse hit testing) */
  getSessionCount(): number {
    return this.sessions.length;
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
      this.computeLayout(this.sessions.length);
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

  /** Check if a session ID is pinned. */
  isPinned(id: string): boolean {
    return this.pinnedIds.has(id);
  }

  /** Return count of pinned sessions. */
  getPinnedCount(): number {
    return this.pinnedIds.size;
  }

  /** Enable or disable terminal bell notifications. */
  setBell(enabled: boolean): void {
    this.bellEnabled = enabled;
  }

  /** Return whether terminal bell is enabled. */
  isBellEnabled(): boolean {
    return this.bellEnabled;
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
      // track activity changes for sort-by-activity
      const now = Date.now();
      for (const s of opts.sessions) {
        const prev = this.prevLastActivity.get(s.id);
        if (s.lastActivity !== undefined && s.lastActivity !== prev) {
          this.lastChangeAt.set(s.id, now);
        }
        if (s.lastActivity !== undefined) this.prevLastActivity.set(s.id, s.lastActivity);
      }
      const sorted = sortSessions(opts.sessions, this.sortMode, this.lastChangeAt, this.pinnedIds);
      const sessionCountChanged = sorted.length !== this.sessions.length;
      this.sessions = sorted;
      if (sessionCountChanged) {
        this.computeLayout(this.sessions.length);
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
  log(tag: string, text: string): void {
    const now = new Date();
    const time = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;
    const entry: ActivityEntry = { time, tag, text };
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
    if (this.active) {
      if (this.searchPattern) {
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

  // ── Scroll navigation ────────────────────────────────────────────────────

  scrollUp(lines?: number): void {
    if (!this.active) return;
    const visibleLines = this.scrollBottom - this.scrollTop + 1;
    const n = lines ?? Math.max(1, Math.floor(visibleLines / 2));
    const entryCount = this.searchPattern
      ? this.activityBuffer.filter((e) => matchesSearch(e, this.searchPattern!)).length
      : this.activityBuffer.length;
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
    const entryCount = this.searchPattern
      ? this.activityBuffer.filter((e) => matchesSearch(e, this.searchPattern!)).length
      : this.activityBuffer.length;
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
      this.computeLayout(this.sessions.length);
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
      this.computeLayout(this.sessions.length);
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
      const sessBodyRows = this.compactMode
        ? computeCompactRowCount(this.sessions, this.cols - 2)
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
    this.computeLayout(this.sessions.length);
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
      const sessCount = `${this.sessions.length} agent${this.sessions.length !== 1 ? "s" : ""}`;
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

      line = ` ${INDIGO}${BOLD}aoaoe${RESET} ${SLATE}${this.version}${RESET}  ${SLATE}│${RESET}  #${this.pollCount}  ${SLATE}│${RESET}  ${sessCount}  ${SLATE}│${RESET}  ${phaseText}${activeTag}${countdownTag}${reasonerTag}`;
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

    // top border with label (includes compact/sort mode tags)
    const sortTag = this.sortMode !== "default" ? this.sortMode : "";
    const compactTag = this.compactMode ? "compact" : "";
    const tags = [compactTag, sortTag].filter(Boolean).join(", ");
    const label = tags ? ` agents (${tags}) ` : " agents ";
    const borderAfterLabel = Math.max(0, innerWidth - label.length);
    const topBorder = `${SLATE}${BOX.rtl}${BOX.h}${RESET}${SLATE}${label}${RESET}${SLATE}${BOX.h.repeat(borderAfterLabel)}${BOX.rtr}${RESET}`;
    process.stderr.write(SAVE_CURSOR + moveTo(startRow, 1) + CLEAR_LINE + truncateAnsi(topBorder, this.cols));

    if (this.sessions.length === 0) {
      // empty state
      const empty = `${SLATE}${BOX.v}${RESET}  ${DIM}no agents connected${RESET}`;
      const padded = padBoxLine(empty, this.cols);
      process.stderr.write(moveTo(startRow + 1, 1) + CLEAR_LINE + padded);
    } else if (this.compactMode) {
      // compact: inline tokens, multiple per row (with pin indicators)
      const compactRows = formatCompactRows(this.sessions, innerWidth - 1, this.pinnedIds);
      for (let r = 0; r < compactRows.length; r++) {
        const line = `${SLATE}${BOX.v}${RESET} ${compactRows[r]}`;
        const padded = padBoxLine(line, this.cols);
        process.stderr.write(moveTo(startRow + 1 + r, 1) + CLEAR_LINE + padded);
      }
    } else {
      for (let i = 0; i < this.sessions.length; i++) {
        const s = this.sessions[i];
        const isHovered = this.hoverSessionIdx === i + 1; // 1-indexed
        const bg = isHovered ? BG_HOVER : "";
        const pinned = this.pinnedIds.has(s.id);
        const pin = pinned ? `${AMBER}${PIN_ICON}${RESET} ` : "";
        const cardWidth = pinned ? innerWidth - 3 : innerWidth - 1; // pin takes 2 extra chars
        const line = `${bg}${SLATE}${BOX.v}${RESET}${bg} ${pin}${formatSessionCard(s, cardWidth)}`;
        const padded = padBoxLineHover(line, this.cols, isHovered);
        process.stderr.write(moveTo(startRow + 1 + i, 1) + CLEAR_LINE + padded);
      }
    }

    // bottom border
    const bodyRows = this.compactMode
      ? computeCompactRowCount(this.sessions, innerWidth)
      : Math.max(this.sessions.length, 1);
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
    if (i < 0 || i >= this.sessions.length) return;
    const startRow = this.headerHeight + 1;
    const innerWidth = this.cols - 2;
    const s = this.sessions[i];
    const isHovered = this.hoverSessionIdx === idx;
    const bg = isHovered ? BG_HOVER : "";
    const pinned = this.pinnedIds.has(s.id);
    const pin = pinned ? `${AMBER}${PIN_ICON}${RESET} ` : "";
    const cardWidth = pinned ? innerWidth - 3 : innerWidth - 1;
    const line = `${bg}${SLATE}${BOX.v}${RESET}${bg} ${pin}${formatSessionCard(s, cardWidth)}`;
    const padded = padBoxLineHover(line, this.cols, isHovered);
    process.stderr.write(SAVE_CURSOR + moveTo(startRow + 1 + i, 1) + CLEAR_LINE + padded + RESTORE_CURSOR);
  }

  private paintSeparator(): void {
    const prefix = `${BOX.h}${BOX.h} activity `;
    let hints: string;
    if (this.searchPattern) {
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
    // when search is active, filter entries first, then paginate
    const source = this.searchPattern
      ? this.activityBuffer.filter((e) => matchesSearch(e, this.searchPattern!))
      : this.activityBuffer;
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
    const prefix = `${BOX.h}${BOX.h} ${title} `;
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
function formatSessionCard(s: DaemonSessionState, maxWidth: number): string {
  const dot = STATUS_DOT[s.status] ?? `${AMBER}${DOT.filled}${RESET}`;
  const name = `${BOLD}${s.title}${RESET}`;
  const toolBadge = `${SLATE}${s.tool}${RESET}`;

  // status description
  let desc: string;
  if (s.userActive) {
    desc = `${AMBER}you're active${RESET}`;
  } else if (s.status === "working" || s.status === "running") {
    desc = s.currentTask
      ? truncatePlain(s.currentTask, Math.max(20, maxWidth - s.title.length - s.tool.length - 16))
      : `${LIME}working${RESET}`;
  } else if (s.status === "idle" || s.status === "stopped") {
    desc = `${SLATE}idle${RESET}`;
  } else if (s.status === "error") {
    desc = `${ROSE}error${RESET}`;
  } else if (s.status === "done") {
    desc = `${GREEN}done${RESET}`;
  } else if (s.status === "waiting") {
    desc = `${AMBER}waiting${RESET}`;
  } else {
    desc = `${SLATE}${s.status}${RESET}`;
  }

  return truncateAnsi(`${dot} ${name} ${toolBadge} ${SLATE}${BOX.h}${RESET} ${desc}`, maxWidth);
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

export { formatActivity, formatSessionCard, truncateAnsi, truncatePlain, padBoxLine, padBoxLineHover, padToWidth, stripAnsiForLen, phaseDisplay, computeScrollSlice, formatScrollIndicator, formatDrilldownScrollIndicator, formatPrompt, formatDrilldownHeader, matchesSearch, formatSearchIndicator, computeSparkline, formatSparkline, sortSessions, nextSortMode, SORT_MODES, formatCompactRows, computeCompactRowCount, COMPACT_NAME_LEN, PIN_ICON };
