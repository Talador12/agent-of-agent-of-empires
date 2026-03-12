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
  BG_DARK,
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

// cursor movement
const moveTo = (row: number, col: number) => `${CSI}${row};${col}H`;
const setScrollRegion = (top: number, bottom: number) => `${CSI}${top};${bottom}r`;
const resetScrollRegion = () => `${CSI}r`;

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

    // enter alternate screen, hide cursor, clear
    process.stderr.write(ALT_SCREEN_ON + CURSOR_HIDE + CLEAR_SCREEN);

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
    // restore normal screen, show cursor, reset scroll region
    process.stderr.write(resetScrollRegion() + CURSOR_SHOW + ALT_SCREEN_OFF);
  }

  isActive(): boolean {
    return this.active;
  }

  // ── State updates ───────────────────────────────────────────────────────

  updateState(opts: {
    phase?: DaemonPhase;
    pollCount?: number;
    sessions?: DaemonSessionState[];
    paused?: boolean;
    reasonerName?: string;
    nextTickAt?: number;
  }): void {
    if (opts.phase !== undefined) this.phase = opts.phase;
    if (opts.pollCount !== undefined) this.pollCount = opts.pollCount;
    if (opts.paused !== undefined) this.paused = opts.paused;
    if (opts.reasonerName !== undefined) this.reasonerName = opts.reasonerName;
    if (opts.nextTickAt !== undefined) this.nextTickAt = opts.nextTickAt;
    if (opts.sessions !== undefined) {
      const sessionCountChanged = opts.sessions.length !== this.sessions.length;
      this.sessions = opts.sessions;
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
    if (this.activityBuffer.length > this.maxActivity) {
      this.activityBuffer = this.activityBuffer.slice(-this.maxActivity);
    }
    if (this.active) this.writeActivityLine(entry);
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

  // ── Layout computation ──────────────────────────────────────────────────

  private updateDimensions(): void {
    this.cols = process.stderr.columns || 80;
    this.rows = process.stderr.rows || 24;
  }

  private computeLayout(sessionCount: number): void {
    this.updateDimensions();
    // header: 1 row
    // sessions: top border (1) + N session rows + bottom border (1) = N+2
    // if no sessions, just show an empty box (2 rows: top + bottom borders)
    const sessBodyRows = Math.max(sessionCount, 1); // at least 1 row for "no agents"
    this.sessionRows = sessBodyRows + 2; // + top/bottom borders
    this.separatorRow = this.headerHeight + this.sessionRows + 1;
    // input line is the last row
    this.inputRow = this.rows;
    // scroll region: from separator+1 to rows-1 (leave room for input)
    this.scrollTop = this.separatorRow + 1;
    this.scrollBottom = this.rows - 1;

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
    this.paintSessions();
    this.paintSeparator();
    this.repaintActivityRegion();
    this.paintInputLine();
  }

  private paintHeader(): void {
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

    const line = ` ${INDIGO}${BOLD}aoaoe${RESET} ${SLATE}${this.version}${RESET}  ${SLATE}│${RESET}  #${this.pollCount}  ${SLATE}│${RESET}  ${sessCount}  ${SLATE}│${RESET}  ${phaseText}${activeTag}${countdownTag}${reasonerTag}`;
    process.stderr.write(
      SAVE_CURSOR +
      moveTo(1, 1) + CLEAR_LINE + BG_DARK + WHITE + truncateAnsi(line, this.cols) + padToWidth(line, this.cols) + RESET +
      RESTORE_CURSOR
    );
  }

  private paintSessions(): void {
    const startRow = this.headerHeight + 1;
    const innerWidth = this.cols - 2; // inside the box borders

    // top border with label
    const label = " agents ";
    const borderAfterLabel = Math.max(0, innerWidth - label.length);
    const topBorder = `${SLATE}${BOX.rtl}${BOX.h}${RESET}${SLATE}${label}${RESET}${SLATE}${BOX.h.repeat(borderAfterLabel)}${BOX.rtr}${RESET}`;
    process.stderr.write(SAVE_CURSOR + moveTo(startRow, 1) + CLEAR_LINE + truncateAnsi(topBorder, this.cols));

    if (this.sessions.length === 0) {
      // empty state
      const empty = `${SLATE}${BOX.v}${RESET}  ${DIM}no agents connected${RESET}`;
      const padded = padBoxLine(empty, this.cols);
      process.stderr.write(moveTo(startRow + 1, 1) + CLEAR_LINE + padded);
    } else {
      for (let i = 0; i < this.sessions.length; i++) {
        const s = this.sessions[i];
        const line = `${SLATE}${BOX.v}${RESET} ${formatSessionCard(s, innerWidth - 1)}`;
        const padded = padBoxLine(line, this.cols);
        process.stderr.write(moveTo(startRow + 1 + i, 1) + CLEAR_LINE + padded);
      }
    }

    // bottom border
    const bodyRows = Math.max(this.sessions.length, 1);
    const bottomRow = startRow + 1 + bodyRows;
    const bottomBorder = `${SLATE}${BOX.rbl}${BOX.h.repeat(Math.max(0, this.cols - 2))}${BOX.rbr}${RESET}`;
    process.stderr.write(moveTo(bottomRow, 1) + CLEAR_LINE + truncateAnsi(bottomBorder, this.cols));

    // clear any leftover rows below the box
    for (let r = bottomRow + 1; r < this.separatorRow; r++) {
      process.stderr.write(moveTo(r, 1) + CLEAR_LINE);
    }

    process.stderr.write(RESTORE_CURSOR);
  }

  private paintSeparator(): void {
    const hints = " esc esc: interrupt  /help  /explain  /pause ";
    const prefix = `${BOX.h}${BOX.h} activity `;
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
    const entries = this.activityBuffer.slice(-visibleLines);
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

  private paintInputLine(): void {
    // phase-aware prompt styling
    const prompt = this.paused
      ? `${AMBER}${BOLD}paused >${RESET} `
      : this.phase === "reasoning"
      ? `${SKY}thinking >${RESET} `
      : `${LIME}>${RESET} `;
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

// ── Exported pure helpers (for testing) ─────────────────────────────────────

export { formatActivity, formatSessionCard, truncateAnsi, truncatePlain, padBoxLine, padToWidth, stripAnsiForLen, phaseDisplay };
