import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import type { AoaoeConfig, ReasonerBackend } from "./types.js";

const execFileAsync = promisify(execFileCb);

const DEFAULTS: AoaoeConfig = {
  reasoner: "opencode",
  pollIntervalMs: 10_000,
  opencode: {
    port: 4097,
  },
  claudeCode: {
    yolo: true,
    resume: true,
  },
  aoe: {
    profile: "default",
  },
  policies: {
    maxIdleBeforeNudgeMs: 120_000,
    maxErrorsBeforeRestart: 3,
    autoAnswerPermissions: true,
  },
  contextFiles: [],
  sessionDirs: {},
  captureLinesCount: 100,
  verbose: false,
  dryRun: false,
};

const CONFIG_NAMES = ["aoaoe.config.json", ".aoaoe.json"];

export function loadConfig(overrides?: Partial<AoaoeConfig>): AoaoeConfig {
  let fileConfig: Partial<AoaoeConfig> = {};

  for (const name of CONFIG_NAMES) {
    const p = resolve(process.cwd(), name);
    if (existsSync(p)) {
      try {
        fileConfig = JSON.parse(readFileSync(p, "utf-8"));
        log(`loaded config from ${p}`);
      } catch (e) {
        console.error(`warning: failed to parse ${p}, using defaults`);
      }
      break;
    }
  }

  const config = deepMerge(
    DEFAULTS as unknown as Record<string, unknown>,
    fileConfig as Record<string, unknown>,
    (overrides ?? {}) as Record<string, unknown>,
  );
  validateConfig(config);
  return config;
}

// validate config values to catch bad configs at startup rather than runtime
export function validateConfig(config: AoaoeConfig): void {
  const errors: string[] = [];

  if (config.reasoner !== "opencode" && config.reasoner !== "claude-code") {
    errors.push(`reasoner must be "opencode" or "claude-code", got "${config.reasoner}"`);
  }
  if (typeof config.pollIntervalMs !== "number" || config.pollIntervalMs < 1000 || !isFinite(config.pollIntervalMs)) {
    errors.push(`pollIntervalMs must be a number >= 1000, got ${config.pollIntervalMs}`);
  }
  if (typeof config.captureLinesCount !== "number" || config.captureLinesCount < 1 || !isFinite(config.captureLinesCount)) {
    errors.push(`captureLinesCount must be a positive number, got ${config.captureLinesCount}`);
  }
  if (typeof config.opencode?.port !== "number" || config.opencode.port < 1 || config.opencode.port > 65535) {
    errors.push(`opencode.port must be 1-65535, got ${config.opencode?.port}`);
  }
  if (typeof config.policies?.maxErrorsBeforeRestart !== "number" || config.policies.maxErrorsBeforeRestart < 1) {
    errors.push(`policies.maxErrorsBeforeRestart must be >= 1, got ${config.policies?.maxErrorsBeforeRestart}`);
  }
  // maxIdleBeforeNudgeMs: 0 would flag every session as idle every poll cycle
  if (config.policies?.maxIdleBeforeNudgeMs !== undefined) {
    const idle = config.policies.maxIdleBeforeNudgeMs;
    if (typeof idle !== "number" || !isFinite(idle) || idle < config.pollIntervalMs) {
      errors.push(`policies.maxIdleBeforeNudgeMs must be a finite number >= pollIntervalMs (${config.pollIntervalMs}), got ${idle}`);
    }
  }
  // actionCooldownMs: 0 would disable rate limiting entirely
  if (config.policies?.actionCooldownMs !== undefined) {
    const cd = config.policies.actionCooldownMs;
    if (typeof cd !== "number" || !isFinite(cd) || cd < 1000) {
      errors.push(`policies.actionCooldownMs must be a finite number >= 1000, got ${cd}`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`invalid config:\n  ${errors.join("\n  ")}`);
  }
}

// validate that required tools are on PATH
export async function validateEnvironment(config: AoaoeConfig): Promise<void> {
  const missing: string[] = [];

  if (!(await which("aoe"))) missing.push("aoe (agent-of-empires)");
  if (!(await which("tmux"))) missing.push("tmux");

  if (config.reasoner === "opencode" && !(await which("opencode"))) {
    missing.push("opencode");
  }
  if (config.reasoner === "claude-code" && !(await which("claude"))) {
    missing.push("claude (Claude Code)");
  }

  if (missing.length > 0) {
    throw new Error(`missing required tools: ${missing.join(", ")}`);
  }
}

async function which(cmd: string): Promise<boolean> {
  try {
    await execFileAsync("which", [cmd]);
    return true;
  } catch {
    return false;
  }
}

// exported for testing
export function deepMerge(...objects: Record<string, unknown>[]): AoaoeConfig {
  const result: Record<string, unknown> = {};
  for (const obj of objects) {
    for (const [key, val] of Object.entries(obj)) {
      if (val !== undefined && val !== null) {
        // empty objects ({}) replace rather than merge — allows clearing sessionDirs etc.
        if (typeof val === "object" && !Array.isArray(val) && Object.keys(val as object).length > 0 && typeof result[key] === "object") {
          result[key] = deepMerge(result[key] as Record<string, unknown>, val as Record<string, unknown>);
        } else {
          result[key] = val;
        }
      }
    }
  }
  return result as unknown as AoaoeConfig;
}

function log(msg: string) {
  console.error(`[config] ${msg}`);
}

export function parseCliArgs(argv: string[]): {
  overrides: Partial<AoaoeConfig>;
  help: boolean;
  version: boolean;
  attach: boolean;
  register: boolean;
  testContext: boolean;
  runTest: boolean;
  showTasks: boolean;
  registerTitle?: string;
} {
  const overrides: Partial<AoaoeConfig> = {};
  let help = false;
  let version = false;
  let attach = false;
  let register = false;
  let testContext = false;
  let runTest = false;
  let showTasks = false;
  let registerTitle: string | undefined;

  // check for subcommand as first non-flag arg
  if (argv[2] === "attach") {
    return { overrides, help: false, version: false, attach: true, register: false, testContext: false, runTest: false, showTasks: false };
  }
  if (argv[2] === "test-context") {
    return { overrides, help: false, version: false, attach: false, register: false, testContext: true, runTest: false, showTasks: false };
  }
  if (argv[2] === "test") {
    return { overrides, help: false, version: false, attach: false, register: false, testContext: false, runTest: true, showTasks: false };
  }
  if (argv[2] === "tasks") {
    return { overrides, help: false, version: false, attach: false, register: false, testContext: false, runTest: false, showTasks: true };
  }
  if (argv[2] === "register") {
    register = true;
    // parse --title from remaining args
    for (let i = 3; i < argv.length; i++) {
      if ((argv[i] === "--title" || argv[i] === "-t") && argv[i + 1]) {
        registerTitle = argv[++i];
      }
    }
    return { overrides, help: false, version: false, attach: false, register, testContext: false, runTest: false, showTasks: false, registerTitle };
  }

  // helper: consume next arg with bounds check
  const nextArg = (i: number, flag: string): string => {
    if (i + 1 >= argv.length) {
      throw new Error(`${flag} requires a value`);
    }
    return argv[i + 1];
  };

  const knownFlags = new Set([
    "--reasoner", "--poll-interval", "--port", "--model", "--profile",
    "--verbose", "-v", "--dry-run", "--help", "-h", "--version",
  ]);

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--reasoner":
        overrides.reasoner = nextArg(i, arg) as ReasonerBackend;
        i++;
        break;
      case "--poll-interval":
        overrides.pollIntervalMs = parseInt(nextArg(i, arg), 10);
        i++;
        break;
      case "--port":
        overrides.opencode = { ...overrides.opencode, port: parseInt(nextArg(i, arg), 10) } as AoaoeConfig["opencode"];
        i++;
        break;
      case "--model": {
        // applies to whichever backend is selected
        const model = nextArg(i, arg);
        overrides.opencode = { ...overrides.opencode, model } as AoaoeConfig["opencode"];
        overrides.claudeCode = { ...overrides.claudeCode, model } as AoaoeConfig["claudeCode"];
        i++;
        break;
      }
      case "--profile":
        overrides.aoe = { profile: nextArg(i, arg) };
        i++;
        break;
      case "--verbose":
      case "-v":
        overrides.verbose = true;
        break;
      case "--dry-run":
        overrides.dryRun = true;
        break;
      case "--help":
      case "-h":
        help = true;
        break;
      case "--version":
        version = true;
        break;
      default:
        if (arg.startsWith("--") || (arg.startsWith("-") && arg.length === 2)) {
          if (!knownFlags.has(arg)) {
            console.error(`warning: unknown flag '${arg}' (ignored)`);
          }
        }
        break;
    }
  }

  return { overrides, help, version, attach, register: false, testContext: false, runTest: false, showTasks: false };
}

