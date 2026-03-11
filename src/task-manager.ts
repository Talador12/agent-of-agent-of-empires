// task-manager.ts — persistent task orchestration for aoaoe
// loads task definitions from aoaoe.tasks.json (or config), creates/manages AoE
// sessions for each, tracks progress that survives session cleanup.
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from "node:fs";
import { join, resolve, basename } from "node:path";
import { homedir } from "node:os";
import { exec } from "./shell.js";
import { toTaskState, toAoeSessionList } from "./types.js";
import type { TaskDefinition, TaskState, TaskProgress, TaskStatus } from "./types.js";
import { RESET, BOLD, DIM, GREEN, YELLOW, RED, CYAN } from "./colors.js";

const AOAOE_DIR = join(homedir(), ".aoaoe");
const STATE_FILE = join(AOAOE_DIR, "task-state.json");
const TASK_FILE_NAMES = ["aoaoe.tasks.json", ".aoaoe.tasks.json"];

// ── Task definition loading ─────────────────────────────────────────────────

// load task definitions from file or config. returns empty array if none found.
export function loadTaskDefinitions(basePath: string): TaskDefinition[] {
  // check for standalone tasks file first
  for (const name of TASK_FILE_NAMES) {
    const p = resolve(basePath, name);
    if (existsSync(p)) {
      try {
        const raw = JSON.parse(readFileSync(p, "utf-8"));
        const tasks = Array.isArray(raw) ? raw : raw.tasks;
        if (Array.isArray(tasks)) {
          log(`loaded ${tasks.length} task(s) from ${name}`);
          return validateDefinitions(tasks, basePath);
        }
      } catch (e) {
        console.error(`warning: failed to parse ${p}: ${e}`);
      }
    }
  }

  // fall back to "tasks" key in config (search ~/.aoaoe/ then basePath)
  const configNames = ["aoaoe.config.json", ".aoaoe.json"];
  const configDirs = [AOAOE_DIR, basePath];
  for (const dir of configDirs) {
    for (const name of configNames) {
      const p = resolve(dir, name);
      if (existsSync(p)) {
        try {
          const config = JSON.parse(readFileSync(p, "utf-8"));
          if (Array.isArray(config.tasks) && config.tasks.length > 0) {
            log(`loaded ${config.tasks.length} task(s) from ${p}`);
            return validateDefinitions(config.tasks, basePath);
          }
        } catch (e) {
          console.error(`warning: failed to parse tasks from ${p}: ${e}`);
        }
      }
    }
  }

  return [];
}

function validateDefinitions(raw: unknown[], basePath: string): TaskDefinition[] {
  const tasks: TaskDefinition[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const t = item as Record<string, unknown>;
    if (typeof t.repo !== "string" || !t.repo) {
      console.error(`warning: task missing 'repo' field, skipping`);
      continue;
    }
    // resolve repo path — support absolute and relative
    const repoPath = resolve(basePath, t.repo);
    if (!existsSync(repoPath)) {
      console.error(`warning: task repo '${t.repo}' not found at ${repoPath}, skipping`);
      continue;
    }
    tasks.push({
      repo: t.repo,
      tool: typeof t.tool === "string" ? t.tool : "opencode",
      goal: typeof t.goal === "string" ? t.goal : undefined,
    });
  }
  return tasks;
}

// ── Persistent task state ───────────────────────────────────────────────────

export function loadTaskState(): Map<string, TaskState> {
  const map = new Map<string, TaskState>();
  try {
    if (!existsSync(STATE_FILE)) return map;
    const raw = JSON.parse(readFileSync(STATE_FILE, "utf-8"));
    if (raw && typeof raw.tasks === "object") {
      for (const [repo, state] of Object.entries(raw.tasks)) {
        const validated = toTaskState(state);
        if (validated) {
          map.set(repo, validated);
        }
      }
    }
  } catch (e) {
    // corrupt state file — back up for recovery, then start fresh
    console.error(`warning: task state file is corrupt, starting fresh: ${e}`);
    try {
      renameSync(STATE_FILE, STATE_FILE + ".corrupt");
      console.error(`  backed up to ${STATE_FILE}.corrupt`);
    } catch { /* best-effort backup */ }
  }
  return map;
}

