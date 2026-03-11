#!/usr/bin/env node
import { loadConfig, validateEnvironment, parseCliArgs, printHelp, configFileExists } from "./config.js";
import { Poller } from "./poller.js";
import { createReasoner } from "./reasoner/index.js";
import { Executor } from "./executor.js";
import { printDashboard } from "./dashboard.js";
import { InputReader } from "./input.js";
import { ReasonerConsole } from "./console.js";
import { writeState, buildSessionStates, checkInterrupt, clearInterrupt, cleanupState } from "./daemon-state.js";
import { formatSessionSummaries, formatActionDetail } from "./console.js";
import { type SessionPolicyState } from "./reasoner/prompt.js";
import { loadGlobalContext } from "./context.js";
import { tick as loopTick } from "./loop.js";
import { sleep } from "./shell.js";
import { wakeableSleep } from "./wake.js";
import { classifyMessages, formatUserMessages, buildReceipts, shouldSkipSleep, hasPendingFile } from "./message.js";
import { TaskManager, loadTaskDefinitions, loadTaskState, formatTaskTable } from "./task-manager.js";
import type { AoaoeConfig, Observation, ReasonerResult, TaskState } from "./types.js";
import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const AOAOE_DIR = join(homedir(), ".aoaoe"); // watch dir for wakeable sleep
const INPUT_FILE = join(AOAOE_DIR, "pending-input.txt"); // file IPC from chat.ts

