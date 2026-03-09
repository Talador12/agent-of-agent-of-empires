#!/usr/bin/env node
import { loadConfig, validateEnvironment, parseCliArgs, printHelp } from "./config.js";
import { Poller } from "./poller.js";
import { createReasoner } from "./reasoner/index.js";
import { Executor, type ActionLogEntry } from "./executor.js";
import { printDashboard } from "./dashboard.js";
import { InputReader } from "./input.js";
import { ReasonerConsole } from "./console.js";
import { writeState, buildSessionStates, checkInterrupt, clearInterrupt, cleanupState } from "./daemon-state.js";
import { type SessionPolicyState, detectPermissionPrompt } from "./reasoner/prompt.js";
import type { AoaoeConfig, Observation, ReasonerResult } from "./types.js";
import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  const { overrides, help, version, attach, register, registerTitle } = parseCliArgs(process.argv);

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
    cleanupState();
    process.exit(0);
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
    const consoleMessages = console_.drainInput();
    const userMessages = [...stdinMessages, ...consoleMessages];
    let userMessage: string | undefined;

    // handle built-in command markers (from stdin or chat.ts file IPC)
    for (const msg of userMessages) {
      if (msg === "__CMD_STATUS__") {
        const isPausedNow = paused || input.isPaused();
        log(`status: poll #${pollCount}, reasoner=${config.reasoner}, paused=${isPausedNow}, dry-run=${config.dryRun}`);
        console_.writeSystem(`status: poll #${pollCount}, reasoner=${config.reasoner}, paused=${isPausedNow}, dry-run=${config.dryRun}`);
      } else if (msg === "__CMD_DASHBOARD__") {
        forceDashboard = true;
      } else if (msg === "__CMD_VERBOSE__") {
        config.verbose = !config.verbose;
        log(`verbose: ${config.verbose ? "on" : "off"}`);
        console_.writeSystem(`verbose: ${config.verbose ? "on" : "off"}`);
      } else if (msg === "__CMD_PAUSE__") {
        paused = true;
        log("paused via console");
        console_.writeSystem("paused -- reasoner will not be called until /resume");
      } else if (msg === "__CMD_RESUME__") {
        paused = false;
        log("resumed via console");
        console_.writeSystem("resumed");
      } else if (msg === "__CMD_INTERRUPT__") {
        // interrupt is handled inside tick() via the flag file; clear it here if no tick is running
        log("interrupt requested (will take effect during next reasoning call)");
      } else {
        // real user message -- combine if multiple
        userMessage = userMessage ? `${userMessage}\n${msg}` : msg;
      }
    }

    // check pause from both stdin input and console commands
    const isPaused = paused || input.isPaused();
    if (isPaused) {
      if (pollCount % 6 === 1) log("paused (type /resume to continue)");
      writeState("sleeping", { paused: true, pollCount, pollIntervalMs: config.pollIntervalMs, nextTickAt: Date.now() + config.pollIntervalMs });
      await sleep(config.pollIntervalMs);
      continue;
    }

    try {
      const interrupted = await tick(config, poller, reasoner, executor, console_, pollCount, policyStates, userMessage, forceDashboard);
      forceDashboard = false;

      // if the reasoner was interrupted, wait for user input before continuing
      if (interrupted) {
        writeState("interrupted", { pollCount, pollIntervalMs: config.pollIntervalMs });
        console_.writeSystem("reasoner interrupted -- type a message to continue, or wait for next cycle");
        log("interrupted -- waiting for user input (up to 60s)");

        const injected = await waitForInput(input, console_, 60_000);
        if (injected) {
          // feed the injected message into the next tick as a user message
          input.inject(injected);
          log(`received post-interrupt input, continuing`);
          console_.writeSystem("resuming with your input");
        }
        clearInterrupt();
      }
    } catch (err) {
      console.error(`[error] tick ${pollCount} failed: ${err}`);
    }

    if (running) {
      const nextTickAt = Date.now() + config.pollIntervalMs;
      writeState("sleeping", { pollCount, pollIntervalMs: config.pollIntervalMs, nextTickAt, paused: false });
      await sleep(config.pollIntervalMs);
    }
  }
}

