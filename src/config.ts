import { readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { homedir } from "node:os";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import type { AoaoeConfig, ReasonerBackend } from "./types.js";

const execFileAsync = promisify(execFileCb);

const AOAOE_DIR = join(homedir(), ".aoaoe");
const CONFIG_NAMES = ["aoaoe.config.json", ".aoaoe.json"];

// search order: ~/.aoaoe/ first (canonical), then cwd (local override for dev)
const CONFIG_SEARCH_DIRS = [AOAOE_DIR, process.cwd()];

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
    userActivityThresholdMs: 30_000,
  },
  contextFiles: [],
  sessionDirs: {},
  protectedSessions: [],
  captureLinesCount: 100,
  verbose: false,
  dryRun: false,
  observe: false,
  confirm: false,
};

// find the first config file that exists across search dirs
export function findConfigFile(): string | null {
  for (const dir of CONFIG_SEARCH_DIRS) {
    for (const name of CONFIG_NAMES) {
      const p = resolve(dir, name);
      if (existsSync(p)) return p;
    }
  }
  return null;
}

// check if any config file exists (searches ~/.aoaoe/ then cwd)
export function configFileExists(): boolean {
  return findConfigFile() !== null;
}

// canonical config path: ~/.aoaoe/aoaoe.config.json
export function defaultConfigPath(): string {
  return join(AOAOE_DIR, CONFIG_NAMES[0]);
}

