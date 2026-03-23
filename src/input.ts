// interactive stdin input -- lets the user send messages to the reasoner
// and run built-in slash commands while the daemon is running.
// in v0.32.0+ the daemon runs interactively in the same terminal (no separate attach).
import { createInterface, emitKeypressEvents, type Interface } from "node:readline";
import { requestInterrupt } from "./daemon-state.js";

import { GREEN, DIM, YELLOW, RED, BOLD, RESET } from "./colors.js";
import { resolveAlias, validateAliasName, MAX_ALIASES } from "./tui.js";

// ESC-ESC interrupt detection
const ESC_DOUBLE_TAP_MS = 500;

export type ScrollDirection = "up" | "down" | "top" | "bottom";

export const INSIST_PREFIX = "__INSIST__";

export type ViewHandler = (target: string | null) => void; // null = back to overview
export type SearchHandler = (pattern: string | null) => void; // null = clear search
export type QuickSwitchHandler = (sessionNum: number) => void; // 1-indexed session number
export type SortHandler = (mode: string | null) => void; // null = cycle to next mode
export type CompactHandler = () => void; // toggle compact mode
export type PinHandler = (target: string) => void; // session index or name to pin/unpin
export type BellHandler = () => void; // toggle bell notifications
export type FocusHandler = () => void; // toggle focus mode
export type MarkHandler = () => void; // add bookmark
export type JumpHandler = (num: number) => void; // jump to bookmark N
export type MarksHandler = () => void; // list bookmarks
export type MuteHandler = (target: string) => void; // session index or name to mute/unmute
export type UnmuteAllHandler = () => void; // clear all mutes at once
export type TagFilterHandler = (tag: string | null) => void; // set or clear tag filter
export type UptimeHandler = () => void; // list all session uptimes
export type AutoPinHandler = () => void; // toggle auto-pin on error
export type NoteHandler = (target: string, text: string) => void; // session + note text (empty = clear)
export type NotesHandler = () => void;
export type ClipHandler = (count: number) => void;
export type DiffHandler = (bookmarkNum: number) => void;
export type WhoHandler = () => void;
export type AliasChangeHandler = () => void; // list all session notes
export type GoalCaptureModeHandler = () => boolean;
export type GroupHandler = (target: string, group: string) => void; // session + group tag (empty = clear)
export type GroupsHandler = () => void; // list all groups
export type GroupFilterHandler = (group: string | null) => void; // filter sessions to a group (null = clear)
export type BurnRateHandler = () => void; // show current context burn rates
export type SnapshotHandler = (format: "json" | "md") => void; // export snapshot
export type BroadcastHandler = (message: string, group: string | null) => void; // broadcast to sessions
export type WatchdogHandler = (thresholdMinutes: number | null) => void; // set watchdog (null = off)
export type TopHandler = (mode: string) => void; // show ranked session view
export type CeilingHandler = () => void; // show context ceiling for all sessions
export type RenameHandler = (target: string, name: string) => void; // rename a session display name
export type CopySessionHandler = (target: string | null) => void; // copy session pane output (null = current drilldown)
export type StatsHandler = () => void; // show per-session stats summary
export type RecallHandler = (keyword: string, maxResults: number) => void; // search history
export type PinAllErrorsHandler = () => void; // pin all sessions currently in error
export type ExportStatsHandler = () => void; // export /stats to JSON file

// ── Mouse event types ───────────────────────────────────────────────────────

export interface MouseEvent {
  button: number;  // 0=left, 1=middle, 2=right, 64=scroll-up, 65=scroll-down
  col: number;     // 1-indexed column
  row: number;     // 1-indexed row
  press: boolean;  // true=press (M suffix), false=release (m suffix)
}

export type MouseClickHandler = (row: number, col: number) => void;
export type MouseWheelHandler = (direction: "up" | "down") => void;
export type MouseMoveHandler = (row: number, col: number) => void;

