// interactive stdin input -- lets the user send messages to the reasoner
// and run built-in slash commands while the daemon is running.
// in v0.32.0+ the daemon runs interactively in the same terminal (no separate attach).
import { createInterface, emitKeypressEvents, type Interface } from "node:readline";
import { requestInterrupt } from "./daemon-state.js";

import { GREEN, DIM, YELLOW, RED, BOLD, RESET } from "./colors.js";

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
export type NoteHandler = (target: string, text: string) => void; // session + note text (empty = clear)
export type NotesHandler = () => void; // list all session notes

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
  private noteHandler: NoteHandler | null = null;
  private notesHandler: NotesHandler | null = null;
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

  // register a callback for note commands (/note <target> <text>)
  onNote(handler: NoteHandler): void {
    this.noteHandler = handler;
  }

  // register a callback for listing notes (/notes)
  onNotes(handler: NotesHandler): void {
    this.notesHandler = handler;
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

    // built-in slash commands
    if (line.startsWith("/")) {
      this.handleCommand(line);
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

    // queue as a user message for the reasoner
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
  just type          send a message — queued for next cycle
  !message           insist — interrupt + deliver message immediately
  /insist <msg>      same as !message
  /explain           ask the AI to explain what's happening right now

${BOLD}controls:${RESET}
  /pause             pause the supervisor
  /resume            resume the supervisor
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
  /filter [tag]      filter activity by tag (error, system, etc. — no arg = clear)
  /note N|name text  attach a note to a session (no text = clear)
  /notes             list all session notes
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

${BOLD}other:${RESET}
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

      case "/clear":
        process.stderr.write("\x1b[2J\x1b[H");
        break;

      default:
        console.error(`${DIM}unknown command: ${cmd} (try /help)${RESET}`);
        break;
    }
  }
}
