// init.ts -- `aoaoe init`: auto-discover environment and generate config
//
// detects:
//   1. tools on PATH (aoe, tmux, opencode, claude)
//   2. running aoe sessions (aoe list --json)
//   3. project directories for each session (resolveProjectDir heuristic)
//   4. running opencode serve instances (port probe)
//   5. best reasoner backend (opencode > claude-code > error)
//
// writes config to ~/.aoaoe/aoaoe.config.json (canonical location).
// non-interactive — prints what it found, writes config, done.

import { existsSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { homedir } from "node:os";
import { exec } from "./shell.js";
import { resolveProjectDirWithSource, type ResolutionSource } from "./context.js";
import { saveTaskState, loadTaskState } from "./task-manager.js";
import { toSessionStatus, toAoeSessionList, type AoeSession, type AoeSessionStatus, type TaskState } from "./types.js";
import { createServer } from "node:net";

import { BOLD, DIM, GREEN, YELLOW, RED, CYAN, RESET } from "./colors.js";

interface ToolCheck {
  name: string;
  path: string | null;
  version: string | null;
  required: boolean;
}

interface SessionDiscovery {
  session: AoeSession;
  resolvedDir: string | null;
  source: ResolutionSource;
}

interface InitResult {
  tools: ToolCheck[];
  sessions: SessionDiscovery[];
  reasoner: "opencode" | "claude-code" | null;
  opencodePort: number;
  opencodeRunning: boolean;
  configPath: string;
  wrote: boolean;
}

// check if a tool is on PATH and get its version
async function checkTool(name: string, versionFlag = "--version"): Promise<{ path: string | null; version: string | null }> {
  const whichResult = await exec("which", [name], 5_000);
  if (whichResult.exitCode !== 0) return { path: null, version: null };

  const toolPath = whichResult.stdout.trim();
  const verResult = await exec(name, [versionFlag], 5_000);
  const version = verResult.exitCode === 0
    ? verResult.stdout.trim().split("\n")[0]
    : null;

  return { path: toolPath, version };
}

// list aoe sessions via CLI, with live tmux status
async function discoverSessions(): Promise<AoeSession[]> {
  const result = await exec("aoe", ["list", "--json"], 10_000);
  if (result.exitCode !== 0) return [];

  try {
    const parsed = JSON.parse(result.stdout);
    if (!Array.isArray(parsed)) return [];
    const raw = parsed as Record<string, unknown>[];
    // fetch status for each session in parallel (allSettled so one failure doesn't kill all)
    const results = await Promise.allSettled(raw.map(async (r): Promise<AoeSession> => {
      const id = String(r.id ?? "");
      const title = String(r.title ?? "");
      const status = await getSessionStatus(id);
      return {
        id,
        title,
        path: String(r.path ?? ""),
        tool: String(r.tool ?? ""),
        status,
        tmux_name: "",
        group: r.group ? String(r.group) : undefined,
        created_at: r.created_at ? String(r.created_at) : undefined,
      };
    }));
    return results
      .filter((r): r is PromiseFulfilledResult<AoeSession> => r.status === "fulfilled")
      .map((r) => r.value);
  } catch (e) {
    console.error(`[init] failed to parse session list: ${e}`);
    return [];
  }
}

async function getSessionStatus(id: string): Promise<AoeSessionStatus> {
  const result = await exec("aoe", ["session", "show", id, "--json"], 5_000);
  if (result.exitCode !== 0) return "unknown";
  try {
    const data = JSON.parse(result.stdout);
    return toSessionStatus(data.status);
  } catch (e) {
    console.error(`[init] failed to parse session status for ${id}: ${e}`);
    return "unknown";
  }
}

// check if opencode serve is running on a given port
async function probeOpencodePort(port: number): Promise<boolean> {
  try {
    const result = await exec("curl", ["-s", "-o", "/dev/null", "-w", "%{http_code}", `http://localhost:${port}/`], 3_000);
    return result.exitCode === 0 && result.stdout.trim() === "200";
  } catch {
    return false;
  }
}

// find a free port starting from preferred, trying preferred+1 then OS-assigned
async function findFreePort(preferred: number): Promise<number> {
  for (const port of [preferred, preferred + 1, 0]) {
    try {
      const found = await new Promise<number>((resolve, reject) => {
        const server = createServer();
        server.on("error", reject);
        server.listen(port, "127.0.0.1", () => {
          const addr = server.address();
          const p = typeof addr === "object" && addr ? addr.port : preferred;
          server.close(() => resolve(p));
        });
      });
      return found;
    } catch {
      continue;
    }
  }
  return preferred; // fallback
}

export async function runInit(forceOverwrite = false): Promise<InitResult> {
  const aoaoeDir = join(homedir(), ".aoaoe");
  const configPath = join(aoaoeDir, "aoaoe.config.json");

  console.log(`\n${BOLD}${CYAN}aoaoe init${RESET} — setting up your supervisor config\n`);

  // ── step 1: check tools ────────────────────────────────────────────────
  console.log(`${BOLD}tools${RESET}`);

  const [aoeCheck, tmuxCheck, opencodeCheck, claudeCheck] = await Promise.all([
    checkTool("aoe"),
    checkTool("tmux"),
    checkTool("opencode"),
    checkTool("claude"),
  ]);

  const tools: ToolCheck[] = [
    { name: "aoe", ...aoeCheck, required: true },
    { name: "tmux", ...tmuxCheck, required: true },
    { name: "opencode", ...opencodeCheck, required: false },
    { name: "claude", ...claudeCheck, required: false },
  ];

  for (const t of tools) {
    const icon = t.path ? `${GREEN}✓${RESET}` : t.required ? `${RED}✗${RESET}` : `${DIM}-${RESET}`;
    const ver = t.version ? ` ${DIM}(${t.version})${RESET}` : "";
    const note = !t.path && t.required ? ` ${RED}required${RESET}` : "";
    console.log(`  ${icon} ${t.name}${ver}${note}`);
  }

  const missingRequired = tools.filter((t) => t.required && !t.path);
  if (missingRequired.length > 0) {
    console.log(`\n${RED}missing required tools: ${missingRequired.map((t) => t.name).join(", ")}${RESET}`);
    console.log(`install them and re-run ${BOLD}aoaoe init${RESET}`);
    return { tools, sessions: [], reasoner: null, opencodePort: 4097, opencodeRunning: false, configPath, wrote: false };
  }

  // ── step 2: pick reasoner ──────────────────────────────────────────────
  let reasoner: "opencode" | "claude-code" | null = null;
  if (opencodeCheck.path) {
    reasoner = "opencode";
  } else if (claudeCheck.path) {
    reasoner = "claude-code";
  }

  if (!reasoner) {
    console.log(`\n${RED}no reasoner backend found${RESET}`);
    console.log(`install ${BOLD}opencode${RESET} (recommended) or ${BOLD}claude${RESET} CLI`);
    console.log(`  opencode: ${DIM}https://opencode.ai${RESET}`);
    console.log(`  claude:   ${DIM}npm install -g @anthropic-ai/claude-code${RESET}`);
    return { tools, sessions: [], reasoner: null, opencodePort: 4097, opencodeRunning: false, configPath, wrote: false };
  }

  console.log(`\n${BOLD}reasoner${RESET}`);
  console.log(`  ${GREEN}→${RESET} ${reasoner}${reasoner === "opencode" && claudeCheck.path ? ` ${DIM}(claude-code also available)${RESET}` : ""}`);

  // ── step 3: check opencode serve ───────────────────────────────────────
  let opencodePort = 4097;
  let opencodeRunning = false;

  if (reasoner === "opencode") {
    opencodeRunning = await probeOpencodePort(opencodePort);
    if (opencodeRunning) {
      console.log(`  ${GREEN}✓${RESET} opencode serve running on port ${opencodePort}`);
    } else {
      // try to find a free port
      opencodePort = await findFreePort(4097);
      console.log(`  ${YELLOW}!${RESET} opencode serve not running — will use port ${opencodePort}`);
      console.log(`  ${DIM}start it with: opencode serve --port ${opencodePort}${RESET}`);
    }
  }

  // ── step 4: discover sessions ──────────────────────────────────────────
  console.log(`\n${BOLD}sessions${RESET}`);
  const rawSessions = await discoverSessions();

  if (rawSessions.length === 0) {
    console.log(`  ${DIM}no aoe sessions found${RESET}`);
    console.log(`  ${DIM}create some with: aoe add <path> -t <title> -c opencode -y${RESET}`);
  }

  const sessions: SessionDiscovery[] = [];
  const sessionDirs: Record<string, string> = {};

  for (const s of rawSessions) {
    const { dir, source } = resolveProjectDirWithSource(s.path, s.title);
    sessions.push({ session: s, resolvedDir: dir, source });

    const statusIcon = s.status === "running" || s.status === "working"
      ? `${GREEN}~${RESET}` : s.status === "idle"
      ? `${DIM}.${RESET}` : s.status === "waiting"
      ? `${YELLOW}~${RESET}` : s.status === "stopped"
      ? `${DIM}x${RESET}` : s.status === "error"
      ? `${RED}!${RESET}` : `${YELLOW}?${RESET}`;
    const statusLabel = s.status !== "unknown" ? s.status : "";
    const dirIcon = dir ? `${GREEN}✓${RESET}` : `${YELLOW}?${RESET}`;
    const srcLabel = source === "direct-child" ? "direct" : source === "nested-child" ? "nested" : source ?? "—";
    const dirLabel = dir ? ` → ${DIM}${dir}${RESET}` : ` ${YELLOW}(project dir not found — add to sessionDirs manually)${RESET}`;
    console.log(`  ${statusIcon} ${s.title} ${DIM}[${s.tool}] ${statusLabel} (${srcLabel})${RESET}${dirLabel}`);

    if (dir) {
      sessionDirs[s.title] = dir;
    }
  }

  // ── step 5: import session history as tasks ─────────────────────────────
  if (rawSessions.length > 0) {
    console.log(`\n${BOLD}task import${RESET}`);
    const existing = loadTaskState();
    let imported = 0;

    for (const disc of sessions) {
      const s = disc.session;
      const dir = disc.resolvedDir;
      if (!dir) continue;

      // skip if already tracked
      const alreadyTracked = [...existing.values()].some(
        (t) => t.sessionTitle.toLowerCase() === s.title.toLowerCase()
      );
      if (alreadyTracked) continue;

      // derive a repo key (relative path if possible, else absolute)
      const cwd = process.cwd();
      const repo = dir.startsWith(cwd) ? dir.slice(cwd.length + 1) : dir;

      const isActive = s.status === "working" || s.status === "idle" || s.status === "waiting";
      const status: TaskState["status"] = isActive ? "active" : s.status === "stopped" ? "paused" : "pending";

      const task: TaskState = {
        repo,
        sessionTitle: s.title,
        tool: s.tool || "opencode",
        goal: "Continue the roadmap in claude.md",
        status,
        sessionId: s.id,
        createdAt: s.created_at ? new Date(s.created_at).getTime() : Date.now(),
        progress: [],
      };

      existing.set(repo, task);
      imported++;

      const statusLabel = isActive ? `${GREEN}active${RESET}` : `${DIM}${status}${RESET}`;
      console.log(`  ${GREEN}+${RESET} ${s.title} → ${statusLabel} ${DIM}(${repo})${RESET}`);
    }

    if (imported > 0) {
      saveTaskState(existing);
      console.log(`  ${GREEN}✓${RESET} imported ${imported} session${imported !== 1 ? "s" : ""} as tasks`);
    } else {
      console.log(`  ${DIM}all sessions already tracked${RESET}`);
    }
  }

  // ── step 6: write config ───────────────────────────────────────────────
  console.log(`\n${BOLD}config${RESET}`);

  if (existsSync(configPath) && !forceOverwrite) {
    console.log(`  ${YELLOW}!${RESET} ${configPath} already exists`);
    console.log(`  ${DIM}use ${BOLD}aoaoe init --force${RESET}${DIM} to overwrite${RESET}`);
    return { tools, sessions, reasoner, opencodePort, opencodeRunning, configPath, wrote: false };
  }

  const config: Record<string, unknown> = {
    reasoner,
    pollIntervalMs: 15_000,
  };

  if (reasoner === "opencode") {
    config.opencode = { port: opencodePort };
  }

  config.aoe = { profile: "default" };

  config.policies = {
    maxIdleBeforeNudgeMs: 120_000,
    maxErrorsBeforeRestart: 3,
    autoAnswerPermissions: true,
  };

  if (Object.keys(sessionDirs).length > 0) {
    config.sessionDirs = sessionDirs;
  }

  const json = JSON.stringify(config, null, 2) + "\n";
  mkdirSync(aoaoeDir, { recursive: true });
  writeFileSync(configPath, json);

  console.log(`  ${GREEN}✓${RESET} wrote ${configPath}`);

  // ── step 6: next steps ─────────────────────────────────────────────────
  console.log(`\n${BOLD}next steps${RESET}`);

  if (reasoner === "opencode" && !opencodeRunning) {
    console.log(`  1. start the reasoner server:`);
    console.log(`     ${CYAN}opencode serve --port ${opencodePort}${RESET}`);
    console.log(`  2. run a dry-run to see what aoaoe observes:`);
    console.log(`     ${CYAN}aoaoe --dry-run${RESET}`);
    console.log(`  3. go live:`);
    console.log(`     ${CYAN}aoaoe${RESET}`);
  } else if (reasoner === "opencode" && opencodeRunning) {
    console.log(`  1. run a dry-run to see what aoaoe observes:`);
    console.log(`     ${CYAN}aoaoe --dry-run${RESET}`);
    console.log(`  2. go live:`);
    console.log(`     ${CYAN}aoaoe${RESET}`);
  } else {
    // claude-code backend
    console.log(`  1. run a dry-run to see what aoaoe observes:`);
    console.log(`     ${CYAN}aoaoe --dry-run${RESET}`);
    console.log(`  2. go live:`);
    console.log(`     ${CYAN}aoaoe${RESET}`);
  }

  console.log(`\n  ${DIM}tip: run ${BOLD}aoaoe test-context${RESET}${DIM} to verify session discovery without starting the daemon${RESET}`);
  console.log(`  ${DIM}tip: add a "notifications" block to your config for webhook alerts (see ${BOLD}aoaoe --help${RESET}${DIM})${RESET}`);
  console.log();

  return { tools, sessions, reasoner, opencodePort, opencodeRunning, configPath, wrote: true };
}

// start opencode serve in background if not running (called by daemon at startup)
export async function ensureOpencodeServe(port: number): Promise<boolean> {
  const running = await probeOpencodePort(port);
  if (running) return true;

  console.error(`[init] starting opencode serve on port ${port}...`);
  try {
    // spawn detached so it survives daemon shutdown
    const { spawn } = await import("node:child_process");
    const { mkdirSync, writeFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { homedir } = await import("node:os");
    const child = spawn("opencode", ["serve", "--port", String(port)], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();

    // write PID file so OpencodeReasoner.killOrphanedServer() can clean up
    // if the daemon restarts. Without this, detached servers become orphans.
    if (child.pid) {
      try {
        const pidFile = join(homedir(), ".aoaoe", "opencode-server.pid");
        mkdirSync(join(homedir(), ".aoaoe"), { recursive: true });
        writeFileSync(pidFile, String(child.pid));
      } catch {} // best-effort
    }

    // wait up to 10s for it to become healthy
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 500));
      if (await probeOpencodePort(port)) {
        console.error(`[init] opencode serve ready on port ${port}`);
        return true;
      }
    }
    console.error(`[init] opencode serve did not become ready within 10s`);
    return false;
  } catch (e) {
    console.error(`[init] failed to start opencode serve: ${e}`);
    return false;
  }
}