export function saveTaskState(states: Map<string, TaskState>): void {
  try {
    mkdirSync(AOAOE_DIR, { recursive: true });
    const obj: Record<string, TaskState> = {};
    for (const [repo, state] of states) {
      obj[repo] = state;
    }
    writeFileSync(STATE_FILE, JSON.stringify({ tasks: obj }, null, 2) + "\n");
  } catch (e) {
    console.error(`warning: failed to save task state: ${e}`);
  }
}

// ── Task manager ────────────────────────────────────────────────────────────

export class TaskManager {
  private basePath: string;
  private definitions: TaskDefinition[];
  private states: Map<string, TaskState>;

  constructor(basePath: string, definitions: TaskDefinition[]) {
    this.basePath = basePath;
    this.definitions = definitions;
    this.states = loadTaskState();

    // reconcile state with definitions: add new tasks, keep completed ones
    for (const def of definitions) {
      if (!this.states.has(def.repo)) {
        this.states.set(def.repo, {
          repo: def.repo,
          sessionTitle: deriveTitle(def.repo),
          tool: def.tool ?? "opencode",
          goal: def.goal ?? "Continue the roadmap in claude.md",
          status: "pending",
          progress: [],
        });
      } else {
        // update goal/tool if definition changed (don't reset progress)
        const existing = this.states.get(def.repo);
        if (existing) {
          if (def.goal) existing.goal = def.goal;
          if (def.tool) existing.tool = def.tool;
        }
      }
    }
    this.save();
  }

  get tasks(): TaskState[] {
    return [...this.states.values()];
  }

  get activeTasks(): TaskState[] {
    return this.tasks.filter((t) => t.status === "active");
  }

  get pendingTasks(): TaskState[] {
    return this.tasks.filter((t) => t.status === "pending");
  }

  getTaskForSession(sessionTitle: string): TaskState | undefined {
    return this.tasks.find(
      (t) => t.sessionTitle.toLowerCase() === sessionTitle.toLowerCase()
    );
  }

  getTaskByRepo(repo: string): TaskState | undefined {
    return this.states.get(repo);
  }

  // reconcile tasks with live AoE sessions: create missing sessions, link existing ones
  async reconcileSessions(): Promise<{ created: string[]; linked: string[] }> {
    const created: string[] = [];
    const linked: string[] = [];

    // get current AoE sessions
    const listResult = await exec("aoe", ["list", "--json"]);
    let sessions: Array<{ id: string; title: string; path: string }> = [];
    if (listResult.exitCode === 0) {
      try { sessions = JSON.parse(listResult.stdout); } catch (e) {
        console.error(`[tasks] failed to parse aoe list output: ${e}`);
      }
    }

    for (const task of this.tasks) {
      if (task.status === "completed") continue;

      // check if a session already exists for this task
      const existing = sessions.find(
        (s) => s.title.toLowerCase() === task.sessionTitle.toLowerCase()
      );

      if (existing) {
        // link existing session
        if (!task.sessionId || task.sessionId !== existing.id) {
          task.sessionId = existing.id;
          if (task.status === "pending") task.status = "active";
          linked.push(task.sessionTitle);
        }
      } else if (task.status === "pending" || task.status === "active" || task.status === "paused") {
        // create new session
        const repoPath = resolve(this.basePath, task.repo);
        const result = await exec("aoe", [
          "add", repoPath, "-t", task.sessionTitle, "-c", task.tool, "-y",
        ]);
        if (result.exitCode === 0) {
          // get the new session ID
          const refreshResult = await exec("aoe", ["list", "--json"]);
          if (refreshResult.exitCode === 0) {
            try {
              const refreshed = toAoeSessionList(JSON.parse(refreshResult.stdout));
              const newSession = refreshed.find(
                (s) => s.title.toLowerCase() === task.sessionTitle.toLowerCase()
              );
              if (newSession) {
                task.sessionId = newSession.id;
                task.status = "active";
                task.createdAt = Date.now();
                created.push(task.sessionTitle);
              }
            } catch (e) {
              console.error(`[tasks] failed to parse refreshed session list: ${e}`);
            }
          }
        } else {
          log(`failed to create session for ${task.repo}: ${result.stderr}`);
        }
      }
    }

    // start any sessions that aren't running
    for (const task of this.activeTasks) {
      if (task.sessionId) {
        await exec("aoe", ["session", "start", task.sessionId]);
      }
    }

    this.save();
    return { created, linked };
  }