async function main() {
  const { overrides, help, version, attach, register, testContext: isTestContext, runTest, showTasks, runInit, initForce, registerTitle } = parseCliArgs(process.argv);

  if (help) {
    printHelp();
    process.exit(0);
  }

  if (version) {
    try {
      const pkg = JSON.parse(readFileSync(resolve(__dirname, "..", "package.json"), "utf-8"));
      console.log(`aoaoe ${pkg.version}`);
    } catch {
      console.log("aoaoe (version unknown)");
    }
    process.exit(0);
  }

  // `aoaoe attach` -- drop into the reasoner console tmux session
  if (attach) {
    await attachToConsole();
    return;
  }

  // `aoaoe register` -- register aoaoe as an AoE session
  if (register) {
    await registerAsAoeSession(registerTitle);
    return;
  }

  // `aoaoe test-context` -- safe read-only scan of sessions + context discovery
  if (isTestContext) {
    await testContext();
    return;
  }

  // `aoaoe test` -- run the integration test (create sessions, test, clean up)
  if (runTest) {
    await runIntegrationTest();
    return;
  }

  // `aoaoe tasks` -- show current task state
  if (showTasks) {
    await showTaskStatus();
    return;
  }

  // `aoaoe init` -- auto-discover environment and generate config
  if (runInit) {
    const { runInit: doInit } = await import("./init.js");
    await doInit(initForce);
    return;
  }

  // auto-init: if no config file exists, run init automatically
  if (!configFileExists()) {
    console.error("");
    console.error("  no aoaoe.config.json found — running auto-init...");
    console.error("");
    const { runInit } = await import("./init.js");
    await runInit(false);
    // if init still didn't create a config (e.g. no aoe sessions), warn but continue with defaults
    if (!configFileExists()) {
      console.error("");
      console.error("  init completed but no config was written (no sessions found?)");
      console.error("  continuing with defaults...");
      console.error("");
    }
  }

  const config = loadConfig(overrides);

  // startup banner
  const pkg = readPkgVersion();
  console.error("");
  console.error("  aoaoe" + (pkg ? ` v${pkg}` : "") + "  —  autonomous supervisor");
  console.error(`  reasoner: ${config.reasoner}  |  poll: ${config.pollIntervalMs / 1000}s`);
  if (config.dryRun) console.error("  ** DRY RUN — will observe and reason but not execute **");
  console.error("");

  // validate tools are installed
  await validateEnvironment(config);

  // auto-start opencode serve if not running (opencode backend only)
  if (config.reasoner === "opencode") {
    const { ensureOpencodeServe } = await import("./init.js");
    const serverReady = await ensureOpencodeServe(config.opencode.port);
    if (!serverReady) {
      console.error("  opencode serve failed to start — cannot reason without it");
      console.error(`  start manually: opencode serve --port ${config.opencode.port}`);
      process.exit(1);
    }
  }

  // load global context (AGENTS.md / claude.md from cwd or parent)
  const globalContext = loadGlobalContext();
  if (globalContext) {
    log("loaded global context (AGENTS.md / claude.md)");
  }

  // load tasks from aoaoe.tasks.json or config
  const basePath = process.cwd();
  const taskDefs = loadTaskDefinitions(basePath);
  let taskManager: TaskManager | undefined;

  if (taskDefs.length > 0) {
    taskManager = new TaskManager(basePath, taskDefs);
    console.error(`  tasks: ${taskDefs.length} defined`);
    for (const t of taskManager.tasks) {
      const icon = t.status === "active" ? "~" : t.status === "completed" ? "+" : ".";
      console.error(`    [${icon}] ${t.repo} — ${t.goal}`);
    }
    console.error("");

    // reconcile: create missing AoE sessions, start them
    log("reconciling task sessions...");
    const { created, linked } = await taskManager.reconcileSessions();
    if (created.length > 0) log(`created sessions: ${created.join(", ")}`);
    if (linked.length > 0) log(`linked existing sessions: ${linked.join(", ")}`);
  }

  const poller = new Poller(config);
  const reasoner = createReasoner(config, globalContext || undefined);
  const executor = new Executor(config);
  if (taskManager) executor.setTaskManager(taskManager);
  const input = new InputReader();
  const reasonerConsole = new ReasonerConsole();

  // init reasoner (starts opencode serve, verifies claude, etc)
  log("initializing reasoner...");
  await reasoner.init();
  log("reasoner ready");

  // start interactive input listener and conversation log
  input.start();
  await reasonerConsole.start();

  // graceful shutdown — wrap in .catch so unhandled rejections from
  // reasoner.shutdown() or reasonerConsole.stop() don't get swallowed
  let running = true;
  const shutdown = () => {
    if (!running) return;
    running = false;
    log("shutting down...");
    input.stop();
    Promise.resolve()
      .then(() => reasonerConsole.stop())
      .then(() => reasoner.shutdown())
      .catch((err) => console.error(`[shutdown] error during cleanup: ${err}`))
      .finally(() => {
        cleanupState();
        process.exit(0);
      });
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // main loop
  let pollCount = 0;
  let forceDashboard = false;
  let paused = false; // can be set by /pause from stdin or chat.ts
  const policyStates = new Map<string, SessionPolicyState>(); // per-session idle/error tracking
  log("entering main loop (Ctrl+C to stop)\n");

  // clear any stale interrupt from a previous run
  clearInterrupt();

  while (running) {
    pollCount++;

    // drain user input from both stdin and console tmux session
    const stdinMessages = input.drain();
    const consoleMessages = reasonerConsole.drainInput();
    const allMessages = [...stdinMessages, ...consoleMessages];

    // classify into commands vs. real user messages
    const { commands, userMessages } = classifyMessages(allMessages);

    // acknowledge receipt of user messages in the conversation log
    const receipts = buildReceipts(userMessages);
    for (const receipt of receipts) {
      reasonerConsole.writeStatus(receipt);
    }

    // format user messages for the reasoner prompt
    const userMessage = userMessages.length > 0 ? formatUserMessages(userMessages) : undefined;

    // handle built-in command markers (from stdin or chat.ts file IPC)
    for (const cmd of commands) {
      if (cmd === "__CMD_STATUS__") {
        const isPausedNow = paused || input.isPaused();
        log(`status: poll #${pollCount}, reasoner=${config.reasoner}, paused=${isPausedNow}, dry-run=${config.dryRun}`);
        reasonerConsole.writeSystem(`status: poll #${pollCount}, reasoner=${config.reasoner}, paused=${isPausedNow}, dry-run=${config.dryRun}`);
      } else if (cmd === "__CMD_DASHBOARD__") {
        forceDashboard = true;
      } else if (cmd === "__CMD_VERBOSE__") {
        config.verbose = !config.verbose;
        log(`verbose: ${config.verbose ? "on" : "off"}`);
        reasonerConsole.writeSystem(`verbose: ${config.verbose ? "on" : "off"}`);
      } else if (cmd === "__CMD_PAUSE__") {
        paused = true;
        log("paused via console");
        reasonerConsole.writeSystem("paused -- reasoner will not be called until /resume");
      } else if (cmd === "__CMD_RESUME__") {
        paused = false;
        log("resumed via console");
        reasonerConsole.writeSystem("resumed");
      } else if (cmd === "__CMD_INTERRUPT__") {
        // interrupt is handled inside tick() via the flag file; clear it here if no tick is running
        log("interrupt requested (will take effect during next reasoning call)");
      }
    }

    // check pause from both stdin input and console commands
    const isPaused = paused || input.isPaused();
    if (isPaused) {
      if (pollCount % 6 === 1) log("paused (type /resume to continue)");
      writeState("sleeping", { paused: true, pollCount, pollIntervalMs: config.pollIntervalMs, nextTickAt: Date.now() + config.pollIntervalMs });
      await wakeableSleep(config.pollIntervalMs, AOAOE_DIR);
      continue;
    }

    try {
      const activeTaskContext = taskManager ? taskManager.tasks.filter((t) => t.status !== "completed") : undefined;
      const interrupted = await daemonTick(config, poller, reasoner, executor, reasonerConsole, pollCount, policyStates, userMessage, forceDashboard, activeTaskContext, taskManager);
      forceDashboard = false;

      // if the reasoner was interrupted, continue to next tick immediately.
      // wakeable sleep will pick up the user's follow-up message via fs.watch
      // instead of blocking for 60s in a busy-poll loop.
      if (interrupted) {
        writeState("interrupted", { pollCount, pollIntervalMs: config.pollIntervalMs });
        reasonerConsole.writeSystem("reasoner interrupted -- type a message and it will be picked up immediately");
        log("interrupted -- continuing to next tick (wakeable sleep will pick up input)");
        clearInterrupt();
      }
    } catch (err) {
      console.error(`[error] tick ${pollCount} failed: ${err}`);
    }

    // re-show input prompt after tick output
    input.prompt();

    if (running) {
      // skip sleep entirely if there are already-queued messages waiting
      const skipSleep = shouldSkipSleep({
        hasPendingStdin: input.hasPending(),
        hasPendingFile: hasPendingFile(INPUT_FILE),
        interrupted: checkInterrupt(),
      });

      if (skipSleep) {
        log("skipping sleep — pending input detected");
      } else {
        const nextTickAt = Date.now() + config.pollIntervalMs;
        writeState("sleeping", { pollCount, pollIntervalMs: config.pollIntervalMs, nextTickAt, paused: false });

        const wake = await wakeableSleep(config.pollIntervalMs, AOAOE_DIR);
        if (wake.reason === "wake") {
          log(`woke early after ${wake.elapsed}ms (file change detected)`);
        }
      }
    }
  }
}

// wraps the core tick logic (loop.ts) with daemon UI: state file, dashboard, status line,
// console output, and interrupt support. the core logic in loop.ts is what the tests exercise.
async function daemonTick(
  config: AoaoeConfig,
  poller: Poller,
  reasoner: ReturnType<typeof createReasoner>,
  executor: Executor,
  reasonerConsole: ReasonerConsole,
  pollCount: number,
  policyStates: Map<string, SessionPolicyState>,
  userMessage?: string,
  forceDashboard?: boolean,
  taskContext?: TaskState[],
  taskManager?: TaskManager
): Promise<boolean> {
  // pre-tick: write IPC state + tick separator in conversation log
  writeState("polling", { pollCount, pollIntervalMs: config.pollIntervalMs, tickStartedAt: Date.now() });
  reasonerConsole.writeTickSeparator(pollCount);

  // user message -> console
  if (userMessage) {
    reasonerConsole.writeUserMessage(userMessage);
  }

  // wrap reasoner with timeout + interrupt support (passes AbortSignal to backends)
  const wrappedReasoner: import("./types.js").Reasoner = {
    init: () => reasoner.init(),
    shutdown: () => reasoner.shutdown(),
    decide: async (obs) => {
      writeState("reasoning", { pollCount, pollIntervalMs: config.pollIntervalMs });
      process.stdout.write(" | reasoning...");

      const { result: r, interrupted } = await withTimeoutAndInterrupt(
        (signal) => reasoner.decide(obs, signal),
        90_000,
        { actions: [{ action: "wait" as const, reason: "reasoner timeout" }] }
      );
      if (interrupted) {
        process.stdout.write(" INTERRUPTED\n");
        reasonerConsole.writeSystem("reasoner interrupted by operator");
        throw new InterruptError();
      }
      return r;
    },
  };

  // run core tick logic (same code path the tests exercise)
  let tickResult: import("./loop.js").TickResult;
  try {
    tickResult = await loopTick({
      config, poller, reasoner: wrappedReasoner, executor, policyStates, pollCount, userMessage, taskContext,
    });
  } catch (err) {
    if (err instanceof InterruptError) return true;
    throw err;
  }

  const { observation, result, executed, skippedReason, dryRunActions } = tickResult;
  const sessionCount = observation.sessions.length;
  const changeCount = observation.changes.length;

  // update IPC state with session info + task progress
  const sessionStates = buildSessionStates(observation);
  const taskStates = taskManager ? taskManager.tasks : undefined;
  writeState("polling", { pollCount, sessionCount, changeCount, sessions: sessionStates, tasks: taskStates });

  // skip cases
  if (skippedReason === "no sessions") {
    if (pollCount % 6 === 1) log("no active aoe sessions found");
    return false;
  }

  // dashboard
  if (forceDashboard || pollCount % 6 === 1) {
    printDashboard(observation, executor.getRecentLog(), pollCount, config);
  }

  // status line
  const statuses = summarizeStatuses(observation);
  const userTag = userMessage ? " | +operator msg" : "";
  process.stdout.write(
    `\r[poll #${pollCount}] ${sessionCount} sessions (${statuses}) | ${changeCount} changed${userTag}`
  );

  // console: observation summary with per-session activity
  {
    const changeSummary = observation.changes.map((c) => `${c.title} (${c.tool}): ${c.status}`);
    const changedTitles = new Set(observation.changes.map((c) => c.title));
    const sessionInfos = observation.sessions.map((snap) => {
      const lines = snap.output.split("\n").filter((l) => l.trim());
      const lastLine = lines.length > 0 ? lines[lines.length - 1].trim() : undefined;
      return {
        title: snap.session.title,
        tool: snap.session.tool,
        status: snap.session.status,
        lastActivity: lastLine,
      };
    });
    const summaries = sessionInfos.length > 0
      ? formatSessionSummaries(sessionInfos, changedTitles)
      : undefined;
    reasonerConsole.writeObservation(sessionCount, changeCount, changeSummary, summaries);
  }

  if (skippedReason === "no changes") {
    if (config.verbose) process.stdout.write(" | no changes, skipping reasoner\n");
    return false;
  }

  // reasoning happened
  if (result) {
    const actionSummary = result.actions.map((a) => a.action).join(", ");
    process.stdout.write(` -> ${actionSummary}\n`);

    if (result.reasoning) {
      reasonerConsole.writeReasoning(result.reasoning);
      if (config.verbose) log(`reasoning: ${result.reasoning}`);
    }
  }

  // dry-run
  if (dryRunActions && dryRunActions.length > 0) {
    for (const action of dryRunActions) {
      const msg = `would ${action.action}: ${JSON.stringify(action)}`;
      log(`[dry-run] ${msg}`);
      reasonerConsole.writeAction(action.action, "dry-run", true);
    }
    return false;
  }

  // execution results — resolve session IDs to titles for display
  writeState("executing", { pollCount, sessionCount, changeCount, sessions: sessionStates });
  const sessionTitleMap = new Map(observation.sessions.map((s) => [s.session.id, s.session.title]));
  for (const entry of executed) {
    if (entry.action.action === "wait") continue;
    const icon = entry.success ? "+" : "!";
    // resolve session title for rich display
    const sessionId = "session" in entry.action ? (entry.action as { session: string }).session : undefined;
    const sessionTitle = sessionId ? (sessionTitleMap.get(sessionId) ?? sessionId) : undefined;
    const actionText = "text" in entry.action ? (entry.action as { text: string }).text : entry.detail;
    const richDetail = formatActionDetail(entry.action.action, sessionTitle, actionText);
    log(`[${icon}] ${richDetail}`);
    reasonerConsole.writeAction(entry.action.action, richDetail, entry.success);
  }
  return false;
}

class InterruptError extends Error { constructor() { super("interrupted"); this.name = "InterruptError"; } }

function summarizeStatuses(obs: Observation): string {
  const counts = new Map<string, number>();
  for (const snap of obs.sessions) {
    const s = snap.session.status;
    counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  return [...counts.entries()].map(([k, v]) => `${v} ${k}`).join(", ");
}

function log(msg: string) {
  const ts = new Date().toLocaleTimeString();
  console.error(`[${ts}] ${msg}`);
}

// race the reasoner against both a timeout and the interrupt flag file.
// accepts a factory that receives an AbortSignal so the underlying HTTP
// request / subprocess can be cancelled on timeout or interrupt.
function withTimeoutAndInterrupt<T>(
  factory: (signal: AbortSignal) => Promise<T>,
  ms: number,
  fallback: T
): Promise<{ result: T; interrupted: boolean }> {
  return new Promise((resolve) => {
    let settled = false;
    const ac = new AbortController();

    // poll for interrupt flag every 300ms
    const interruptInterval = setInterval(() => {
      if (settled) return;
      if (checkInterrupt()) {
        settled = true;
        ac.abort();
        clearInterval(interruptInterval);
        clearTimeout(timer);
        clearInterrupt();
        resolve({ result: fallback, interrupted: true });
      }
    }, 300);

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      ac.abort();
      clearInterval(interruptInterval);
      log(`reasoner timed out after ${ms}ms, using fallback`);
      resolve({ result: fallback, interrupted: false });
    }, ms);

    factory(ac.signal).then((result) => {
      if (settled) return;
      settled = true;
      clearInterval(interruptInterval);
      clearTimeout(timer);
      resolve({ result, interrupted: false });
    }).catch((err) => {
      if (settled) return;
      settled = true;
      clearInterval(interruptInterval);
      clearTimeout(timer);
      log(`reasoner error (using fallback): ${err}`);
      resolve({ result: fallback, interrupted: false });
    });
  });
}



