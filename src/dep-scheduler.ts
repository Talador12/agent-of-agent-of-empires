// dep-scheduler.ts — dependency-aware pool scheduling.
// automatically activates pending tasks when their prerequisites complete.
// integrates with SessionPoolManager to respect concurrency limits.

import type { TaskState } from "./types.js";

export interface SchedulingAction {
  sessionTitle: string;
  action: "activate" | "block" | "skip";
  reason: string;
}

/**
 * Determine which pending tasks should be activated based on dependency graph
 * and pool capacity. Returns a list of scheduling actions.
 */
export function computeSchedulingActions(
  tasks: readonly TaskState[],
  maxConcurrent: number,
): SchedulingAction[] {
  const actions: SchedulingAction[] = [];
  const activeCount = tasks.filter((t) => t.status === "active").length;
  const availableSlots = Math.max(0, maxConcurrent - activeCount);
  let slotsUsed = 0;

  // build completion set for dependency checks
  const completedTitles = new Set(
    tasks.filter((t) => t.status === "completed").map((t) => t.sessionTitle),
  );

  // sort pending tasks: oldest createdAt first
  const pending = tasks
    .filter((t) => t.status === "pending")
    .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));

  for (const task of pending) {
    // check dependencies
    if (task.dependsOn && task.dependsOn.length > 0) {
      const unmet = task.dependsOn.filter((dep) => !completedTitles.has(dep));
      if (unmet.length > 0) {
        actions.push({
          sessionTitle: task.sessionTitle,
          action: "block",
          reason: `waiting on: ${unmet.join(", ")}`,
        });
        continue;
      }
    }

    // check pool capacity
    if (slotsUsed >= availableSlots) {
      actions.push({
        sessionTitle: task.sessionTitle,
        action: "skip",
        reason: `pool at capacity (${maxConcurrent} active)`,
      });
      continue;
    }

    // eligible for activation
    actions.push({
      sessionTitle: task.sessionTitle,
      action: "activate",
      reason: task.dependsOn?.length ? `deps met: ${task.dependsOn.join(", ")}` : "no dependencies",
    });
    slotsUsed++;
  }

  return actions;
}

/**
 * Get just the tasks that should be activated this tick.
 */
export function getActivatableTasks(tasks: readonly TaskState[], maxConcurrent: number): string[] {
  return computeSchedulingActions(tasks, maxConcurrent)
    .filter((a) => a.action === "activate")
    .map((a) => a.sessionTitle);
}

/**
 * Format scheduling actions for TUI display.
 */
export function formatSchedulingActions(actions: SchedulingAction[]): string[] {
  if (actions.length === 0) return ["  (no pending tasks to schedule)"];
  const lines: string[] = [];
  for (const a of actions) {
    const icon = a.action === "activate" ? "▶" : a.action === "block" ? "⏳" : "⊘";
    lines.push(`  ${icon} ${a.sessionTitle}: ${a.action} — ${a.reason}`);
  }
  return lines;
}
