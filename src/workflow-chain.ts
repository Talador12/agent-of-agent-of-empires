// workflow-chain.ts — chain workflows together with dependencies.
// a workflow chain is a sequence of workflows where each can depend on
// the completion of previous workflows before starting.

import type { WorkflowState } from "./workflow-engine.js";

export interface WorkflowChainEntry {
  workflowName: string;
  dependsOn: string[];  // names of workflows that must complete first
  status: "pending" | "active" | "completed" | "failed";
}

export interface WorkflowChain {
  name: string;
  entries: WorkflowChainEntry[];
  startedAt: number;
  completedAt?: number;
}

/**
 * Create a workflow chain from a list of entries.
 */
export function createWorkflowChain(name: string, entries: Array<{ workflowName: string; dependsOn?: string[] }>, now = Date.now()): WorkflowChain {
  return {
    name,
    entries: entries.map((e) => ({
      workflowName: e.workflowName,
      dependsOn: e.dependsOn ?? [],
      status: "pending",
    })),
    startedAt: now,
  };
}

/**
 * Advance the chain: activate workflows whose dependencies are met.
 * Returns workflow names that should be started.
 */
export function advanceChain(
  chain: WorkflowChain,
  workflowStates: ReadonlyMap<string, WorkflowState>,
): { activate: string[]; completed: boolean; failed: boolean } {
  const completedSet = new Set<string>();
  const failedSet = new Set<string>();

  for (const entry of chain.entries) {
    const wfState = workflowStates.get(entry.workflowName);
    if (entry.status === "completed" || wfState?.completedAt) {
      entry.status = "completed";
      completedSet.add(entry.workflowName);
    }
    if (entry.status === "failed") {
      failedSet.add(entry.workflowName);
    }
  }

  // check for failed chains
  if (failedSet.size > 0) {
    return { activate: [], completed: false, failed: true };
  }

  const activate: string[] = [];
  for (const entry of chain.entries) {
    if (entry.status !== "pending") continue;
    const depsmet = entry.dependsOn.every((dep) => completedSet.has(dep));
    if (depsmet) {
      entry.status = "active";
      activate.push(entry.workflowName);
    }
  }

  const allDone = chain.entries.every((e) => e.status === "completed");
  if (allDone) chain.completedAt = Date.now();

  return { activate, completed: allDone, failed: false };
}

/**
 * Format workflow chain for TUI display.
 */
export function formatWorkflowChain(chain: WorkflowChain): string[] {
  const lines: string[] = [];
  const elapsed = chain.completedAt ? chain.completedAt - chain.startedAt : Date.now() - chain.startedAt;
  const dur = elapsed < 60_000 ? `${Math.round(elapsed / 1000)}s` : `${Math.round(elapsed / 60_000)}m`;
  lines.push(`  Workflow chain: ${chain.name} (${dur})`);
  for (const e of chain.entries) {
    const icon = e.status === "completed" ? "✓" : e.status === "active" ? "▶" : e.status === "failed" ? "✗" : "○";
    const deps = e.dependsOn.length > 0 ? ` ← [${e.dependsOn.join(", ")}]` : "";
    lines.push(`  ${icon} ${e.workflowName} (${e.status})${deps}`);
  }
  return lines;
}
