// goal-dep-impact.ts — predict downstream effects of goal changes.
// given a task graph, computes which sessions would be affected if a
// specific goal is delayed, removed, or fails. helps operators make
// informed decisions about intervention.

export interface TaskNode {
  sessionTitle: string;
  goal: string;
  status: string;
  dependsOn: string[];
}

export interface ImpactResult {
  targetSession: string;
  scenario: "delay" | "failure" | "removal";
  directlyBlocked: string[];
  transitivelyBlocked: string[];
  totalAffected: number;
  criticalPath: boolean; // is this task on the critical path?
}

/**
 * Compute downstream impact of a change to a specific task.
 */
export function computeImpact(tasks: TaskNode[], targetSession: string, scenario: ImpactResult["scenario"]): ImpactResult {
  const taskMap = new Map(tasks.map((t) => [t.sessionTitle, t]));

  // find directly dependent tasks
  const directlyBlocked = tasks
    .filter((t) => t.dependsOn.includes(targetSession) && t.status !== "completed" && t.status !== "removed")
    .map((t) => t.sessionTitle);

  // BFS for transitive dependencies
  const transitivelyBlocked = new Set<string>();
  const queue = [...directlyBlocked];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (transitivelyBlocked.has(current)) continue;
    transitivelyBlocked.add(current);
    // find tasks that depend on this one
    const downstream = tasks
      .filter((t) => t.dependsOn.includes(current) && t.status !== "completed" && t.status !== "removed")
      .map((t) => t.sessionTitle);
    queue.push(...downstream);
  }

  // remove direct from transitive to avoid double counting
  const transitiveOnly = Array.from(transitivelyBlocked).filter((s) => !directlyBlocked.includes(s));

  // check if target is on critical path (has dependents that have dependents)
  const criticalPath = transitiveOnly.length > 0 || directlyBlocked.length >= 2;

  return {
    targetSession,
    scenario,
    directlyBlocked,
    transitivelyBlocked: transitiveOnly,
    totalAffected: directlyBlocked.length + transitiveOnly.length,
    criticalPath,
  };
}

/**
 * Compute impact for all active tasks (fleet-wide risk assessment).
 */
export function computeFleetImpact(tasks: TaskNode[]): ImpactResult[] {
  const active = tasks.filter((t) => t.status === "active" || t.status === "pending");
  return active.map((t) => computeImpact(tasks, t.sessionTitle, "failure")).sort((a, b) => b.totalAffected - a.totalAffected);
}

/**
 * Format impact analysis for TUI display.
 */
export function formatImpact(results: ImpactResult[]): string[] {
  if (results.length === 0) return ["  Dep Impact: no tasks with downstream dependencies"];
  const withDeps = results.filter((r) => r.totalAffected > 0);
  if (withDeps.length === 0) return ["  Dep Impact: no downstream dependencies detected"];
  const lines: string[] = [];
  lines.push(`  Dep Impact Analysis (${withDeps.length} tasks with downstream deps):`);
  for (const r of withDeps.slice(0, 8)) {
    const cpIcon = r.criticalPath ? " ★" : "";
    lines.push(`    ${r.targetSession}: ${r.totalAffected} affected (${r.directlyBlocked.length} direct, ${r.transitivelyBlocked.length} transitive)${cpIcon}`);
    if (r.directlyBlocked.length > 0) lines.push(`      Directly: ${r.directlyBlocked.join(", ")}`);
    if (r.transitivelyBlocked.length > 0) lines.push(`      Transitive: ${r.transitivelyBlocked.join(", ")}`);
  }
  return lines;
}
