#!/usr/bin/env node
// chat.ts -- interactive chat UI for the aoaoe reasoner
// runs inside an AoE-managed tmux pane (registered via `aoaoe register`).
// reads conversation.log for daemon output, writes user input to pending-input.txt.
//
// works standalone too: captures all AoE panes directly via tmux + aoe CLI
// to show /overview even when the daemon isn't running.
import { createInterface, emitKeypressEvents } from "node:readline";
import { appendFileSync, writeFileSync, existsSync, mkdirSync, watchFile, unwatchFile, readFileSync, statSync, openSync, readSync, closeSync, unlinkSync, watch, type FSWatcher } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { readState, requestInterrupt } from "./daemon-state.js";
import { parseTasks, parseModel, parseContext, parseCost, parseLastLine, formatTaskList } from "./task-parser.js";
import { listAoeSessionsShared, type BasicSessionInfo } from "./poller.js";
import { exec } from "./shell.js";
import type { DaemonState } from "./types.js";

const AOAOE_DIR = join(homedir(), ".aoaoe");
const CONVO_LOG = join(AOAOE_DIR, "conversation.log");
const INPUT_FILE = join(AOAOE_DIR, "pending-input.txt");
const PID_FILE = join(AOAOE_DIR, "chat.pid");

// ANSI
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const GREEN = "\x1b[32m";
const CYAN = "\x1b[36m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const MAGENTA = "\x1b[35m";
const RESET = "\x1b[0m";

// ESC-ESC interrupt detection
let lastEscTime = 0;
const ESC_DOUBLE_TAP_MS = 500;

// track last displayed status to avoid spamming
let lastStatusLine = "";

// log file watcher (hoisted so cleanup() can close it)
let logWatcher: FSWatcher | null = null;

function main() {
  mkdirSync(AOAOE_DIR, { recursive: true });
  writeFileSync(PID_FILE, String(process.pid));

  // banner
  console.log(`${BOLD}${CYAN}aoaoe reasoner chat${RESET}`);
  console.log(`${DIM}type /help for commands, ESC ESC to interrupt reasoner, Ctrl+C to exit${RESET}`);

  // daemon check on startup
  checkDaemon();
  console.log();

  // replay conversation history
  replayLog();

  // watch conversation.log for new daemon output using fs.watch (inotify/kqueue)
  // falls back to watchFile polling if fs.watch isn't available
  let lastSize = existsSync(CONVO_LOG) ? statSync(CONVO_LOG).size : 0;

  const onLogChange = () => {
    try {
      const currSize = statSync(CONVO_LOG).size;
      if (currSize > lastSize) {
        const fd = openSync(CONVO_LOG, "r");
        const buf = Buffer.alloc(currSize - lastSize);
        readSync(fd, buf, 0, buf.length, lastSize);
        closeSync(fd);
        const newText = buf.toString("utf-8");
        process.stdout.write(`\r\x1b[K${colorize(newText)}`);
        rl.prompt(true);
        lastSize = currSize;
      }
    } catch {
      // file may be truncated or removed — reset so we pick up from start of new file
      lastSize = 0;
    }
  };

  try {
    logWatcher = watch(CONVO_LOG, onLogChange);
  } catch {
    // fs.watch not available on this platform — fall back to polling
    watchFile(CONVO_LOG, { interval: 500 }, onLogChange);
  }

  // ESC-ESC detection
  if (process.stdin.isTTY) {
    emitKeypressEvents(process.stdin);
    process.stdin.on("keypress", (_ch: string | undefined, key: { name?: string; sequence?: string }) => {
      if (key?.name === "escape" || key?.sequence === "\x1b") {
        const now = Date.now();
        if (now - lastEscTime < ESC_DOUBLE_TAP_MS) {
          handleInterrupt(rl);
          lastEscTime = 0;
        } else {
          lastEscTime = now;
        }
      } else {
        lastEscTime = 0;
      }
    });
  }

  // readline
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: `${GREEN}>${RESET} `,
    terminal: true,
  });
  rl.prompt();

  // status ticker -- print a status line every 5s, only if it changed
  const statusInterval = setInterval(() => {
    const line = buildStatusLine();
    if (line && line !== lastStatusLine) {
      process.stdout.write(`\r\x1b[K${DIM}${line}${RESET}\n`);
      lastStatusLine = line;
      rl.prompt(true);
    }
    // also set tmux pane title
    const titleLine = buildStatusLine(true);
    if (titleLine) process.stdout.write(`\x1b]2;${titleLine}\x07`);
  }, 5000);

  rl.on("line", async (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) { rl.prompt(); return; }

    // slash commands
    if (trimmed.startsWith("/")) {
      await handleCommand(trimmed, rl);
      rl.prompt();
      return;
    }

    // regular message -> queue for reasoner
    appendToInput(trimmed);
    const eta = getCountdown();
    if (eta !== null) {
      console.log(`${DIM}queued -- reasoner will read this in ~${eta}s${RESET}`);
    } else if (isDaemonRunning()) {
      console.log(`${DIM}queued -- waiting for next reasoning cycle${RESET}`);
    } else {
      console.log(`${YELLOW}queued, but daemon is not running!${RESET}`);
      console.log(`${DIM}start it with: aoaoe${RESET}`);
    }
    rl.prompt();
  });

  rl.on("close", () => { clearInterval(statusInterval); cleanup(); process.exit(0); });
  process.on("SIGINT", () => { clearInterval(statusInterval); cleanup(); process.exit(0); });
  process.on("SIGTERM", () => { clearInterval(statusInterval); cleanup(); process.exit(0); });
}

