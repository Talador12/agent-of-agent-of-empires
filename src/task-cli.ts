// task-cli.ts — `aoaoe task` subcommands for managing sessions + tasks
// dead-simple CRUD: list, start, stop, edit, new, rm. no config editing needed.
import { exec } from "./shell.js";
import { existsSync } from "node:fs";
import { resolve, basename } from "node:path";
import { buildProfileListArgs } from "./poller.js";
import { loadConfig } from "./config.js";
import { resolveProfiles } from "./tui.js";
import { loadTaskState, saveTaskState, formatTaskTable, syncTaskDefinitionsFromState, taskStateKey, resolveTaskRepoPath, TaskManager, loadTaskDefinitions, injectGoalToSession } from "./task-manager.js";
import { goalToList } from "./types.js";
import type { TaskState, TaskSessionMode } from "./types.js";

import { BOLD, DIM, GREEN, YELLOW, RED, CYAN, RESET } from "./colors.js";

interface AoeSessionLite {
  id: string;
  title: string;
  path?: string;
  tool?: string;
  status?: string;
  profile?: string;
}

function buildProfileAwareAoeArgs(profile: string | undefined, tailArgs: string[]): string[] {
  if (!profile || profile === "default") return tailArgs;
  return ["-p", profile, ...tailArgs];
}

function getTaskProfiles(): string[] {
  try {
    return resolveProfiles(loadConfig());
  } catch {
    return ["default"];
  }
}

function taskCommandHelp(prefix = "aoaoe task"): string {
  return [
    `${prefix} list                     show tracked tasks`,
    `${prefix} reconcile                link/create sessions now`,
    `${prefix} new <title> <path>       create task + session`,
    `${prefix} start|stop <task>         control task session`,
    `${prefix} edit <task> <goal>        update task goal`,
    `${prefix} rm <task>                 remove task + session`,
    "step-in quick path: /task <session> :: <new instructions>",
  ].join("\n");
}

async function listAoeSessionsAcrossProfiles(): Promise<AoeSessionLite[]> {
  const profiles = getTaskProfiles();
  const sessions: AoeSessionLite[] = [];
  const seenIds = new Set<string>();

  for (const profile of profiles) {
    const listResult = await exec("aoe", buildProfileListArgs(profile));
    if (listResult.exitCode !== 0) continue;
    try {
      const raw = JSON.parse(listResult.stdout);
      const items = Array.isArray(raw) ? raw : [];
      for (const item of items) {
        const id = String(item.id ?? "");
        const title = String(item.title ?? "");
        if (!id || !title || seenIds.has(id)) continue;
        seenIds.add(id);
        sessions.push({
          id,
          title,
          path: typeof item.path === "string" ? item.path : undefined,
          tool: typeof item.tool === "string" ? item.tool : undefined,
          status: typeof item.status === "string" ? item.status : undefined,
          profile,
        });
      }
    } catch {
      // ignore malformed output for one profile and keep scanning others
    }
  }

  return sessions;
}

// resolve a fuzzy reference to a task: match by title, repo basename, or session ID prefix
export function resolveTask(ref: string, tasks: TaskState[]): TaskState | undefined {
  const lower = ref.toLowerCase();
  return (
    tasks.find((t) => t.sessionTitle.toLowerCase() === lower) ??
    tasks.find((t) => basename(t.repo).toLowerCase() === lower) ??
    tasks.find((t) => t.sessionId?.startsWith(ref)) ??
    tasks.find((t) => t.sessionTitle.toLowerCase().includes(lower))
  );
}

// list all tasks with their current state
export function taskList(): void {
  const states = loadTaskState();
  if (states.size === 0) {
    console.log(`\n  ${DIM}no tasks found${RESET}`);
    console.log(`  ${DIM}create one with: ${BOLD}aoaoe task new <title> <path>${RESET}\n`);
    return;
  }
  console.log(`\n${formatTaskTable(states)}\n`);
}

// start an inactive/stopped session
export async function taskStart(ref: string): Promise<boolean> {
  const states = loadTaskState();
  const task = resolveTask(ref, [...states.values()]);
  if (!task) {
    console.error(`${RED}task not found: ${ref}${RESET}`);
    return false;
  }

  if (!task.sessionId) {
    console.error(`${YELLOW}task '${task.sessionTitle}' has no session — use 'aoaoe task new' to create one${RESET}`);
    return false;
  }

  const result = await exec("aoe", buildProfileAwareAoeArgs(task.profile, ["session", "start", task.sessionId]));
  if (result.exitCode !== 0) {
    console.error(`${RED}failed to start ${task.sessionTitle}: ${result.stderr.trim()}${RESET}`);
    return false;
  }

  task.status = "active";
  states.set(taskStateKey(task.repo, task.sessionTitle), task);
  saveTaskState(states);
  console.log(`${GREEN}started${RESET} ${task.sessionTitle} (${task.sessionId.slice(0, 8)})`);
  return true;
}

