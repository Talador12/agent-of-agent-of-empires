#!/usr/bin/env node
// chat.ts -- standalone interactive chat that runs inside an AoE-managed tmux pane
// this is the program that --cmd_override points to when aoaoe registers itself as an AoE session.
// it reads conversation.log for history display, writes user input to pending-input.txt,
// and the daemon picks it up on the next poll cycle.
//
// features:
// - live countdown to next reasoning cycle (reads daemon-state.json every 1s)
// - per-pane task display (/tasks command)
// - ESC-ESC to interrupt the current reasoner (like OpenCode)
import { createInterface, emitKeypressEvents } from "node:readline";
import { appendFileSync, writeFileSync, existsSync, mkdirSync, watchFile, unwatchFile, readFileSync, statSync, openSync, readSync, closeSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { readState, requestInterrupt } from "./daemon-state.js";
import type { DaemonState } from "./types.js";

const AOAOE_DIR = join(homedir(), ".aoaoe");
const CONVO_LOG = join(AOAOE_DIR, "conversation.log");
const INPUT_FILE = join(AOAOE_DIR, "pending-input.txt");
const PID_FILE = join(AOAOE_DIR, "chat.pid");

// ANSI helpers
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const GREEN = "\x1b[32m";
const CYAN = "\x1b[36m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const MAGENTA = "\x1b[35m";
const RESET = "\x1b[0m";
const SAVE_CURSOR = "\x1b7";
const RESTORE_CURSOR = "\x1b8";
const CLEAR_LINE = "\x1b[2K";

// ESC-ESC interrupt detection
let lastEscTime = 0;
const ESC_DOUBLE_TAP_MS = 500;

function main() {
  mkdirSync(AOAOE_DIR, { recursive: true });

  // write PID so daemon can detect we're running
  writeFileSync(PID_FILE, String(process.pid));

  // print banner
  console.log(`${BOLD}${CYAN}aoaoe reasoner chat${RESET}`);
  console.log(`${DIM}messages you type here are sent to the reasoner on the next poll cycle${RESET}`);
  console.log(`${DIM}the daemon writes observations and decisions to this view${RESET}`);
  console.log(`${DIM}type /help for commands, ESC ESC to interrupt reasoner, Ctrl+C to exit${RESET}`);
  console.log();

  // replay existing conversation log
  replayLog();

  // watch conversation.log for new content and stream it
  let lastSize = existsSync(CONVO_LOG) ? statSync(CONVO_LOG).size : 0;
  watchFile(CONVO_LOG, { interval: 500 }, (curr) => {
    if (curr.size > lastSize) {
      // read only new bytes
      const fd = openSync(CONVO_LOG, "r");
      const buf = Buffer.alloc(curr.size - lastSize);
      readSync(fd, buf, 0, buf.length, lastSize);
      closeSync(fd);
      const newText = buf.toString("utf-8");
      // move cursor to start of line, clear it, print new content, then re-show prompt
      process.stdout.write(`\r\x1b[K${colorize(newText)}`);
      rl.prompt(true);
      lastSize = curr.size;
    }
  });

  // set up keypress events for ESC-ESC detection
  if (process.stdin.isTTY) {
    emitKeypressEvents(process.stdin);
    process.stdin.on("keypress", (_ch: string | undefined, key: { name?: string; sequence?: string }) => {
      if (key?.name === "escape" || key?.sequence === "\x1b") {
        const now = Date.now();
        if (now - lastEscTime < ESC_DOUBLE_TAP_MS) {
          // double-ESC detected -- interrupt the reasoner
          handleInterrupt();
          lastEscTime = 0;
        } else {
          lastEscTime = now;
        }
      } else {
        // any other key resets the ESC timer
        lastEscTime = 0;
      }
    });
  }

  // interactive readline
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: `${GREEN}>${RESET} `,
    terminal: true,
  });

  rl.prompt();

  // live status bar -- update every second
  const statusInterval = setInterval(() => {
    renderStatusBar(rl);
  }, 1000);

  rl.on("line", (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) {
      rl.prompt();
      return;
    }

    // handle local commands
    if (trimmed === "/help") {
      printHelp();
      rl.prompt();
      return;
    }
    if (trimmed === "/status") {
      appendToInput("__CMD_STATUS__");
      console.log(`${DIM}status requested${RESET}`);
      rl.prompt();
      return;
    }
    if (trimmed === "/dashboard") {
      appendToInput("__CMD_DASHBOARD__");
      console.log(`${DIM}dashboard requested${RESET}`);
      rl.prompt();
      return;
    }
    if (trimmed === "/tasks") {
      printTasks();
      rl.prompt();
      return;
    }
    if (trimmed === "/verbose") {
      appendToInput("__CMD_VERBOSE__");
      console.log(`${DIM}verbose toggled${RESET}`);
      rl.prompt();
      return;
    }
    if (trimmed === "/pause") {
      appendToInput("__CMD_PAUSE__");
      console.log(`${DIM}pause requested${RESET}`);
      rl.prompt();
      return;
    }
    if (trimmed === "/resume") {
      appendToInput("__CMD_RESUME__");
      console.log(`${DIM}resume requested${RESET}`);
      rl.prompt();
      return;
    }
    if (trimmed === "/interrupt") {
      handleInterrupt();
      rl.prompt();
      return;
    }
    if (trimmed === "/clear") {
      process.stdout.write("\x1b[2J\x1b[H");
      rl.prompt();
      return;
    }

    // regular message -- queue for reasoner
    appendToInput(trimmed);
    console.log(`${DIM}queued for next reasoning cycle${RESET}`);
    rl.prompt();
  });

  rl.on("close", () => {
    clearInterval(statusInterval);
    cleanup();
    process.exit(0);
  });

  process.on("SIGINT", () => {
    clearInterval(statusInterval);
    cleanup();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    clearInterval(statusInterval);
    cleanup();
    process.exit(0);
  });
}

