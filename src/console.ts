// console.ts -- manages the aoaoe_reasoner tmux session
// two-pane layout: top shows conversation, bottom accepts user input
// "aoaoe attach" drops you into this session, Ctrl+B D to detach
import { mkdirSync, appendFileSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { execQuiet, exec } from "./shell.js";

const AOAOE_DIR = join(homedir(), ".aoaoe");
const CONVO_LOG = join(AOAOE_DIR, "conversation.log");
const INPUT_FILE = join(AOAOE_DIR, "pending-input.txt");
const SESSION_NAME = "aoaoe_reasoner";

export class ReasonerConsole {
  private started = false;

  async start(): Promise<void> {
    mkdirSync(AOAOE_DIR, { recursive: true });

    // clear previous conversation log (fresh session)
    writeFileSync(CONVO_LOG, "");
    writeFileSync(INPUT_FILE, "");

    // kill any stale session
    await execQuiet("tmux", ["kill-session", "-t", SESSION_NAME]);

    // create the session with the conversation viewer in the top pane
    // using ANSI colors for a nice look
    await exec("tmux", [
      "new-session", "-d", "-s", SESSION_NAME, "-x", "200", "-y", "50",
      `tail -f ${CONVO_LOG}`,
    ]);

    // split bottom pane for user input
    await exec("tmux", [
      "split-window", "-t", SESSION_NAME, "-v", "-l", "4",
      `bash ${join(AOAOE_DIR, "input-loop.sh")}`,
    ]);

    // write the input loop script
    writeFileSync(join(AOAOE_DIR, "input-loop.sh"), INPUT_LOOP_SCRIPT);

    // select top pane by default (so user sees conversation first)
    await execQuiet("tmux", ["select-pane", "-t", `${SESSION_NAME}:.0`]);

    // style: set pane border labels
    await execQuiet("tmux", [
      "set-option", "-t", SESSION_NAME, "pane-border-format",
      " #{?pane_active,#[fg=green],#[fg=white]}#{pane_title} ",
    ]);
    await execQuiet("tmux", ["select-pane", "-t", `${SESSION_NAME}:.0`, "-T", "conversation"]);
    await execQuiet("tmux", ["select-pane", "-t", `${SESSION_NAME}:.1`, "-T", "input (type here)"]);

    // focus the input pane so user can type immediately on attach
    await execQuiet("tmux", ["select-pane", "-t", `${SESSION_NAME}:.1`]);

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

  // read and clear pending user input from the input pane
  drainInput(): string[] {
    if (!existsSync(INPUT_FILE)) return [];

    const content = readFileSync(INPUT_FILE, "utf-8").trim();
    if (!content) return [];

    // clear the file
    writeFileSync(INPUT_FILE, "");

    return content.split("\n").filter((l) => l.trim());
  }

  async stop(): Promise<void> {
    if (this.started) {
      await execQuiet("tmux", ["kill-session", "-t", SESSION_NAME]);
      this.started = false;
    }
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
INPUT_FILE="${INPUT_FILE}"
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
