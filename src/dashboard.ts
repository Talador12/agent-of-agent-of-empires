// periodic CLI dashboard -- prints a status table to stderr every N polls
import type { Observation, AoaoeConfig } from "./types.js";
import type { ActionLogEntry } from "./executor.js";

const STATUS_ICONS: Record<string, string> = {
  working: "~",
  idle:    ".",
  waiting: "?",
  done:    "+",
  error:   "!",
  stopped: "x",
};

// print a compact dashboard summary every dashboardInterval polls
export function printDashboard(
  obs: Observation,
  recentActions: ActionLogEntry[],
  pollCount: number,
  config: AoaoeConfig
): void {
  const sep = "-".repeat(72);
  const lines: string[] = [];

  lines.push(sep);
  lines.push(`  aoaoe dashboard  |  poll #${pollCount}  |  ${new Date().toLocaleTimeString()}`);
  if (config.dryRun) lines.push("  ** DRY RUN **");
  lines.push(sep);

  // session table
  if (obs.sessions.length === 0) {
    lines.push("  no active sessions");
  } else {
    lines.push("  status | tool       | title                | id");
    lines.push("  " + "-".repeat(68));
    for (const snap of obs.sessions) {
      const s = snap.session;
      const icon = STATUS_ICONS[s.status] ?? "?";
      const tool = s.tool.padEnd(10).slice(0, 10);
      const title = s.title.padEnd(20).slice(0, 20);
      const id = s.id.slice(0, 8);
      lines.push(`    ${icon}    | ${tool} | ${title} | ${id}`);
    }
  }

  // recent actions (last 5 non-wait)
  const meaningful = recentActions.filter(e => e.action.action !== "wait");
  if (meaningful.length > 0) {
    lines.push("");
    lines.push("  recent actions:");
    for (const entry of meaningful.slice(-5)) {
      const ts = new Date(entry.timestamp).toLocaleTimeString();
      const icon = entry.success ? "+" : "!";
      lines.push(`    [${ts}] ${icon} ${entry.action.action}: ${entry.detail}`);
    }
  }

  lines.push(sep);
  lines.push("");

  console.error(lines.join("\n"));
}
