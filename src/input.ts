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

// ── Mouse event types ───────────────────────────────────────────────────────

export interface MouseEvent {
  button: number;  // 0=left, 1=middle, 2=right, 64=scroll-up, 65=scroll-down
  col: number;     // 1-indexed column
  row: number;     // 1-indexed row
  press: boolean;  // true=press (M suffix), false=release (m suffix)
}

export type MouseClickHandler = (row: number, col: number) => void;
export type MouseWheelHandler = (direction: "up" | "down") => void;

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
  private searchHandler: SearchHandler | null = null;
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

  // register a callback for search commands (/search <pattern> or /search to clear)
  onSearch(handler: SearchHandler): void {
    this.searchHandler = handler;
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
  /view [N|name]     drill into a session's live output (default: 1)
  /back              return to overview from drill-down
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