// stop an active session
export async function taskStop(ref: string): Promise<boolean> {
  const states = loadTaskState();
  const task = resolveTask(ref, [...states.values()]);
  if (!task) {
    console.error(`${RED}task not found: ${ref}${RESET}`);
    return false;
  }

  if (!task.sessionId) {
    console.error(`${YELLOW}task '${task.sessionTitle}' has no session${RESET}`);
    return false;
  }

  const result = await exec("aoe", buildProfileAwareAoeArgs(task.profile, ["session", "stop", task.sessionId]));
  if (result.exitCode !== 0) {
    console.error(`${RED}failed to stop ${task.sessionTitle}: ${result.stderr.trim()}${RESET}`);
    return false;
  }

  task.status = "paused";
  states.set(taskStateKey(task.repo, task.sessionTitle), task);
  saveTaskState(states);
  console.log(`${YELLOW}stopped${RESET} ${task.sessionTitle} (${task.sessionId.slice(0, 8)})`);
  return true;
}

// edit a task's goal text
export async function taskEdit(ref: string, newGoal: string): Promise<boolean> {
  const states = loadTaskState();
  const task = resolveTask(ref, [...states.values()]);
  if (!task) {
    console.error(`${RED}task not found: ${ref}${RESET}`);
    return false;
  }

  const oldGoal = task.goal;
  task.goal = newGoal;
  states.set(taskStateKey(task.repo, task.sessionTitle), task);
  saveTaskState(states);
  syncTaskDefinitionsFromState(process.cwd(), states);
  console.log(`${GREEN}updated${RESET} ${task.sessionTitle}`);
  console.log(`  ${DIM}was:${RESET}`);
  for (const item of goalToList(oldGoal)) console.log(`  ${DIM}    - ${item}${RESET}`);
  console.log(`  ${BOLD}now:${RESET}`);
  for (const item of goalToList(newGoal)) console.log(`  ${BOLD}    - ${item}${RESET}`);

  // inject updated goal into the active session so the agent sees it immediately
  if (task.sessionId) {
    const ok = await injectGoalToSession(task.sessionId, task.sessionTitle, newGoal);
    if (ok) console.log(`  ${DIM}goal injected into session${RESET}`);
  }

  return true;
}

// create a new session + task
export async function taskNew(title: string, path: string, tool = "opencode", mode: TaskSessionMode = "new", profile = "default"): Promise<boolean> {
  const resolvedPath = resolve(path);
  if (!existsSync(resolvedPath)) {
    console.error(`${RED}path not found: ${resolvedPath}${RESET}`);
    return false;
  }

  const states = loadTaskState();
  const lower = title.toLowerCase();
  const existing = [...states.values()].find((t) => t.sessionTitle.toLowerCase() === lower);
  if (existing) {
    console.error(`${YELLOW}task '${title}' already exists (repo: ${existing.repo})${RESET}`);
    return false;
  }

  let sessionId: string | undefined;
  let sessionProfile = profile;

  if (mode === "existing" || mode === "auto") {
    const sessions = await listAoeSessionsAcrossProfiles();
    const found = sessions.find((s) => s.title.toLowerCase() === lower);
    sessionId = found?.id;
    sessionProfile = found?.profile ?? sessionProfile;
  }

  if ((mode === "new" || mode === "auto") && !sessionId) {
    console.log(`${DIM}creating session...${RESET}`);
    const result = await exec("aoe", buildProfileAwareAoeArgs(profile, ["add", resolvedPath, "-t", title, "-c", tool, "-y"]));
    if (result.exitCode !== 0) {
      console.error(`${RED}failed to create session: ${result.stderr.trim()}${RESET}`);
      return false;
    }
    const sessions = await listAoeSessionsAcrossProfiles();
    const found = sessions.find((s) => s.title.toLowerCase() === lower);
    sessionId = found?.id;
    sessionProfile = found?.profile ?? profile;
  }

  const status = sessionId ? "active" : "pending";

  if (mode === "existing" && !sessionId) {
    console.log(`${YELLOW}session '${title}' not found yet — task created in pending state${RESET}`);
  }

  // compute repo key (relative to cwd)
  const repo = path;

  const task: TaskState = {
    repo,
    sessionTitle: title,
    profile: sessionProfile,
    sessionMode: mode,
    tool,
    goal: "Continue the roadmap in claude.md",
    status,
    sessionId,
    createdAt: Date.now(),
    progress: [],
  };

  states.set(taskStateKey(repo, title), task);
  saveTaskState(states);
  syncTaskDefinitionsFromState(process.cwd(), states);
  console.log(`${GREEN}created${RESET} ${title} → ${resolvedPath}`);
  console.log(`  ${DIM}mode: ${mode}${RESET}`);
  if (sessionId) {
    console.log(`  ${DIM}session: ${sessionId.slice(0, 8)}${RESET}`);
  }
  return true;
}

