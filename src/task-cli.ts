// task-cli.ts — `aoaoe task` subcommands for managing sessions + tasks
// dead-simple CRUD: list, start, stop, edit, new, rm. no config editing needed.
import { exec } from "./shell.js";
import { existsSync } from "node:fs";
import { resolve, basename } from "node:path";
import { loadTaskState, saveTaskState, formatTaskTable } from "./task-manager.js";
import type { TaskState, TaskStatus } from "./types.js";

// ANSI
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";
const RESET = "\x1b[0m";

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

  const result = await exec("aoe", ["session", "start", task.sessionId]);
  if (result.exitCode !== 0) {
    console.error(`${RED}failed to start ${task.sessionTitle}: ${result.stderr.trim()}${RESET}`);
    return false;
  }

  task.status = "active";
  states.set(task.repo, task);
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

  const result = await exec("aoe", ["session", "stop", task.sessionId]);
  if (result.exitCode !== 0) {
    console.error(`${RED}failed to stop ${task.sessionTitle}: ${result.stderr.trim()}${RESET}`);
    return false;
  }

  task.status = "paused";
  states.set(task.repo, task);
  saveTaskState(states);
  console.log(`${YELLOW}stopped${RESET} ${task.sessionTitle} (${task.sessionId.slice(0, 8)})`);
  return true;
}

// edit a task's goal text
export function taskEdit(ref: string, newGoal: string): boolean {
  const states = loadTaskState();
  const task = resolveTask(ref, [...states.values()]);
  if (!task) {
    console.error(`${RED}task not found: ${ref}${RESET}`);
    return false;
  }

  const oldGoal = task.goal;
  task.goal = newGoal;
  states.set(task.repo, task);
  saveTaskState(states);
  console.log(`${GREEN}updated${RESET} ${task.sessionTitle}`);
  console.log(`  ${DIM}was: ${oldGoal}${RESET}`);
  console.log(`  ${BOLD}now: ${newGoal}${RESET}`);
  return true;
}

// create a new session + task
export async function taskNew(title: string, path: string, tool = "opencode"): Promise<boolean> {
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

  // create AoE session
  console.log(`${DIM}creating session...${RESET}`);
  const result = await exec("aoe", ["add", resolvedPath, "-t", title, "-c", tool, "-y"]);
  if (result.exitCode !== 0) {
    console.error(`${RED}failed to create session: ${result.stderr.trim()}${RESET}`);
    return false;
  }

  // find the new session ID
  const listResult = await exec("aoe", ["list", "--json"]);
  let sessionId: string | undefined;
  if (listResult.exitCode === 0) {
    try {
      const sessions = JSON.parse(listResult.stdout) as Array<{ id: string; title: string }>;
      const found = sessions.find((s) => s.title.toLowerCase() === lower);
      sessionId = found?.id;
    } catch {}
  }

  // compute repo key (relative to cwd)
  const repo = path;

  const task: TaskState = {
    repo,
    sessionTitle: title,
    tool,
    goal: "Continue the roadmap in claude.md",
    status: "active",
    sessionId,
    createdAt: Date.now(),
    progress: [],
  };

  states.set(repo, task);
  saveTaskState(states);
  console.log(`${GREEN}created${RESET} ${title} → ${resolvedPath}`);
  if (sessionId) console.log(`  ${DIM}session: ${sessionId.slice(0, 8)}${RESET}`);
  return true;
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
    await exec("aoe", ["session", "stop", task.sessionId]);
    await exec("aoe", ["remove", task.sessionId, "-y"]);
    console.log(`${DIM}removed session ${task.sessionId.slice(0, 8)}${RESET}`);
  }

  states.delete(task.repo);
  saveTaskState(states);
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
      taskEdit(args[0], args.slice(1).join(" "));
      return;
    }
    case "new":
    case "create":
    case "add": {
      if (!args[0] || !args[1]) { console.error(`usage: aoaoe task new <title> <path> [--tool opencode]`); return; }
      const title = args[0];
      const path = args[1];
      let tool = "opencode";
      const toolIdx = args.indexOf("--tool");
      if (toolIdx !== -1 && args[toolIdx + 1]) tool = args[toolIdx + 1];
      await taskNew(title, path, tool);
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
      console.error(`usage: aoaoe task [list|start|stop|edit|new|rm]`);
  }
}

// handle /task slash commands from within the running daemon (returns human-readable output)
export async function handleTaskSlashCommand(args: string): Promise<string> {
  const parts = args.trim().split(/\s+/);
  const sub = parts[0] || "list";
  const rest = parts.slice(1);

  const states = loadTaskState();
  const tasks = [...states.values()];

  if (sub === "list" || sub === "ls" || sub === "") {
    if (tasks.length === 0) return "(no tasks)";
    return formatTaskTable(states);
  }

  if (sub === "start" && rest[0]) {
    const ok = await taskStart(rest[0]);
    return ok ? `started ${rest[0]}` : `failed to start ${rest[0]}`;
  }

  if (sub === "stop" && rest[0]) {
    const ok = await taskStop(rest[0]);
    return ok ? `stopped ${rest[0]}` : `failed to stop ${rest[0]}`;
  }

  if (sub === "new" && rest[0] && rest[1]) {
    const tool = rest[2] || "opencode";
    const ok = await taskNew(rest[0], rest[1], tool);
    return ok ? `created ${rest[0]}` : `failed to create ${rest[0]}`;
  }

  if (sub === "rm" && rest[0]) {
    const ok = await taskRemove(rest[0]);
    return ok ? `removed ${rest[0]}` : `failed to remove ${rest[0]}`;
  }

  if (sub === "edit" && rest[0] && rest[1]) {
    const ok = taskEdit(rest[0], rest.slice(1).join(" "));
    return ok ? `updated ${rest[0]}` : `failed to update ${rest[0]}`;
  }

  return "usage: /task [list|start|stop|edit|new|rm] [args]";
}
