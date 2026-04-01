// task-manager.ts — persistent task orchestration for aoaoe
// loads task definitions from aoaoe.tasks.json (or config), creates/manages AoE
// sessions for each, tracks progress that survives session cleanup.
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from "node:fs";
import { join, resolve, basename } from "node:path";
import { homedir } from "node:os";
import { exec } from "./shell.js";
import { resolveProjectDir } from "./context.js";
import { buildProfileListArgs, computeTmuxName } from "./poller.js";
import { toTaskState, normalizeGoal, goalToList } from "./types.js";
import type { TaskDefinition, TaskState, TaskProgress, TaskStatus, TaskSessionMode } from "./types.js";
import { RESET, BOLD, DIM, GREEN, YELLOW, RED, CYAN } from "./colors.js";

const AOAOE_DIR = join(homedir(), ".aoaoe");
const STATE_FILE = join(AOAOE_DIR, "task-state.json");
const TASK_FILE_NAMES = ["aoaoe.tasks.json", ".aoaoe.tasks.json"];

// normalizeGoal and goalToList are exported from types.ts and re-exported here for convenience
export { normalizeGoal, goalToList } from "./types.js";

function resolveTaskFilePath(basePath: string): string {
  for (const name of TASK_FILE_NAMES) {
    const p = resolve(basePath, name);
    if (existsSync(p)) return p;
  }
  return resolve(basePath, TASK_FILE_NAMES[0]);
}

// stable key for persistent task-state map entries.
// repo alone is not unique in meta AoE mode where many sessions share the same root path.
export function taskStateKey(repo: string, sessionTitle: string): string {
  return `${repo}::${sessionTitle.trim().toLowerCase()}`;
}

// resolve a task's effective repo path from AoE session metadata.
// prefers title-based project resolution and falls back to the session's root path.
export function resolveTaskRepoPath(basePath: string, sessionPath: string | undefined, sessionTitle: string): string {
  const root = resolve(sessionPath || basePath);
  const projectDir = resolveProjectDir(root, sessionTitle);
  return projectDir ?? root;
}

// run periodic task/session reconciliation in the daemon loop.
// default cadence: once every 6 polls (about 1 minute at 10s poll interval).
export function shouldReconcileTasks(pollCount: number, everyPolls = 6): boolean {
  if (!Number.isFinite(pollCount) || pollCount < 1) return false;
  if (!Number.isFinite(everyPolls) || everyPolls < 1) return false;
  return pollCount === 1 || pollCount % everyPolls === 1;
}

interface ListedSession {
  id: string;
  title: string;
  path: string;
  tool?: string;
  status?: string;
  created_at?: string;
  profile: string;
}

function buildProfileAwareAoeArgs(profile: string | undefined, tailArgs: string[]): string[] {
  if (!profile || profile === "default") return tailArgs;
  return ["-p", profile, ...tailArgs];
}

// send a task goal to a session via tmux send-keys.
// strips ANSI, escapes for tmux literal mode (-l), keeps it concise.
export async function injectGoalToSession(
  sessionId: string,
  sessionTitle: string,
  goal: string,
): Promise<boolean> {
  if (!goal.trim()) return false;
  const tmuxName = computeTmuxName(sessionId, sessionTitle);
  const goalLines = goalToList(goal);
  const prompt = goalLines.length === 1
    ? goalLines[0]
    : goalLines.map((g, i) => `${i + 1}. ${g}`).join("\n");
  const result = await exec("tmux", ["send-keys", "-t", tmuxName, "-l", prompt]);
  if (result.exitCode !== 0) {
    log(`goal injection failed for ${sessionTitle}: ${result.stderr.trim()}`);
    return false;
  }
  // press enter to submit
  await exec("tmux", ["send-keys", "-t", tmuxName, "Enter"]);
  log(`injected goal into ${sessionTitle}: ${prompt.slice(0, 80)}`);
  return true;
}