function parseTaskMode(raw: string | undefined): TaskSessionMode {
  if (!raw) return "new";
  const v = raw.toLowerCase();
  if (v === "auto" || v === "existing" || v === "new") return v;
  return "new";
}

async function listAoeSessions(): Promise<AoeSessionLite[]> {
  return listAoeSessionsAcrossProfiles();
}

async function findAoeSession(ref: string): Promise<AoeSessionLite | undefined> {
  const sessions = await listAoeSessionsAcrossProfiles();
  const lower = ref.toLowerCase();
  return (
    sessions.find((s) => s.id.startsWith(ref)) ??
    sessions.find((s) => s.title.toLowerCase() === lower) ??
    sessions.find((s) => s.title.toLowerCase().includes(lower))
  );
}

export async function quickTaskUpdate(ref: string, goal: string): Promise<string> {
  const states = loadTaskState();
  const tasks = [...states.values()];
  const task = resolveTask(ref, tasks);
  if (task) {
    task.goal = goal;
    if (task.sessionMode !== "existing") task.sessionMode = "existing";
    states.set(taskStateKey(task.repo, task.sessionTitle), task);
    saveTaskState(states);
    syncTaskDefinitionsFromState(process.cwd(), states);
    return `updated ${task.sessionTitle} goal`; 
  }

  const session = await findAoeSession(ref);
  if (!session) return `session not found: ${ref}`;
  const repo = resolveTaskRepoPath(process.cwd(), session.path, session.title);
  const status: TaskState["status"] = session.status === "stopped" ? "paused" : "active";
  const newTask: TaskState = {
    repo,
    sessionTitle: session.title,
    profile: session.profile ?? "default",
    sessionMode: "existing",
    tool: session.tool || "opencode",
    goal,
    status,
    sessionId: session.id,
    createdAt: Date.now(),
    progress: [],
  };
  states.set(taskStateKey(newTask.repo, newTask.sessionTitle), newTask);
  saveTaskState(states);
  syncTaskDefinitionsFromState(process.cwd(), states);
  return `created task for existing session ${session.title}`;
}

// remove a task and its session
export async function taskRemove(ref: string): Promise<boolean> {
  const states = loadTaskState();
  const task = resolveTask(ref, [...states.values()]);
  if (!task) {
    console.error(`${RED}task not found: ${ref}${RESET}`);
    return false;
  }

  // stop + remove the AoE session if it exists
  if (task.sessionId) {
    await exec("aoe", buildProfileAwareAoeArgs(task.profile, ["session", "stop", task.sessionId]));
    await exec("aoe", buildProfileAwareAoeArgs(task.profile, ["remove", task.sessionId, "-y"]));
    console.log(`${DIM}removed session ${task.sessionId.slice(0, 8)}${RESET}`);
  }

  states.delete(taskStateKey(task.repo, task.sessionTitle));
  saveTaskState(states);
  syncTaskDefinitionsFromState(process.cwd(), states);
  console.log(`${RED}deleted${RESET} task '${task.sessionTitle}' (repo: ${task.repo})`);
  return true;
}