  // record a progress update from the reasoner
  reportProgress(sessionTitle: string, summary: string): void {
    const task = this.getTaskForSession(sessionTitle);
    if (!task) return;
    const entry: TaskProgress = { at: Date.now(), summary };
    task.progress.push(entry);
    task.lastProgressAt = Date.now();
    // keep progress bounded (last 50 entries)
    if (task.progress.length > 50) {
      task.progress = task.progress.slice(-50);
    }
    this.save();
  }

  // mark a task as completed, optionally clean up its session
  async completeTask(sessionTitle: string, summary: string, cleanupSession = true): Promise<void> {
    const task = this.getTaskForSession(sessionTitle);
    if (!task) return;

    task.status = "completed";
    task.completedAt = Date.now();
    task.progress.push({ at: Date.now(), summary: `COMPLETED: ${summary}` });

    if (cleanupSession && task.sessionId) {
      // stop and remove the AoE session
      await exec("aoe", ["session", "stop", task.sessionId]);
      await exec("aoe", ["remove", task.sessionId, "-y"]);
      log(`cleaned up session ${task.sessionTitle} (${task.sessionId})`);
    }

    this.save();
  }

  private save(): void {
    saveTaskState(this.states);
  }
}

// derive a session title from a repo path: "github/adventure" → "adventure"
export function deriveTitle(repo: string): string {
  return basename(repo).toLowerCase().replace(/[^a-z0-9_-]/g, "-");
}

function log(msg: string): void {
  console.error(`[tasks] ${msg}`);
}

// ── CLI display ─────────────────────────────────────────────────────────────

// format task state for CLI output
export function formatTaskTable(states: Map<string, TaskState> | TaskState[]): string {
  const tasks = Array.isArray(states) ? states : [...states.values()];
  if (tasks.length === 0) return "  (no tasks defined)";

  const lines: string[] = [];

  const statusColor = (s: TaskStatus) =>
    s === "active" ? GREEN : s === "completed" ? CYAN : s === "failed" ? RED : s === "paused" ? YELLOW : DIM;

  // header
  lines.push(`  ${BOLD}${"REPO".padEnd(28)} ${"STATUS".padEnd(12)} ${"SESSION".padEnd(10)} PROGRESS${RESET}`);
  lines.push(`  ${"-".repeat(78)}`);

  for (const t of tasks) {
    const repo = t.repo.length > 27 ? t.repo.slice(-27) : t.repo.padEnd(28);
    const status = `${statusColor(t.status)}${t.status.padEnd(12)}${RESET}`;
    const session = t.sessionId ? t.sessionId.slice(0, 8).padEnd(10) : `${DIM}-${RESET}`.padEnd(10 + 9); // +9 for ANSI codes
    const lastProgress = t.progress.length > 0 ? t.progress[t.progress.length - 1] : null;
    let progressStr = `${DIM}(not started)${RESET}`;
    if (lastProgress) {
      const ago = formatAgo(Date.now() - lastProgress.at);
      const summary = lastProgress.summary.length > 40
        ? lastProgress.summary.slice(0, 37) + "..."
        : lastProgress.summary;
      progressStr = `${summary} ${DIM}(${ago})${RESET}`;
    }
    lines.push(`  ${repo} ${status} ${session} ${progressStr}`);

    // show goal on next line if active
    if (t.status === "active" || t.status === "pending") {
      const goal = t.goal.length > 72 ? t.goal.slice(0, 69) + "..." : t.goal;
      lines.push(`  ${DIM}  goal: ${goal}${RESET}`);
    }
  }

  return lines.join("\n");
}

export function formatAgo(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`;
  return `${Math.round(ms / 86_400_000)}d ago`;
}