// check whether all of a task's dependencies are satisfied (completed).
// returns true if the task has no deps or all deps are completed.
export function areDependenciesMet(task: TaskState, allTasks: TaskState[]): boolean {
  if (!task.dependsOn || task.dependsOn.length === 0) return true;
  for (const dep of task.dependsOn) {
    const depTask = allTasks.find((t) => t.sessionTitle.toLowerCase() === dep.toLowerCase());
    if (!depTask || depTask.status !== "completed") return false;
  }
  return true;
}

// find tasks that were blocked on the given completed task and are now unblocked.
export function findNewlyUnblockedTasks(completedTitle: string, allTasks: TaskState[]): TaskState[] {
  return allTasks.filter((t) => {
    if (t.status !== "pending") return false;
    if (!t.dependsOn || t.dependsOn.length === 0) return false;
    const dependsOnCompleted = t.dependsOn.some((d) => d.toLowerCase() === completedTitle.toLowerCase());
    return dependsOnCompleted && areDependenciesMet(t, allTasks);
  });
}

async function listSessionsAcrossProfiles(profiles: string[]): Promise<ListedSession[]> {
  const out: ListedSession[] = [];
  const seenIds = new Set<string>();
  for (const profile of profiles) {
    const result = await exec("aoe", buildProfileListArgs(profile));
    if (result.exitCode !== 0) continue;
    try {
      const parsed = JSON.parse(result.stdout);
      const items = Array.isArray(parsed) ? parsed : [];
      for (const item of items) {
        const id = String(item.id ?? "");
        const title = String(item.title ?? "");
        if (!id || !title || seenIds.has(id)) continue;
        seenIds.add(id);
        out.push({
          id,
          title,
          path: String(item.path ?? ""),
          tool: typeof item.tool === "string" ? item.tool : undefined,
          status: typeof item.status === "string" ? item.status : undefined,
          created_at: typeof item.created_at === "string" ? item.created_at : undefined,
          profile,
        });
      }
    } catch {
      // ignore bad profile payloads and keep going
    }
  }
  return out;
}

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

export function saveTaskDefinitions(basePath: string, defs: TaskDefinition[]): void {
  const taskFile = resolveTaskFilePath(basePath);
  try {
    writeFileSync(taskFile, JSON.stringify(defs, null, 2) + "\n");
  } catch (e) {
    console.error(`warning: failed to save task definitions to ${taskFile}: ${e}`);
  }
}

function taskStateToDefinition(t: TaskState): TaskDefinition {
  return {
    repo: t.repo,
    sessionTitle: t.sessionTitle,
    profile: t.profile,
    sessionMode: t.sessionMode,
    tool: t.tool,
    goal: t.goal,
    dependsOn: t.dependsOn && t.dependsOn.length > 0 ? t.dependsOn : undefined,
  };
}

export function syncTaskDefinitionsFromState(basePath: string, states: Map<string, TaskState>): void {
  const defs = [...states.values()].map(taskStateToDefinition);
  saveTaskDefinitions(basePath, defs);
}

