#!/usr/bin/env node
import { loadConfig, validateEnvironment, parseCliArgs, printHelp } from "./config.js";
import { Poller } from "./poller.js";
import { createReasoner } from "./reasoner/index.js";
import { Executor, type ActionLogEntry } from "./executor.js";
import type { AoaoeConfig, Observation, ReasonerResult } from "./types.js";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  const { overrides, help, version } = parseCliArgs(process.argv);

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

  const config = loadConfig(overrides);
  log("starting aoaoe supervisor");
  log(`reasoner: ${config.reasoner}`);
  log(`poll interval: ${config.pollIntervalMs}ms`);

  // validate tools are installed
  await validateEnvironment(config);

  const poller = new Poller(config);
  const reasoner = createReasoner(config);
  const executor = new Executor(config);

  // init reasoner (starts opencode serve, verifies claude, etc)
  log("initializing reasoner...");
  await reasoner.init();
  log("reasoner ready");

  // graceful shutdown
  let running = true;
  const shutdown = async () => {
    if (!running) return;
    running = false;
    log("shutting down...");
    await reasoner.shutdown();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // main loop
  let pollCount = 0;
  log("entering main loop (Ctrl+C to stop)\n");

  while (running) {
    pollCount++;
    try {
      await tick(config, poller, reasoner, executor, pollCount);
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
  pollCount: number
): Promise<void> {
  // 1. poll
  const observation = await poller.poll();
  const sessionCount = observation.sessions.length;
  const changeCount = observation.changes.length;

  if (sessionCount === 0) {
    if (pollCount % 6 === 1) {
      // log every ~60s when no sessions
      log("no active aoe sessions found");
    }
    return;
  }

  // status line
  const statuses = summarizeStatuses(observation);
  process.stdout.write(
    `\r[poll #${pollCount}] ${sessionCount} sessions (${statuses}) | ${changeCount} changed`
  );

  // 2. if nothing changed, skip reasoning (save tokens)
  if (changeCount === 0) {
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

  if (result.reasoning && config.verbose) {
    log(`reasoning: ${result.reasoning}`);
  }

  // 4. execute (skip if all actions are "wait")
  const nonWaitActions = result.actions.filter((a) => a.action !== "wait");
  if (nonWaitActions.length === 0) {
    return;
  }

  const entries = await executor.execute(result.actions, observation.sessions);
  for (const entry of entries) {
    if (entry.action.action === "wait") continue;
    const icon = entry.success ? "+" : "!";
    log(`[${icon}] ${entry.action.action}: ${entry.detail}`);
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

main().catch((err) => {
  console.error(`fatal: ${err}`);
  process.exit(1);
});
