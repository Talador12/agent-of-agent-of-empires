// goal-dep-auto-repair.ts — fix broken dependency chains from completed
// or removed tasks. scans all active task dependencies and removes
// references to tasks that no longer exist or are already completed.

export interface DepRepairResult {
  sessionTitle: string;
  removedDeps: string[];  // dependency titles that were removed
  reason: string;
}

export interface TaskDepInfo {
  sessionTitle: string;
  status: string;
  dependsOn: string[];
}

/**
 * Find broken dependencies in the task graph.
 */
export function findBrokenDeps(tasks: TaskDepInfo[]): DepRepairResult[] {
  const taskMap = new Map(tasks.map((t) => [t.sessionTitle, t]));
  const results: DepRepairResult[] = [];

  for (const task of tasks) {
    if (task.status === "completed" || task.status === "removed" || task.status === "failed") continue;
    if (!task.dependsOn || task.dependsOn.length === 0) continue;

    const removedDeps: string[] = [];
    const reasons: string[] = [];

    for (const dep of task.dependsOn) {
      const depTask = taskMap.get(dep);
      if (!depTask) {
        removedDeps.push(dep);
        reasons.push(`"${dep}" not found`);
      } else if (depTask.status === "completed") {
        removedDeps.push(dep);
        reasons.push(`"${dep}" already completed`);
      } else if (depTask.status === "removed") {
        removedDeps.push(dep);
        reasons.push(`"${dep}" was removed`);
      } else if (depTask.status === "failed") {
        removedDeps.push(dep);
        reasons.push(`"${dep}" failed`);
      }
    }

    if (removedDeps.length > 0) {
      results.push({ sessionTitle: task.sessionTitle, removedDeps, reason: reasons.join("; ") });
    }
  }

  return results;
}

/**
 * Apply repairs — returns updated task dep lists.
 */
export function applyRepairs(tasks: TaskDepInfo[], repairs: DepRepairResult[]): Map<string, string[]> {
  const repairMap = new Map(repairs.map((r) => [r.sessionTitle, new Set(r.removedDeps)]));
  const updated = new Map<string, string[]>();

  for (const task of tasks) {
    const toRemove = repairMap.get(task.sessionTitle);
    if (toRemove && task.dependsOn) {
      const newDeps = task.dependsOn.filter((d) => !toRemove.has(d));
      updated.set(task.sessionTitle, newDeps);
    }
  }

  return updated;
}

/**
 * Detect circular dependencies.
 */
export function detectCycles(tasks: TaskDepInfo[]): string[][] {
  const taskMap = new Map(tasks.map((t) => [t.sessionTitle, t]));
  const cycles: string[][] = [];
  const visited = new Set<string>();
  const inStack = new Set<string>();

  function dfs(title: string, path: string[]): void {
    if (inStack.has(title)) {
      const cycleStart = path.indexOf(title);
      if (cycleStart >= 0) cycles.push(path.slice(cycleStart).concat(title));
      return;
    }
    if (visited.has(title)) return;
    visited.add(title);
    inStack.add(title);
    path.push(title);

    const task = taskMap.get(title);
    if (task?.dependsOn) {
      for (const dep of task.dependsOn) dfs(dep, [...path]);
    }

    inStack.delete(title);
  }

  for (const task of tasks) dfs(task.sessionTitle, []);
  return cycles;
}

/**
 * Format repair results for TUI display.
 */
export function formatDepRepairs(repairs: DepRepairResult[], cycles: string[][]): string[] {
  const lines: string[] = [];
  if (repairs.length === 0 && cycles.length === 0) {
    lines.push("  Dep Auto-Repair: all dependency chains healthy");
    return lines;
  }

  lines.push(`  Dep Auto-Repair (${repairs.length} broken deps, ${cycles.length} cycles):`);
  for (const r of repairs) {
    lines.push(`    ${r.sessionTitle}: removed [${r.removedDeps.join(", ")}]`);
    lines.push(`      ${r.reason}`);
  }
  for (const c of cycles) {
    lines.push(`    ⚠ Cycle: ${c.join(" → ")}`);
  }
  return lines;
}
