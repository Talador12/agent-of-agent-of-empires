// runbook-executor.ts — auto-execute generated runbook steps.
// takes a GeneratedRunbook and produces actionable commands for the daemon
// to execute, with dry-run support and step-by-step confirmation.

import type { GeneratedRunbook, RunbookStep } from "./runbook-generator.js";

export interface RunbookExecution {
  runbookTitle: string;
  steps: ExecutionStep[];
  status: "pending" | "running" | "completed" | "failed";
  currentStep: number;
  startedAt?: number;
  completedAt?: number;
}

export interface ExecutionStep {
  action: string;
  detail: string;
  status: "pending" | "running" | "completed" | "skipped" | "failed";
  result?: string;
}

/**
 * Create an execution plan from a generated runbook.
 */
export function createExecution(runbook: GeneratedRunbook): RunbookExecution {
  return {
    runbookTitle: runbook.title,
    steps: runbook.steps.map((s) => ({
      action: s.action,
      detail: s.detail,
      status: "pending",
    })),
    status: "pending",
    currentStep: 0,
  };
}

/**
 * Advance execution to the next step.
 * Returns the step to execute, or null if done.
 */
export function advanceExecution(exec: RunbookExecution, previousStepResult?: string): ExecutionStep | null {
  if (exec.status === "completed" || exec.status === "failed") return null;

  // mark previous step as completed
  if (exec.currentStep > 0 && exec.steps[exec.currentStep - 1].status === "running") {
    exec.steps[exec.currentStep - 1].status = "completed";
    exec.steps[exec.currentStep - 1].result = previousStepResult;
  }

  if (exec.status === "pending") {
    exec.status = "running";
    exec.startedAt = Date.now();
  }

  if (exec.currentStep >= exec.steps.length) {
    exec.status = "completed";
    exec.completedAt = Date.now();
    return null;
  }

  const step = exec.steps[exec.currentStep];
  step.status = "running";
  exec.currentStep++;
  return step;
}

/**
 * Skip the current step.
 */
export function skipStep(exec: RunbookExecution): void {
  if (exec.currentStep > 0 && exec.steps[exec.currentStep - 1].status === "running") {
    exec.steps[exec.currentStep - 1].status = "skipped";
  }
}

/**
 * Fail the current execution.
 */
export function failExecution(exec: RunbookExecution, reason: string): void {
  exec.status = "failed";
  if (exec.currentStep > 0) {
    exec.steps[exec.currentStep - 1].status = "failed";
    exec.steps[exec.currentStep - 1].result = reason;
  }
}

/**
 * Format execution state for TUI display.
 */
export function formatExecution(exec: RunbookExecution): string[] {
  const lines: string[] = [];
  const duration = exec.startedAt ? (exec.completedAt ?? Date.now()) - exec.startedAt : 0;
  lines.push(`  Runbook: ${exec.runbookTitle} (${exec.status}, ${Math.round(duration / 1000)}s)`);
  for (let i = 0; i < exec.steps.length; i++) {
    const s = exec.steps[i];
    const icon = s.status === "completed" ? "✓" : s.status === "running" ? "▶" : s.status === "failed" ? "✗" : s.status === "skipped" ? "⏭" : "○";
    const result = s.result ? ` → ${s.result.slice(0, 50)}` : "";
    lines.push(`  ${icon} ${i + 1}. ${s.action}: ${s.detail}${result}`);
  }
  return lines;
}
