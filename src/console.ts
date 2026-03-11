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

import { DIM, GREEN, CYAN, YELLOW, RED, BOLD, RESET } from "./colors.js";

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
    } catch (e) {
      console.error(`[console] pending-input size check failed: ${e}`);
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
    } catch (e) { console.error(`[console] conversation log write failed: ${e}`); }

    // in inline mode, also print colorized output to stderr
    if (this.inlineMode) {
      process.stderr.write(colorizeConsoleLine(line) + "\n");
    }
  }

  private ts(): string {
    return new Date().toLocaleTimeString();
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
 * Build a narrated observation summary — conversational one-liner.
 * Examples:
 *   "Adventure just made progress. CHV is idle."
 *   "All 3 agents are working — no changes."
 *   "Adventure hit an error!"
 */
export function narrateObservation(
  sessions: Array<{ title: string; status: string }>,
  changedTitles: Set<string>,
): string {
  if (sessions.length === 0) return "No agents running.";

  const parts: string[] = [];

  // mention sessions that changed
  const changed = sessions.filter((s) => changedTitles.has(s.title));
  const errored = sessions.filter((s) => s.status === "error");
  const idle = sessions.filter((s) => s.status === "idle" || s.status === "stopped");

  if (errored.length > 0) {
    const names = errored.map((s) => s.title).join(", ");
    parts.push(`${names} hit an error!`);
  }

  if (changed.length > 0) {
    const progressNames = changed.filter((s) => s.status !== "error").map((s) => s.title);
    if (progressNames.length > 0) {
      parts.push(`${progressNames.join(", ")} just made progress.`);
    }
  }

  if (changed.length === 0 && errored.length === 0) {
    if (idle.length === sessions.length) {
      parts.push(`All ${sessions.length} agents are idle.`);
    } else {
      parts.push(`${sessions.length} agents working — no new changes.`);
    }
  }

  if (idle.length > 0 && idle.length < sessions.length) {
    const idleNames = idle.map((s) => s.title).join(", ");
    parts.push(`${idleNames} ${idle.length === 1 ? "is" : "are"} idle.`);
  }

  return parts.join(" ");
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

/**
 * Summarize recent actions from the persistent actions.log.
 * Pure function: takes log lines (JSONL), returns a conversational catch-up sentence.
 * Used at startup to show "Recent activity: 5 actions in the last hour."
 */
export function summarizeRecentActions(logLines: string[], windowMs = 3_600_000): string {
  if (logLines.length === 0) return "No previous activity found.";

  const now = Date.now();
  const cutoff = now - windowMs;
  let recentCount = 0;
  let successes = 0;
  let failures = 0;
  const actionTypes = new Map<string, number>();
  const sessionNames = new Set<string>();

  for (const line of logLines) {
    try {
      const entry = JSON.parse(line) as {
        timestamp: number;
        action: { action: string; session?: string; title?: string };
        success: boolean;
      };
      if (entry.timestamp < cutoff) continue;
      if (entry.action.action === "wait") continue;
      recentCount++;
      if (entry.success) successes++;
      else failures++;
      actionTypes.set(entry.action.action, (actionTypes.get(entry.action.action) ?? 0) + 1);
      if (entry.action.session) sessionNames.add(entry.action.session);
      if (entry.action.title) sessionNames.add(entry.action.title);
    } catch {
      // skip malformed lines
    }
  }

  if (recentCount === 0) return "No actions in the last hour.";

  const windowDesc = windowMs >= 3_600_000
    ? `${Math.round(windowMs / 3_600_000)} hour${windowMs >= 7_200_000 ? "s" : ""}`
    : `${Math.round(windowMs / 60_000)} minutes`;

  const parts: string[] = [];
  parts.push(`${recentCount} action${recentCount !== 1 ? "s" : ""} in the last ${windowDesc}`);
  if (failures > 0) parts.push(`${failures} failed`);
  if (sessionNames.size > 0 && sessionNames.size <= 4) {
    parts.push(`across ${[...sessionNames].join(", ")}`);
  }

  return `Recent activity: ${parts.join(", ")}.`;
}

/**
 * Translate raw shell error output into a friendlier human-readable message.
 * Pure function: takes stderr text, returns a plain-English explanation.
 */
export function friendlyError(stderr: string): string {
  const s = stderr.trim();
  if (!s) return "Unknown error (no details)";

  // common patterns
  if (/command not found/i.test(s)) {
    const cmd = s.match(/(?:(?:bash|sh|zsh): )?(.+?):\s*command not found/i)?.[1]?.trim();
    return cmd ? `"${cmd}" is not installed or not on your PATH.` : "A required command is not installed.";
  }
  if (/ECONNREFUSED/i.test(s)) {
    return "Connection refused — is the server running?";
  }
  if (/ENOENT/i.test(s)) {
    const path = s.match(/ENOENT[^']*'([^']+)'/)?.[1];
    return path ? `File or directory not found: ${path}` : "A file or directory was not found.";
  }
  if (/EACCES|permission denied/i.test(s)) {
    return "Permission denied — check file permissions or run with appropriate access.";
  }
  if (/ETIMEDOUT|timed?\s*out/i.test(s)) {
    return "The operation timed out — try again or check the network.";
  }
  if (/401|unauthorized/i.test(s)) {
    return "Authentication failed — check your credentials or run the auth login command.";
  }
  if (/403|forbidden/i.test(s)) {
    return "Access forbidden — you may not have permission for this resource.";
  }
  if (/404|not found/i.test(s) && !/ENOENT/.test(s)) {
    return "Resource not found — check the URL or identifier.";
  }
  if (/no such session/i.test(s)) {
    return "That session doesn't exist — it may have been removed or never created.";
  }
  if (/can't establish/i.test(s) || /connection reset/i.test(s)) {
    return "Network error — check your connection.";
  }
  if (/rate limit/i.test(s) || /429/i.test(s)) {
    return "Rate limited — too many requests, waiting before retry.";
  }
  if (/ENOMEM|out of memory/i.test(s)) {
    return "Out of memory — try closing other applications.";
  }

  // fallback: return first line, trimmed
  const firstLine = s.split("\n")[0].trim();
  return firstLine.length > 120 ? firstLine.slice(0, 117) + "..." : firstLine;
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