export function printHelp() {
  console.log(`aoaoe - autonomous supervisor for agent-of-empires sessions

usage: aoaoe [command] [options]

commands:
  (none)         start the supervisor daemon (polls, reasons, executes)
  tasks          show task progress (from aoaoe.tasks.json)
  test           run integration test (creates sessions, tests, cleans up)
  test-context   scan sessions + context files (read-only, no LLM, safe)
  register       register aoaoe as an AoE session (one-time setup)
  attach         enter the reasoner console (Ctrl+B D to detach)

try it alongside running sessions:
  aoaoe test-context           # see what aoaoe sees (zero side effects)
  aoaoe --dry-run              # full loop but actions are only logged
  aoaoe                        # full autonomous mode
  aoaoe test                   # end-to-end integration test (~30s)

options:
  --reasoner <opencode|claude-code>  reasoning backend (default: opencode)
  --poll-interval <ms>               poll interval in ms (default: 10000)
  --port <number>                    opencode server port (default: 4097)
  --model <model>                    model to use
  --profile <name>                   aoe profile (default: default)
  --dry-run                          run full loop but only log actions (costs
                                     LLM tokens, but never touches sessions)
  --verbose, -v                      verbose logging
  --help, -h                         show this help
  --version                          show version

register options:
  --title, -t <name>                 session title in AoE (default: aoaoe)

console commands (inside reasoner chat):
  /help          show available commands
  /status        request daemon status
  /dashboard     request dashboard output
  /pause         pause the daemon
  /resume        resume the daemon
  /clear         clear the screen
  (anything)     send a message to the reasoner`);
}