// `aoaoe test-context` -- safe read-only scan: list sessions, resolve project dirs,
// discover context files. touches nothing, just prints what it finds.
async function testContext(): Promise<void> {
  // hoist all imports to top of function (not inside loops)
  const { exec: shellExec } = await import("./shell.js");
  const { resolveProjectDirWithSource, discoverContextFiles, loadSessionContext, loadGlobalContext: loadGlobal } = await import("./context.js");
  const { computeTmuxName } = await import("./poller.js");
  const { statSync } = await import("node:fs");
  const { resolve: pathResolve } = await import("node:path");

  const basePath = process.cwd();
  const config = loadConfig();
  const sessionDirs = Object.keys(config.sessionDirs).length ? config.sessionDirs : undefined;
  console.log(`base path: ${basePath}`);
  if (sessionDirs) {
    console.log(`sessionDirs config: ${JSON.stringify(sessionDirs)}`);
  }
  console.log();

  // 1. list sessions
  const listResult = await shellExec("aoe", ["list", "--json"]);
  if (listResult.exitCode !== 0) {
    console.error("failed to list sessions (is aoe running?)");
    console.error(listResult.stderr);
    process.exit(1);
  }

  let sessions: Array<{ id: string; title: string; path: string; tool: string }>;
  try {
    sessions = JSON.parse(listResult.stdout);
  } catch {
    console.error("failed to parse aoe list output");
    process.exit(1);
  }

  if (sessions.length === 0) {
    console.log("no active aoe sessions found");
    return;
  }

  console.log(`found ${sessions.length} session(s):\n`);

  for (const s of sessions) {
    const tmuxName = computeTmuxName(s.id, s.title);
    console.log(`--- ${s.title} (${s.id.slice(0, 8)}) ---`);
    console.log(`  tool:      ${s.tool}`);
    console.log(`  path:      ${s.path}`);
    console.log(`  tmux:      ${tmuxName}`);

    // resolve project directory
    const { dir: projectDir, source: resolutionSource } = resolveProjectDirWithSource(basePath, s.title, sessionDirs);
    const sourceLabel = resolutionSource ? ` (via ${resolutionSource})` : "";
    console.log(`  resolved:  ${projectDir ? projectDir + sourceLabel : "(not found — will fall back to session path)"}`);

    // discover context files in the resolved dir
    const scanDir = projectDir ?? s.path;
    const discovered = discoverContextFiles(scanDir);
    if (discovered.length > 0) {
      console.log(`  context files (${discovered.length}):`);
      for (const f of discovered) {
        const rel = f.startsWith(basePath) ? f.slice(basePath.length + 1) : f;
        try {
          const size = statSync(f).size;
          console.log(`    ${rel} (${(size / 1024).toFixed(1)}KB)`);
        } catch {
          console.log(`    ${rel} (unreadable)`);
        }
      }
    } else {
      console.log(`  context files: (none found)`);
    }

    // also check parent dir for group-level context
    if (projectDir) {
      const parentDir = pathResolve(projectDir, "..");
      const parentFiles = discoverContextFiles(parentDir);
      const parentOnly = parentFiles.filter((f) => !discovered.includes(f));
      if (parentOnly.length > 0) {
        console.log(`  group-level context (from parent):`);
        for (const f of parentOnly) {
          const rel = f.startsWith(basePath) ? f.slice(basePath.length + 1) : f;
          console.log(`    ${rel}`);
        }
      }
    }

    // show total loaded context size
    const fullContext = loadSessionContext(basePath, s.title, undefined, sessionDirs);
    const contextSize = Buffer.byteLength(fullContext, "utf-8");
    console.log(`  total context: ${(contextSize / 1024).toFixed(1)}KB`);
    console.log();
  }

  // global context
  const globalFiles = discoverContextFiles(basePath);
  if (globalFiles.length > 0) {
    console.log("--- global context (supervisor working directory) ---");
    for (const f of globalFiles) {
      const rel = f.startsWith(basePath) ? f.slice(basePath.length + 1) : f;
      console.log(`  ${rel}`);
    }
    const globalCtx = loadGlobal(basePath);
    console.log(`  total: ${(Buffer.byteLength(globalCtx, "utf-8") / 1024).toFixed(1)}KB\n`);
  }

  console.log("done — no sessions were modified.");
}