// --- commands ---

async function handleCommand(cmd: string, rl: ReturnType<typeof createInterface>) {
  const parts = cmd.split(/\s+/);
  switch (parts[0]) {
    case "/help": printHelp(); break;
    case "/overview": await printOverview(); break;
    case "/tasks": await printOverview(); break; // alias
    case "/status": printStatus(); break;
    case "/dashboard":
      appendToInput("__CMD_DASHBOARD__");
      console.log(`${DIM}dashboard requested${RESET}`);
      break;
    case "/verbose":
      appendToInput("__CMD_VERBOSE__");
      console.log(`${DIM}verbose toggled${RESET}`);
      break;
    case "/pause":
      appendToInput("__CMD_PAUSE__");
      console.log(`${DIM}pause requested${RESET}`);
      break;
    case "/resume":
      appendToInput("__CMD_RESUME__");
      console.log(`${DIM}resume requested${RESET}`);
      break;
    case "/interrupt":
      handleInterrupt(rl);
      break;
    case "/clear":
      process.stdout.write("\x1b[2J\x1b[H");
      break;
    default:
      console.log(`${DIM}unknown command: ${parts[0]} (try /help)${RESET}`);
  }
}

// --- interrupt ---

function handleInterrupt(rl: ReturnType<typeof createInterface>) {
  const state = readState();
  if (state?.phase === "reasoning") {
    requestInterrupt();
    console.log(`\n${RED}${BOLD}>>> interrupting reasoner <<<${RESET}`);
    console.log(`${YELLOW}type your message now -- it will be sent before the next cycle resumes${RESET}`);
    rl.prompt(true);
  } else if (!isDaemonRunning()) {
    console.log(`${YELLOW}daemon is not running -- nothing to interrupt${RESET}`);
    console.log(`${DIM}start it with: aoaoe${RESET}`);
  } else {
    console.log(`${DIM}reasoner not active right now (phase: ${state?.phase ?? "sleeping"})${RESET}`);
    const eta = getCountdown();
    if (eta !== null) console.log(`${DIM}next cycle in ~${eta}s -- type your message, it will be included${RESET}`);
  }
}

// --- /overview: capture all panes directly via tmux + aoe, parse tasks ---

