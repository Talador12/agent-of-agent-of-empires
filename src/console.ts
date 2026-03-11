// console.ts -- manages conversation log and user input IPC for the reasoner
// supports three modes:
// 1. inline mode (default) -- prints colorized output directly to the daemon terminal
// 2. file-only mode -- when chat.ts runs inside an AoE-managed tmux pane
// 3. legacy tmux session (aoaoe_reasoner) -- removed in v0.32.0
import { mkdirSync, appendFileSync, readFileSync, writeFileSync, existsSync, renameSync, unlinkSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const AOAOE_DIR = join(homedir(), ".aoaoe");
const CONVO_LOG = join(AOAOE_DIR, "conversation.log");
const INPUT_FILE = join(AOAOE_DIR, "pending-input.txt");
const PID_FILE = join(AOAOE_DIR, "chat.pid");
const SESSION_NAME = "aoaoe_reasoner";

// ANSI colors for inline mode
const DIM = "\x1b[2m";
const GREEN = "\x1b[32m";
const CYAN = "\x1b[36m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const RESET = "\x1b[0m";

export class ReasonerConsole {
  private started = false;
  private inlineMode = false; // true = print to daemon terminal directly

  // detect if chat.ts is running (registered as AoE session)
  private chatIsRunning(): boolean {
    if (!existsSync(PID_FILE)) return false;
    try {
      const pid = parseInt(readFileSync(PID_FILE, "utf-8").trim(), 10);
      if (isNaN(pid)) return false;
      // check if process is alive (signal 0 doesn't kill, just checks)
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  async start(): Promise<void> {
    mkdirSync(AOAOE_DIR, { recursive: true });

    // clear previous conversation log (fresh session)
    writeFileSync(CONVO_LOG, "");
    writeFileSync(INPUT_FILE, "");

    // always use inline mode — print directly to the daemon terminal
    // if chat.ts is also running in an AoE pane, it reads conversation.log independently
    this.inlineMode = true;
    this.started = true;

    if (this.chatIsRunning()) {
      this.writeSystem("chat UI also connected (running in AoE session)");
    }
  }

  // visual tick boundary — groups observation -> reasoning -> actions
  writeTickSeparator(pollCount: number): void {
    this.append(`\n${formatTickSeparator(pollCount)}`);
  }

  // write a formatted entry to the conversation log
  writeObservation(sessionCount: number, changeCount: number, changes: string[], sessionSummaries?: string[]): void {
    const ts = this.ts();
    this.append(`${ts} [observation] ${sessionCount} sessions, ${changeCount} changed`);
    if (sessionSummaries && sessionSummaries.length > 0) {
      for (const s of sessionSummaries) {
        this.append(`  ${s}`);
      }
    } else {
      for (const c of changes) {
        this.append(`  ${c}`);
      }
    }
  }

  writeUserMessage(msg: string): void {
    this.append(`${this.ts()} [you] ${msg}`);
  }

  writeReasoning(reasoning: string): void {
    this.append(`${this.ts()} [reasoner] ${reasoning}`);
  }

  writeExplanation(explanation: string): void {
    this.append(`${this.ts()} [explain] ${explanation}`);
  }

  writeAction(action: string, detail: string, success: boolean): void {
    const icon = success ? "+" : "!";
    this.append(`${this.ts()} [${icon} action] ${action}: ${detail}`);
  }

  writeSystem(msg: string): void {
    this.append(`${this.ts()} [system] ${msg}`);
  }

  // phase transition status — lighter than [system], visible in chat
  writeStatus(msg: string): void {
    this.append(`${this.ts()} [status] ${msg}`);
  }

  // check if pending-input.txt has content without draining it.
  // used to decide whether to skip sleep after a tick.
  hasPendingInput(): boolean {
    try {
      if (!existsSync(INPUT_FILE)) return false;
      const st = statSync(INPUT_FILE);
      return st.size > 0;
    } catch {
      return false;
    }
  }

  // read and clear pending user input from the input pane.
  // uses atomic rename to avoid race where input written between read and clear is lost.
  drainInput(): string[] {
    // atomic swap: rename to temp file, then read the temp.
    // if chat.ts appends between rename and read, those writes go to a new INPUT_FILE
    // (the old one is now at drainPath) so nothing is lost.
    // no existsSync check — just try the rename; ENOENT is handled in the catch.
    const drainPath = INPUT_FILE + ".drain";
    try {
      renameSync(INPUT_FILE, drainPath);
    } catch {
      // ENOENT or concurrent drain — both fine
      return [];
    }

    try {
      const content = readFileSync(drainPath, "utf-8").trim();
      // remove the temp file (best-effort)
      try { unlinkSync(drainPath); } catch {}
      if (!content) return [];
      return content.split("\n").filter((l) => l.trim());
    } catch {
      return [];
    }
  }

  async stop(): Promise<void> {
    this.started = false;
  }

  private append(line: string): void {
    // always write to conversation.log (for chat.ts / external readers)
    try {
      appendFileSync(CONVO_LOG, line + "\n");
    } catch {}

    // in inline mode, also print colorized output to stderr
    if (this.inlineMode) {
      process.stderr.write(colorizeConsoleLine(line) + "\n");
    }
  }

  private ts(): string {
    return new Date().toLocaleTimeString();
  }

  static sessionName(): string {
    return SESSION_NAME;
  }
}

// --- pure formatting helpers (exported for testing) ---

/** Format the tick separator line. Pattern: `──── tick #N ────` */
export function formatTickSeparator(pollCount: number): string {
  return `──── tick #${pollCount} ────`;
}

/** Status icon for a session: ~ working, . idle, ! error, ? unknown */
function sessionIcon(status: string): string {
  if (status === "working") return "~";
  if (status === "idle" || status === "stopped") return ".";
  if (status === "error") return "!";
  return "?";
}

/**
 * Build per-session one-liner summaries for the observation entry.
 * Format: `~ title (tool) — last activity snippet`
 */
export function formatSessionSummaries(
  sessions: Array<{ title: string; tool: string; status: string; lastActivity?: string }>,
  changedTitles: Set<string>,
): string[] {
  return sessions.map((s) => {
    const icon = sessionIcon(s.status);
    const activity = s.lastActivity
      ? s.lastActivity.length > 60 ? s.lastActivity.slice(0, 57) + "..." : s.lastActivity
      : s.status;
    const changed = changedTitles.has(s.title) ? " *" : "";
    return `${icon} ${s.title} (${s.tool})${changed} — ${activity}`;
  });
}

/**
 * Format an action line with session title and text preview.
 * For send_input: `send_input → title: text preview`
 * For other actions: `action → title`
 */
export function formatActionDetail(action: string, sessionTitle: string | undefined, detail: string): string {
  if (!sessionTitle) return `${action}: ${detail}`;
  if (action === "send_input") {
    const preview = detail.length > 80 ? detail.slice(0, 77) + "..." : detail;
    return `${action} → ${sessionTitle}: ${preview}`;
  }
  return `${action} → ${sessionTitle}`;
}

/**
 * Format an action as a plain-English sentence for human-friendly display.
 * Examples:
 *   "Sent a message to Adventure: 'implement the login flow'"
 *   "Starting Cloud Hypervisor"
 *   "Waiting — all agents are making progress"
 */
export function formatPlainEnglishAction(
  action: string,
  sessionTitle: string | undefined,
  detail: string,
  success: boolean,
): string {
  const name = sessionTitle ?? "unknown session";
  const failed = !success ? " (failed)" : "";

  switch (action) {
    case "send_input": {
      const preview = detail.length > 80 ? detail.slice(0, 77) + "..." : detail;
      return `Sent a message to ${name}: '${preview}'${failed}`;
    }
    case "start_session":
      return `Starting ${name}${failed}`;
    case "stop_session":
      return `Stopping ${name}${failed}`;
    case "create_agent":
      return `Creating a new agent: ${name}${failed}`;
    case "remove_agent":
      return `Removing ${name}${failed}`;
    case "report_progress": {
      const preview = detail.length > 60 ? detail.slice(0, 57) + "..." : detail;
      return `Progress on ${name}: ${preview}${failed}`;
    }
    case "complete_task":
      return `Marked ${name} as complete${failed}`;
    case "wait":
      return `Waiting — ${detail || "no action needed"}`;
    default:
      return `${action} on ${name}${failed}`;
  }
}

// colorize a single console line for inline terminal output
// applied to each line as it's written (not batch like chat.ts colorize)
export function colorizeConsoleLine(line: string): string {
  // tick separators
  if (/^─{2,}/.test(line.trim())) {
    return `${DIM}${line}${RESET}`;
  }
  // tagged entries: [observation], [you], [reasoner], [explain], [+ action], [! action], [system], [status]
  const tagMatch = line.match(/^(.*?\[)(observation|you|reasoner|explain|\+ action|! action|system|status)(\].*$)/);
  if (tagMatch) {
    const [, pre, tag, post] = tagMatch;
    const BOLD = "\x1b[1m";
    switch (tag) {
      case "observation": return `${DIM}${pre}${tag}${post}${RESET}`;
      case "you": return `${GREEN}${pre}${tag}${post}${RESET}`;
      case "reasoner": return `${CYAN}${pre}${tag}${post}${RESET}`;
      case "explain": return `${BOLD}${CYAN}${pre}${tag}${post}${RESET}`;
      case "+ action": return `${YELLOW}${pre}${tag}${post}${RESET}`;
      case "! action": return `${RED}${pre}${tag}${post}${RESET}`;
      case "system": return `${DIM}${pre}${tag}${post}${RESET}`;
      case "status": return `${DIM}${pre}${tag}${post}${RESET}`;
    }
  }
  return line;
}
