// workflow-engine.ts — define multi-session workflows with fan-out/fan-in.
// a workflow is a DAG of stages, each containing one or more parallel tasks.
// stages execute sequentially; tasks within a stage execute in parallel.

import type { TaskState } from "./types.js";

export interface WorkflowStage {
  name: string;
  tasks: Array<{ sessionTitle: string; goal: string }>;
  dependsOnStage?: string; // previous stage name (auto-set for sequential stages)
}

export interface WorkflowDefinition {
  name: string;
  stages: WorkflowStage[];
}

export interface WorkflowState {
  name: string;
  currentStage: number;
  stages: Array<{
    name: string;
    status: "pending" | "active" | "completed" | "failed";
    tasks: Array<{ sessionTitle: string; status: string }>;
  }>;
  startedAt: number;
  completedAt?: number;
}

/**
 * Create a workflow state from a definition.
 */
export function createWorkflowState(def: WorkflowDefinition, now = Date.now()): WorkflowState {
  return {
    name: def.name,
    currentStage: 0,
    stages: def.stages.map((s) => ({
      name: s.name,
      status: "pending",
      tasks: s.tasks.map((t) => ({ sessionTitle: t.sessionTitle, status: "pending" })),
    })),
    startedAt: now,
  };
}

/**
 * Advance the workflow based on current task states.
 * Returns actions to take (activate next stage's tasks, complete workflow, etc.)
 */
export function advanceWorkflow(
  workflow: WorkflowState,
  taskStates: ReadonlyMap<string, string>, // sessionTitle → status
): { actions: WorkflowAction[]; completed: boolean } {
  const actions: WorkflowAction[] = [];

  if (workflow.currentStage >= workflow.stages.length) {
    return { actions: [], completed: true };
  }

  const current = workflow.stages[workflow.currentStage];

  // update task statuses from live data
  for (const task of current.tasks) {
    const liveStatus = taskStates.get(task.sessionTitle);
    if (liveStatus) task.status = liveStatus;
  }

  // check if current stage is completed
  const allDone = current.tasks.every((t) => t.status === "completed");
  const anyFailed = current.tasks.some((t) => t.status === "failed");

  if (anyFailed) {
    current.status = "failed";
    actions.push({ type: "stage_failed", stage: current.name, detail: `stage "${current.name}" has failed tasks` });
    return { actions, completed: false };
  }

  if (allDone) {
    current.status = "completed";
    workflow.currentStage++;

    if (workflow.currentStage >= workflow.stages.length) {
      workflow.completedAt = Date.now();
      actions.push({ type: "workflow_completed", stage: workflow.name, detail: `workflow "${workflow.name}" completed` });
      return { actions, completed: true };
    }

    // activate next stage
    const next = workflow.stages[workflow.currentStage];
    next.status = "active";
    for (const task of next.tasks) {
      actions.push({ type: "activate_task", stage: next.name, detail: task.sessionTitle });
    }
    actions.push({ type: "stage_started", stage: next.name, detail: `stage "${next.name}" started (${next.tasks.length} tasks)` });
  } else if (current.status === "pending") {
    // activate first stage
    current.status = "active";
    for (const task of current.tasks) {
      actions.push({ type: "activate_task", stage: current.name, detail: task.sessionTitle });
    }
    actions.push({ type: "stage_started", stage: current.name, detail: `stage "${current.name}" started (${current.tasks.length} tasks)` });
  }

  return { actions, completed: false };
}

export interface WorkflowAction {
  type: "activate_task" | "stage_started" | "stage_completed" | "stage_failed" | "workflow_completed";
  stage: string;
  detail: string;
}

/**
 * Format workflow state for TUI display.
 */
export function formatWorkflow(workflow: WorkflowState): string[] {
  const lines: string[] = [];
  const elapsed = workflow.completedAt
    ? workflow.completedAt - workflow.startedAt
    : Date.now() - workflow.startedAt;
  const duration = elapsed < 60_000 ? `${Math.round(elapsed / 1000)}s` : `${Math.round(elapsed / 60_000)}m`;

  lines.push(`  Workflow: ${workflow.name} (${duration})`);
  for (let i = 0; i < workflow.stages.length; i++) {
    const s = workflow.stages[i];
    const icon = s.status === "completed" ? "✓" : s.status === "active" ? "▶" : s.status === "failed" ? "✗" : "○";
    const current = i === workflow.currentStage ? " ←" : "";
    lines.push(`  ${icon} Stage ${i + 1}: ${s.name} (${s.status})${current}`);
    for (const t of s.tasks) {
      const tIcon = t.status === "completed" ? "✓" : t.status === "active" ? "~" : t.status === "failed" ? "!" : ".";
      lines.push(`      [${tIcon}] ${t.sessionTitle}`);
    }
  }
  return lines;
}
