// periodic CLI dashboard -- prints a status table to stderr every N polls
import type { Observation, AoaoeConfig, TaskState } from "./types.js";
import type { ActionLogEntry } from "./executor.js";
import { readState } from "./daemon-state.js";

const STATUS_ICONS: Record<string, string> = {
  working: "~",
  idle:    ".",
  waiting: "?",
  done:    "+",
  error:   "!",
  stopped: "x",
};

const TASK_STATUS_ICONS: Record<string, string> = {
  pending: ".",
  active: "~",
  completed: "+",
  paused: "=",
  failed: "!",
};

// print a compact dashboard summary every dashboardInterval polls
export function printDashboard(
  obs: Observation,
  recentActions: ActionLogEntry[],
  pollCount: number,
  config: AoaoeConfig
): void {
  const sep = "-".repeat(78);
  const lines: string[] = [];

  // header with countdown
  const state = readState();
  let countdownStr = "";
  if (state?.nextTickAt) {
    const remaining = Math.max(0, Math.ceil((state.nextTickAt - Date.now()) / 1000));
    countdownStr = `  |  next: ${remaining}s`;
  }

  lines.push(sep);
  lines.push(`  aoaoe  |  poll #${pollCount}  |  ${new Date().toLocaleTimeString()}${countdownStr}`);
  if (config.dryRun) lines.push("  ** DRY RUN **");
  lines.push(sep);

  // task progress (if tasks defined)
  const tasks = state?.tasks;
  if (tasks && tasks.length > 0) {
    lines.push("  tasks:");
    for (const t of tasks) {
      const icon = TASK_STATUS_ICONS[t.status] ?? "?";
      const repo = t.repo.length > 24 ? "..." + t.repo.slice(-21) : t.repo.padEnd(24);
      const lastProg = t.progress.length > 0 ? t.progress[t.progress.length - 1] : null;
      const progStr = lastProg
        ? truncate(lastProg.summary, 40) + ` (${formatAgo(Date.now() - lastProg.at)})`
        : t.goal ? truncate(t.goal, 50) : "-";
      lines.push(`    [${icon}] ${repo}  ${progStr}`);
    }
    lines.push("");
  }

  // session table with per-pane tasks and todo items
  if (obs.sessions.length === 0) {
    lines.push("  no active sessions");
  } else {
    lines.push("  sessions:");
    lines.push(`  ${"st".padEnd(4)} ${"tool".padEnd(10)} ${"title".padEnd(20)} ${"id".padEnd(10)} task`);
    lines.push("  " + "-".repeat(74));
    for (const snap of obs.sessions) {
      const s = snap.session;
      const icon = STATUS_ICONS[s.status] ?? "?";
      const tool = s.tool.padEnd(10).slice(0, 10);
      const title = s.title.padEnd(20).slice(0, 20);
      const id = s.id.slice(0, 8).padEnd(10);
      // show current task from daemon state
      const sessionState = state?.sessions?.find((ss) => ss.id === s.id);
      const task = sessionState?.currentTask ?? "";
      const taskStr = task ? truncate(task, 30) : "-";
      lines.push(`   ${icon}   ${tool} ${title} ${id} ${taskStr}`);
      // show todo items if present
      if (sessionState?.todoSummary) {
        const todoLines = sessionState.todoSummary.split("\n").slice(0, 5);
        for (const tl of todoLines) {
          lines.push(`        ${tl.trim()}`);
        }
      }
    }
  }

  // last reasoning output
  const lastResult = recentActions.find(
    (e) => e.action.action !== "wait" && e.action.action !== "report_progress"
  );
  if (lastResult) {
    lines.push("");
    const ts = new Date(lastResult.timestamp).toLocaleTimeString();
    lines.push(`  last action [${ts}]: ${lastResult.action.action} — ${truncate(lastResult.detail, 55)}`);
  }

  // recent actions (last 5 non-wait)
  const meaningful = recentActions.filter(e => e.action.action !== "wait");
  if (meaningful.length > 1) {
    lines.push("");
    lines.push("  recent:");
    for (const entry of meaningful.slice(-5)) {
      const ts = new Date(entry.timestamp).toLocaleTimeString();
      const icon = entry.success ? "+" : "!";
      lines.push(`    [${ts}] ${icon} ${entry.action.action}: ${truncate(entry.detail, 55)}`);
    }
  }

  lines.push(sep);
  lines.push("");

  console.error(lines.join("\n"));
}

function truncate(s: string, max: number): string {
  // collapse to single line
  const line = s.replace(/\n/g, " ").trim();
  return line.length > max ? line.slice(0, max - 3) + "..." : line;
}

function formatAgo(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  return `${Math.round(ms / 3_600_000)}h ago`;
}