async function printOverview() {
  console.log(`\n${BOLD}${CYAN}=== aoaoe overview ===${RESET}`);

  // daemon status
  const state = readState();
  const daemonUp = isDaemonRunning();
  if (daemonUp) {
    const eta = getCountdown();
    const phaseStr = state?.phase === "reasoning" ? `${YELLOW}reasoning${RESET}`
      : state?.phase === "executing" ? `${GREEN}executing${RESET}`
      : state?.phase === "interrupted" ? `${RED}INTERRUPTED${RESET}`
      : state?.phase ?? "sleeping";
    console.log(`  daemon: ${GREEN}running${RESET} | phase: ${phaseStr} | poll #${state?.pollCount ?? "?"}${eta !== null ? ` | next cycle: ${eta}s` : ""}`);
  } else {
    console.log(`  daemon: ${RED}not running${RESET} ${DIM}(start with: aoaoe)${RESET}`);
  }
  console.log();

  // list all AoE sessions by calling aoe CLI directly (async)
  const sessions = await listAoeSessions();
  if (sessions.length === 0) {
    console.log(`  ${DIM}no AoE sessions found${RESET}`);
    console.log();
    return;
  }

  for (const s of sessions) {
    // capture tmux pane output (async)
    const output = await captureTmuxPane(s.tmuxName);
    if (!output) {
      const statusIcon = `${RED}x${RESET}`;
      console.log(`${statusIcon} ${BOLD}${s.title}${RESET} ${DIM}[${s.tool}]${RESET} ${DIM}(tmux pane not found)${RESET}`);
      console.log();
      continue;
    }

    // parse tasks and metadata
    const tasks = parseTasks(output);
    const model = parseModel(output);
    const context = parseContext(output);
    const cost = parseCost(output);
    const lastLine = parseLastLine(output);

    // status icon
    const statusIcon = s.status === "working" ? `${GREEN}~${RESET}`
      : s.status === "idle" ? `${DIM}.${RESET}`
      : s.status === "error" ? `${RED}!${RESET}`
      : `${YELLOW}?${RESET}`;

    // header
    const meta: string[] = [];
    if (model) meta.push(model);
    if (context) meta.push(context);
    if (cost) meta.push(cost);
    const metaStr = meta.length > 0 ? `${DIM}(${meta.join(" | ")})${RESET}` : "";

    console.log(`${statusIcon} ${BOLD}${s.title}${RESET} ${DIM}[${s.tool}]${RESET} ${metaStr}`);

    // tasks
    if (tasks.length > 0) {
      for (const t of tasks) {
        const icon = t.status === "done" ? `${GREEN}✓${RESET}`
          : t.status === "in_progress" ? `${YELLOW}•${RESET}`
          : t.status === "failed" ? `${RED}✗${RESET}`
          : `${DIM}○${RESET}`;
        console.log(`    [${icon}] ${t.text}`);
      }
    } else {
      console.log(`    ${DIM}(no task list detected)${RESET}`);
    }

    // last activity
    console.log(`    ${DIM}> ${lastLine}${RESET}`);
    console.log();
  }
}

// --- /status: quick daemon status ---

function printStatus() {
  const state = readState();
  if (!isDaemonRunning()) {
    console.log(`${YELLOW}daemon is not running${RESET}`);
    console.log(`${DIM}start it with: aoaoe${RESET}`);
    return;
  }

  const eta = getCountdown();
  console.log(`${BOLD}daemon status:${RESET}`);
  console.log(`  phase: ${state?.phase ?? "?"}`);
  console.log(`  poll #${state?.pollCount ?? "?"}`);
  console.log(`  sessions: ${state?.sessionCount ?? "?"}`);
  console.log(`  interval: ${state?.pollIntervalMs ?? "?"}ms`);
  if (eta !== null) console.log(`  next cycle: ${eta}s`);
  if (state?.paused) console.log(`  ${YELLOW}PAUSED${RESET}`);
}

// --- AoE session capture (works without daemon) ---

// use shared session listing from poller.ts, then filter out ourselves
async function listAoeSessions(): Promise<BasicSessionInfo[]> {
  const sessions = await listAoeSessionsShared();
  return sessions.filter((s) => s.title !== "aoaoe");
}

async function captureTmuxPane(tmuxName: string): Promise<string | null> {
  try {
    const result = await exec("tmux", ["capture-pane", "-t", tmuxName, "-p", "-S", "-100"], 5_000);
    return result.exitCode === 0 ? result.stdout : null;
  } catch {
    return null;
  }
}

// --- daemon connection check ---

function isDaemonRunning(): boolean {
  return isDaemonRunningFromState(readState());
}

function getCountdown(): number | null {
  const state = readState();
  return getCountdownFromState(state, isDaemonRunningFromState(state));
}