export async function importAoeSessionsToTasks(basePath: string, profiles: string[] = ["default"]): Promise<{ imported: string[] }> {
  const imported: string[] = [];
  const sessions = await listSessionsAcrossProfiles(profiles);
  if (sessions.length === 0) return { imported };

  const states = loadTaskState();
  for (const s of sessions) {
    const alreadyTracked = [...states.values()].some(
      (t) => t.sessionTitle.toLowerCase() === s.title.toLowerCase()
    );
    if (alreadyTracked) continue;

    const repoAbs = resolveTaskRepoPath(basePath, s.path, s.title);
    const repo = repoAbs.startsWith(basePath) ? repoAbs.slice(basePath.length + 1) : repoAbs;
    const status: TaskStatus = s.status === "stopped"
      ? "paused"
      : s.status === "error"
        ? "failed"
        : "active";

    states.set(taskStateKey(repo, s.title), {
      repo,
      sessionTitle: s.title,
      profile: s.profile,
      sessionMode: "existing",
      tool: s.tool || "opencode",
      goal: "Continue the roadmap in claude.md",
      status,
      sessionId: s.id,
      createdAt: s.created_at ? new Date(s.created_at).getTime() : Date.now(),
      progress: [],
    });
    imported.push(s.title);
  }

  if (imported.length > 0) {
    saveTaskState(states);
    syncTaskDefinitionsFromState(basePath, states);
  }

  return { imported };
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
      sessionTitle: typeof t.sessionTitle === "string" ? t.sessionTitle : undefined,
      profile: typeof t.profile === "string" && t.profile ? t.profile : undefined,
      sessionMode: parseSessionMode(t.sessionMode),
      tool: typeof t.tool === "string" ? t.tool : "opencode",
      goal: (typeof t.goal === "string" || Array.isArray(t.goal)) ? t.goal : undefined,
      dependsOn: Array.isArray(t.dependsOn) ? t.dependsOn.filter((d: unknown): d is string => typeof d === "string") : undefined,
      continueOnRoadmap: t.continueOnRoadmap === true,
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
      for (const [, state] of Object.entries(raw.tasks)) {
        const validated = toTaskState(state);
        if (validated) {
          const key = taskStateKey(validated.repo, validated.sessionTitle);
          // migration safety: if duplicate keys are present, keep the one with
          // more recent progress so we don't lose the latest state.
          const existing = map.get(key);
          if (!existing || (validated.lastProgressAt ?? 0) >= (existing.lastProgressAt ?? 0)) {
            map.set(key, validated);
          }
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
  private profiles: string[];

  constructor(basePath: string, definitions: TaskDefinition[], profiles: string[] = ["default"]) {
    this.basePath = basePath;
    this.definitions = definitions;
    this.profiles = profiles.length > 0 ? profiles : ["default"];
    this.states = loadTaskState();

    // reconcile state with definitions: add new tasks, keep completed ones
    for (const def of definitions) {
      const sessionTitle = def.sessionTitle || deriveTitle(def.repo);
      const key = taskStateKey(def.repo, sessionTitle);
      if (!this.states.has(key)) {
        const hasDeps = def.dependsOn && def.dependsOn.length > 0;
        this.states.set(key, {
          repo: def.repo,
          sessionTitle,
          profile: def.profile || "default",
          sessionMode: def.sessionMode ?? "auto",
          tool: def.tool ?? "opencode",
          goal: normalizeGoal(def.goal),
          dependsOn: def.dependsOn,
          status: hasDeps ? "pending" : "pending", // pending regardless; reconcile activates when deps met
          progress: [],
        });
      } else {
        // update goal/tool if definition changed (don't reset progress)
        const existing = this.states.get(key);
        if (existing) {
          if (def.goal) existing.goal = normalizeGoal(def.goal);
          if (def.tool) existing.tool = def.tool;
          if (def.sessionTitle) existing.sessionTitle = def.sessionTitle;
          if (def.profile) existing.profile = def.profile;
          if (def.sessionMode) existing.sessionMode = def.sessionMode;
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
    return this.tasks.find((t) => t.repo === repo);
  }

  // reconcile tasks with live AoE sessions: create missing sessions, link existing ones
  async reconcileSessions(): Promise<{ created: string[]; linked: string[]; goalsInjected: string[] }> {
    const created: string[] = [];
    const linked: string[] = [];
    const goalsInjected: string[] = [];

    // get current AoE sessions
    const sessions = await listSessionsAcrossProfiles(this.profiles);

    // track which tasks are newly linked/created so we can inject goals after startup
    const newlyActivated: TaskState[] = [];

    for (const task of this.tasks) {
      if (task.status === "completed") continue;

      // skip tasks whose dependencies haven't been met yet
      if (!areDependenciesMet(task, this.tasks)) {
        if (task.status === "active") {
          task.status = "pending";
          log(`task '${task.sessionTitle}' waiting on dependencies: ${task.dependsOn?.join(", ")}`);
        }
        continue;
      }

      // check if a session already exists for this task
      const existing = sessions.find(
        (s) => s.title.toLowerCase() === task.sessionTitle.toLowerCase()
      );

      if (existing) {
        // link existing session
        if (!task.sessionId || task.sessionId !== existing.id) {
          const wasNew = !task.sessionId;
          task.sessionId = existing.id;
          task.profile = existing.profile || task.profile || "default";
          if (task.status === "pending") task.status = "active";
          linked.push(task.sessionTitle);
          if (wasNew && task.goal) newlyActivated.push(task);
        }
      } else if (task.sessionMode !== "existing" && (task.status === "pending" || task.status === "active" || task.status === "paused")) {
        // create new session
        const repoPath = resolve(this.basePath, task.repo);
        const result = await exec("aoe", buildProfileAwareAoeArgs(task.profile, [
          "add", repoPath, "-t", task.sessionTitle, "-c", task.tool, "-y",
        ]));
        if (result.exitCode === 0) {
          // get the new session ID
          const refreshed = await listSessionsAcrossProfiles(this.profiles);
          const newSession = refreshed.find(
            (s) => s.title.toLowerCase() === task.sessionTitle.toLowerCase()
          );
          if (newSession) {
            task.sessionId = newSession.id;
            task.profile = newSession.profile || task.profile || "default";
            task.status = "active";
            task.createdAt = Date.now();
            created.push(task.sessionTitle);
            if (task.goal) newlyActivated.push(task);
          }
        } else {
          log(`failed to create session for ${task.repo}: ${result.stderr}`);
        }
      } else if (task.sessionMode === "existing") {
        task.sessionId = undefined;
        if (task.status === "active") task.status = "pending";
        log(`waiting for existing session '${task.sessionTitle}' to appear (mode=existing)`);
      }
    }

    // start any sessions that aren't running
    for (const task of this.activeTasks) {
      if (task.sessionId) {
        await exec("aoe", buildProfileAwareAoeArgs(task.profile, ["session", "start", task.sessionId]));
      }
    }

    // inject goals into newly activated sessions (after they've had time to start)
    if (newlyActivated.length > 0) {
      // brief delay to let sessions initialize their tmux panes
      await new Promise((r) => setTimeout(r, 2000));
      for (const task of newlyActivated) {
        if (task.sessionId && task.goal) {
          const ok = await injectGoalToSession(task.sessionId, task.sessionTitle, task.goal);
          if (ok) goalsInjected.push(task.sessionTitle);
        }
      }
    }

    this.save();
    return { created, linked, goalsInjected };
  }

  // record a progress update from the reasoner
  reportProgress(sessionTitle: string, summary: string): void {
    const task = this.getTaskForSession(sessionTitle);
    if (!task) return;
    const entry: TaskProgress = { at: Date.now(), summary };
    task.progress.push(entry);
    task.lastProgressAt = Date.now();
    task.stuckNudgeCount = 0; // progress means it's not stuck anymore
    // keep progress bounded (last 50 entries)
    if (task.progress.length > 50) {
      task.progress = task.progress.slice(-50);
    }
    this.save();
  }

  // record that the reasoner nudged a stuck session. returns true if the task should be auto-paused.
  recordStuckNudge(sessionTitle: string, maxNudges: number): boolean {
    const task = this.getTaskForSession(sessionTitle);
    if (!task || task.status !== "active") return false;
    task.stuckNudgeCount = (task.stuckNudgeCount ?? 0) + 1;
    if (maxNudges > 0 && task.stuckNudgeCount >= maxNudges) {
      task.status = "paused";
      log(`auto-paused '${sessionTitle}' after ${task.stuckNudgeCount} stuck nudges (threshold: ${maxNudges})`);
      this.save();
      return true;
    }
    this.save();
    return false;
  }

  // mark a task as completed, optionally clean up its session.
  // if the task definition has continueOnRoadmap:true, resets with next backlog items instead.
  async completeTask(sessionTitle: string, summary: string, cleanupSession = true): Promise<string[]> {
    const task = this.getTaskForSession(sessionTitle);
    if (!task) return [];

    // find original definition to check continueOnRoadmap
    const def = this.definitions.find(
      (d) => (d.sessionTitle || deriveTitle(d.repo)).toLowerCase() === sessionTitle.toLowerCase()
    );

    if (def?.continueOnRoadmap) {
      // instead of completing, refresh the goal from the roadmap and continue
      const nextGoal = readNextRoadmapItems(this.basePath);
      task.progress.push({ at: Date.now(), summary: `cycle complete: ${summary} — continuing on roadmap` });
      task.goal = nextGoal;
      task.status = "active";
      task.lastProgressAt = Date.now();
      log(`continueOnRoadmap: recycled task '${sessionTitle}' with fresh roadmap goal`);
      this.save();
      return [];
    }

    task.status = "completed";
    task.completedAt = Date.now();
    task.progress.push({ at: Date.now(), summary: `COMPLETED: ${summary}` });

    if (cleanupSession && task.sessionId) {
      await exec("aoe", buildProfileAwareAoeArgs(task.profile, ["session", "stop", task.sessionId]));
      await exec("aoe", buildProfileAwareAoeArgs(task.profile, ["remove", task.sessionId, "-y"]));
      log(`cleaned up session ${task.sessionTitle} (${task.sessionId})`);
    }

    // activate downstream tasks whose dependencies are now met
    const unblocked = findNewlyUnblockedTasks(task.sessionTitle, this.tasks);
    for (const downstream of unblocked) {
      downstream.status = "active";
      log(`dependency met: activated '${downstream.sessionTitle}' (was waiting on '${task.sessionTitle}')`);
    }

    this.save();
    return unblocked.map((t) => t.sessionTitle);
  }

  private save(): void {
    saveTaskState(this.states);
  }
}

// derive a session title from a repo path: "github/adventure" → "adventure"
export function deriveTitle(repo: string): string {
  return basename(repo).toLowerCase().replace(/[^a-z0-9_-]/g, "-");
}

/**
 * Read the Ideas Backlog from claude.md in basePath and return it as a goal string.
 * Extracts all `- **Item**` bullet lines from the "Ideas Backlog" section.
 * Falls back to a generic roadmap directive if the file isn't found or has no items.
 */
export function readNextRoadmapItems(basePath: string, maxItems = 3): string {
  const candidateFiles = ["claude.md", "CLAUDE.md", ".claude.md"];
  for (const name of candidateFiles) {
    const p = resolve(basePath, name);
    if (!existsSync(p)) continue;
    try {
      const content = readFileSync(p, "utf-8");
      // find the Ideas Backlog section
      const backlogMatch = content.match(/###\s+Ideas Backlog\s*\n([\s\S]*?)(?=###|$)/);
      if (!backlogMatch) continue;
      const section = backlogMatch[1];
      // extract bullet items: `- **Name** — description`
      const items: string[] = [];
      for (const line of section.split("\n")) {
        const m = line.match(/^-\s+\*\*([^*]+)\*\*\s*(?:—\s*(.+))?/);
        if (m) {
          const name = m[1].trim();
          const desc = m[2]?.trim() ?? "";
          items.push(desc ? `${name}: ${desc}` : name);
          if (items.length >= maxItems) break;
        }
      }
      if (items.length > 0) {
        const header = "Continue the roadmap — pick the next items from the Ideas Backlog and implement them with full tests, commit and push after each:";
        return `${header}\n${items.map((i) => `- ${i}`).join("\n")}`;
      }
    } catch { /* ignore, try next file */ }
  }
  return "Continue the roadmap in claude.md — pick the next item from the Ideas Backlog, implement with tests, commit, and push.";
}

function parseSessionMode(raw: unknown): TaskSessionMode | undefined {
  if (raw === "auto" || raw === "existing" || raw === "new") return raw;
  if (raw !== undefined) {
    console.error(`warning: invalid sessionMode '${String(raw)}' (use auto|existing|new), defaulting to auto`);
  }
  return undefined;
}

function log(msg: string): void {
  if (process.env.AOAOE_QUIET === "1") return;
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

  const statusIcon = (s: TaskStatus) =>
    s === "active" ? "●" : s === "completed" ? "✓" : s === "failed" ? "✗" : s === "paused" ? "◎" : "○";

  // header
  lines.push(`  ${BOLD}${"SESSION".padEnd(22)} ${"STATUS".padEnd(12)} ${"SESSION ID".padEnd(10)} LAST PROGRESS${RESET}`);
  lines.push(`  ${"-".repeat(90)}`);

  for (const t of tasks) {
    const title = t.sessionTitle.length > 21 ? t.sessionTitle.slice(0, 18) + "..." : t.sessionTitle.padEnd(22);
    const icon = statusIcon(t.status);
    const status = `${statusColor(t.status)}${icon} ${t.status.padEnd(10)}${RESET}`;
    const session = t.sessionId ? t.sessionId.slice(0, 8).padEnd(10) : `${DIM}-${RESET}`.padEnd(10 + 9);
    const lastProgress = t.progress.length > 0 ? t.progress[t.progress.length - 1] : null;
    let progressStr = `${DIM}(not started)${RESET}`;
    if (lastProgress) {
      const ago = formatAgo(Date.now() - lastProgress.at);
      const summary = lastProgress.summary.length > 50
        ? lastProgress.summary.slice(0, 47) + "..."
        : lastProgress.summary;
      progressStr = `${summary} ${DIM}(${ago})${RESET}`;
    }
    lines.push(`  ${title} ${status} ${session} ${progressStr}`);

    // dependency info
    if (t.dependsOn && t.dependsOn.length > 0) {
      lines.push(`  ${DIM}  depends on: ${t.dependsOn.join(", ")}${RESET}`);
    }

    // goal (only for active/pending)
    if (t.status === "active" || t.status === "pending") {
      const items = goalToList(t.goal);
      if (items.length === 1) {
        const trimmed = items[0].length > 76 ? items[0].slice(0, 73) + "..." : items[0];
        lines.push(`  ${DIM}  goal: ${trimmed}${RESET}`);
      } else {
        lines.push(`  ${DIM}  goal:${RESET}`);
        for (const item of items.slice(0, 3)) {
          const trimmed = item.length > 72 ? item.slice(0, 69) + "..." : item;
          lines.push(`  ${DIM}    - ${trimmed}${RESET}`);
        }
        if (items.length > 3) lines.push(`  ${DIM}    ... +${items.length - 3} more${RESET}`);
      }
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

// format a readable progress digest across all tasks — what happened recently.
// designed for morning check-ins and human scanning.
export function formatProgressDigest(tasks: TaskState[], maxAgeMs = 24 * 60 * 60 * 1000): string {
  if (tasks.length === 0) return "  (no tasks)";
  const now = Date.now();
  const cutoff = now - maxAgeMs;
  const lines: string[] = [];

  for (const t of tasks) {
    const recentProgress = t.progress.filter((p) => p.at >= cutoff);
    const statusIcon = t.status === "completed" ? "✓"
      : t.status === "active" ? "●"
      : t.status === "paused" ? "◎"
      : t.status === "failed" ? "✗"
      : "○";
    const statusColor = t.status === "active" ? GREEN
      : t.status === "completed" ? CYAN
      : t.status === "failed" ? RED
      : t.status === "paused" ? YELLOW
      : DIM;

    lines.push(`  ${statusColor}${statusIcon}${RESET} ${BOLD}${t.sessionTitle}${RESET} ${DIM}(${t.status})${RESET}`);

    if (t.dependsOn && t.dependsOn.length > 0) {
      lines.push(`    ${DIM}depends on: ${t.dependsOn.join(", ")}${RESET}`);
    }

    if (recentProgress.length === 0) {
      if (t.status === "active") {
        const lastAny = t.lastProgressAt ? formatAgo(now - t.lastProgressAt) : "never";
        lines.push(`    ${DIM}no recent progress (last: ${lastAny})${RESET}`);
      } else {
        lines.push(`    ${DIM}no progress in time window${RESET}`);
      }
    } else {
      for (const p of recentProgress) {
        lines.push(`    ${formatAgo(now - p.at)}: ${p.summary}`);
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}
