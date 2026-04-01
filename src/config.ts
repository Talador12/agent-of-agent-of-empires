import { readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { homedir } from "node:os";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { toReasonerBackend } from "./types.js";
import type { AoaoeConfig, ReasonerBackend } from "./types.js";

const execFileAsync = promisify(execFileCb);

const AOAOE_DIR = join(homedir(), ".aoaoe");
const CONFIG_NAMES = ["aoaoe.config.json", ".aoaoe.json"];

// search order: ~/.aoaoe/ first (canonical), then cwd (local override for dev)
const CONFIG_SEARCH_DIRS = [AOAOE_DIR, process.cwd()];

export const DEFAULTS: AoaoeConfig = {
  reasoner: "opencode",
  pollIntervalMs: 10_000,
  reasonIntervalMs: 60_000,
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

export function loadConfig(overrides?: Partial<AoaoeConfig>): AoaoeConfig & { _configPath?: string } {
  let fileConfig: Partial<AoaoeConfig> = {};

  const found = findConfigFile();
  if (found) {
    try {
      const raw = JSON.parse(readFileSync(found, "utf-8"));
      warnUnknownKeys(raw, found);
      fileConfig = raw;
      log(`loaded config from ${found}`);
    } catch (e) {
      if (e instanceof SyntaxError) {
        console.error(`warning: failed to parse ${found}, using defaults`);
      } else {
        throw e; // re-throw validation errors from warnUnknownKeys
      }
    }
  }

  const config = deepMerge(
    DEFAULTS as unknown as Record<string, unknown>,
    fileConfig as Record<string, unknown>,
    (overrides ?? {}) as Record<string, unknown>,
  );
  validateConfig(config);
  return { ...config, _configPath: found ?? undefined };
}

// known top-level and nested config keys — used to warn on typos
const KNOWN_KEYS: Record<string, Set<string> | true> = {
  reasoner: true, pollIntervalMs: true, reasonIntervalMs: true, captureLinesCount: true,
  verbose: true, dryRun: true, observe: true, confirm: true,
  contextFiles: true, sessionDirs: true, protectedSessions: true, healthPort: true, tuiHistoryRetentionDays: true,
  opencode: new Set(["port", "model"]),
  claudeCode: new Set(["model", "yolo", "resume"]),
  aoe: new Set(["profile"]),
  policies: new Set([
    "maxIdleBeforeNudgeMs", "maxErrorsBeforeRestart", "autoAnswerPermissions",
    "actionCooldownMs", "userActivityThresholdMs", "allowDestructive",
  ]),
  notifications: new Set(["webhookUrl", "slackWebhookUrl", "events", "maxRetries"]),
};

export function warnUnknownKeys(raw: unknown, source: string): void {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
  const obj = raw as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (!(key in KNOWN_KEYS)) {
      console.error(`warning: unknown config key "${key}" in ${source} (typo?)`);
      continue;
    }
    // check nested keys for known sub-objects
    const schema = KNOWN_KEYS[key];
    if (schema instanceof Set && obj[key] && typeof obj[key] === "object" && !Array.isArray(obj[key])) {
      for (const subKey of Object.keys(obj[key] as Record<string, unknown>)) {
        if (!schema.has(subKey)) {
          console.error(`warning: unknown config key "${key}.${subKey}" in ${source} (typo?)`);
        }
      }
    }
  }
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
  if (typeof config.reasonIntervalMs !== "number" || config.reasonIntervalMs < config.pollIntervalMs || !isFinite(config.reasonIntervalMs)) {
    errors.push(`reasonIntervalMs must be a number >= pollIntervalMs (${config.pollIntervalMs}), got ${config.reasonIntervalMs}`);
  }
  if (typeof config.captureLinesCount !== "number" || config.captureLinesCount < 1 || !isFinite(config.captureLinesCount)) {
    errors.push(`captureLinesCount must be a positive number, got ${config.captureLinesCount}`);
  }
  if (typeof config.opencode?.port !== "number" || !isFinite(config.opencode.port) || config.opencode.port < 1 || config.opencode.port > 65535) {
    errors.push(`opencode.port must be 1-65535, got ${config.opencode?.port}`);
  }
  if (config.healthPort !== undefined) {
    if (typeof config.healthPort !== "number" || !isFinite(config.healthPort) || config.healthPort < 1 || config.healthPort > 65535) {
      errors.push(`healthPort must be 1-65535, got ${config.healthPort}`);
    }
  }
  // tuiHistoryRetentionDays: must be a positive integer, 1-365
  if (config.tuiHistoryRetentionDays !== undefined) {
    const d = config.tuiHistoryRetentionDays;
    if (typeof d !== "number" || !isFinite(d) || !Number.isInteger(d) || d < 1 || d > 365) {
      errors.push(`tuiHistoryRetentionDays must be an integer 1-365, got ${d}`);
    }
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
  // notifications.webhookUrl must be a string starting with http:// or https://
  if (config.notifications?.webhookUrl !== undefined) {
    const u = config.notifications.webhookUrl;
    if (typeof u !== "string" || (!u.startsWith("http://") && !u.startsWith("https://"))) {
      errors.push(`notifications.webhookUrl must be a URL starting with http:// or https://, got ${JSON.stringify(u)}`);
    }
  }
  // notifications.slackWebhookUrl must be a string starting with http:// or https://
  if (config.notifications?.slackWebhookUrl !== undefined) {
    const u = config.notifications.slackWebhookUrl;
    if (typeof u !== "string" || (!u.startsWith("http://") && !u.startsWith("https://"))) {
      errors.push(`notifications.slackWebhookUrl must be a URL starting with http:// or https://, got ${JSON.stringify(u)}`);
    }
  }
  // notifications.events must be an array of valid NotificationEvent values
  if (config.notifications?.events !== undefined) {
    const VALID_EVENTS = new Set(["session_error", "session_done", "action_executed", "action_failed", "daemon_started", "daemon_stopped"]);
    if (!Array.isArray(config.notifications.events)) {
      errors.push(`notifications.events must be an array, got ${typeof config.notifications.events}`);
    } else {
      for (const e of config.notifications.events) {
        if (!VALID_EVENTS.has(e)) {
          errors.push(`notifications.events contains invalid event "${e}"`);
        }
      }
    }
  }

  // notifications.maxRetries must be a non-negative integer
  if (config.notifications?.maxRetries !== undefined) {
    const r = config.notifications.maxRetries;
    if (typeof r !== "number" || !isFinite(r) || r < 0 || !Number.isInteger(r)) {
      errors.push(`notifications.maxRetries must be a non-negative integer, got ${r}`);
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

// internal recursive merge on plain Record objects (no type assertions needed)
function mergeRecords(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  for (const [key, val] of Object.entries(source)) {
    if (val !== undefined && val !== null) {
      const existing = target[key];
      // empty objects ({}) replace rather than merge — allows clearing sessionDirs etc.
      if (
        typeof val === "object" && !Array.isArray(val) &&
        typeof existing === "object" && existing !== null && !Array.isArray(existing) &&
        Object.keys(val).length > 0
      ) {
        target[key] = mergeRecords({ ...(existing as Record<string, unknown>) }, val as Record<string, unknown>);
      } else {
        target[key] = val;
      }
    }
  }
  return target;
}

// exported for testing — merges config objects with nested object support
export function deepMerge(...objects: Record<string, unknown>[]): AoaoeConfig {
  let result: Record<string, unknown> = {};
  for (const obj of objects) {
    result = mergeRecords(result, obj);
  }
  // validated by caller (validateConfig) before use — safe cast
  return result as unknown as AoaoeConfig;
}

// compute fields that differ between two config objects (flat dot-notation paths)
// exported for testing
export function computeConfigDiff(
  current: Record<string, unknown>,
  defaults: Record<string, unknown>,
  prefix = "",
): Array<{ path: string; current: unknown; default: unknown }> {
  const diffs: Array<{ path: string; current: unknown; default: unknown }> = [];
  const allKeys = new Set([...Object.keys(current), ...Object.keys(defaults)]);
  for (const key of allKeys) {
    const fullPath = prefix ? `${prefix}.${key}` : key;
    const curVal = current[key];
    const defVal = defaults[key];

    // both are plain objects — recurse
    if (
      curVal && defVal &&
      typeof curVal === "object" && !Array.isArray(curVal) &&
      typeof defVal === "object" && !Array.isArray(defVal)
    ) {
      diffs.push(...computeConfigDiff(
        curVal as Record<string, unknown>,
        defVal as Record<string, unknown>,
        fullPath,
      ));
      continue;
    }

    // compare with JSON.stringify for arrays/objects, === for primitives
    const curStr = JSON.stringify(curVal);
    const defStr = JSON.stringify(defVal);
    if (curStr !== defStr) {
      diffs.push({ path: fullPath, current: curVal, default: defVal });
    }
  }
  return diffs;
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
  showStatus: boolean;
  runRunbook: boolean;
  runbookJson: boolean;
  runbookSection?: string;
  runIncident: boolean;
  incidentSince?: string;
  incidentLimit?: number;
  incidentJson: boolean;
  incidentNdjson: boolean;
  incidentWatch: boolean;
  incidentChangesOnly: boolean;
  incidentHeartbeatSec?: number;
  incidentIntervalMs?: number;
  runSupervisor: boolean;
  supervisorAll: boolean;
  supervisorSince?: string;
  supervisorLimit?: number;
  supervisorJson: boolean;
  supervisorNdjson: boolean;
  supervisorWatch: boolean;
  supervisorChangesOnly: boolean;
  supervisorHeartbeatSec?: number;
  supervisorIntervalMs?: number;
  showConfig: boolean;
  configValidate: boolean;
  configDiff: boolean;
  notifyTest: boolean;
  runDoctor: boolean;
  runLogs: boolean;
  logsActions: boolean;
  logsGrep?: string;
  logsCount?: number;
  runExport: boolean;
  exportFormat?: string;
  exportOutput?: string;
  exportLast?: string;
  runInit: boolean;
  initForce: boolean;
  runTaskCli: boolean;
  runTail: boolean;
  tailFollow: boolean;
  tailCount?: number;
  runStats: boolean;
  statsLast?: string;
  runReplay: boolean;
  replaySpeed?: number;
  replayLast?: string;
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

  const defaults = { overrides, help: false, version: false, register: false, testContext: false, runTest: false, showTasks: false, showHistory: false, showStatus: false, runRunbook: false, runbookJson: false, runbookSection: undefined as string | undefined, runIncident: false, incidentSince: undefined as string | undefined, incidentLimit: undefined as number | undefined, incidentJson: false, incidentNdjson: false, incidentWatch: false, incidentChangesOnly: false, incidentHeartbeatSec: undefined as number | undefined, incidentIntervalMs: undefined as number | undefined, runSupervisor: false, supervisorAll: false, supervisorSince: undefined as string | undefined, supervisorLimit: undefined as number | undefined, supervisorJson: false, supervisorNdjson: false, supervisorWatch: false, supervisorChangesOnly: false, supervisorHeartbeatSec: undefined as number | undefined, supervisorIntervalMs: undefined as number | undefined, showConfig: false, configValidate: false, configDiff: false, notifyTest: false, runDoctor: false, runLogs: false, logsActions: false, logsGrep: undefined as string | undefined, logsCount: undefined as number | undefined, runExport: false, exportFormat: undefined as string | undefined, exportOutput: undefined as string | undefined, exportLast: undefined as string | undefined, runInit: false, initForce: false, runTaskCli: false, runTail: false, tailFollow: false, tailCount: undefined as number | undefined, runStats: false, statsLast: undefined as string | undefined, runReplay: false, replaySpeed: undefined as number | undefined, replayLast: undefined as string | undefined };

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
  if (argv[2] === "status") {
    return { ...defaults, showStatus: true };
  }
  if (argv[2] === "runbook") {
    const json = argv.includes("--json");
    let section: string | undefined;
    for (let i = 3; i < argv.length; i++) {
      if ((argv[i] === "--section" || argv[i] === "-s") && argv[i + 1]) {
        section = argv[++i];
      } else if (!argv[i].startsWith("-") && !section) {
        section = argv[i];
      }
    }
    return { ...defaults, runRunbook: true, runbookJson: json, runbookSection: section };
  }
  if (argv[2] === "incident") {
    let since: string | undefined;
    let limit: number | undefined;
    let json = false;
    let ndjson = false;
    let watch = false;
    let follow = false;
    let changesOnly = false;
    let heartbeatSec: number | undefined;
    let intervalMs: number | undefined;
    for (let i = 3; i < argv.length; i++) {
      if (argv[i] === "--json") {
        json = true;
      } else if (argv[i] === "--ndjson") {
        ndjson = true;
      } else if (argv[i] === "--follow" || argv[i] === "-f") {
        follow = true;
      } else if (argv[i] === "--watch" || argv[i] === "-w") {
        watch = true;
      } else if (argv[i] === "--changes-only") {
        changesOnly = true;
      } else if ((argv[i] === "--heartbeat" || argv[i] === "-H") && argv[i + 1]) {
        const val = parseInt(argv[++i], 10);
        if (!isNaN(val) && val >= 1) heartbeatSec = val;
      } else if ((argv[i] === "--interval" || argv[i] === "-i") && argv[i + 1]) {
        const val = parseInt(argv[++i], 10);
        if (!isNaN(val) && val >= 500) intervalMs = val;
      } else if (argv[i] === "--since" && argv[i + 1]) {
        since = argv[++i];
      } else if (argv[i] === "--limit" && argv[i + 1]) {
        const val = parseInt(argv[++i], 10);
        if (!isNaN(val) && val > 0) limit = val;
      }
    }
    if (follow) {
      if (!watch) watch = true;
      if (!changesOnly) changesOnly = true;
      if (heartbeatSec === undefined) heartbeatSec = 30;
    }
    if (changesOnly && !watch) watch = true;
    if (heartbeatSec !== undefined) {
      if (!changesOnly) changesOnly = true;
      if (!watch) watch = true;
    }
    return {
      ...defaults,
      runIncident: true,
      incidentSince: since,
      incidentLimit: limit,
      incidentJson: json,
      incidentNdjson: ndjson,
      incidentWatch: watch,
      incidentChangesOnly: changesOnly,
      incidentHeartbeatSec: heartbeatSec,
      incidentIntervalMs: intervalMs,
    };
  }
  if (argv[2] === "supervisor") {
    let all = false;
    let since: string | undefined;
    let limit: number | undefined;
    let json = false;
    let ndjson = false;
    let watch = false;
    let changesOnly = false;
    let heartbeatSec: number | undefined;
    let intervalMs: number | undefined;
    for (let i = 3; i < argv.length; i++) {
      if (argv[i] === "--all") {
        all = true;
      } else if (argv[i] === "--json") {
        json = true;
      } else if (argv[i] === "--ndjson") {
        ndjson = true;
      } else if (argv[i] === "--watch" || argv[i] === "-w") {
        watch = true;
      } else if (argv[i] === "--changes-only") {
        changesOnly = true;
      } else if ((argv[i] === "--heartbeat" || argv[i] === "-H") && argv[i + 1]) {
        const val = parseInt(argv[++i], 10);
        if (!isNaN(val) && val >= 1) heartbeatSec = val;
      } else if (argv[i] === "--since" && argv[i + 1]) {
        since = argv[++i];
      } else if (argv[i] === "--limit" && argv[i + 1]) {
        const val = parseInt(argv[++i], 10);
        if (!isNaN(val) && val > 0) limit = val;
      } else if ((argv[i] === "--interval" || argv[i] === "-i") && argv[i + 1]) {
        const val = parseInt(argv[++i], 10);
        if (!isNaN(val) && val >= 500) intervalMs = val;
      }
    }
    if (changesOnly && !watch) watch = true;
    if (heartbeatSec !== undefined) {
      if (!changesOnly) changesOnly = true;
      if (!watch) watch = true;
    }
    return { ...defaults, runSupervisor: true, supervisorAll: all, supervisorSince: since, supervisorLimit: limit, supervisorJson: json, supervisorNdjson: ndjson, supervisorWatch: watch, supervisorChangesOnly: changesOnly, supervisorHeartbeatSec: heartbeatSec, supervisorIntervalMs: intervalMs };
  }
  if (argv[2] === "config") {
    const validate = argv.includes("--validate") || argv.includes("-V");
    const diff = argv.includes("--diff");
    return { ...defaults, showConfig: true, configValidate: validate, configDiff: diff };
  }
  if (argv[2] === "notify-test") {
    return { ...defaults, notifyTest: true };
  }
  if (argv[2] === "doctor") {
    return { ...defaults, runDoctor: true };
  }
  if (argv[2] === "logs") {
    const actions = argv.includes("--actions") || argv.includes("-a");
    let grep: string | undefined;
    let count: number | undefined;
    for (let i = 3; i < argv.length; i++) {
      if ((argv[i] === "--grep" || argv[i] === "-g") && argv[i + 1]) {
        grep = argv[++i];
      } else if ((argv[i] === "-n" || argv[i] === "--count") && argv[i + 1]) {
        const val = parseInt(argv[++i], 10);
        if (!isNaN(val) && val > 0) count = val;
      }
    }
    return { ...defaults, runLogs: true, logsActions: actions, logsGrep: grep, logsCount: count };
  }
  if (argv[2] === "export") {
    let format: string | undefined;
    let output: string | undefined;
    let last: string | undefined;
    for (let i = 3; i < argv.length; i++) {
      if ((argv[i] === "--format" || argv[i] === "-f") && argv[i + 1]) {
        format = argv[++i];
      } else if ((argv[i] === "--output" || argv[i] === "-o") && argv[i + 1]) {
        output = argv[++i];
      } else if ((argv[i] === "--last" || argv[i] === "-l") && argv[i + 1]) {
        last = argv[++i];
      }
    }
    return { ...defaults, runExport: true, exportFormat: format, exportOutput: output, exportLast: last };
  }
  if (argv[2] === "init") {
    const force = argv.includes("--force") || argv.includes("-f");
    return { ...defaults, runInit: true, initForce: force };
  }
  if (argv[2] === "tail") {
    let follow = false;
    let count: number | undefined;
    for (let i = 3; i < argv.length; i++) {
      if (argv[i] === "-f" || argv[i] === "--follow") {
        follow = true;
      } else if ((argv[i] === "-n" || argv[i] === "--count") && argv[i + 1]) {
        const val = parseInt(argv[++i], 10);
        if (!isNaN(val) && val > 0) count = val;
      }
    }
    return { ...defaults, runTail: true, tailFollow: follow, tailCount: count };
  }
  if (argv[2] === "stats") {
    let last: string | undefined;
    for (let i = 3; i < argv.length; i++) {
      if ((argv[i] === "--last" || argv[i] === "-l") && argv[i + 1]) {
        last = argv[++i];
      }
    }
    return { ...defaults, runStats: true, statsLast: last };
  }
  if (argv[2] === "replay") {
    let speed: number | undefined;
    let last: string | undefined;
    for (let i = 3; i < argv.length; i++) {
      if ((argv[i] === "--speed" || argv[i] === "-s") && argv[i + 1]) {
        const val = parseFloat(argv[++i]);
        if (!isNaN(val) && val >= 0) speed = val;
      } else if ((argv[i] === "--last" || argv[i] === "-l") && argv[i + 1]) {
        last = argv[++i];
      } else if (argv[i] === "--instant") {
        speed = 0;
      }
    }
    return { ...defaults, runReplay: true, replaySpeed: speed, replayLast: last };
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
    "--reasoner", "--opencode", "--claude-code", "--poll-interval", "--reason-interval", "--port", "--model", "--profile", "--health-port",
    "--verbose", "-v", "--dry-run", "--observe", "--confirm", "--help", "-h", "--version",
  ]);

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--reasoner":
        overrides.reasoner = toReasonerBackend(nextArg(i, arg));
        i++;
        break;
      case "--opencode":
        overrides.reasoner = "opencode";
        break;
      case "--claude-code":
        overrides.reasoner = "claude-code";
        break;
      case "--poll-interval": {
        const val = parseInt(nextArg(i, arg), 10);
        if (isNaN(val)) throw new Error(`--poll-interval value '${argv[i + 1]}' is not a valid number`);
        overrides.pollIntervalMs = val;
        i++;
        break;
      }
      case "--reason-interval": {
        const val = parseInt(nextArg(i, arg), 10);
        if (isNaN(val)) throw new Error(`--reason-interval value '${argv[i + 1]}' is not a valid number`);
        overrides.reasonIntervalMs = val;
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
      case "--health-port": {
        const val = parseInt(nextArg(i, arg), 10);
        if (isNaN(val)) throw new Error(`--health-port value '${argv[i + 1]}' is not a valid number`);
        overrides.healthPort = val;
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

  return { overrides, help, version, register: false, testContext: false, runTest: false, showTasks: false, showHistory: false, showStatus: false, runRunbook: false, runbookJson: false, runbookSection: undefined, runIncident: false, incidentSince: undefined, incidentLimit: undefined, incidentJson: false, incidentNdjson: false, incidentWatch: false, incidentChangesOnly: false, incidentHeartbeatSec: undefined, incidentIntervalMs: undefined, runSupervisor: false, supervisorAll: false, supervisorSince: undefined, supervisorLimit: undefined, supervisorJson: false, supervisorNdjson: false, supervisorWatch: false, supervisorChangesOnly: false, supervisorHeartbeatSec: undefined, supervisorIntervalMs: undefined, showConfig: false, configValidate: false, configDiff: false, notifyTest: false, runDoctor: false, runLogs: false, logsActions: false, logsGrep: undefined, logsCount: undefined, runExport: false, exportFormat: undefined, exportOutput: undefined, exportLast: undefined, runInit: false, initForce: false, runTaskCli: false, runTail: false, tailFollow: false, tailCount: undefined, runStats: false, statsLast: undefined, runReplay: false, replaySpeed: undefined, replayLast: undefined };
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
  status         quick daemon health check (is it running? what's it doing?)
  runbook        print operator playbook for day-2 supervision
  runbook --json machine-readable runbook output
  runbook --section <quickstart|response-flow|incident|all> print only one runbook section
  incident       one-shot incident quick view (response-flow + recent activity)
  incident --since <duration>      filter incident events window (30m, 2h, 1d)
  incident --limit <N>             cap incident events shown (default: 5)
  incident --json                  machine-readable incident output
  incident --ndjson                emit compact one-line JSON snapshots
  incident --watch                 stream incident snapshots continuously
  incident --follow                shortcut for --watch --changes-only --heartbeat 30
  incident --changes-only          emit only when incident state changes (implies --watch)
  incident --heartbeat <sec>       keepalive interval (implies --changes-only + --watch)
  incident --interval <ms>         watch refresh interval (default: 5000, min: 500)
  supervisor     one-shot supervisor/task/session orchestration status
  supervisor --all                 show full recent supervisor event buffer
  supervisor --since <duration>    filter events to a time window (30m, 2h, 7d)
  supervisor --limit <N>           cap number of events shown (default: 5)
  supervisor --json                machine-readable output for automation
  supervisor --ndjson              emit one compact JSON object per snapshot
  supervisor --watch               stream supervisor snapshot continuously
  supervisor --changes-only        emit only when state changes (implies --watch)
  supervisor --heartbeat <sec>     keepalive interval (implies --changes-only + --watch)
  supervisor --interval <ms>       watch refresh interval (default: 5000, min: 500)
  config         show the effective resolved config (defaults + file)
  config --validate  validate config + check tool availability
  config --diff  show only fields that differ from defaults
  notify-test    send a test notification to configured webhooks
  doctor         comprehensive health check (config, tools, daemon, disk)
  logs           show recent conversation log entries (last 50)
  logs --actions show action log entries (from ~/.aoaoe/actions.log)
  logs --grep <pattern>  filter log entries by substring or regex
  logs -n <count>        number of entries to show (default: 50)
  export         export session timeline as JSON or Markdown for post-mortems
  export --format <json|markdown>  output format (default: json)
  export --output <file>           write to file (default: stdout)
  export --last <duration>         time window: 1h, 6h, 24h, 7d (default: 24h)
  stats          show aggregate daemon statistics (actions, sessions, activity)
  stats --last <duration>  time window: 1h, 6h, 24h, 7d (default: all time)
  replay         play back tui-history.jsonl like a movie with simulated timing
  replay --speed <N>  playback speed: 1=realtime, 5=5x (default), 10=fast, 0=instant
  replay --instant    same as --speed 0 (no delays, dump all entries immediately)
  replay --last <duration>  only replay entries from the last 1h, 6h, 24h, 7d
  tail           live-stream daemon activity to a separate terminal
  tail -f        follow mode — keep watching for new entries (Ctrl+C to stop)
  tail -n <N>    number of entries to show (default: 50)
  task           manage tasks and sessions (list, reconcile, start, stop, new, rm, edit, help)
  tasks          show task progress (from aoaoe.tasks.json)
  history        review recent actions (from ~/.aoaoe/actions.log)
  test           run integration test (creates sessions, tests, cleans up)
  test-context   scan sessions + context files (read-only, no LLM, safe)
  register       register aoaoe as an AoE session (one-time setup)

options:
  --reasoner <opencode|claude-code>  reasoning backend (default: opencode)
  --opencode                         shorthand for --reasoner opencode
  --claude-code                      shorthand for --reasoner claude-code
  --poll-interval <ms>               tmux observation poll interval in ms (default: 10000)
  --reason-interval <ms>             minimum ms between LLM reasoning calls (default: 60000)
  --port <number>                    opencode server port (default: 4097)
  --health-port <number>             start HTTP health check server on this port
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

logs options:
  --actions, -a                      show action log instead of conversation log
  --grep, -g <pattern>               filter entries by substring or regex
  -n, --count <number>               number of entries to show (default: 50)

replay options:
  --speed, -s <number>               playback speed multiplier (default: 5)
  --instant                          no delays, dump all entries immediately
  --last, -l <duration>              time window: 1h, 6h, 24h, 7d

tail options:
  -f, --follow                       keep watching for new entries (Ctrl+C to stop)
  -n, --count <number>               number of entries to show (default: 50)

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
    },
    "healthPort": 4098,
    "tuiHistoryRetentionDays": 7,
    "notifications": {
      "webhookUrl": "https://example.com/webhook",
      "slackWebhookUrl": "https://hooks.slack.com/services/T.../B.../xxx",
      "events": ["session_error", "session_done", "daemon_started", "daemon_stopped"],
      "maxRetries": 2
    }
  }

  sessionDirs maps aoe session titles to project directories.
  aoaoe loads AGENTS.md, claude.md, and other AI instruction files
  from each project directory to give the reasoner per-session context.

  tuiHistoryRetentionDays controls how many days of TUI history to replay
  on daemon startup (default: 7, range: 1-365). History file rotates at 50MB.

  notifications sends webhook alerts for daemon events. Both webhookUrl
  and slackWebhookUrl are optional. events filters which events fire
  (omit to send all). maxRetries enables exponential backoff retry on
  failure (default: 0 = no retry). Run 'aoaoe notify-test' to verify.

interactive commands (while daemon is running):
  /help          show available commands
  /explain       ask the AI to explain what's happening in plain English
  /insist <msg>  interrupt + deliver message immediately (skip queue)
  /view [N|name] drill into a session's live output (default: 1)
  /back          return to overview from drill-down
  /status        request daemon status
  /dashboard     request full dashboard output
  /pause         pause the daemon
  /resume        resume the daemon
  /interrupt     interrupt the current reasoner call
  /verbose       toggle verbose logging
  /clear         clear the screen
  PgUp / PgDn    scroll through activity history
  Home / End     jump to oldest / return to live
  ESC ESC        interrupt the current reasoner (shortcut)
  !message       insist shortcut — same as /insist message
  (anything)     send a message to the AI — queued for next cycle`);
}
