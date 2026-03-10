// console.ts -- manages conversation log and user input IPC for the reasoner
// supports two modes:
// 1. standalone tmux session (aoaoe_reasoner) -- legacy fallback when not registered as AoE session
// 2. file-only mode -- when chat.ts runs inside an AoE-managed tmux pane, we just read/write files
import { mkdirSync, appendFileSync, readFileSync, writeFileSync, existsSync, renameSync, unlinkSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { execQuiet, exec } from "./shell.js";

const AOAOE_DIR = join(homedir(), ".aoaoe");
const CONVO_LOG = join(AOAOE_DIR, "conversation.log");
const INPUT_FILE = join(AOAOE_DIR, "pending-input.txt");
const PID_FILE = join(AOAOE_DIR, "chat.pid");
const SESSION_NAME = "aoaoe_reasoner";

export class ReasonerConsole {
  private started = false;
  private ownsTmux = false; // true if we created the aoaoe_reasoner tmux session

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

    // if chat.ts is running in an AoE pane, skip creating our own tmux session
    if (this.chatIsRunning()) {
      this.started = true;
      this.writeSystem("aoaoe daemon connected (chat running in AoE session)");
      this.writeSystem("---");
      return;
    }

    // fallback: create standalone tmux session
    await execQuiet("tmux", ["kill-session", "-t", SESSION_NAME]);

    await exec("tmux", [
      "new-session", "-d", "-s", SESSION_NAME, "-x", "200", "-y", "50",
      `tail -f ${CONVO_LOG}`,
    ]);

    // write the input-loop script BEFORE starting the tmux pane that uses it
    // to avoid a race where bash tries to read the script before it exists
    writeFileSync(join(AOAOE_DIR, "input-loop.sh"), INPUT_LOOP_SCRIPT);

    await exec("tmux", [
      "split-window", "-t", SESSION_NAME, "-v", "-l", "4",
      `bash ${join(AOAOE_DIR, "input-loop.sh")}`,
    ]);

    await execQuiet("tmux", ["select-pane", "-t", `${SESSION_NAME}:.0`]);
    await execQuiet("tmux", [
      "set-option", "-t", SESSION_NAME, "pane-border-format",
      " #{?pane_active,#[fg=green],#[fg=white]}#{pane_title} ",
    ]);
    await execQuiet("tmux", ["select-pane", "-t", `${SESSION_NAME}:.0`, "-T", "conversation"]);
    await execQuiet("tmux", ["select-pane", "-t", `${SESSION_NAME}:.1`, "-T", "input (type here)"]);
    await execQuiet("tmux", ["select-pane", "-t", `${SESSION_NAME}:.1`]);

    this.ownsTmux = true;
    this.started = true;
    this.writeSystem("aoaoe reasoner console started");
    this.writeSystem("type a message below to send to the reasoner");
    this.writeSystem("detach with Ctrl+B D to return to your shell");
    this.writeSystem("---");
  }

  // write a formatted entry to the conversation log
  writeObservation(sessionCount: number, changeCount: number, changes: string[]): void {
    const ts = this.ts();
    this.append(`\n${ts} [observation] ${sessionCount} sessions, ${changeCount} changed`);
    for (const c of changes) {
      this.append(`  ${c}`);
    }
  }

  writeUserMessage(msg: string): void {
    this.append(`\n${this.ts()} [you] ${msg}`);
  }

  writeReasoning(reasoning: string): void {
    this.append(`${this.ts()} [reasoner] ${reasoning}`);
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
    if (this.started && this.ownsTmux) {
      await execQuiet("tmux", ["kill-session", "-t", SESSION_NAME]);
    }
    this.started = false;
  }

  private append(line: string): void {
    try {
      appendFileSync(CONVO_LOG, line + "\n");
    } catch {}
  }

  private ts(): string {
    return new Date().toLocaleTimeString();
  }

  static sessionName(): string {
    return SESSION_NAME;
  }
}

// shell script that runs in the bottom tmux pane -- simple input loop
const INPUT_LOOP_SCRIPT = `#!/usr/bin/env bash
INPUT_FILE='${INPUT_FILE}'
touch "$INPUT_FILE"

# colors
GREEN="\\033[32m"
RESET="\\033[0m"
DIM="\\033[2m"

while true; do
  printf "\${GREEN}>\${RESET} "
  read -r msg
  if [ -n "$msg" ]; then
    echo "$msg" >> "$INPUT_FILE"
    printf "\${DIM}queued for next reasoning cycle\${RESET}\\n"
  fi
done
`;