// `aoaoe register` -- register aoaoe as an AoE session using --cmd_override
// this makes aoaoe appear in `aoe list` so users can enter it via AoE's normal interface
async function registerAsAoeSession(title?: string): Promise<void> {
  const sessionTitle = title ?? "aoaoe";

  // resolve the path to chat.js -- works whether installed globally via npm or run from source
  const chatPath = resolve(__dirname, "chat.js");
  const { existsSync: exists } = await import("node:fs");
  if (!exists(chatPath)) {
    console.error(`error: chat.js not found at ${chatPath}`);
    console.error("run 'npm run build' first if running from source");
    process.exit(1);
  }

  const cwd = process.cwd();

  // create a wrapper script that runs chat.js inside AoE's tmux pane.
  // we use /bin/sh (not bash) to avoid loading .bashrc which pollutes the pane,
  // and embed the full node path since nvm isn't available in a bare /bin/sh.
  //
  // AoE integration constraints (0.13.3):
  // 1. -c value must contain a known tool name (resolve_tool_name does substring match)
  // 2. -c value must contain a space or AoE won't store it (add.rs:183)
  // 3. yolo mode with EnvVar tools (opencode) breaks exec -- use claude (CliFlag) instead
  // 4. wrapper name contains "claude" so `-c "<path> --"` passes tool validation
  const wrapperPath = join(homedir(), ".aoaoe", "claude-aoaoe-chat.sh");
  const { mkdirSync: mkdirS, writeFileSync: writeS, chmodSync } = await import("node:fs");
  mkdirS(join(homedir(), ".aoaoe"), { recursive: true });
  const nodePath = process.execPath; // full path to current node binary
  writeS(wrapperPath, `#!/bin/sh\nexec "${nodePath}" "${chatPath}"\n`);
  chmodSync(wrapperPath, 0o755);
  // trailing "--" ensures the command contains a space so AoE stores it
  const chatCmd = `${wrapperPath} --`;

  // check if already registered by looking at aoe list
  const { exec: shellExec } = await import("./shell.js");
  try {
    const listResult = await shellExec("aoe", ["list", "--json"]);
    if (listResult.exitCode === 0 && listResult.stdout.trim()) {
      const sessions = JSON.parse(listResult.stdout);
      const existing = sessions.find((s: { title: string }) => s.title === sessionTitle);
      if (existing) {
        console.log(`session '${sessionTitle}' already registered (id: ${existing.id})`);
        console.log(`start it with: aoe session start ${sessionTitle}`);
        console.log(`then enter it with: aoe (and select ${sessionTitle})`);
        return;
      }
    }
  } catch {
    // aoe list failed -- maybe no sessions, continue with registration
  }

  // register via aoe add with -c containing "opencode" in the env var to pass tool validation.
  // AoE stores the full command string and runs it directly in the tmux pane on session start.
  console.log(`registering '${sessionTitle}' as an AoE session...`);
  console.log(`  path: ${cwd}`);
  console.log(`  command: ${chatCmd}`);

  const addResult = await shellExec("aoe", [
    "add", cwd,
    "-t", sessionTitle,
    "-c", chatCmd,
  ]);

  if (addResult.exitCode !== 0) {
    console.error(`failed to register: ${addResult.stderr || addResult.stdout}`);
    process.exit(1);
  }

  console.log();
  console.log(`registered! next steps:`);
  console.log(`  1. start the daemon:  aoaoe`);
  console.log(`  2. start the session: aoe session start ${sessionTitle}`);
  console.log(`  3. enter via AoE:     aoe  (then select ${sessionTitle})`);
  console.log();
  console.log(`or start + enter immediately: aoe session start ${sessionTitle} && aoe`);
}