// returns true if the reasoner was interrupted
async function tick(
  config: AoaoeConfig,
  poller: Poller,
  reasoner: ReturnType<typeof createReasoner>,
  executor: Executor,
  console_: ReasonerConsole,
  pollCount: number,
  policyStates: Map<string, SessionPolicyState>,
  userMessage?: string,
  forceDashboard?: boolean
): Promise<boolean> {
  // 1. poll
  writeState("polling", { pollCount, pollIntervalMs: config.pollIntervalMs, tickStartedAt: Date.now() });
  const observation = await poller.poll();
  const sessionCount = observation.sessions.length;
  const changeCount = observation.changes.length;

  // update state with session info
  const sessionStates = buildSessionStates(observation);
  writeState("polling", { pollCount, sessionCount, changeCount, sessions: sessionStates });

  // update per-session policy tracking (idle time, error counts, permission prompts)
  const now = Date.now();
  const changedIds = new Set(observation.changes.map((c) => c.sessionId));
  for (const snap of observation.sessions) {
    const sid = snap.session.id;
    let ps = policyStates.get(sid);
    if (!ps) {
      ps = { sessionId: sid, lastOutputChangeAt: now, consecutiveErrorPolls: 0, hasPermissionPrompt: false };
      policyStates.set(sid, ps);
    }
    // update idle tracking: reset timer when output changed
    if (changedIds.has(sid)) {
      ps.lastOutputChangeAt = now;
    }
    // update error counter
    if (snap.session.status === "error") {
      ps.consecutiveErrorPolls++;
    } else {
      ps.consecutiveErrorPolls = 0;
    }
    // detect permission prompts in recent output
    ps.hasPermissionPrompt = detectPermissionPrompt(snap.output);
  }
  // prune policy states for sessions that no longer exist
  const activeIds = new Set(observation.sessions.map((s) => s.session.id));
  for (const key of policyStates.keys()) {
    if (!activeIds.has(key)) policyStates.delete(key);
  }

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
    return false;
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

  // check if any policy alerts should force reasoning even without output changes
  const policyAlerts = [...policyStates.values()].filter((ps) =>
    (now - ps.lastOutputChangeAt >= config.policies.maxIdleBeforeNudgeMs) ||
    (ps.consecutiveErrorPolls >= config.policies.maxErrorsBeforeRestart) ||
    (ps.hasPermissionPrompt && config.policies.autoAnswerPermissions)
  );
  const hasPolicyAlerts = policyAlerts.length > 0;

  // 2. if nothing changed AND no user message AND no policy alerts, skip reasoning
  if (changeCount === 0 && !userMessage && !hasPolicyAlerts) {
    if (config.verbose) {
      process.stdout.write(" | no changes, skipping reasoner\n");
    }
    return false;
  }

  // attach policy context to observation so formatObservation can annotate the prompt
  observation.policyContext = {
    policies: config.policies,
    sessionStates: [...policyStates.values()],
  };

  process.stdout.write(" | reasoning...");
  writeState("reasoning", { pollCount, sessionCount, changeCount, sessions: sessionStates });

  // 3. reason (with timeout + interrupt support)
  const { result, interrupted } = await withTimeoutAndInterrupt(
    reasoner.decide(observation),
    90_000, // 90s max for a single reasoning call
    { actions: [{ action: "wait" as const, reason: "reasoner timeout" }] }
  );

  if (interrupted) {
    process.stdout.write(" INTERRUPTED\n");
    console_.writeSystem("reasoner interrupted by operator");
    return true;
  }

  const actionSummary = result.actions.map((a) => a.action).join(", ");
  process.stdout.write(` -> ${actionSummary}\n`);

  if (result.reasoning) {
    console_.writeReasoning(result.reasoning);
    if (config.verbose) log(`reasoning: ${result.reasoning}`);
  }

  // 4. execute (skip if all actions are "wait")
  const nonWaitActions = result.actions.filter((a) => a.action !== "wait");
  if (nonWaitActions.length === 0) {
    return false;
  }

  writeState("executing", { pollCount, sessionCount, changeCount, sessions: sessionStates });

  // dry-run: log what would happen, don't actually execute
  if (config.dryRun) {
    for (const action of nonWaitActions) {
      const msg = `would ${action.action}: ${JSON.stringify(action)}`;
      log(`[dry-run] ${msg}`);
      console_.writeAction(action.action, "dry-run", true);
    }
    return false;
  }

  const entries = await executor.execute(result.actions, observation.sessions);
  for (const entry of entries) {
    if (entry.action.action === "wait") continue;
    const icon = entry.success ? "+" : "!";
    log(`[${icon}] ${entry.action.action}: ${entry.detail}`);
    console_.writeAction(entry.action.action, entry.detail, entry.success);
  }
  return false;
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

// race the reasoner against both a timeout and the interrupt flag file
function withTimeoutAndInterrupt<T>(
  promise: Promise<T>,
  ms: number,
  fallback: T
): Promise<{ result: T; interrupted: boolean }> {
  return new Promise((resolve) => {
    let settled = false;

    // poll for interrupt flag every 300ms
    const interruptInterval = setInterval(() => {
      if (settled) return;
      if (checkInterrupt()) {
        settled = true;
        clearInterval(interruptInterval);
        clearTimeout(timer);
        clearInterrupt();
        resolve({ result: fallback, interrupted: true });
      }
    }, 300);

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      clearInterval(interruptInterval);
      log(`reasoner timed out after ${ms}ms, using fallback`);
      resolve({ result: fallback, interrupted: false });
    }, ms);

    promise.then((result) => {
      if (settled) return;
      settled = true;
      clearInterval(interruptInterval);
      clearTimeout(timer);
      resolve({ result, interrupted: false });
    }).catch(() => {
      if (settled) return;
      settled = true;
      clearInterval(interruptInterval);
      clearTimeout(timer);
      resolve({ result: fallback, interrupted: false });
    });
  });
}

// after an interrupt, wait for user input before resuming the main loop
async function waitForInput(
  input: InputReader,
  console_: ReasonerConsole,
  maxWaitMs: number
): Promise<string | null> {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    // check stdin input
    const stdinMsgs = input.drain();
    const consoleMsgs = console_.drainInput();
    const msgs = [...stdinMsgs, ...consoleMsgs].filter(
      (m) => !m.startsWith("__CMD_")
    );
    if (msgs.length > 0) return msgs.join("\n");
    await sleep(500);
  }
  return null;
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
