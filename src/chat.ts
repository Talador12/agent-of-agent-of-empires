#!/usr/bin/env node
// chat.ts -- standalone interactive chat that runs inside an AoE-managed tmux pane
// this is the program that --cmd_override points to when aoaoe registers itself as an AoE session.
// it reads conversation.log for history display, writes user input to pending-input.txt,
// and the daemon picks it up on the next poll cycle.
import { createInterface } from "node:readline";
import { appendFileSync, writeFileSync, existsSync, mkdirSync, watchFile, unwatchFile, readFileSync, statSync, openSync, readSync, closeSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

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
const RESET = "\x1b[0m";

function main() {
  mkdirSync(AOAOE_DIR, { recursive: true });

  // write PID so daemon can detect we're running
  writeFileSync(PID_FILE, String(process.pid));

  // print banner
  console.log(`${BOLD}${CYAN}aoaoe reasoner chat${RESET}`);
  console.log(`${DIM}messages you type here are sent to the reasoner on the next poll cycle${RESET}`);
  console.log(`${DIM}the daemon writes observations and decisions to this view${RESET}`);
  console.log(`${DIM}type /help for commands, Ctrl+C to exit${RESET}`);
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

  // interactive readline
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: `${GREEN}>${RESET} `,
    terminal: true,
  });

  rl.prompt();

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
    cleanup();
    process.exit(0);
  });

  process.on("SIGINT", () => {
    cleanup();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    cleanup();
    process.exit(0);
  });
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
  /verbose    toggle verbose logging
  /pause      pause the daemon
  /resume     resume the daemon
  /clear      clear the screen

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
