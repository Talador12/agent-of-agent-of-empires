#!/usr/bin/env node
import { loadConfig, validateEnvironment, parseCliArgs, printHelp, configFileExists, findConfigFile } from "./config.js";
import { Poller, computeTmuxName } from "./poller.js";
import { createReasoner } from "./reasoner/index.js";
import { Executor } from "./executor.js";
import { printDashboard } from "./dashboard.js";
import { InputReader } from "./input.js";
import { ReasonerConsole } from "./console.js";
import { writeState, buildSessionStates, checkInterrupt, clearInterrupt, cleanupState, acquireLock, readState } from "./daemon-state.js";
import { formatSessionSummaries, formatActionDetail, formatPlainEnglishAction, narrateObservation, summarizeRecentActions, friendlyError } from "./console.js";
import { type SessionPolicyState } from "./reasoner/prompt.js";
import { loadGlobalContext, resolveProjectDirWithSource, discoverContextFiles, loadSessionContext } from "./context.js";
import { tick as loopTick } from "./loop.js";
import { exec as shellExec } from "./shell.js";
import { wakeableSleep } from "./wake.js";
import { classifyMessages, formatUserMessages, buildReceipts, shouldSkipSleep, hasPendingFile } from "./message.js";
import { TaskManager, loadTaskDefinitions, loadTaskState, formatTaskTable } from "./task-manager.js";
import { runTaskCli, handleTaskSlashCommand } from "./task-cli.js";
import { TUI } from "./tui.js";
import { isDaemonRunningFromState } from "./chat.js";
import { sendNotification, sendTestNotification } from "./notify.js";
import type { AoaoeConfig, Observation, ReasonerResult, TaskState } from "./types.js";
import { actionSession, actionDetail } from "./types.js";
import { YELLOW, GREEN, DIM, BOLD, RED, RESET } from "./colors.js";
import { readFileSync, existsSync, statSync, mkdirSync, writeFileSync, chmodSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const AOAOE_DIR = join(homedir(), ".aoaoe"); // watch dir for wakeable sleep
const INPUT_FILE = join(AOAOE_DIR, "pending-input.txt"); // file IPC from chat.ts

async function main() {
   const { overrides, help, version, register, testContext: isTestContext, runTest, showTasks, showHistory, showStatus, showConfig, notifyTest, runInit, initForce, runTaskCli: isTaskCli, registerTitle } = parseCliArgs(process.argv);

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

  // `aoaoe history` -- review recent actions
  if (showHistory) {
    await showActionHistory();
    return;
  }

  // `aoaoe status` -- quick one-shot daemon health check
  if (showStatus) {
    showDaemonStatus();
    return;
  }

  // `aoaoe config` -- show effective resolved config
  if (showConfig) {
    showEffectiveConfig();
    return;
  }

  // `aoaoe notify-test` -- send a test notification to configured webhooks
  if (notifyTest) {
    await runNotifyTest();
    return;
  }

  // `aoaoe task` -- task management CLI
  if (isTaskCli) {
    await runTaskCli(process.argv);
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
    console.error("  no config found (~/.aoaoe/ or cwd) — running auto-init...");
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

  const configResult = loadConfig(overrides);
  const configPath = configResult._configPath;
  const config: AoaoeConfig = configResult; // strip _configPath from type for downstream

  // acquire daemon lock — prevent two daemons from running simultaneously
  const lock = acquireLock();
  if (!lock.acquired) {
    console.error("");
    console.error(`  another aoaoe daemon is already running (pid ${lock.existingPid ?? "unknown"})`);
    console.error("  only one daemon can manage sessions at a time.");
    console.error("");
    console.error("  if this is stale, remove ~/.aoaoe/daemon.lock and retry.");
    process.exit(1);
  }

  // startup banner + TUI setup
  const pkg = readPkgVersion();
  const useTui = process.stdin.isTTY === true;
  const tui = useTui ? new TUI() : null;

  if (!useTui) {
    // fallback: plain scrolling output (non-TTY / piped)
    console.error("");
    console.error("  aoaoe" + (pkg ? ` v${pkg}` : "") + "  —  autonomous supervisor");
    console.error(`  reasoner: ${config.reasoner}  |  poll: ${config.pollIntervalMs / 1000}s`);
    console.error(`  config: ${configPath ?? "defaults (no config file found)"}`);
    if (config.observe) console.error("  OBSERVE MODE — watching only, no AI, no actions");
    else if (config.confirm) console.error("  CONFIRM MODE — the AI will ask before every action");
    else if (config.dryRun) console.error("  DRY RUN — the AI thinks but doesn't act");
    console.error("");
  }

  // validate tools are installed (in observe mode, only need aoe+tmux, not the reasoner)
  if (config.observe) {
    // lightweight validation — only poller deps (aoe + tmux), skip reasoner tool check
    const obsConfig = { ...config, reasoner: "opencode" as const };
    try {
      await validateEnvironment(obsConfig);
    } catch (err) {
      // re-throw only if aoe/tmux are missing (strip reasoner-specific errors)
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("aoe") || msg.includes("tmux")) throw err;
      // opencode/claude missing is fine in observe mode — no reasoner needed
    }
  } else {
    await validateEnvironment(config);
  }

  // auto-start opencode serve if not running (opencode backend only, skip in observe mode)
  if (!config.observe && config.reasoner === "opencode") {
    const { ensureOpencodeServe } = await import("./init.js");
    const serverReady = await ensureOpencodeServe(config.opencode.port);
    if (!serverReady) {
      console.error("  opencode serve failed to start — cannot reason without it");
      console.error(`  start manually: opencode serve --port ${config.opencode.port}`);
      process.exit(1);
    }
  }

  // load global context (AGENTS.md / claude.md from cwd or parent)
  const globalContext = config.observe ? null : loadGlobalContext();
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
  const reasoner = config.observe ? null : createReasoner(config, globalContext || undefined);
  const executor = config.observe ? null : new Executor(config);
  if (taskManager && executor) executor.setTaskManager(taskManager);
  const input = new InputReader();
  const reasonerConsole = new ReasonerConsole();

  // init reasoner (starts opencode serve, verifies claude, etc) — skip in observe mode
  if (reasoner) {
    log("initializing reasoner...");
    await reasoner.init();
    log("reasoner ready");
  }

  // start interactive input listener and conversation log
  input.start();
  await reasonerConsole.start();

  // start TUI (alternate screen buffer) after input is ready
  if (tui) {
    tui.start(pkg || "dev");
    tui.updateState({ reasonerName: config.observe ? "observe-only" : config.reasoner });

    // welcome banner — plain-English explanation of what's happening
    tui.log("system", "");
    if (config.observe) {
      tui.log("system", "OBSERVE MODE — watching your agents without touching anything.");
      tui.log("system", "No AI calls, no actions, zero cost. Just monitoring.");
    } else if (config.confirm) {
      tui.log("system", `The AI supervisor is watching your agents and will ask before acting.`);
      tui.log("system", `You'll see a y/n prompt before any action runs.`);
    } else if (config.dryRun) {
      tui.log("system", `DRY RUN — the AI will think about what to do, but won't actually do it.`);
    } else {
      tui.log("system", `The AI supervisor is watching your agents and will help when needed.`);
    }
    tui.log("system", "");
    tui.log("system", `config: ${configPath ?? "using defaults (no config file found)"}`);
    tui.log("system", "Type a message to talk to the AI, or use /help for commands.");
    tui.log("system", "Press ESC twice to interrupt the AI mid-thought.");
    tui.log("system", "");

    // catch-up: show recent activity from actions.log
    try {
      const actionsLogPath = join(homedir(), ".aoaoe", "actions.log");
      if (existsSync(actionsLogPath)) {
        const logContent = readFileSync(actionsLogPath, "utf-8").trim();
        if (logContent) {
          const logLines = logContent.split("\n").filter((l) => l.trim());
          const catchUp = summarizeRecentActions(logLines);
          tui.log("system", catchUp);
        }
      }
    } catch {}
  }

  // ── session stats (for shutdown summary) ──────────────────────────────────
  const daemonStartedAt = Date.now();
  let totalDecisions = 0;
  let totalActionsExecuted = 0;
  let totalActionsFailed = 0;
  let totalPolls = 0;

  // graceful shutdown — wrap in .catch so unhandled rejections from
  // reasoner.shutdown() or reasonerConsole.stop() don't get swallowed
  let running = true;
  const shutdown = () => {
    if (!running) return;
    running = false;
    // swallow further signals during cleanup — prevents stale lock files
    // when user hits Ctrl+C again while async cleanup is in progress
    process.removeAllListeners("SIGINT");
    process.removeAllListeners("SIGTERM");
    process.on("SIGINT", () => {}); // swallow
    process.on("SIGTERM", () => {}); // swallow
    if (tui) tui.stop();

    // ── shutdown summary ──────────────────────────────────────────────────
    const elapsed = Date.now() - daemonStartedAt;
    const mins = Math.floor(elapsed / 60_000);
    const secs = Math.floor((elapsed % 60_000) / 1000);
    const duration = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
    console.error("");
    console.error("  ── aoaoe session summary ──");
    console.error(`  duration:   ${duration}`);
    console.error(`  polls:      ${totalPolls}`);
    if (!config.observe) {
      console.error(`  decisions:  ${totalDecisions}`);
      console.error(`  actions:    ${totalActionsExecuted} executed, ${totalActionsFailed} failed`);
    }
    if (config.observe) console.error(`  mode:       observe-only (no LLM, no execution)`);
    else if (config.confirm) console.error(`  mode:       confirm (human-approved actions)`);
    else if (config.dryRun) console.error(`  mode:       dry-run (no execution)`);
    console.error("");

    log("shutting down...");
    // notify: daemon stopped (fire-and-forget, don't block shutdown)
    sendNotification(config, { event: "daemon_stopped", timestamp: Date.now(), detail: `polls: ${totalPolls}, actions: ${totalActionsExecuted}` });
    input.stop();
    Promise.resolve()
      .then(() => reasonerConsole.stop())
      .then(() => reasoner?.shutdown())
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
  if (tui) {
    tui.log("system", "entering main loop (Ctrl+C to stop)");
  } else {
    log("entering main loop (Ctrl+C to stop)\n");
  }

  // notify: daemon started
  sendNotification(config, { event: "daemon_started", timestamp: Date.now(), detail: `reasoner: ${config.reasoner}` });

  // clear any stale interrupt from a previous run
  clearInterrupt();

  // auto-explain: on the very first tick with sessions, inject an explain prompt
  // so the AI introduces what it sees. Only in normal mode (not observe/confirm/dry-run).
  let autoExplainPending = !config.observe && !config.confirm;

  while (running) {
    pollCount++;

    // drain user input from both stdin and console tmux session
    const stdinMessages = input.drain();
    const consoleMessages = reasonerConsole.drainInput();
    const allMessages = [...stdinMessages, ...consoleMessages];

    // classify into commands vs. real user messages
    const { commands, userMessages } = classifyMessages(allMessages);

    // auto-explain on first tick: inject an explain prompt so the AI introduces itself
    if (autoExplainPending && pollCount === 1) {
      const autoExplainPrompt = "This is your first observation. Please briefly introduce what you see: " +
        "how many agents are running, what each one is working on, and whether anything needs attention. " +
        "Keep it conversational — one or two sentences per agent.";
      userMessages.push(autoExplainPrompt);
      autoExplainPending = false;
      if (tui) tui.log("system", "asking the AI for an introduction..."); else log("auto-explain: asking AI to introduce what it sees");
    }

    // /explain: inject a smart prompt into userMessages before formatting
    if (commands.includes("__CMD_EXPLAIN__")) {
      const explainPrompt = "Please explain what's happening right now in plain English. " +
        "For each agent, say what it's working on, whether it's making progress or stuck, " +
        "and whether you plan to do anything. Write as if explaining to someone who just walked in.";
      userMessages.push(explainPrompt);
      if (tui) tui.log("you", "/explain"); else log("/explain — asking AI for a summary");
      reasonerConsole.writeUserMessage("/explain");
    }

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
        const msg = `status: poll #${pollCount}, reasoner=${config.reasoner}, paused=${isPausedNow}, dry-run=${config.dryRun}`;
        if (tui) tui.log("status", msg); else log(msg);
        reasonerConsole.writeSystem(msg);
      } else if (cmd === "__CMD_DASHBOARD__") {
        forceDashboard = true;
      } else if (cmd === "__CMD_VERBOSE__") {
        config.verbose = !config.verbose;
        const msg = `verbose: ${config.verbose ? "on" : "off"}`;
        if (tui) tui.log("system", msg); else log(msg);
        reasonerConsole.writeSystem(msg);
      } else if (cmd === "__CMD_PAUSE__") {
        paused = true;
        if (tui) { tui.log("system", "paused via console"); tui.updateState({ paused: true }); } else log("paused via console");
        reasonerConsole.writeSystem("paused -- reasoner will not be called until /resume");
      } else if (cmd === "__CMD_RESUME__") {
        paused = false;
        if (tui) { tui.log("system", "resumed"); tui.updateState({ paused: false }); } else log("resumed via console");
        reasonerConsole.writeSystem("resumed");
      } else if (cmd === "__CMD_INTERRUPT__") {
        // interrupt is handled inside tick() via the flag file; clear it here if no tick is running
        if (tui) tui.log("system", "interrupt requested (will take effect during next reasoning call)"); else log("interrupt requested (will take effect during next reasoning call)");
      } else if (cmd === "__CMD_EXPLAIN__") {
        // handled above (before formatUserMessages) — just skip here
      } else if (cmd.startsWith("__CMD_TASK__")) {
        const taskArgs = cmd.slice("__CMD_TASK__".length);
        try {
          const output = await handleTaskSlashCommand(taskArgs);
          if (tui) tui.log("system", output); else log(output);
          reasonerConsole.writeSystem(output);
        } catch (err) {
          const msg = `task command error: ${err}`;
          if (tui) tui.log("error", msg); else log(msg);
        }
      }
    }

    // check pause from both stdin input and console commands
    const isPaused = paused || input.isPaused();
    if (isPaused) {
      if (pollCount % 6 === 1) {
        if (tui) tui.log("system", "paused (type /resume to continue)"); else log("paused (type /resume to continue)");
      }
      const pausedNextTickAt = Date.now() + config.pollIntervalMs;
      if (tui) tui.updateState({ phase: "sleeping", paused: true, pollCount, nextTickAt: pausedNextTickAt });
      writeState("sleeping", { paused: true, pollCount, pollIntervalMs: config.pollIntervalMs, nextTickAt: pausedNextTickAt });
      await wakeableSleep(config.pollIntervalMs, AOAOE_DIR);
      continue;
    }

    try {
      totalPolls++;
      if (tui) tui.updateState({ phase: "polling", pollCount, paused: false });

      // ── observe mode: poll + display, skip reasoning + execution ──────
      if (config.observe) {
        const observation = await poller.poll();
        const sessionStates = buildSessionStates(observation);
        if (tui) tui.updateState({ phase: "polling", pollCount, sessions: sessionStates });
        writeState("polling", { pollCount, sessionCount: observation.sessions.length, changeCount: observation.changes.length, sessions: sessionStates });

        if (observation.sessions.length === 0 && pollCount % 6 === 1) {
          if (tui) tui.log("observation", "no active aoe sessions found"); else log("no active aoe sessions found");
        } else if (observation.changes.length > 0) {
          for (const ch of observation.changes) {
            const preview = ch.newLines.split("\n").filter((l) => l.trim()).slice(-3).join(" | ").slice(0, 80);
            if (tui) tui.log("observation", `${ch.title}: ${preview}`); else log(`[${ch.title}] ${preview}`);
          }
        } else if (config.verbose) {
          if (tui) tui.log("observation", `${observation.sessions.length} sessions, no changes`);
        }

        // user message in observe mode — just acknowledge, don't send to reasoner
        if (userMessage) {
          const msg = "observe mode: message received but no reasoner to forward to";
          if (tui) tui.log("system", msg); else log(msg);
        }
        // skip the rest — no reasoning, no execution
      } else {
      // ── normal mode: full tick ─────────────────────────────────────────

      const activeTaskContext = taskManager ? taskManager.tasks.filter((t) => t.status !== "completed") : undefined;
      if (!reasoner || !executor) throw new Error("reasoner/executor unexpectedly null in normal mode");
      const { interrupted, decisionsThisTick, actionsOk, actionsFail } = await daemonTick(config, poller, reasoner, executor, reasonerConsole, pollCount, policyStates, userMessage, forceDashboard, activeTaskContext, taskManager, tui);
      totalDecisions += decisionsThisTick;
      totalActionsExecuted += actionsOk;
      totalActionsFailed += actionsFail;
      forceDashboard = false;

      // if the reasoner was interrupted, continue to next tick immediately.
      // wakeable sleep will pick up the user's follow-up message via fs.watch
      // instead of blocking for 60s in a busy-poll loop.
      if (interrupted) {
        writeState("interrupted", { pollCount, pollIntervalMs: config.pollIntervalMs });
        reasonerConsole.writeSystem("reasoner interrupted -- type a message and it will be picked up immediately");
        if (tui) tui.log("system", "interrupted -- continuing to next tick"); else log("interrupted -- continuing to next tick (wakeable sleep will pick up input)");
        clearInterrupt();
      }

      } // end normal mode else block
    } catch (err) {
      const msg = `tick ${pollCount} failed: ${err}`;
      if (tui) tui.log("error", msg); else console.error(`[error] ${msg}`);
    }

    // re-show input prompt after tick output (no-op when TUI is active since it has its own input line)
    if (!tui) input.prompt();

    if (running) {
      // skip sleep entirely if there are already-queued messages waiting
      const skipSleep = shouldSkipSleep({
        hasPendingStdin: input.hasPending(),
        hasPendingFile: hasPendingFile(INPUT_FILE),
        interrupted: checkInterrupt(),
      });

      if (skipSleep) {
        if (tui) tui.log("system", "skipping sleep — pending input detected"); else log("skipping sleep — pending input detected");
      } else {
        const nextTickAt = Date.now() + config.pollIntervalMs;
        if (tui) tui.updateState({ phase: "sleeping", nextTickAt });
        writeState("sleeping", { pollCount, pollIntervalMs: config.pollIntervalMs, nextTickAt, paused: false });

        const wake = await wakeableSleep(config.pollIntervalMs, AOAOE_DIR);
        if (wake.reason === "wake") {
          if (tui) tui.log("system", `woke early after ${wake.elapsed}ms`); else log(`woke early after ${wake.elapsed}ms (file change detected)`);
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
  taskManager?: TaskManager,
  tui?: TUI | null,
): Promise<{ interrupted: boolean; decisionsThisTick: number; actionsOk: number; actionsFail: number }> {
  // pre-tick: write IPC state + tick separator in conversation log
  writeState("polling", { pollCount, pollIntervalMs: config.pollIntervalMs, tickStartedAt: Date.now() });
  reasonerConsole.writeTickSeparator(pollCount);

  // user message -> console + TUI
  if (userMessage) {
    if (tui) tui.log("you", userMessage);
    reasonerConsole.writeUserMessage(userMessage);
  }

  // wrap reasoner with timeout + interrupt support (passes AbortSignal to backends)
  const wrappedReasoner: import("./types.js").Reasoner = {
    init: () => reasoner.init(),
    shutdown: () => reasoner.shutdown(),
    decide: async (obs) => {
      writeState("reasoning", { pollCount, pollIntervalMs: config.pollIntervalMs });
      if (tui) tui.updateState({ phase: "reasoning" }); else process.stdout.write(" | reasoning...");

      const { result: r, interrupted } = await withTimeoutAndInterrupt(
        (signal) => reasoner.decide(obs, signal),
        90_000,
        { actions: [{ action: "wait" as const, reason: "reasoner timeout" }] }
      );
      if (interrupted) {
        if (tui) tui.log("system", "reasoner INTERRUPTED"); else process.stdout.write(" INTERRUPTED\n");
        reasonerConsole.writeSystem("reasoner interrupted by operator");
        throw new InterruptError();
      }
      return r;
    },
  };

  // confirm mode: build a beforeExecute hook that prompts the user for each action
  let beforeExecute: ((action: import("./types.js").Action) => Promise<boolean>) | undefined;
  if (config.confirm && process.stdin.isTTY) {
    // resolve session titles for confirm prompts
    beforeExecute = async (action) => {
      if (action.action === "wait") return true;
      const plainText = formatPlainEnglishAction(
        action.action,
        actionSession(action),
        actionDetail(action) ?? action.action,
        true,
      );
      const answer = await askConfirm(plainText, tui);
      if (!answer) {
        const msg = `Skipped: ${plainText}`;
        if (tui) tui.log("system", msg); else log(msg);
        reasonerConsole.writeSystem(msg);
      }
      return answer;
    };
  }

  // run core tick logic (same code path the tests exercise)
  let tickResult: import("./loop.js").TickResult;
  try {
    tickResult = await loopTick({
      config, poller, reasoner: wrappedReasoner, executor, policyStates, pollCount, userMessage, taskContext, beforeExecute,
    });
  } catch (err) {
    if (err instanceof InterruptError) return { interrupted: true, decisionsThisTick: 0, actionsOk: 0, actionsFail: 0 };
    throw err;
  }

  const { observation, result, executed, skippedReason, dryRunActions } = tickResult;
  const sessionCount = observation.sessions.length;
  const changeCount = observation.changes.length;

  // update IPC state with session info + task progress
  const sessionStates = buildSessionStates(observation);
  const taskStates = taskManager ? taskManager.tasks : undefined;
  writeState("polling", { pollCount, sessionCount, changeCount, sessions: sessionStates, tasks: taskStates });

  // update TUI session panel
  if (tui) tui.updateState({ phase: "polling", pollCount, sessions: sessionStates });

  const noStats = { interrupted: false, decisionsThisTick: 0, actionsOk: 0, actionsFail: 0 };

  // skip cases
  if (skippedReason === "no sessions") {
    if (pollCount % 6 === 1) {
      if (tui) tui.log("observation", "no active aoe sessions found"); else log("no active aoe sessions found");
    }
    return noStats;
  }

  // dashboard (only in non-TUI mode — TUI has its own session panel)
  if (!tui && (forceDashboard || pollCount % 6 === 1)) {
    printDashboard(observation, executor.getRecentLog(), pollCount, config);
  }

  // status line (only in non-TUI mode — TUI header shows phase)
  if (!tui) {
    const statuses = summarizeStatuses(observation);
    const userTag = userMessage ? " | +operator msg" : "";
    process.stdout.write(
      `\r[poll #${pollCount}] ${sessionCount} sessions (${statuses}) | ${changeCount} changed${userTag}`
    );
  }

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

  // TUI: log narrated observation summary + event highlights
  if (tui) {
    const changedTitles = new Set(observation.changes.map((c) => c.title));
    const sessionInfos = observation.sessions.map((s) => ({
      title: s.session.title, status: s.session.status,
    }));
    const narration = narrateObservation(sessionInfos, changedTitles);
    tui.log("observation", narration + (userMessage ? " +your message" : ""));

    // event highlights — call attention to important events
    for (const snap of observation.sessions) {
      const s = snap.session;
      if (s.status === "error" && changedTitles.has(s.title)) {
        tui.log("! action", `${s.title} hit an error! The AI will investigate.`);
      }
      if (s.status === "done" && changedTitles.has(s.title)) {
        tui.log("+ action", `${s.title} finished its task!`);
      }
      if (snap.userActive) {
        tui.log("status", `You're working in ${s.title} — the AI won't interfere.`);
      }
    }
  }

  // notify: session error/done events (fires for both TUI and non-TUI modes)
  {
    const changedSet = new Set(observation.changes.map((c) => c.title));
    for (const snap of observation.sessions) {
      const s = snap.session;
      if (s.status === "error" && changedSet.has(s.title)) {
        sendNotification(config, { event: "session_error", timestamp: Date.now(), session: s.title, detail: `status: ${s.status}` });
      }
      if (s.status === "done" && changedSet.has(s.title)) {
        sendNotification(config, { event: "session_done", timestamp: Date.now(), session: s.title });
      }
    }
  }

  if (skippedReason === "no changes") {
    if (config.verbose) {
      if (tui) tui.log("observation", "no changes, skipping reasoner"); else process.stdout.write(" | no changes, skipping reasoner\n");
    }
    return noStats;
  }

  // reasoning happened — show the AI's explanation prominently
  if (result) {
    if (result.reasoning) {
      // show reasoning as a plain-English explanation (always visible, not just verbose)
      reasonerConsole.writeExplanation(result.reasoning);
      if (tui) {
        tui.log("explain", result.reasoning);
      } else {
        process.stdout.write(`\n  AI: ${result.reasoning}\n`);
      }
    }

    const actionSummary = result.actions.map((a) => a.action).join(", ");
    if (tui) {
      tui.log("reasoner", `decided: ${actionSummary}`);
    } else {
      process.stdout.write(` -> ${actionSummary}\n`);
    }
  }

  // dry-run
  if (dryRunActions && dryRunActions.length > 0) {
    for (const action of dryRunActions) {
      const msg = `would ${action.action}: ${JSON.stringify(action)}`;
      if (tui) tui.log("+ action", `[dry-run] ${msg}`); else log(`[dry-run] ${msg}`);
      reasonerConsole.writeAction(action.action, "dry-run", true);
    }
    return { interrupted: false, decisionsThisTick: 1, actionsOk: 0, actionsFail: 0 };
  }

  // execution results — resolve session IDs to titles for display
  if (tui) tui.updateState({ phase: "executing" });
  writeState("executing", { pollCount, sessionCount, changeCount, sessions: sessionStates });
  const sessionTitleMap = new Map(observation.sessions.map((s) => [s.session.id, s.session.title]));
  for (const entry of executed) {
    if (entry.action.action === "wait") continue;
    const tag = entry.success ? "+ action" : "! action";
    // resolve session title for rich display
    const sessionId = actionSession(entry.action);
    const sessionTitle = sessionId ? (sessionTitleMap.get(sessionId) ?? sessionId) : undefined;
    const actionText = actionDetail(entry.action) ?? entry.detail;

    // plain-English display for humans
    const plainEnglish = formatPlainEnglishAction(entry.action.action, sessionTitle, actionText, entry.success);
    // technical detail for the log file
    const richDetail = formatActionDetail(entry.action.action, sessionTitle, actionText);

    // friendly error translation for failed actions
    const displayText = !entry.success && entry.detail
      ? `${plainEnglish} — ${friendlyError(entry.detail)}`
      : plainEnglish;

    if (tui) {
      tui.log(tag, displayText);
    } else {
      const icon = entry.success ? "+" : "!";
      log(`[${icon}] ${displayText}`);
    }
    reasonerConsole.writeAction(entry.action.action, richDetail, entry.success);
    // notify: action executed or failed
    sendNotification(config, {
      event: entry.success ? "action_executed" : "action_failed",
      timestamp: Date.now(),
      session: sessionTitle,
      detail: `${entry.action.action}${actionText ? `: ${actionText.slice(0, 200)}` : ""}`,
    });
  }
  const actionsOk = executed.filter((e) => e.success && e.action.action !== "wait").length;
  const actionsFail = executed.filter((e) => !e.success && e.action.action !== "wait").length;
  return { interrupted: false, decisionsThisTick: result ? 1 : 0, actionsOk, actionsFail };
}

class InterruptError extends Error { constructor() { super("interrupted"); this.name = "InterruptError"; } }

// prompt the user for y/n confirmation before an action runs.
// used by --confirm mode. returns true if approved, false if rejected.
function askConfirm(description: string, tui?: TUI | null): Promise<boolean> {
  return new Promise((resolve) => {
    const prompt = `\n${YELLOW}${BOLD}The AI wants to:${RESET} ${description}\n${DIM}Allow? (y/n):${RESET} `;
    if (tui) {
      tui.log("system", `The AI wants to: ${description}`);
    }
    process.stderr.write(prompt);

    // cleanup helper — ensures terminal is restored regardless of how we exit
    const cleanup = () => {
      process.stdin.removeListener("data", onData);
      if (process.stdin.isTTY) try { process.stdin.setRawMode(false); } catch { /* already restored */ }
    };

    // temporarily listen for a single keypress
    const onData = (data: Buffer) => {
      const ch = data.toString().trim().toLowerCase();
      cleanup();
      if (ch === "y" || ch === "yes") {
        process.stderr.write(`${GREEN}approved${RESET}\n`);
        resolve(true);
      } else {
        process.stderr.write(`${DIM}skipped${RESET}\n`);
        resolve(false);
      }
    };

    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    process.stdin.once("data", onData);

    // if the process receives SIGINT while waiting, restore terminal and reject
    const onSignal = () => { cleanup(); resolve(false); };
    process.once("SIGINT", onSignal);
    process.once("SIGTERM", onSignal);
  });
}

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
      const parentDir = resolve(projectDir, "..");
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
    const globalCtx = loadGlobalContext(basePath);
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
  if (!existsSync(chatPath)) {
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
  mkdirSync(join(homedir(), ".aoaoe"), { recursive: true });
  const nodePath = process.execPath; // full path to current node binary
  writeFileSync(wrapperPath, `#!/bin/sh\nexec "${nodePath}" "${chatPath}"\n`);
  chmodSync(wrapperPath, 0o755);
  // trailing "--" ensures the command contains a space so AoE stores it
  const chatCmd = `${wrapperPath} --`;

  // check if already registered by looking at aoe list
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

// `aoaoe notify-test` -- send a test notification to all configured webhooks and report results
async function runNotifyTest(): Promise<void> {
  const config = loadConfig();

  if (!config.notifications) {
    console.log("");
    console.log("  no notifications configured.");
    console.log("");
    console.log("  add to your config (~/.aoaoe/aoaoe.config.json):");
    console.log('    "notifications": {');
    console.log('      "webhookUrl": "https://example.com/webhook",');
    console.log('      "slackWebhookUrl": "https://hooks.slack.com/services/...",');
    console.log('      "events": ["session_error", "session_done", "daemon_started", "daemon_stopped"]');
    console.log("    }");
    console.log("");
    return;
  }

  if (!config.notifications.webhookUrl && !config.notifications.slackWebhookUrl) {
    console.log("");
    console.log("  notifications block exists but no webhook URLs configured.");
    console.log("  add webhookUrl and/or slackWebhookUrl to your notifications config.");
    console.log("");
    return;
  }

  console.log("");
  console.log("  sending test notification...");

  const result = await sendTestNotification(config);

  console.log("");
  if (result.webhookOk !== undefined) {
    const icon = result.webhookOk ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`;
    console.log(`  ${icon} generic webhook: ${result.webhookOk ? "ok" : result.webhookError ?? "failed"}`);
  }
  if (result.slackOk !== undefined) {
    const icon = result.slackOk ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`;
    console.log(`  ${icon} slack webhook:   ${result.slackOk ? "ok" : result.slackError ?? "failed"}`);
  }
  console.log("");
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

// `aoaoe history` -- review recent actions from the persistent action log
async function showActionHistory(): Promise<void> {
  const logFile = join(homedir(), ".aoaoe", "actions.log");
  if (!existsSync(logFile)) {
    console.log("no action history found (no actions have been taken yet)");
    return;
  }

  let lines: string[];
  try {
    lines = readFileSync(logFile, "utf-8").trim().split("\n").filter((l) => l.trim());
  } catch {
    console.error("failed to read action log");
    return;
  }

  if (lines.length === 0) {
    console.log("action log is empty");
    return;
  }

  // show last 50 actions
  const recent = lines.slice(-50);

  console.log("");
  console.log(`  action history (last ${recent.length} of ${lines.length} total)`);
  console.log(`  ${"─".repeat(70)}`);

  for (const line of recent) {
    try {
      const entry = JSON.parse(line) as { timestamp: number; action: { action: string; session?: string; text?: string; title?: string }; success: boolean; detail: string };
      const time = new Date(entry.timestamp).toLocaleTimeString();
      const date = new Date(entry.timestamp).toLocaleDateString();
      const icon = entry.success ? `${GREEN}+${RESET}` : `${RED}!${RESET}`;
      const actionName = entry.action.action;
      const session = entry.action.session?.slice(0, 8) ?? entry.action.title ?? "";
      const detail = entry.detail.length > 50 ? entry.detail.slice(0, 47) + "..." : entry.detail;
      console.log(`  ${icon} ${DIM}${date} ${time}${RESET}  ${YELLOW}${actionName.padEnd(16)}${RESET} ${session.padEnd(10)} ${detail}`);
    } catch {
      // skip malformed lines
    }
  }

  console.log(`  ${"─".repeat(70)}`);

  // summary stats
  let successes = 0, failures = 0;
  const actionCounts = new Map<string, number>();
  for (const line of lines) {
    try {
      const e = JSON.parse(line) as { action: { action: string }; success: boolean };
      if (e.success) successes++; else failures++;
      actionCounts.set(e.action.action, (actionCounts.get(e.action.action) ?? 0) + 1);
    } catch {}
  }
  const breakdown = [...actionCounts.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}: ${v}`).join(", ");
  console.log(`  total: ${lines.length} actions (${GREEN}${successes} ok${RESET}, ${RED}${failures} failed${RESET})`);
  console.log(`  breakdown: ${breakdown}`);
  console.log("");
}

// `aoaoe test` -- dynamically import and run the integration test
async function runIntegrationTest(): Promise<void> {
  const testModule = resolve(__dirname, "integration-test.js");
  if (!existsSync(testModule)) {
    console.error("error: integration-test.js not found (run 'npm run build' first)");
    process.exit(1);
  }
  // the integration test is a self-contained script that runs main() on import
  await import(testModule);
}

// `aoaoe status` -- quick one-shot health check: is the daemon running? what's it doing?
function showDaemonStatus(): void {
  const state = readState();
  const running = isDaemonRunningFromState(state);
  const pkg = readPkgVersion();

  console.log("");
  console.log(`  aoaoe${pkg ? ` v${pkg}` : ""} — daemon status`);
  console.log(`  ${"─".repeat(50)}`);

  if (!running || !state) {
    console.log(`  ${RED}●${RESET} daemon is ${BOLD}not running${RESET}`);
    const configPath = findConfigFile();
    console.log(`  config: ${configPath ?? "none found (run 'aoaoe init')"}`);
    console.log("");
    console.log("  start with: aoaoe");
    console.log("  or observe: aoaoe --observe");
    console.log("");
    return;
  }

  // daemon is running — show details
  const elapsed = Date.now() - state.phaseStartedAt;
  const elapsedStr = elapsed < 60_000 ? `${Math.floor(elapsed / 1000)}s` : `${Math.floor(elapsed / 60_000)}m`;
  const phaseIcon = state.phase === "sleeping" ? `${DIM}○${RESET}` :
                    state.phase === "reasoning" ? `${YELLOW}●${RESET}` :
                    state.phase === "executing" ? `${GREEN}●${RESET}` :
                    state.phase === "polling" ? `${YELLOW}○${RESET}` :
                    `${RED}●${RESET}`;

  console.log(`  ${GREEN}●${RESET} daemon is ${BOLD}running${RESET}  (poll #${state.pollCount})`);
  console.log(`  ${phaseIcon} phase: ${state.phase} (${elapsedStr})`);
  if (state.paused) console.log(`  ${YELLOW}${BOLD}  PAUSED${RESET}`);
  console.log(`  poll interval: ${state.pollIntervalMs / 1000}s`);

  if (state.nextTickAt > Date.now()) {
    const countdown = Math.ceil((state.nextTickAt - Date.now()) / 1000);
    console.log(`  next tick: ${countdown}s`);
  }

  console.log("");

  // sessions
  if (state.sessions.length === 0) {
    console.log("  no active sessions");
  } else {
    console.log(`  ${state.sessions.length} session(s):`);
    for (const s of state.sessions) {
      const statusIcon = s.status === "working" || s.status === "running" ? `${GREEN}●${RESET}` :
                         s.status === "idle" ? `${DIM}○${RESET}` :
                         s.status === "error" ? `${RED}●${RESET}` :
                         s.status === "done" ? `${GREEN}✓${RESET}` :
                         `${DIM}?${RESET}`;
      const userTag = s.userActive ? ` ${DIM}(user active)${RESET}` : "";
      const taskTag = s.currentTask ? ` — ${DIM}${s.currentTask.slice(0, 50)}${RESET}` : "";
      console.log(`    ${statusIcon} ${BOLD}${s.title}${RESET} (${s.tool}) ${s.status}${userTag}${taskTag}`);
    }
  }

  console.log("");
}

// `aoaoe config` -- show the effective resolved config (defaults + file + any notes)
function showEffectiveConfig(): void {
  const configPath = findConfigFile();
  const configResult = loadConfig();
  // strip _configPath from output
  const { _configPath, ...config } = configResult as unknown as Record<string, unknown>;

  console.log("");
  console.log("  aoaoe — effective config");
  console.log(`  ${"─".repeat(50)}`);
  console.log(`  source: ${configPath ?? "defaults (no config file found)"}`);
  console.log("");
  console.log(JSON.stringify(config, null, 2));
  console.log("");

  // helpful notes
  if (!configPath) {
    console.log(`  ${DIM}create a config: aoaoe init${RESET}`);
    console.log("");
  }
}

main().catch((err) => {
  console.error(`fatal: ${err}`);
  process.exit(1);
});