export function loadConfig(overrides?: Partial<AoaoeConfig>): AoaoeConfig {
  let fileConfig: Partial<AoaoeConfig> = {};

  const found = findConfigFile();
  if (found) {
    try {
      fileConfig = JSON.parse(readFileSync(found, "utf-8"));
      log(`loaded config from ${found}`);
    } catch (e) {
      console.error(`warning: failed to parse ${found}, using defaults`);
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
  if (typeof config.opencode?.port !== "number" || !isFinite(config.opencode.port) || config.opencode.port < 1 || config.opencode.port > 65535) {
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
  // protectedSessions must be an array of strings (crashes isProtected if string)
  if (config.protectedSessions !== undefined && !Array.isArray(config.protectedSessions)) {
    errors.push(`protectedSessions must be an array of strings, got ${typeof config.protectedSessions}`);
  }
  // sessionDirs must be a plain object with string values
  if (config.sessionDirs !== undefined && (typeof config.sessionDirs !== "object" || config.sessionDirs === null || Array.isArray(config.sessionDirs))) {
    errors.push(`sessionDirs must be an object mapping session titles to directory paths, got ${typeof config.sessionDirs}`);
  }
  // contextFiles must be an array of strings
  if (config.contextFiles !== undefined && !Array.isArray(config.contextFiles)) {
    errors.push(`contextFiles must be an array of file paths, got ${typeof config.contextFiles}`);
  }
  // claudeCode.yolo and claudeCode.resume must be booleans (string "false" is truthy)
  if (config.claudeCode?.yolo !== undefined && typeof config.claudeCode.yolo !== "boolean") {
    errors.push(`claudeCode.yolo must be a boolean, got ${typeof config.claudeCode.yolo}`);
  }
  if (config.claudeCode?.resume !== undefined && typeof config.claudeCode.resume !== "boolean") {
    errors.push(`claudeCode.resume must be a boolean, got ${typeof config.claudeCode.resume}`);
  }
  // aoe.profile must be a non-empty string
  if (config.aoe?.profile !== undefined && (typeof config.aoe.profile !== "string" || !config.aoe.profile)) {
    errors.push(`aoe.profile must be a non-empty string, got ${JSON.stringify(config.aoe?.profile)}`);
  }
  // policies.autoAnswerPermissions must be a boolean
  if (config.policies?.autoAnswerPermissions !== undefined && typeof config.policies.autoAnswerPermissions !== "boolean") {
    errors.push(`policies.autoAnswerPermissions must be a boolean, got ${typeof config.policies.autoAnswerPermissions}`);
  }
  // policies.userActivityThresholdMs must be a non-negative number
  if (config.policies?.userActivityThresholdMs !== undefined) {
    const t = config.policies.userActivityThresholdMs;
    if (typeof t !== "number" || !isFinite(t) || t < 0) {
      errors.push(`policies.userActivityThresholdMs must be a number >= 0, got ${t}`);
    }
  }
  // policies.allowDestructive must be a boolean
  if (config.policies?.allowDestructive !== undefined && typeof config.policies.allowDestructive !== "boolean") {
    errors.push(`policies.allowDestructive must be a boolean, got ${typeof config.policies.allowDestructive}`);
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
  register: boolean;
  testContext: boolean;
  runTest: boolean;
  showTasks: boolean;
  showHistory: boolean;
  runInit: boolean;
  initForce: boolean;
  runTaskCli: boolean;
  registerTitle?: string;
} {
  const overrides: Partial<AoaoeConfig> = {};
  let help = false;
  let version = false;
  let register = false;
  let testContext = false;
  let runTest = false;
  let showTasks = false;
  let runInit = false;
  let initForce = false;
  let runTaskCli = false;
  let registerTitle: string | undefined;

  const defaults = { overrides, help: false, version: false, register: false, testContext: false, runTest: false, showTasks: false, showHistory: false, runInit: false, initForce: false, runTaskCli: false };

  // check for subcommand as first non-flag arg
  if (argv[2] === "test-context") {
    return { ...defaults, testContext: true };
  }
  if (argv[2] === "test") {
    return { ...defaults, runTest: true };
  }
  if (argv[2] === "task") {
    return { ...defaults, runTaskCli: true };
  }
  if (argv[2] === "tasks") {
    return { ...defaults, showTasks: true };
  }
  if (argv[2] === "history") {
    return { ...defaults, showHistory: true };
  }
  if (argv[2] === "init") {
    const force = argv.includes("--force") || argv.includes("-f");
    return { ...defaults, runInit: true, initForce: force };
  }
  if (argv[2] === "register") {
    register = true;
    // parse --title from remaining args
    for (let i = 3; i < argv.length; i++) {
      if ((argv[i] === "--title" || argv[i] === "-t") && argv[i + 1]) {
        registerTitle = argv[++i];
      }
    }
    return { ...defaults, register, registerTitle };
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
    "--verbose", "-v", "--dry-run", "--observe", "--confirm", "--help", "-h", "--version",
  ]);

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--reasoner":
        overrides.reasoner = nextArg(i, arg) as ReasonerBackend;
        i++;
        break;
      case "--poll-interval": {
        const val = parseInt(nextArg(i, arg), 10);
        if (isNaN(val)) throw new Error(`--poll-interval value '${argv[i + 1]}' is not a valid number`);
        overrides.pollIntervalMs = val;
        i++;
        break;
      }
      case "--port": {
        const val = parseInt(nextArg(i, arg), 10);
        if (isNaN(val)) throw new Error(`--port value '${argv[i + 1]}' is not a valid number`);
        overrides.opencode = { ...overrides.opencode, port: val } as AoaoeConfig["opencode"];
        i++;
        break;
      }
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
      case "--observe":
        overrides.observe = true;
        break;
      case "--confirm":
        overrides.confirm = true;
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

  return { overrides, help, version, register: false, testContext: false, runTest: false, showTasks: false, showHistory: false, runInit: false, initForce: false, runTaskCli: false };
}

export function printHelp() {
  console.log(`aoaoe - autonomous supervisor for agent-of-empires sessions

usage: aoaoe [command] [options]

getting started:
  aoaoe init                   # detect environment, generate config
  aoaoe test-context           # see what aoaoe sees (zero side effects)
  aoaoe --dry-run              # full loop but actions are only logged
  aoaoe                        # full autonomous mode

commands:
  init           detect tools + sessions, import history, generate config
  (none)         start the supervisor daemon (interactive TUI)
  task           manage tasks and sessions (list, start, stop, new, rm, edit)
  tasks          show task progress (from aoaoe.tasks.json)
  history        review recent actions (from ~/.aoaoe/actions.log)
  test           run integration test (creates sessions, tests, cleans up)
  test-context   scan sessions + context files (read-only, no LLM, safe)
  register       register aoaoe as an AoE session (one-time setup)

options:
  --reasoner <opencode|claude-code>  reasoning backend (default: opencode)
  --poll-interval <ms>               poll interval in ms (default: 10000)
  --port <number>                    opencode server port (default: 4097)
  --model <model>                    model to use
  --profile <name>                   aoe profile (default: default)
  --dry-run                          run full loop but only log actions (costs
                                      LLM tokens, but never touches sessions)
  --observe                          observe only — no LLM calls, no execution,
                                       zero cost. shows what the daemon sees.
  --confirm                          ask before each action — the AI proposes,
                                       you approve with y/n before it runs.
  --verbose, -v                      verbose logging
  --help, -h                         show this help
  --version                          show version

init options:
  --force, -f                        overwrite existing config

register options:
  --title, -t <name>                 session title in AoE (default: aoaoe)

config file location (searched in order):
  1. ~/.aoaoe/aoaoe.config.json   (canonical, written by 'aoaoe init')
  2. ./aoaoe.config.json           (local override for development)
  3. ./.aoaoe.json                  (alternate name)

example config:
  {
    "reasoner": "opencode",
    "pollIntervalMs": 15000,
    "opencode": { "port": 4097 },
    "sessionDirs": {
      "my-project": "/path/to/my-project",
      "other-repo": "/path/to/other-repo"
    }
  }

  sessionDirs maps aoe session titles to project directories.
  aoaoe loads AGENTS.md, claude.md, and other AI instruction files
  from each project directory to give the reasoner per-session context.

interactive commands (while daemon is running):
  /help          show available commands
  /explain       ask the AI to explain what's happening in plain English
  /status        request daemon status
  /dashboard     request full dashboard output
  /pause         pause the daemon
  /resume        resume the daemon
  /interrupt     interrupt the current reasoner call
  /verbose       toggle verbose logging
  /clear         clear the screen
  ESC ESC        interrupt the current reasoner (shortcut)
  (anything)     send a message to the AI — it reads your input next cycle`);
}
