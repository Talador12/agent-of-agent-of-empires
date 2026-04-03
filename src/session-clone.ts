// session-clone.ts — clone a session to try alternative approaches in parallel.
// creates a new task definition from an existing session's config + goal,
// allowing A/B experimentation on the same problem.

import type { TaskState, TaskDefinition } from "./types.js";

export interface CloneOptions {
  sourceTitle: string;
  cloneTitle: string;
  goalOverride?: string;   // override goal for the clone
  toolOverride?: string;   // use different tool
  modeOverride?: string;   // different session mode
}

export interface CloneResult {
  original: string;
  clone: string;
  goal: string;
  tool: string;
}

/**
 * Create a clone task definition from an existing task.
 */
export function cloneSession(source: TaskState, options: CloneOptions): TaskDefinition {
  return {
    repo: source.repo,
    sessionTitle: options.cloneTitle,
    sessionMode: (options.modeOverride ?? source.sessionMode) as any,
    tool: options.toolOverride ?? source.tool,
    goal: options.goalOverride ?? source.goal,
    dependsOn: undefined, // clone runs independently
  };
}

/**
 * Format clone result for TUI display.
 */
export function formatCloneResult(result: CloneResult): string[] {
  return [
    `  Cloned "${result.original}" → "${result.clone}"`,
    `  Tool: ${result.tool}  Goal: ${result.goal.length > 60 ? result.goal.slice(0, 57) + "..." : result.goal}`,
  ];
}
