// interactive stdin input -- lets the user send messages to the reasoner
// and run built-in slash commands while the daemon is running.
// in v0.32.0+ the daemon runs interactively in the same terminal (no separate attach).
import { createInterface, emitKeypressEvents, type Interface } from "node:readline";
import { requestInterrupt } from "./daemon-state.js";

import { GREEN, DIM, YELLOW, RED, BOLD, RESET } from "./colors.js";

// ESC-ESC interrupt detection
const ESC_DOUBLE_TAP_MS = 500;

export type ScrollDirection = "up" | "down" | "top" | "bottom";

export class InputReader {
  private rl: Interface | null = null;
  private queue: string[] = []; // pending user messages for the reasoner
  private paused = false;
  private lastEscTime = 0;
  private scrollHandler: ((dir: ScrollDirection) => void) | null = null;

  // register a callback for scroll key events (PgUp/PgDn/Home/End)
  onScroll(handler: (dir: ScrollDirection) => void): void {
    this.scrollHandler = handler;
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
  }

  // re-show the prompt (called after daemon prints output)
  prompt(): void {
    this.rl?.prompt(true);
  }

  stop(): void {
    this.rl?.close();
    this.rl = null;
  }

  private handleEscInterrupt(): void {
    requestInterrupt();
    this.queue.push("__CMD_INTERRUPT__");
    console.error(`\n${RED}${BOLD}>>> interrupting reasoner <<<${RESET}`);
    console.error(`${YELLOW}type your message now -- it will be sent before the next cycle${RESET}`);
    this.rl?.prompt(true);
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

    // queue as a user message for the reasoner
    this.queue.push(line);
    console.error(`${GREEN}Got it!${RESET} ${DIM}The AI will read your message on the next cycle.${RESET}`);
    this.rl?.prompt();
  }

  private handleCommand(line: string): void {
    const [cmd] = line.split(/\s+/);

    switch (cmd) {
      case "/help":
        console.error(`
${BOLD}talking to the AI:${RESET}
  just type          send a message to the AI supervisor
  /explain           ask the AI to explain what's happening right now

${BOLD}controls:${RESET}
  /pause             pause the supervisor
  /resume            resume the supervisor
  /interrupt         interrupt the AI mid-thought
  ESC ESC            same as /interrupt (shortcut)
  PgUp / PgDn        scroll through activity history
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

      case "/tasks":
        this.queue.push("__CMD_TASK__list");
        break;

      case "/task": {
        // pass arguments after "/task" as __CMD_TASK__ marker with args
        const taskArgs = line.slice("/task".length).trim();
        this.queue.push(`__CMD_TASK__${taskArgs}`);
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