// parse `aoaoe task <subcommand> [args...]` from argv
export async function runTaskCli(argv: string[]): Promise<void> {
  // argv = ["node", "aoaoe", "task", subcommand?, ...args]
  const sub = argv[3];
  const args = argv.slice(4);

  if (!sub || sub === "list" || sub === "ls") {
    taskList();
    return;
  }

  if (sub === "help" || sub === "-h" || sub === "--help") {
    console.log(taskCommandHelp("aoaoe task"));
    return;
  }

  switch (sub) {
    case "start": {
      if (!args[0]) { console.error(`usage: aoaoe task start <name|id>`); return; }
      await taskStart(args[0]);
      return;
    }
    case "stop": {
      if (!args[0]) { console.error(`usage: aoaoe task stop <name|id>`); return; }
      await taskStop(args[0]);
      return;
    }
    case "edit": {
      if (!args[0] || !args[1]) { console.error(`usage: aoaoe task edit <name|id> <new goal text>`); return; }
      await taskEdit(args[0], args.slice(1).join(" "));
      return;
    }
    case "new":
    case "create":
    case "add": {
      if (!args[0] || !args[1]) { console.error(`usage: aoaoe task new <title> <path> [--tool opencode] [--mode new|existing|auto]`); return; }
      const title = args[0];
      const path = args[1];
      let tool = "opencode";
      const toolIdx = args.indexOf("--tool");
      if (toolIdx !== -1 && args[toolIdx + 1]) tool = args[toolIdx + 1];
      let mode: TaskSessionMode = "new";
      const modeIdx = args.indexOf("--mode");
      if (modeIdx !== -1) mode = parseTaskMode(args[modeIdx + 1]);
      let profile = "default";
      const profileIdx = args.indexOf("--profile");
      if (profileIdx !== -1 && args[profileIdx + 1]) profile = args[profileIdx + 1];
      await taskNew(title, path, tool, mode, profile);
      return;
    }
    case "reconcile": {
      const basePath = process.cwd();
      const defs = loadTaskDefinitions(basePath);
      const tm = new TaskManager(basePath, defs, getTaskProfiles());
      const { created, linked, goalsInjected } = await tm.reconcileSessions();
      console.log(`reconciled tasks: +${created.length} created, +${linked.length} linked, +${goalsInjected.length} goals injected`);
      return;
    }
    case "rm":
    case "remove":
    case "delete": {
      if (!args[0]) { console.error(`usage: aoaoe task rm <name|id>`); return; }
      await taskRemove(args[0]);
      return;
    }
    default:
      console.error(`unknown task subcommand: ${sub}`);
      console.error(`usage: aoaoe task [list|start|stop|edit|new|rm|reconcile|help]`);
  }
}

// ── Task intake UX ──────────────────────────────────────────────────────────
// Guided /task new flow — parse forgiving syntax and infer defaults.

export interface TaskNewIntent {
  title: string;
  path: string | null;    // null = needs inference from sessionDirs / search
  tool: string;
  goal: string | null;    // null = no goal set yet
  mode: TaskSessionMode;
}

/**
 * Parse a forgiving /task new argument string into a structured intent.
 * Supports multiple formats:
 *   "/task new myproject /path/to/repo opencode"   — full explicit
 *   "/task new myproject /path/to/repo"             — tool defaults to "opencode"
 *   "/task new myproject"                           — path inferred, tool defaults
 *   "/task new myproject :: implement login"         — with inline goal
 *   "/task new myproject /path :: implement login"   — path + goal
 * Returns null when no title is provided.
 */
export function parseTaskNewIntent(input: string): TaskNewIntent | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // split on :: to extract goal
  let argsPart = trimmed;
  let goal: string | null = null;
  const goalIdx = trimmed.indexOf("::");
  if (goalIdx >= 0) {
    argsPart = trimmed.slice(0, goalIdx).trim();
    goal = trimmed.slice(goalIdx + 2).trim() || null;
  }

  const parts = argsPart.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return null;

  // parts[0] might be "new" if called from handleTaskSlashCommand — skip it
  let offset = 0;
  if (parts[0] === "new") offset = 1;

  const title = parts[offset];
  if (!title) return null;

  const pathArg = parts[offset + 1] ?? null;
  const toolArg = parts[offset + 2] ?? "opencode";

  // detect if pathArg looks like a tool name rather than a path
  const knownTools = new Set(["opencode", "claude-code", "claude", "aider", "cursor"]);
  let path: string | null = pathArg;
  let tool = toolArg;
  if (pathArg && knownTools.has(pathArg.toLowerCase())) {
    tool = pathArg;
    path = null;
  }

  return { title, path, tool, goal, mode: "auto" };
}

/**
 * Suggest sessions that don't have a task entry yet.
 * Useful for guided `/task new` when no args are given —
 * shows the user which sessions are untracked.
 */
export function suggestNewTasks(
  sessions: readonly { title: string; id: string; tool?: string; path?: string }[],
  existingTasks: readonly TaskState[],
): Array<{ title: string; id: string; tool: string; path: string | undefined }> {
  const tracked = new Set(existingTasks.map((t) => t.sessionTitle.toLowerCase()));
  return sessions
    .filter((s) => !tracked.has(s.title.toLowerCase()))
    .map((s) => ({ title: s.title, id: s.id, tool: s.tool ?? "opencode", path: s.path }));
}

