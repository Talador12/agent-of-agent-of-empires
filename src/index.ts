#!/usr/bin/env node
import { loadConfig, validateEnvironment, parseCliArgs, printHelp } from "./config.js";
import { Poller } from "./poller.js";
import { createReasoner } from "./reasoner/index.js";
import { Executor, type ActionLogEntry } from "./executor.js";
import { printDashboard } from "./dashboard.js";
import { InputReader } from "./input.js";
import { ReasonerConsole } from "./console.js";
import type { AoaoeConfig, Observation, ReasonerResult } from "./types.js";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  const { overrides, help, version, attach } = parseCliArgs(process.argv);

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

  const config = loadConfig(overrides);
  log("starting aoaoe supervisor");
  log(`reasoner: ${config.reasoner}`);
  log(`poll interval: ${config.pollIntervalMs}ms`);
  if (config.dryRun) log("DRY RUN -- will observe and reason but not execute");

  // validate tools are installed
  await validateEnvironment(config);

  const poller = new Poller(config);
  const reasoner = createReasoner(config);
  const executor = new Executor(config);
  const input = new InputReader();
  const console_ = new ReasonerConsole();

  // init reasoner (starts opencode serve, verifies claude, etc)
  log("initializing reasoner...");
  await reasoner.init();
  log("reasoner ready");

  // start interactive input listener (stdin fallback) and console tmux session
  input.start();
  await console_.start();
  log(`reasoner console ready -- run 'aoaoe attach' to enter`);

  // graceful shutdown
  let running = true;
  const shutdown = async () => {
    if (!running) return;
    running = false;
    log("shutting down...");
    input.stop();
    await console_.stop();
    await reasoner.shutdown();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // main loop
  let pollCount = 0;
  let forceDashboard = false;
  log("entering main loop (Ctrl+C to stop)\n");

  while (running) {
    pollCount++;

    // drain user input from both stdin and console tmux session
    const stdinMessages = input.drain();
    const consoleMessages = console_.drainInput();
    const userMessages = [...stdinMessages, ...consoleMessages];
    let userMessage: string | undefined;

    // handle built-in command markers
    for (const msg of userMessages) {
      if (msg === "__CMD_STATUS__") {
        log(`status: poll #${pollCount}, reasoner=${config.reasoner}, paused=${input.isPaused()}, dry-run=${config.dryRun}`);
      } else if (msg === "__CMD_DASHBOARD__") {
        forceDashboard = true;
      } else if (msg === "__CMD_VERBOSE__") {
        config.verbose = !config.verbose;
        log(`verbose: ${config.verbose ? "on" : "off"}`);
      } else {
        // real user message -- combine if multiple
        userMessage = userMessage ? `${userMessage}\n${msg}` : msg;
      }
    }

    if (input.isPaused()) {
      if (pollCount % 6 === 1) log("paused (type /resume to continue)");
      await sleep(config.pollIntervalMs);
      continue;
    }

    try {
      await tick(config, poller, reasoner, executor, console_, pollCount, userMessage, forceDashboard);
      forceDashboard = false;
    } catch (err) {
      console.error(`[error] tick ${pollCount} failed: ${err}`);
    }

    if (running) {
      await sleep(config.pollIntervalMs);
    }
  }
}

async function tick(
  config: AoaoeConfig,
  poller: Poller,
  reasoner: ReturnType<typeof createReasoner>,
  executor: Executor,
  console_: ReasonerConsole,
  pollCount: number,
  userMessage?: string,
  forceDashboard?: boolean
): Promise<void> {
  // 1. poll
  const observation = await poller.poll();
  const sessionCount = observation.sessions.length;
  const changeCount = observation.changes.length;

  // attach user message to observation if present
  if (userMessage) {
    observation.userMessage = userMessage;
    console_.writeUserMessage(userMessage);
  }

  if (sessionCount === 0 && !userMessage) {
    if (pollCount % 6 === 1) {
      // log every ~60s when no sessions
      log("no active aoe sessions found");
    }
    return;
  }

  // dashboard every 6 polls (~60s at default interval), or on demand
  if (forceDashboard || pollCount % 6 === 1) {
    printDashboard(observation, executor.getRecentLog(), pollCount, config);
  }

  // status line
  const statuses = summarizeStatuses(observation);
  const userTag = userMessage ? " | +operator msg" : "";
  process.stdout.write(
    `\r[poll #${pollCount}] ${sessionCount} sessions (${statuses}) | ${changeCount} changed${userTag}`
  );

  // write observation to console
  if (changeCount > 0) {
    const changeSummary = observation.changes.map(
      (c) => `${c.title} (${c.tool}): ${c.status}`
    );
    console_.writeObservation(sessionCount, changeCount, changeSummary);
  }

  // 2. if nothing changed AND no user message, skip reasoning (save tokens)
  if (changeCount === 0 && !userMessage) {
    if (config.verbose) {
      process.stdout.write(" | no changes, skipping reasoner\n");
    }
    return;
  }

  process.stdout.write(" | reasoning...");

  // 3. reason (with timeout to avoid blocking the loop)
  const result = await withTimeout(
    reasoner.decide(observation),
    90_000, // 90s max for a single reasoning call
    { actions: [{ action: "wait" as const, reason: "reasoner timeout" }] }
  );

  const actionSummary = result.actions.map((a) => a.action).join(", ");
  process.stdout.write(` -> ${actionSummary}\n`);

  if (result.reasoning) {
    console_.writeReasoning(result.reasoning);
    if (config.verbose) log(`reasoning: ${result.reasoning}`);
  }

  // 4. execute (skip if all actions are "wait")
  const nonWaitActions = result.actions.filter((a) => a.action !== "wait");
  if (nonWaitActions.length === 0) {
    return;
  }

  // dry-run: log what would happen, don't actually execute
  if (config.dryRun) {
    for (const action of nonWaitActions) {
      const msg = `would ${action.action}: ${JSON.stringify(action)}`;
      log(`[dry-run] ${msg}`);
      console_.writeAction(action.action, "dry-run", true);
    }
    return;
  }

  const entries = await executor.execute(result.actions, observation.sessions);
  for (const entry of entries) {
    if (entry.action.action === "wait") continue;
    const icon = entry.success ? "+" : "!";
    log(`[${icon}] ${entry.action.action}: ${entry.detail}`);
    console_.writeAction(entry.action.action, entry.detail, entry.success);
  }
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => {
      log(`reasoner timed out after ${ms}ms, using fallback`);
      resolve(fallback);
    }, ms)),
  ]);
}

// `aoaoe attach` -- enter the reasoner console tmux session
async function attachToConsole(): Promise<void> {
  const { execQuiet } = await import("./shell.js");
  const name = ReasonerConsole.sessionName();

  // check if the session exists
  const exists = await execQuiet("tmux", ["has-session", "-t", name]);
  if (!exists) {
    console.error(`no running aoaoe session found (looking for tmux session '${name}')`);
    console.error("start the daemon first: aoaoe");
    process.exit(1);
  }

  // attach -- replace this process with tmux attach
  const { execFileSync } = await import("node:child_process");
  try {
    execFileSync("tmux", ["attach-session", "-t", name], { stdio: "inherit" });
  } catch {
    // normal exit when user detaches
  }
}

main().catch((err) => {
  console.error(`fatal: ${err}`);
  process.exit(1);
});