function handleInterrupt() {
  const state = readState();
  if (state?.phase === "reasoning") {
    requestInterrupt();
    console.log(`${RED}${BOLD}interrupting reasoner...${RESET}`);
    console.log(`${DIM}type your message -- it will be sent before the next reasoning cycle${RESET}`);
  } else {
    console.log(`${DIM}no active reasoning to interrupt (phase: ${state?.phase ?? "unknown"})${RESET}`);
  }
}

// render a status bar showing countdown, phase, and session count
function renderStatusBar(rl: ReturnType<typeof createInterface>) {
  const state = readState();
  if (!state) return;

  const parts: string[] = [];

  // phase indicator
  const phaseIcons: Record<string, string> = {
    sleeping: "zzz",
    polling: "...",
    reasoning: "thinking",
    executing: "running",
    interrupted: "INTERRUPTED",
  };
  const phaseStr = phaseIcons[state.phase] ?? state.phase;

  // countdown to next tick
  if (state.phase === "sleeping" && state.nextTickAt) {
    const remaining = Math.max(0, Math.ceil((state.nextTickAt - Date.now()) / 1000));
    parts.push(`next cycle: ${remaining}s`);
  } else if (state.phase === "reasoning") {
    const elapsed = Math.floor((Date.now() - state.phaseStartedAt) / 1000);
    parts.push(`reasoning: ${elapsed}s`);
  } else {
    parts.push(phaseStr);
  }

  // session count
  parts.push(`${state.sessionCount} sessions`);
  if (state.paused) parts.push("PAUSED");
  parts.push(`poll #${state.pollCount}`);

  const statusLine = parts.join(" | ");

  // write status to terminal title (visible in tmux pane title)
  process.stdout.write(`\x1b]0;aoaoe: ${statusLine}\x07`);

  // also write a status line above the prompt using save/restore cursor
  // this overwrites the line above the current prompt
  process.stderr.write(
    `${SAVE_CURSOR}\x1b[s` + // save position
    `\x1b[1A` +              // move up one line
    `\r${CLEAR_LINE}` +      // clear that line
    `${DIM}[${statusLine}]${RESET}` +
    `\x1b[u${RESTORE_CURSOR}` // restore position
  );
}

function printTasks() {
  const state = readState();
  if (!state || state.sessions.length === 0) {
    console.log(`${DIM}no active sessions${RESET}`);
    return;
  }

  console.log(`\n${BOLD}session tasks:${RESET}`);
  for (const s of state.sessions) {
    const statusIcon = s.status === "working" ? "~" : s.status === "idle" ? "." : s.status === "error" ? "!" : "?";
    const task = s.currentTask ?? `${DIM}(no task assigned)${RESET}`;
    const activity = s.lastActivity
      ? `${DIM}last: ${s.lastActivity.slice(0, 60)}${RESET}`
      : "";
    console.log(`  ${statusIcon} ${BOLD}${s.title}${RESET} [${s.tool}] ${s.id.slice(0, 8)}`);
    console.log(`    task: ${task}`);
    if (activity) console.log(`    ${activity}`);
  }
  console.log();
}

function appendToInput(msg: string) {
  try {
    appendFileSync(INPUT_FILE, msg + "\n");
  } catch {
    // ignore write errors
  }
}

function replayLog() {
  if (!existsSync(CONVO_LOG)) return;
  try {
    const content = readFileSync(CONVO_LOG, "utf-8");
    if (content.trim()) {
      process.stdout.write(colorize(content));
      console.log(`${DIM}--- end of history ---${RESET}\n`);
    }
  } catch {
    // ignore read errors
  }
}

// colorize conversation log lines based on their tag
function colorize(text: string): string {
  return text.replace(/^(.*?\[)(observation|you|reasoner|action|\+ action|! action|system)(\].*$)/gm, (_, pre, tag, post) => {
    switch (tag) {
      case "observation": return `${DIM}${pre}${tag}${post}${RESET}`;
      case "you": return `${GREEN}${pre}${tag}${post}${RESET}`;
      case "reasoner": return `${CYAN}${pre}${tag}${post}${RESET}`;
      case "+ action": return `${YELLOW}${pre}${tag}${post}${RESET}`;
      case "! action": return `${RED}${pre}${tag}${post}${RESET}`;
      case "system": return `${DIM}${pre}${tag}${post}${RESET}`;
      default: return `${pre}${tag}${post}`;
    }
  });
}

function printHelp() {
  console.log(`
${BOLD}commands:${RESET}
  /help       show this help
  /status     request daemon status
  /dashboard  request dashboard output
  /tasks      show per-session task assignments
  /verbose    toggle verbose logging
  /pause      pause the daemon
  /resume     resume the daemon
  /interrupt  interrupt the current reasoner call
  /clear      clear the screen

${BOLD}shortcuts:${RESET}
  ESC ESC     interrupt the current reasoner (same as /interrupt)

${BOLD}anything else${RESET} is sent to the reasoner as an operator message
`);
}

function cleanup() {
  unwatchFile(CONVO_LOG);
  try {
    // only remove PID file if it's still ours
    if (existsSync(PID_FILE) && readFileSync(PID_FILE, "utf-8").trim() === String(process.pid)) {
      unlinkSync(PID_FILE);
    }
  } catch {
    // ignore
  }
}

main();