// SGR extended mouse format: \x1b[<btn;col;rowM (press) or \x1b[<btn;col;rowm (release)
const SGR_MOUSE_RE = /\x1b\[<(\d+);(\d+);(\d+)([Mm])/;

/** Parse an SGR extended mouse event from raw terminal data. Returns null if not a mouse event. */
export function parseMouseEvent(data: string): MouseEvent | null {
  const m = SGR_MOUSE_RE.exec(data);
  if (!m) return null;
  return {
    button: parseInt(m[1], 10),
    col: parseInt(m[2], 10),
    row: parseInt(m[3], 10),
    press: m[4] === "M",
  };
}

export class InputReader {
  private rl: Interface | null = null;
  private queue: string[] = []; // pending user messages for the reasoner
  private paused = false;
  private lastEscTime = 0;
  private scrollHandler: ((dir: ScrollDirection) => void) | null = null;
  private queueChangeHandler: ((count: number) => void) | null = null;
  private viewHandler: ViewHandler | null = null;
  private mouseClickHandler: MouseClickHandler | null = null;
  private mouseWheelHandler: MouseWheelHandler | null = null;
  private mouseMoveHandler: MouseMoveHandler | null = null;
  private lastMoveRow = 0; // debounce: only fire move handler when row changes
  private searchHandler: SearchHandler | null = null;
  private quickSwitchHandler: QuickSwitchHandler | null = null;
  private sortHandler: SortHandler | null = null;
  private compactHandler: CompactHandler | null = null;
  private pinHandler: PinHandler | null = null;
  private bellHandler: BellHandler | null = null;
  private focusHandler: FocusHandler | null = null;
  private markHandler: MarkHandler | null = null;
  private jumpHandler: JumpHandler | null = null;
  private marksHandler: MarksHandler | null = null;
  private muteHandler: MuteHandler | null = null;
  private unmuteAllHandler: UnmuteAllHandler | null = null;
  private tagFilterHandler: TagFilterHandler | null = null;
  private uptimeHandler: UptimeHandler | null = null;
  private autoPinHandler: AutoPinHandler | null = null;
  private noteHandler: NoteHandler | null = null;
  private notesHandler: NotesHandler | null = null;
  private clipHandler: ClipHandler | null = null;
  private diffHandler: DiffHandler | null = null;
  private whoHandler: WhoHandler | null = null;
  private aliasChangeHandler: AliasChangeHandler | null = null;
  private goalCaptureModeHandler: GoalCaptureModeHandler | null = null;
  private groupHandler: GroupHandler | null = null;
  private groupsHandler: GroupsHandler | null = null;
  private groupFilterHandler: GroupFilterHandler | null = null;
  private burnRateHandler: BurnRateHandler | null = null;
  private snapshotHandler: SnapshotHandler | null = null;
  private broadcastHandler: BroadcastHandler | null = null;
  private watchdogHandler: WatchdogHandler | null = null;
  private topHandler: TopHandler | null = null;
  private ceilingHandler: CeilingHandler | null = null;
  private renameHandler: RenameHandler | null = null;
  private copySessionHandler: CopySessionHandler | null = null;
  private statsHandler: StatsHandler | null = null;
  private recallHandler: RecallHandler | null = null;
  private pinAllErrorsHandler: PinAllErrorsHandler | null = null;
  private exportStatsHandler: ExportStatsHandler | null = null;
  private aliases = new Map<string, string>(); // /shortcut → /full command
  private mouseDataListener: ((data: Buffer) => void) | null = null;

  // register a callback for scroll key events (PgUp/PgDn/Home/End)
  onScroll(handler: (dir: ScrollDirection) => void): void {
    this.scrollHandler = handler;
  }

  // register a callback for queue size changes (for TUI pending count display)
  onQueueChange(handler: (count: number) => void): void {
    this.queueChangeHandler = handler;
  }

  // register a callback for view commands (/view, /back)
  onView(handler: ViewHandler): void {
    this.viewHandler = handler;
  }

  // register a callback for mouse left-click events (row, col are 1-indexed)
  onMouseClick(handler: MouseClickHandler): void {
    this.mouseClickHandler = handler;
  }

  // register a callback for mouse wheel events (scroll up/down)
  onMouseWheel(handler: MouseWheelHandler): void {
    this.mouseWheelHandler = handler;
  }

  // register a callback for mouse move events (only fires on row change for efficiency)
  onMouseMove(handler: MouseMoveHandler): void {
    this.mouseMoveHandler = handler;
  }

  // register a callback for search commands (/search <pattern> or /search to clear)
  onSearch(handler: SearchHandler): void {
    this.searchHandler = handler;
  }

  // register a callback for quick-switch (bare digit 1-9 on empty input line)
  onQuickSwitch(handler: QuickSwitchHandler): void {
    this.quickSwitchHandler = handler;
  }

  // register a callback for sort commands (/sort <mode> or /sort to cycle)
  onSort(handler: SortHandler): void {
    this.sortHandler = handler;
  }

  // register a callback for compact mode toggle (/compact)
  onCompact(handler: CompactHandler): void {
    this.compactHandler = handler;
  }

  // register a callback for pin/unpin commands (/pin <target>)
  onPin(handler: PinHandler): void {
    this.pinHandler = handler;
  }

  // register a callback for bell toggle (/bell)
  onBell(handler: BellHandler): void {
    this.bellHandler = handler;
  }

  // register a callback for focus mode toggle (/focus)
  onFocus(handler: FocusHandler): void {
    this.focusHandler = handler;
  }

  // register a callback for adding bookmarks (/mark)
  onMark(handler: MarkHandler): void {
    this.markHandler = handler;
  }

  // register a callback for jumping to bookmarks (/jump N)
  onJump(handler: JumpHandler): void {
    this.jumpHandler = handler;
  }

  // register a callback for listing bookmarks (/marks)
  onMarks(handler: MarksHandler): void {
    this.marksHandler = handler;
  }

  // register a callback for mute/unmute commands (/mute <target>)
  onMute(handler: MuteHandler): void {
    this.muteHandler = handler;
  }

  // register a callback for unmuting all sessions (/unmute-all)
  onUnmuteAll(handler: UnmuteAllHandler): void {
    this.unmuteAllHandler = handler;
  }

  // register a callback for tag filter commands (/filter <tag>)
  onTagFilter(handler: TagFilterHandler): void {
    this.tagFilterHandler = handler;
  }

  // register a callback for uptime listing (/uptime)
  onUptime(handler: UptimeHandler): void {
    this.uptimeHandler = handler;
  }

  // register a callback for auto-pin toggle (/auto-pin)
  onAutoPin(handler: AutoPinHandler): void {
    this.autoPinHandler = handler;
  }

  // register a callback for note commands (/note <target> <text>)
  onNote(handler: NoteHandler): void {
    this.noteHandler = handler;
  }

  // register a callback for listing notes (/notes)
  onNotes(handler: NotesHandler): void {
    this.notesHandler = handler;
  }

  // register a callback for fleet status (/who)
  onWho(handler: WhoHandler): void {
    this.whoHandler = handler;
  }

  // register a callback for alias changes (to persist)
  onAliasChange(handler: AliasChangeHandler): void {
    this.aliasChangeHandler = handler;
  }

  // register a callback to decide whether plain text should update goals (task capture mode)
  onGoalCaptureMode(handler: GoalCaptureModeHandler): void {
    this.goalCaptureModeHandler = handler;
  }

  // register a callback for group assignment (/group <N|name> <tag>)
  onGroup(handler: GroupHandler): void {
    this.groupHandler = handler;
  }

  // register a callback for listing groups (/groups)
  onGroups(handler: GroupsHandler): void {
    this.groupsHandler = handler;
  }

  // register a callback for group filter (/group-filter <name> or /group-filter to clear)
  onGroupFilter(handler: GroupFilterHandler): void {
    this.groupFilterHandler = handler;
  }

  // register a callback for burn-rate reporting (/burn-rate)
  onBurnRate(handler: BurnRateHandler): void {
    this.burnRateHandler = handler;
  }

  // register a callback for snapshot export (/snapshot [md])
  onSnapshot(handler: SnapshotHandler): void {
    this.snapshotHandler = handler;
  }

  // register a callback for broadcast (/broadcast [group:<tag>] <message>)
  onBroadcast(handler: BroadcastHandler): void {
    this.broadcastHandler = handler;
  }

  // register a callback for watchdog (/watchdog [N] | /watchdog off)
  onWatchdog(handler: WatchdogHandler): void {
    this.watchdogHandler = handler;
  }

  // register a callback for /top [mode]
  onTop(handler: TopHandler): void {
    this.topHandler = handler;
  }

  // register a callback for /ceiling
  onCeiling(handler: CeilingHandler): void {
    this.ceilingHandler = handler;
  }

  // register a callback for /rename <N|name> [display name]
  onRename(handler: RenameHandler): void {
    this.renameHandler = handler;
  }

  // register a callback for /copy [N|name] — copy session pane output
  onCopySession(handler: CopySessionHandler): void {
    this.copySessionHandler = handler;
  }

  // register a callback for /stats — per-session stats summary
  onStats(handler: StatsHandler): void {
    this.statsHandler = handler;
  }

  // register a callback for /recall <keyword> [N] — search history
  onRecall(handler: RecallHandler): void {
    this.recallHandler = handler;
  }

  // register a callback for /pin-all-errors — pin all error sessions
  onPinAllErrors(handler: PinAllErrorsHandler): void {
    this.pinAllErrorsHandler = handler;
  }

  // register a callback for /export-stats — export stats to JSON file
  onExportStats(handler: ExportStatsHandler): void {
    this.exportStatsHandler = handler;
  }

  /** Set aliases from persisted prefs. */
  setAliases(aliases: Record<string, string>): void {
    this.aliases.clear();
    for (const [k, v] of Object.entries(aliases)) this.aliases.set(k, v);
  }

  /** Get current aliases as a plain object. */
  getAliases(): Record<string, string> {
    return Object.fromEntries(this.aliases);
  }

  // register a callback for clipboard export (/clip [N])
  onClip(handler: ClipHandler): void {
    this.clipHandler = handler;
  }

  // register a callback for bookmark diff (/diff N)
  onDiff(handler: DiffHandler): void {
    this.diffHandler = handler;
  }

  private notifyQueueChange(): void {
    this.queueChangeHandler?.(this.queue.length);
  }

  start(): void {
    // only works if stdin is a TTY (not piped)
    if (!process.stdin.isTTY) return;

    this.rl = createInterface({
      input: process.stdin,
      output: process.stderr, // prompt goes to stderr so stdout stays clean
      prompt: `${GREEN}you >${RESET} `,
      terminal: true,
    });

    this.rl.on("line", (line) => this.handleLine(line.trim()));
    this.rl.on("close", () => { this.rl = null; });

    // ESC-ESC interrupt detection (same as chat.ts)
    emitKeypressEvents(process.stdin);

    // intercept raw SGR mouse sequences before keypress parsing
    this.mouseDataListener = (data: Buffer) => {
      const str = data.toString("utf8");
      const evt = parseMouseEvent(str);
      if (!evt) return;
      // left click press
      if (evt.press && evt.button === 0 && this.mouseClickHandler) {
        this.mouseClickHandler(evt.row, evt.col);
      }
      // mouse wheel: button 64 = scroll up, 65 = scroll down
      if (evt.button === 64 && this.mouseWheelHandler) {
        this.mouseWheelHandler("up");
      } else if (evt.button === 65 && this.mouseWheelHandler) {
        this.mouseWheelHandler("down");
      }
      // mouse motion: bit 5 set (button 32-35), only fire on row change
      if (evt.button >= 32 && evt.button <= 35 && this.mouseMoveHandler) {
        if (evt.row !== this.lastMoveRow) {
          this.lastMoveRow = evt.row;
          this.mouseMoveHandler(evt.row, evt.col);
        }
      }
    };
    process.stdin.on("data", this.mouseDataListener);

    process.stdin.on("keypress", (_ch: string | undefined, key: { name?: string; sequence?: string }) => {
      if (key?.name === "escape" || key?.sequence === "\x1b") {
        const now = Date.now();
        if (now - this.lastEscTime < ESC_DOUBLE_TAP_MS) {
          this.handleEscInterrupt();
          this.lastEscTime = 0;
        } else {
          this.lastEscTime = now;
        }
      } else {
        this.lastEscTime = 0;
      }
      // scroll key detection (PgUp, PgDn, Home, End)
      if (this.scrollHandler) {
        if (key?.name === "pageup" || key?.sequence === "\x1b[5~") {
          this.scrollHandler("up");
        } else if (key?.name === "pagedown" || key?.sequence === "\x1b[6~") {
          this.scrollHandler("down");
        } else if (key?.name === "home" || key?.sequence === "\x1b[1~") {
          this.scrollHandler("top");
        } else if (key?.name === "end" || key?.sequence === "\x1b[4~") {
          this.scrollHandler("bottom");
        }
      }
    });

    // show hint on startup
    console.error(`${DIM}type a message to talk to the AI supervisor, /help for commands, ESC ESC to interrupt${RESET}`);
    this.rl.prompt();
  }

  // drain all pending user messages (called each tick)
  drain(): string[] {
    const msgs = this.queue.splice(0);
    if (msgs.length > 0) this.notifyQueueChange();
    return msgs;
  }

  isPaused(): boolean {
    return this.paused;
  }

  // check if there are queued messages without draining them
  hasPending(): boolean {
    return this.queue.length > 0;
  }

  // inject a message directly into the queue (used after interrupt to feed text into next tick)
  inject(msg: string): void {
    this.queue.push(msg);
    this.notifyQueueChange();
  }

  // re-show the prompt (called after daemon prints output)
  prompt(): void {
    this.rl?.prompt(true);
  }

  stop(): void {
    if (this.mouseDataListener) {
      process.stdin.removeListener("data", this.mouseDataListener);
      this.mouseDataListener = null;
    }
    this.rl?.close();
    this.rl = null;
  }

  private handleEscInterrupt(): void {
    requestInterrupt();
    this.queue.push("__CMD_INTERRUPT__");
    this.notifyQueueChange();
    console.error(`\n${RED}${BOLD}>>> interrupting reasoner <<<${RESET}`);
    console.error(`${YELLOW}type your message now -- it will be sent before the next cycle${RESET}`);
    this.rl?.prompt(true);
  }

  private handleInsist(msg: string): void {
    requestInterrupt();
    this.queue.push("__CMD_INTERRUPT__");
    this.queue.push(`${INSIST_PREFIX}${msg}`);
    this.notifyQueueChange();
    console.error(`${RED}${BOLD}!${RESET} ${GREEN}insist${RESET} ${DIM}— interrupting + delivering your message immediately${RESET}`);
  }

  private handleLine(line: string): void {
    if (!line) {
      this.rl?.prompt();
      return;
    }

    // quick-switch: bare digit 1-9 jumps to that session
    if (/^[1-9]$/.test(line) && this.quickSwitchHandler) {
      this.quickSwitchHandler(parseInt(line, 10));
      this.rl?.prompt();
      return;
    }

    // ultra-fast task capture: ":<goal>" updates current drill-down session task
    if (line.startsWith(":") && line.trim().length > 1) {
      const goal = line.slice(1).trim();
      this.queue.push(`__CMD_QUICKTASK__${goal}`);
      this.notifyQueueChange();
      console.error(`${GREEN}captured${RESET} ${DIM}task goal queued for current session${RESET}`);
      this.rl?.prompt();
      return;
    }

    // built-in slash commands (resolve aliases first)
    if (line.startsWith("/")) {
      this.handleCommand(resolveAlias(line, this.aliases));
      this.rl?.prompt();
      return;
    }

    // ! prefix = insist mode: interrupt + priority message
    if (line.startsWith("!") && line.length > 1) {
      const msg = line.slice(1).trim();
      if (msg) {
        this.handleInsist(msg);
        this.rl?.prompt();
        return;
      }
    }

    // plain text in drill-down defaults to task goal capture
    if (this.goalCaptureModeHandler?.()) {
      this.queue.push(`__CMD_QUICKTASK__${line}`);
      this.notifyQueueChange();
      console.error(`${GREEN}captured${RESET} ${DIM}goal updated for current session${RESET}`);
      this.rl?.prompt();
      return;
    }

    // otherwise, queue as a user message for the reasoner
    this.queue.push(line);
    this.notifyQueueChange();
    const pending = this.queue.filter(m => !m.startsWith("__CMD_")).length;
    console.error(`${GREEN}queued${RESET} ${DIM}(${pending} pending) — will be read next cycle${RESET}`);
    this.rl?.prompt();
  }

  private handleCommand(line: string): void {
    const [cmd] = line.split(/\s+/);

    switch (cmd) {
      case "/help":
        console.error(`
${BOLD}talking to the AI:${RESET}
  just type          in drill-down: update goal for that session; otherwise message AI
  !message           insist — interrupt + deliver message immediately
  /insist <msg>      same as !message
  /explain           ask the AI to explain what's happening right now

${BOLD}controls:${RESET}
  /pause             pause the supervisor
  /resume            resume the supervisor
  /mode [name]       set mode: observe, dry-run, confirm, autopilot (no arg = show)
  /interrupt         interrupt the AI mid-thought
  ESC ESC            same as /interrupt (shortcut)

${BOLD}navigation:${RESET}
  1-9                quick-switch: jump to session N (type digit + Enter)
  /view [N|name]     drill into a session's live output (default: 1)
  /back              return to overview from drill-down
  /sort [mode]       sort sessions: status, name, activity, default (or cycle)
  /compact           toggle compact mode (dense session panel)
  /pin [N|name]      pin/unpin a session to the top (toggle)
  /bell              toggle terminal bell on errors/completions
  /focus             toggle focus mode (show only pinned sessions)
  /mute [N|name]     mute/unmute a session's activity entries (toggle)
  /unmute-all        unmute all sessions at once
  /filter [tag]      filter activity by tag — presets: errors, actions, system (no arg = clear)
  /who               show fleet status (all sessions at a glance)
  /uptime            show session uptimes (time since first observed)
  /auto-pin          toggle auto-pin on error (pin sessions that emit errors)
  /note N|name text  attach a note to a session (no text = clear)
  /notes             list all session notes
  /group N|name tag  assign session to a group (no tag = clear)
  /groups            list all groups and their sessions
  /group-filter tag  show only sessions in a group (no arg = clear)
  /burn-rate         show context token burn rates for all sessions
  /snapshot [md]     export session state snapshot to JSON (or Markdown with md)
  /broadcast <msg>   send message to all sessions; /broadcast group:<tag> <msg> for group
  /watchdog [N]      alert if session stalls N minutes (default 10); /watchdog off to disable
  /top [mode]        rank sessions by errors (default), burn, or idle
  /ceiling           show context token usage vs limit for all sessions
  /rename N|name [display] set custom display name in TUI (no display = clear)
  /copy [N|name]     copy session's current pane output to clipboard (default: current drill-down)
  /stats             show per-session health, errors, burn rate, context %, uptime
  /recall <keyword>  search persisted activity history (last 7 days) for keyword
  /pin-all-errors    pin every session currently in error status
  /export-stats      export /stats output as JSON to ~/.aoaoe/stats-<ts>.json
  /clip [N]          copy last N activity entries to clipboard (default 20)
  /diff N            show activity since bookmark N
  /mark              bookmark current activity position
  /jump N            jump to bookmark N
  /marks             list all bookmarks
  /search <pattern>  filter activity entries by substring (case-insensitive)
  /search            clear active search filter
  click session      click an agent card to drill down (click again to go back)
  mouse wheel        scroll activity (overview) or session output (drill-down)
  PgUp / PgDn        scroll through activity or session output
  Home / End         jump to oldest / return to live

${BOLD}info:${RESET}
  /status            show daemon state
  /dashboard         show full dashboard
  /tasks             show task progress table
  /task [sub] [args] task management (list, start, stop, edit, new, rm)
  /task <s> :: <g>   quick update goal <g> for session/task <s>
  :<goal>            fastest path: set goal for current drill-down session

${BOLD}other:${RESET}
  /alias /x /cmd     create alias (/x expands to /cmd). no args = list all
  /verbose           toggle detailed logging
  /clear             clear the screen
`);
        break;

      case "/pause":
        this.paused = true;
        console.error(`${YELLOW}paused -- reasoner will not be called until /resume${RESET}`);
        break;

      case "/resume":
        this.paused = false;
        console.error(`${GREEN}resumed${RESET}`);
        break;

      case "/status":
        this.queue.push("__CMD_STATUS__");
        break;

      case "/mode": {
        const modeArg = line.slice("/mode".length).trim().toLowerCase();
        this.queue.push(`__CMD_MODE__${modeArg}`);
        break;
      }

      case "/dashboard":
        this.queue.push("__CMD_DASHBOARD__");
        break;

      case "/explain":
        this.queue.push("__CMD_EXPLAIN__");
        console.error(`${GREEN}Got it!${RESET} ${DIM}Asking the AI for a plain-English summary...${RESET}`);
        break;

      case "/verbose":
        this.queue.push("__CMD_VERBOSE__");
        break;

      case "/interrupt":
        this.handleEscInterrupt();
        break;

      case "/insist": {
        const insistMsg = line.slice("/insist".length).trim();
        if (insistMsg) {
          this.handleInsist(insistMsg);
        } else {
          console.error(`${DIM}usage: /insist <message> — interrupts and delivers your message immediately${RESET}`);
        }
        break;
      }

      case "/tasks":
        this.queue.push("__CMD_TASK__list");
        break;

      case "/t":
      case "/todo":
      case "/idea": {
        const taskArgs = line.slice(cmd.length).trim();
        this.queue.push(`__CMD_TASK__${taskArgs}`);
        break;
      }

      case "/task": {
        // pass arguments after "/task" as __CMD_TASK__ marker with args
        const taskArgs = line.slice("/task".length).trim();
        this.queue.push(`__CMD_TASK__${taskArgs}`);
        break;
      }

      case "/view": {
        const viewArg = line.slice("/view".length).trim();
        if (this.viewHandler) {
          this.viewHandler(viewArg || "1"); // default to session 1
        } else {
          console.error(`${DIM}drill-down not available (no TUI)${RESET}`);
        }
        break;
      }

      case "/back":
        if (this.viewHandler) {
          this.viewHandler(null); // null = back to overview
        } else {
          console.error(`${DIM}already in overview${RESET}`);
        }
        break;

      case "/sort": {
        const sortArg = line.slice("/sort".length).trim().toLowerCase();
        if (this.sortHandler) {
          this.sortHandler(sortArg || null); // empty = cycle to next mode
        } else {
          console.error(`${DIM}sort not available (no TUI)${RESET}`);
        }
        break;
      }

      case "/compact":
        if (this.compactHandler) {
          this.compactHandler();
        } else {
          console.error(`${DIM}compact mode not available (no TUI)${RESET}`);
        }
        break;

      case "/pin": {
        const pinArg = line.slice("/pin".length).trim();
        if (this.pinHandler) {
          if (pinArg) {
            this.pinHandler(pinArg);
          } else {
            console.error(`${DIM}usage: /pin <N|name> — toggle pin for a session${RESET}`);
          }
        } else {
          console.error(`${DIM}pin not available (no TUI)${RESET}`);
        }
        break;
      }

      case "/bell":
        if (this.bellHandler) {
          this.bellHandler();
        } else {
          console.error(`${DIM}bell not available (no TUI)${RESET}`);
        }
        break;

      case "/focus":
        if (this.focusHandler) {
          this.focusHandler();
        } else {
          console.error(`${DIM}focus not available (no TUI)${RESET}`);
        }
        break;

      case "/mute": {
        const muteArg = line.slice("/mute".length).trim();
        if (this.muteHandler) {
          if (muteArg) {
            this.muteHandler(muteArg);
          } else {
            console.error(`${DIM}usage: /mute <N|name> — toggle mute for a session${RESET}`);
          }
        } else {
          console.error(`${DIM}mute not available (no TUI)${RESET}`);
        }
        break;
      }

      case "/unmute-all":
        if (this.unmuteAllHandler) {
          this.unmuteAllHandler();
        } else {
          console.error(`${DIM}unmute-all not available (no TUI)${RESET}`);
        }
        break;

      case "/filter": {
        const filterArg = line.slice("/filter".length).trim();
        if (this.tagFilterHandler) {
          this.tagFilterHandler(filterArg || null);
        } else {
          console.error(`${DIM}filter not available (no TUI)${RESET}`);
        }
        break;
      }

      case "/who":
        if (this.whoHandler) {
          this.whoHandler();
        } else {
          console.error(`${DIM}who not available (no TUI)${RESET}`);
        }
        break;

      case "/uptime":
        if (this.uptimeHandler) {
          this.uptimeHandler();
        } else {
          console.error(`${DIM}uptime not available (no TUI)${RESET}`);
        }
        break;

      case "/auto-pin":
        if (this.autoPinHandler) {
          this.autoPinHandler();
        } else {
          console.error(`${DIM}auto-pin not available (no TUI)${RESET}`);
        }
        break;

      case "/note": {
        const noteArg = line.slice("/note".length).trim();
        if (this.noteHandler) {
          // split: first word is target, rest is note text
          const spaceIdx = noteArg.indexOf(" ");
          if (spaceIdx > 0) {
            const target = noteArg.slice(0, spaceIdx);
            const text = noteArg.slice(spaceIdx + 1).trim();
            this.noteHandler(target, text);
          } else if (noteArg) {
            // target only, no text — clear note
            this.noteHandler(noteArg, "");
          } else {
            console.error(`${DIM}usage: /note <N|name> <text> — set note, or /note <N|name> — clear${RESET}`);
          }
        } else {
          console.error(`${DIM}notes not available (no TUI)${RESET}`);
        }
        break;
      }

      case "/notes":
        if (this.notesHandler) {
          this.notesHandler();
        } else {
          console.error(`${DIM}notes not available (no TUI)${RESET}`);
        }
        break;

      case "/clip": {
        const clipArg = line.slice("/clip".length).trim();
        const clipCount = clipArg ? parseInt(clipArg, 10) : 20;
        if (this.clipHandler && !isNaN(clipCount) && clipCount > 0) {
          this.clipHandler(clipCount);
        } else if (!this.clipHandler) {
          console.error(`${DIM}clip not available (no TUI)${RESET}`);
        } else {
          console.error(`${DIM}usage: /clip [N] — copy last N activity entries to clipboard${RESET}`);
        }
        break;
      }

      case "/diff": {
        const diffArg = line.slice("/diff".length).trim();
        const diffNum = parseInt(diffArg, 10);
        if (this.diffHandler && !isNaN(diffNum) && diffNum > 0) {
          this.diffHandler(diffNum);
        } else if (!this.diffHandler) {
          console.error(`${DIM}diff not available (no TUI)${RESET}`);
        } else {
          console.error(`${DIM}usage: /diff N — show activity since bookmark N${RESET}`);
        }
        break;
      }

      case "/mark":
        if (this.markHandler) {
          this.markHandler();
        } else {
          console.error(`${DIM}bookmarks not available (no TUI)${RESET}`);
        }
        break;

      case "/jump": {
        const jumpArg = line.slice("/jump".length).trim();
        const jumpNum = parseInt(jumpArg, 10);
        if (this.jumpHandler && !isNaN(jumpNum) && jumpNum > 0) {
          this.jumpHandler(jumpNum);
        } else if (!this.jumpHandler) {
          console.error(`${DIM}bookmarks not available (no TUI)${RESET}`);
        } else {
          console.error(`${DIM}usage: /jump N — jump to bookmark number N${RESET}`);
        }
        break;
      }

      case "/marks":
        if (this.marksHandler) {
          this.marksHandler();
        } else {
          console.error(`${DIM}bookmarks not available (no TUI)${RESET}`);
        }
        break;

      case "/search": {
        const searchArg = line.slice("/search".length).trim();
        if (this.searchHandler) {
          this.searchHandler(searchArg || null); // empty = clear search
        } else {
          console.error(`${DIM}search not available (no TUI)${RESET}`);
        }
        break;
      }

      case "/alias": {
        const aliasArgs = line.slice("/alias".length).trim();
        if (!aliasArgs) {
          // list all aliases
          if (this.aliases.size === 0) {
            console.error(`${DIM}no aliases — use /alias /shortcut /command${RESET}`);
          } else {
            for (const [k, v] of this.aliases) console.error(`${DIM}  ${k} → ${v}${RESET}`);
          }
        } else {
          const parts = aliasArgs.split(/\s+/);
          const name = parts[0].startsWith("/") ? parts[0] : `/${parts[0]}`;
          const target = parts.slice(1).join(" ");
          if (!target) {
            // clear alias
            if (this.aliases.has(name)) {
              this.aliases.delete(name);
              console.error(`${DIM}alias ${name} removed${RESET}`);
              this.aliasChangeHandler?.();
            } else {
              console.error(`${DIM}no alias ${name} to remove${RESET}`);
            }
          } else {
            const err = validateAliasName(name);
            if (err) {
              console.error(`${RED}${err}${RESET}`);
            } else if (this.aliases.size >= MAX_ALIASES && !this.aliases.has(name)) {
              console.error(`${RED}max ${MAX_ALIASES} aliases — remove one first${RESET}`);
            } else {
              const targetCmd = target.startsWith("/") ? target : `/${target}`;
              this.aliases.set(name, targetCmd);
              console.error(`${DIM}alias ${name} → ${targetCmd}${RESET}`);
              this.aliasChangeHandler?.();
            }
          }
        }
        break;
      }

      case "/group": {
        const groupArg = line.slice("/group".length).trim();
        if (this.groupHandler) {
          const spaceIdx = groupArg.indexOf(" ");
          if (spaceIdx > 0) {
            const target = groupArg.slice(0, spaceIdx);
            const tag = groupArg.slice(spaceIdx + 1).trim();
            this.groupHandler(target, tag);
          } else if (groupArg) {
            // target only — clear group
            this.groupHandler(groupArg, "");
          } else {
            console.error(`${DIM}usage: /group <N|name> <tag> — assign group, or /group <N|name> — clear${RESET}`);
          }
        } else {
          console.error(`${DIM}groups not available (no TUI)${RESET}`);
        }
        break;
      }

      case "/groups":
        if (this.groupsHandler) {
          this.groupsHandler();
        } else {
          console.error(`${DIM}groups not available (no TUI)${RESET}`);
        }
        break;

      case "/group-filter": {
        const gfArg = line.slice("/group-filter".length).trim();
        if (this.groupFilterHandler) {
          this.groupFilterHandler(gfArg || null);
        } else {
          console.error(`${DIM}group filter not available (no TUI)${RESET}`);
        }
        break;
      }

      case "/pin-all-errors":
        if (this.pinAllErrorsHandler) {
          this.pinAllErrorsHandler();
        } else {
          console.error(`${DIM}pin-all-errors not available (no TUI)${RESET}`);
        }
        break;

      case "/export-stats":
        if (this.exportStatsHandler) {
          this.exportStatsHandler();
        } else {
          console.error(`${DIM}export-stats not available (no TUI)${RESET}`);
        }
        break;

      case "/recall": {
        const recallArgs = line.slice("/recall".length).trim().split(/\s+/);
        const keyword = recallArgs[0] ?? "";
        if (!keyword) {
          console.error(`${DIM}usage: /recall <keyword> [N] — search activity history (default: last 50 matches)${RESET}`);
          break;
        }
        const maxN = recallArgs[1] ? parseInt(recallArgs[1], 10) : 50;
        const limit = isNaN(maxN) || maxN < 1 ? 50 : Math.min(maxN, 500);
        if (this.recallHandler) {
          this.recallHandler(keyword, limit);
        } else {
          console.error(`${DIM}recall not available (no TUI)${RESET}`);
        }
        break;
      }

      case "/stats":
        if (this.statsHandler) {
          this.statsHandler();
        } else {
          console.error(`${DIM}stats not available (no TUI)${RESET}`);
        }
        break;

      case "/copy": {
        const copyArg = line.slice("/copy".length).trim() || null;
        if (this.copySessionHandler) {
          this.copySessionHandler(copyArg);
        } else {
          console.error(`${DIM}copy not available (no TUI)${RESET}`);
        }
        break;
      }

      case "/rename": {
        const renameArg = line.slice("/rename".length).trim();
        if (!renameArg) {
          console.error(`${DIM}usage: /rename <N|name> [display name] — set custom display name (no name = clear)${RESET}`);
          break;
        }
        if (this.renameHandler) {
          const spaceIdx = renameArg.indexOf(" ");
          if (spaceIdx > 0) {
            const target = renameArg.slice(0, spaceIdx);
            const display = renameArg.slice(spaceIdx + 1).trim();
            this.renameHandler(target, display);
          } else {
            // target only — clear alias
            this.renameHandler(renameArg, "");
          }
        } else {
          console.error(`${DIM}rename not available (no TUI)${RESET}`);
        }
        break;
      }

      case "/ceiling":
        if (this.ceilingHandler) {
          this.ceilingHandler();
        } else {
          console.error(`${DIM}ceiling not available (no TUI)${RESET}`);
        }
        break;

      case "/top": {
        const topArg = line.slice("/top".length).trim().toLowerCase() || "default";
        if (this.topHandler) {
          this.topHandler(topArg);
        } else {
          console.error(`${DIM}top not available (no TUI)${RESET}`);
        }
        break;
      }

      case "/watchdog": {
        const wdArg = line.slice("/watchdog".length).trim().toLowerCase();
        if (this.watchdogHandler) {
          if (!wdArg || wdArg === "on") {
            this.watchdogHandler(10); // default 10 min
          } else if (wdArg === "off") {
            this.watchdogHandler(null);
          } else {
            const mins = parseInt(wdArg, 10);
            if (!isNaN(mins) && mins > 0) {
              this.watchdogHandler(mins);
            } else {
              console.error(`${DIM}usage: /watchdog [N]  set N-minute stall alert (default 10), or /watchdog off${RESET}`);
            }
          }
        } else {
          console.error(`${DIM}watchdog not available (no TUI)${RESET}`);
        }
        break;
      }

      case "/burn-rate":
        if (this.burnRateHandler) {
          this.burnRateHandler();
        } else {
          console.error(`${DIM}burn-rate not available (no TUI)${RESET}`);
        }
        break;

      case "/broadcast": {
        const broadcastArg = line.slice("/broadcast".length).trim();
        if (!broadcastArg) {
          console.error(`${DIM}usage: /broadcast <message>  or  /broadcast group:<tag> <message>${RESET}`);
          break;
        }
        if (this.broadcastHandler) {
          // check for group:<tag> prefix
          const groupMatch = broadcastArg.match(/^group:([a-z0-9_-]+)\s+([\s\S]+)$/i);
          if (groupMatch) {
            this.broadcastHandler(groupMatch[2].trim(), groupMatch[1].toLowerCase());
          } else {
            this.broadcastHandler(broadcastArg, null);
          }
        } else {
          console.error(`${DIM}broadcast not available (no TUI)${RESET}`);
        }
        break;
      }

      case "/snapshot": {
        const snapArg = line.slice("/snapshot".length).trim().toLowerCase();
        const fmt = snapArg === "md" || snapArg === "markdown" ? "md" : "json";
        if (this.snapshotHandler) {
          this.snapshotHandler(fmt);
        } else {
          console.error(`${DIM}snapshot not available (no TUI)${RESET}`);
        }
        break;
      }

      case "/clear":
        process.stderr.write("\x1b[2J\x1b[H");
        break;

      default:
        console.error(`${DIM}unknown command: ${cmd} (try /help — or in drill-down use :<goal>)${RESET}`);
        break;
    }
  }
}
