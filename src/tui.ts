// tui.ts — in-place terminal UI for aoaoe daemon
// replaces scrolling log output with an OpenCode-style repaintable view.
// layout: header (1 line) + sessions panel + separator + scroll region (activity) + input line
//
// uses ANSI scroll regions so activity log scrolls naturally while header/sessions
// and input line stay fixed. no external deps — raw escape codes only.
import type { DaemonSessionState, DaemonPhase, TaskState } from "./types.js";

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

// colors
const BOLD = `${CSI}1m`;
const DIM = `${CSI}2m`;
const RESET = `${CSI}0m`;
const GREEN = `${CSI}32m`;
const YELLOW = `${CSI}33m`;
const RED = `${CSI}31m`;
const CYAN = `${CSI}36m`;
const WHITE = `${CSI}37m`;
const BG_DARK = `${CSI}48;5;236m`; // dark gray background for header

// status icons
const STATUS_ICONS: Record<string, string> = {
  working: `${GREEN}~${RESET}`,
  idle: `${DIM}.${RESET}`,
  waiting: `${YELLOW}~${RESET}`,
  done: `${GREEN}+${RESET}`,
  error: `${RED}!${RESET}`,
  stopped: `${DIM}x${RESET}`,
};

// ── Activity log entry ──────────────────────────────────────────────────────

export interface ActivityEntry {
  time: string;   // "HH:MM:SS"
  tag: string;    // "observation", "reasoner", "+ action", "! action", "you", "system", "status"
  text: string;   // the message
}

// ── TUI class ───────────────────────────────────────────────────────────────