// handle /task slash commands from within the running daemon (returns human-readable output)
export async function handleTaskSlashCommand(args: string): Promise<string> {
  const raw = args.trim();
  if (raw.includes("::")) {
    const [lhsRaw, rhsRaw] = raw.split("::", 2);
    const lhs = lhsRaw.trim();
    const goal = rhsRaw.trim();
    if (!lhs || !goal) return "usage: /task <session> :: <goal>  or  /task <mode> <title> <path> :: <goal>";
    const lhsParts = lhs.split(/\s+/);
    if (lhsParts[0] === "new" || lhsParts[0] === "auto" || lhsParts[0] === "existing") {
      if (!lhsParts[1] || !lhsParts[2]) {
        return "usage: /task <mode> <title> <path> :: <goal>";
      }
      const mode = parseTaskMode(lhsParts[0]);
      const ok = await taskNew(lhsParts[1], lhsParts[2], "opencode", mode);
      if (!ok) return `failed to create ${lhsParts[1]}`;
      const edited = await taskEdit(lhsParts[1], goal);
      return edited ? `created ${lhsParts[1]} + set goal` : `created ${lhsParts[1]}`;
    }
    return await quickTaskUpdate(lhsParts[0], goal);
  }

  const parts = raw.split(/\s+/);
  const sub = parts[0] || "list";
  const rest = parts.slice(1);

  const states = loadTaskState();
  const tasks = [...states.values()];

  if (sub === "list" || sub === "ls" || sub === "") {
    if (tasks.length === 0) return "(no tasks)";
    return formatTaskTable(states);
  }

  if (sub === "help") {
    return taskCommandHelp("/task");
  }

  if (sub === "start" && rest[0]) {
    const ok = await taskStart(rest[0]);
    return ok ? `started ${rest[0]}` : `failed to start ${rest[0]}`;
  }

  if (sub === "stop" && rest[0]) {
    const ok = await taskStop(rest[0]);
    return ok ? `stopped ${rest[0]}` : `failed to stop ${rest[0]}`;
  }

  if (sub === "new") {
    // guided task intake UX: parse forgiving syntax with smart defaults
    const newArgs = raw.slice(raw.indexOf("new")).trim(); // "new title path :: goal" or "new title" etc.
    const intent = parseTaskNewIntent(newArgs);
    if (!intent) {
      // no title given — suggest untracked sessions
      const sessions = await listAoeSessions();
      const suggestions = suggestNewTasks(sessions, tasks);
      if (suggestions.length === 0) {
        return "all sessions already have task entries. usage: /task new <title> [path] [tool] [:: goal]";
      }
      const lines = suggestions.map((s) =>
        `  ${BOLD}${s.title}${RESET} ${DIM}(${s.tool}${s.path ? `, ${s.path}` : ""})${RESET}`
      );
      return `sessions without tasks:\n${lines.join("\n")}\n\nusage: /task new <title> [path] [tool] [:: goal]`;
    }
    // infer path if not provided: try to find the session and use its path
    let resolvedPath = intent.path;
    if (!resolvedPath) {
      const session = await findAoeSession(intent.title);
      resolvedPath = session?.path ?? process.cwd();
    }
      const ok = await taskNew(intent.title, resolvedPath, intent.tool, intent.mode);
      if (!ok) return `failed to create ${intent.title}`;
    if (intent.goal) {
      await taskEdit(intent.title, intent.goal);
      return `created ${intent.title} + set goal: ${intent.goal}`;
    }
    return `created ${intent.title} (path: ${resolvedPath}, tool: ${intent.tool})`;
  }

  if (sub === "rm" && rest[0]) {
    const ok = await taskRemove(rest[0]);
    return ok ? `removed ${rest[0]}` : `failed to remove ${rest[0]}`;
  }

  if (sub === "edit" && rest[0] && rest[1]) {
    const ok = await taskEdit(rest[0], rest.slice(1).join(" "));
    return ok ? `updated ${rest[0]}` : `failed to update ${rest[0]}`;
  }

  if (sub === "reconcile") {
    const basePath = process.cwd();
    const defs = loadTaskDefinitions(basePath);
    const tm = new TaskManager(basePath, defs, getTaskProfiles());
    const { created, linked, goalsInjected } = await tm.reconcileSessions();
    return `reconciled tasks: +${created.length} created, +${linked.length} linked, +${goalsInjected.length} goals injected`;
  }

  return "usage: /task [list|start|stop|edit|new|rm|reconcile|help] [args]";
}