// pure logic extracted for testing — accepts state + current time
export function isDaemonRunningFromState(state: DaemonState | null, now = Date.now()): boolean {
  if (!state) return false;
  // state file exists -- check if it's recent.
  // reasoning phase can take up to 90s+ (LLM call), so the stale threshold
  // must account for that, not just 2x poll interval.
  // use 2x poll interval as a minimum, but at least 120s to cover long reasoning calls.
  const staleMs = Math.max(state.pollIntervalMs * 2, 120_000);
  const age = now - state.phaseStartedAt;
  return age < staleMs;
}

export function getCountdownFromState(state: DaemonState | null, daemonRunning: boolean, now = Date.now()): number | null {
  if (!state || !daemonRunning) return null;
  if (state.phase === "sleeping" && state.nextTickAt) {
    const remaining = Math.max(0, Math.ceil((state.nextTickAt - now) / 1000));
    return remaining;
  }
  return null;
}

function checkDaemon() {
  if (isDaemonRunning()) {
    const state = readState()!;
    const eta = getCountdown();
    console.log(`${GREEN}daemon connected${RESET} ${DIM}(${state.sessionCount} sessions, poll #${state.pollCount})${RESET}`);
    if (eta !== null) console.log(`${DIM}next reasoning cycle in ${eta}s${RESET}`);
  } else {
    console.log(`${YELLOW}daemon not detected${RESET} ${DIM}-- start it with: aoaoe${RESET}`);
    console.log(`${DIM}/overview still works (captures panes directly)${RESET}`);
  }
}

// --- status line (printed periodically, only when changed) ---

function buildStatusLine(forTitle = false): string | null {
  const state = readState();
  return buildStatusLineFromState(state, isDaemonRunningFromState(state), forTitle);
}

// pure logic extracted for testing
export function buildStatusLineFromState(state: DaemonState | null, daemonRunning: boolean, forTitle = false, now = Date.now()): string | null {
  if (!state || !daemonRunning) return forTitle ? "aoaoe (daemon offline)" : null;

  const parts: string[] = [];
  if (state.phase === "sleeping" && state.nextTickAt) {
    const remaining = Math.max(0, Math.ceil((state.nextTickAt - now) / 1000));
    parts.push(`next: ${remaining}s`);
  } else if (state.phase === "reasoning") {
    const elapsed = Math.floor((now - state.phaseStartedAt) / 1000);
    parts.push(`reasoning: ${elapsed}s`);
  } else {
    parts.push(state.phase);
  }
  parts.push(`${state.sessionCount} sessions`);
  parts.push(`poll #${state.pollCount}`);
  if (state.paused) parts.push("PAUSED");
  return parts.join(" | ");
}

// --- helpers ---

function appendToInput(msg: string) {
  try { appendFileSync(INPUT_FILE, msg + "\n"); } catch {}
}

function replayLog() {
  if (!existsSync(CONVO_LOG)) return;
  try {
    const content = readFileSync(CONVO_LOG, "utf-8");
    if (content.trim()) {
      process.stdout.write(colorize(content));
      console.log(`${DIM}--- end of history ---${RESET}\n`);
    }
  } catch {}
}

export function colorize(text: string): string {
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
  /overview    show all AoE sessions with tasks and status (works without daemon)
  /tasks       alias for /overview
  /status      daemon connection status + countdown
  /dashboard   request full dashboard from daemon
  /interrupt   interrupt the current reasoner call
  /verbose     toggle verbose logging
  /pause       pause the daemon
  /resume      resume the daemon
  /clear       clear the screen
  /help        show this help

${BOLD}shortcuts:${RESET}
  ESC ESC      interrupt the current reasoner (same as /interrupt)

${BOLD}anything else${RESET} is sent to the reasoner as an operator message
`);
}

function cleanup() {
  if (logWatcher) {
    logWatcher.close();
    logWatcher = null;
  } else {
    unwatchFile(CONVO_LOG);
  }
  try {
    if (existsSync(PID_FILE) && readFileSync(PID_FILE, "utf-8").trim() === String(process.pid)) {
      unlinkSync(PID_FILE);
    }
  } catch {}
}

// only run when executed as entry point (not when imported for testing)
const isEntryPoint = process.argv[1]?.endsWith("chat.js") || process.argv[1]?.endsWith("chat.ts");
if (isEntryPoint) {
  main();
}
