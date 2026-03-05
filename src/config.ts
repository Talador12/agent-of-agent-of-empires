import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type { AoaoeConfig, ReasonerBackend } from "./types.js";

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

  return deepMerge(
    DEFAULTS as unknown as Record<string, unknown>,
    fileConfig as Record<string, unknown>,
    (overrides ?? {}) as Record<string, unknown>,
  );
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
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const exec = promisify(execFile);
  try {
    await exec("which", [cmd]);
    return true;
  } catch {
    return false;
  }
}

function deepMerge(...objects: Record<string, unknown>[]): AoaoeConfig {
  const result: Record<string, unknown> = {};
  for (const obj of objects) {
    for (const [key, val] of Object.entries(obj)) {
      if (val !== undefined && val !== null) {
        if (typeof val === "object" && !Array.isArray(val) && typeof result[key] === "object") {
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
} {
  const overrides: Partial<AoaoeConfig> = {};
  let help = false;
  let version = false;

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--reasoner":
        overrides.reasoner = argv[++i] as ReasonerBackend;
        break;
      case "--poll-interval":
        overrides.pollIntervalMs = parseInt(argv[++i], 10);
        break;
      case "--port":
        overrides.opencode = { ...overrides.opencode, port: parseInt(argv[++i], 10) } as AoaoeConfig["opencode"];
        break;
      case "--model":
        // applies to whichever backend is selected
        overrides.opencode = { ...overrides.opencode, model: argv[++i] } as AoaoeConfig["opencode"];
        overrides.claudeCode = { ...overrides.claudeCode, model: argv[i] } as AoaoeConfig["claudeCode"];
        break;
      case "--profile":
        overrides.aoe = { profile: argv[++i] };
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
    }
  }

  return { overrides, help, version };
}

export function printHelp() {
  console.log(`aoaoe - autonomous supervisor for agent-of-empires sessions

usage: aoaoe [options]

options:
  --reasoner <opencode|claude-code>  reasoning backend (default: opencode)
  --poll-interval <ms>               poll interval in ms (default: 10000)
  --port <number>                    opencode server port (default: 4097)
  --model <model>                    model to use
  --profile <name>                   aoe profile (default: default)
  --dry-run                          observe + reason but don't execute
  --verbose, -v                      verbose logging
  --help, -h                         show this help
  --version                          show version`);
}
