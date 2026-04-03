// workflow-viz.ts — ASCII DAG rendering for workflows and workflow chains.
// produces a visual graph of stage/task dependencies with status icons.

import type { WorkflowState } from "./workflow-engine.js";
import type { WorkflowChain } from "./workflow-chain.js";

/**
 * Render a workflow as an ASCII pipeline diagram.
 */
export function renderWorkflowDag(workflow: WorkflowState): string[] {
  const lines: string[] = [];
  lines.push(`  ┌─ Workflow: ${workflow.name} ─┐`);

  for (let i = 0; i < workflow.stages.length; i++) {
    const stage = workflow.stages[i];
    const icon = stage.status === "completed" ? "✓" : stage.status === "active" ? "▶" : stage.status === "failed" ? "✗" : "○";
    const current = i === workflow.currentStage ? " ◄" : "";

    lines.push(`  │`);
    lines.push(`  ├─[${icon}] ${stage.name}${current}`);

    for (const task of stage.tasks) {
      const tIcon = task.status === "completed" ? "✓" : task.status === "active" ? "~" : task.status === "failed" ? "!" : ".";
      lines.push(`  │   └─[${tIcon}] ${task.sessionTitle}`);
    }

    if (i < workflow.stages.length - 1) {
      lines.push(`  │   ↓`);
    }
  }

  lines.push(`  └${"─".repeat(40)}┘`);
  return lines;
}

/**
 * Render a workflow chain as an ASCII dependency DAG.
 */
export function renderChainDag(chain: WorkflowChain): string[] {
  const lines: string[] = [];
  lines.push(`  ╔═ Chain: ${chain.name} ═╗`);

  // group by depth (entries with no deps = depth 0, etc.)
  const depths = new Map<string, number>();
  const getDepth = (name: string, visited = new Set<string>()): number => {
    if (depths.has(name)) return depths.get(name)!;
    if (visited.has(name)) return 0;
    visited.add(name);
    const entry = chain.entries.find((e) => e.workflowName === name);
    if (!entry || entry.dependsOn.length === 0) { depths.set(name, 0); return 0; }
    const maxDep = Math.max(...entry.dependsOn.map((d) => getDepth(d, visited)));
    const depth = maxDep + 1;
    depths.set(name, depth);
    return depth;
  };
  for (const e of chain.entries) getDepth(e.workflowName);

  const maxDepth = Math.max(0, ...depths.values());
  for (let d = 0; d <= maxDepth; d++) {
    const atDepth = chain.entries.filter((e) => (depths.get(e.workflowName) ?? 0) === d);
    if (d > 0) lines.push(`  ║   ↓`);
    const indent = "  ║" + "  ".repeat(d);
    for (const e of atDepth) {
      const icon = e.status === "completed" ? "✓" : e.status === "active" ? "▶" : e.status === "failed" ? "✗" : "○";
      const deps = e.dependsOn.length > 0 ? ` ← ${e.dependsOn.join(",")}` : "";
      lines.push(`${indent} [${icon}] ${e.workflowName}${deps}`);
    }
  }

  lines.push(`  ╚${"═".repeat(40)}╝`);
  return lines;
}

/**
 * Render a compact workflow summary (single-line per stage).
 */
export function renderWorkflowCompact(workflow: WorkflowState): string {
  const icons = workflow.stages.map((s) =>
    s.status === "completed" ? "✓" : s.status === "active" ? "▶" : s.status === "failed" ? "✗" : "○"
  );
  return `[${icons.join("→")}] ${workflow.name}`;
}