export class TUI {
  private active = false;
  private countdownTimer: ReturnType<typeof setInterval> | null = null;
  private cols = 80;
  private rows = 24;
  private headerHeight = 1;      // top bar
  private sessionRows = 0;       // dynamic based on session count
  private separatorRow = 0;      // line between sessions and activity
  private scrollTop = 0;         // first row of scroll region
  private scrollBottom = 0;      // last row of scroll region
  private inputRow = 0;          // bottom input line
  private activityBuffer: ActivityEntry[] = []; // ring buffer for activity log
  private maxActivity = 500;     // max entries to keep

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
    // repaint header every second so countdown timer ticks down
    this.countdownTimer = setInterval(() => {
      if (this.active && this.phase === "sleeping" && this.nextTickAt > 0) {
        this.paintHeader();
      }
    }, 1000);
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
  }

  // ── Layout computation ──────────────────────────────────────────────────

  private updateDimensions(): void {
    this.cols = process.stderr.columns || 80;
    this.rows = process.stderr.rows || 24;
  }

  private computeLayout(sessionCount: number): void {
    this.updateDimensions();
    // header: 1 row
    // sessions: 1 header + N sessions + 1 blank = N+2 rows (min 2 if no sessions)
    this.sessionRows = Math.max(sessionCount, 0) + 2;
    this.separatorRow = this.headerHeight + this.sessionRows + 1;
    // input line is the last row
    this.inputRow = this.rows;
    // scroll region: from separator+1 to rows-1 (leave room for input)
    this.scrollTop = this.separatorRow + 1;
    this.scrollBottom = this.rows - 1;

    if (this.active) {
      // set scroll region so activity log scrolls within bounds
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
    const phaseText = this.paused
      ? `${YELLOW}PAUSED${RESET}`
      : this.phase === "reasoning"
      ? `${CYAN}reasoning...${RESET}`
      : this.phase === "executing"
      ? `${YELLOW}executing...${RESET}`
      : this.phase === "polling"
      ? `${GREEN}polling${RESET}`
      : `${DIM}sleeping${RESET}`;

    const sessCount = `${this.sessions.length} session${this.sessions.length !== 1 ? "s" : ""}`;
    const activeCount = this.sessions.filter((s) => s.userActive).length;
    const activeTag = activeCount > 0 ? `  ${DIM}|${RESET}  ${YELLOW}${activeCount} user active${RESET}` : "";

    // countdown to next tick (only in sleeping phase)
    let countdownTag = "";
    if (this.phase === "sleeping" && this.nextTickAt > 0) {
      const remaining = Math.max(0, Math.ceil((this.nextTickAt - Date.now()) / 1000));
      countdownTag = `  ${DIM}|${RESET}  ${DIM}next: ${remaining}s${RESET}`;
    }

    // reasoner name
    const reasonerTag = this.reasonerName ? `  ${DIM}|${RESET}  ${DIM}${this.reasonerName}${RESET}` : "";

    const line = ` ${BOLD}aoaoe${RESET} ${DIM}${this.version}${RESET}  ${DIM}|${RESET}  poll #${this.pollCount}  ${DIM}|${RESET}  ${sessCount}  ${DIM}|${RESET}  ${phaseText}${activeTag}${countdownTag}${reasonerTag}`;
    process.stderr.write(
      SAVE_CURSOR +
      moveTo(1, 1) + CLEAR_LINE + BG_DARK + WHITE + truncateAnsi(line, this.cols) + RESET +
      RESTORE_CURSOR
    );
  }

  private paintSessions(): void {
    const startRow = this.headerHeight + 1;
    // session header
    const hdr = `  ${DIM}${"st".padEnd(4)} ${"tool".padEnd(11)} ${"title".padEnd(22)} ${"id".padEnd(10)} task${RESET}`;
    process.stderr.write(SAVE_CURSOR + moveTo(startRow, 1) + CLEAR_LINE + hdr);

    for (let i = 0; i < this.sessions.length; i++) {
      const s = this.sessions[i];
      const icon = STATUS_ICONS[s.status] ?? `${YELLOW}?${RESET}`;
      const userFlag = s.userActive ? `${YELLOW}*${RESET}` : " ";
      const tool = s.tool.length > 10 ? s.tool.slice(0, 10) : s.tool.padEnd(11);
      const title = s.title.length > 20 ? s.title.slice(0, 20) + ".." : s.title.padEnd(22);
      const id = (s.id || "").slice(0, 8).padEnd(10);
      const task = s.currentTask ? truncatePlain(s.currentTask, 30) : `${DIM}-${RESET}`;
      const line = `  ${icon}${userFlag} ${tool} ${title} ${id} ${task}`;
      process.stderr.write(moveTo(startRow + 1 + i, 1) + CLEAR_LINE + line);
    }

    // clear any leftover rows if session count decreased
    const totalSessionLines = this.sessions.length + 1; // +1 for header
    for (let r = startRow + totalSessionLines; r < this.separatorRow; r++) {
      process.stderr.write(moveTo(r, 1) + CLEAR_LINE);
    }

    process.stderr.write(RESTORE_CURSOR);
  }

  private paintSeparator(): void {
    const hints = " ESC ESC: interrupt  /help  /task  /pause ";
    const prefix = "── activity ";
    const totalDecor = prefix.length + hints.length + 2; // 2 for surrounding ──
    const fill = Math.max(0, this.cols - totalDecor);
    const line = `${DIM}${prefix}${"─".repeat(Math.floor(fill / 2))}${hints}${"─".repeat(Math.ceil(fill / 2))}${RESET}`;
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
    // repaint visible portion of activity buffer
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
    process.stderr.write(
      SAVE_CURSOR +
      moveTo(this.inputRow, 1) + CLEAR_LINE +
      `${GREEN}>${RESET} ` +
      RESTORE_CURSOR
    );
  }
}

// ── Formatting helpers ──────────────────────────────────────────────────────

// colorize an activity entry based on its tag
function formatActivity(entry: ActivityEntry, maxCols: number): string {
  const { time, tag, text } = entry;
  let color = DIM;
  let prefix = tag;

  switch (tag) {
    case "observation": color = DIM; prefix = "obs"; break;
    case "reasoner": color = CYAN; break;
    case "+ action": case "action": color = YELLOW; prefix = "+ action"; break;
    case "! action": case "error": color = RED; prefix = "! action"; break;
    case "you": color = GREEN; break;
    case "system": color = DIM; break;
    case "status": color = DIM; break;
    default: color = DIM; break;
  }

  const formatted = `  ${DIM}${time}${RESET} ${color}[${prefix}]${RESET} ${text}`;
  return truncateAnsi(formatted, maxCols);
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

// ── Exported pure helpers (for testing) ─────────────────────────────────────

export { formatActivity, truncateAnsi, truncatePlain };