// `aoaoe attach` -- deprecated in v0.32.0, the daemon is now interactive inline
async function attachToConsole(): Promise<void> {
  console.error("aoaoe attach is no longer needed.");
  console.error("");
  console.error("since v0.32, the daemon is interactive in the same terminal.");
  console.error("just run: aoaoe");
  console.error("");
  console.error("type messages directly, use /help for commands, ESC ESC to interrupt.");
  process.exit(0);
}

function readPkgVersion(): string | null {
  try {
    const pkg = JSON.parse(readFileSync(resolve(__dirname, "..", "package.json"), "utf-8"));
    return pkg.version ?? null;
  } catch {
    return null;
  }
}

// `aoaoe tasks` -- show current task progress
async function showTaskStatus(): Promise<void> {
  const basePath = process.cwd();
  const defs = loadTaskDefinitions(basePath);
  const states = loadTaskState();

  if (defs.length === 0 && states.size === 0) {
    console.log("no tasks defined.");
    console.log("");
    console.log("create aoaoe.tasks.json:");
    console.log('  [{ "repo": "github/adventure", "goal": "Continue the roadmap" }]');
    return;
  }

  // merge definitions into state for display
  const tm = new TaskManager(basePath, defs);
  console.log("");
  console.log(formatTaskTable(tm.tasks));
  console.log("");
}

// `aoaoe test` -- dynamically import and run the integration test
async function runIntegrationTest(): Promise<void> {
  const testModule = resolve(__dirname, "integration-test.js");
  const { existsSync: exists } = await import("node:fs");
  if (!exists(testModule)) {
    console.error("error: integration-test.js not found (run 'npm run build' first)");
    process.exit(1);
  }
  // the integration test is a self-contained script that runs main() on import
  await import(testModule);
}

main().catch((err) => {
  console.error(`fatal: ${err}`);
  process.exit(1);
});
