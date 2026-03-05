// interactive stdin input -- lets the user send messages to the reasoner
// and run built-in slash commands while the daemon is running
import { createInterface, type Interface } from "node:readline";

export class InputReader {
  private rl: Interface | null = null;
  private queue: string[] = []; // pending user messages for the reasoner
  private paused = false;

  start(): void {
    // only works if stdin is a TTY (not piped)
    if (!process.stdin.isTTY) return;

    this.rl = createInterface({
      input: process.stdin,
      output: process.stderr, // prompt goes to stderr so stdout stays clean
      prompt: "",
    });

    this.rl.on("line", (line) => this.handleLine(line.trim()));
    this.rl.on("close", () => { this.rl = null; });

    // show hint on startup
    console.error("[input] type a message to send to the reasoner, or /help for commands");
  }

  // drain all pending user messages (called each tick)
  drain(): string[] {
    const msgs = this.queue.splice(0);
    return msgs;
  }

  isPaused(): boolean {
    return this.paused;
  }

  // inject a message directly into the queue (used after interrupt to feed text into next tick)
  inject(msg: string): void {
    this.queue.push(msg);
  }

  stop(): void {
    this.rl?.close();
    this.rl = null;
  }

  private handleLine(line: string): void {
    if (!line) return;

    // built-in slash commands
    if (line.startsWith("/")) {
      this.handleCommand(line);
      return;
    }

    // queue as a user message for the reasoner
    this.queue.push(line);
    console.error(`[input] queued message for next reasoning cycle`);
  }

  private handleCommand(line: string): void {
    const [cmd, ...args] = line.split(/\s+/);

    switch (cmd) {
      case "/help":
        console.error(`
  /help              show this help
  /status            print current daemon state
  /pause             pause the daemon loop (polling continues, reasoning skipped)
  /resume            resume the daemon loop
  /dashboard         force a dashboard print on next tick
  /tasks             show per-session task assignments
  /interrupt         interrupt the current reasoner call
  /verbose           toggle verbose mode
  <any text>         send message to the reasoner on next tick
`);
        break;

      case "/pause":
        this.paused = true;
        console.error("[input] paused -- reasoner will not be called until /resume");
        break;

      case "/resume":
        this.paused = false;
        console.error("[input] resumed");
        break;

      case "/status":
        // handled by the main loop (push a special marker)
        this.queue.push("__CMD_STATUS__");
        break;

      case "/dashboard":
        this.queue.push("__CMD_DASHBOARD__");
        break;

      case "/verbose":
        this.queue.push("__CMD_VERBOSE__");
        break;

      case "/interrupt":
        this.queue.push("__CMD_INTERRUPT__");
        console.error("[input] interrupt requested");
        break;

      case "/tasks":
        this.queue.push("__CMD_DASHBOARD__"); // reuse dashboard for now
        break;

      default:
        console.error(`[input] unknown command: ${cmd} (try /help)`);
        break;
    }
  }
}
