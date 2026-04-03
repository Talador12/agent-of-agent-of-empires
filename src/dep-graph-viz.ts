// dep-graph-viz.ts — ASCII visualization of task dependency graphs.
// renders a topological layout showing dependencies between tasks.

import type { TaskState } from "./types.js";

export interface GraphNode {
  title: string;
  status: string;
  dependsOn: string[];
  depth: number; // topological depth (0 = no deps)
}

/**
 * Build a dependency graph from task states.
 */
export function buildGraph(tasks: readonly TaskState[]): GraphNode[] {
  const titleSet = new Set(tasks.map((t) => t.sessionTitle));
  const nodes: GraphNode[] = tasks.map((t) => ({
    title: t.sessionTitle,
    status: t.status,
    dependsOn: (t.dependsOn ?? []).filter((d) => titleSet.has(d)),
    depth: 0,
  }));

  // compute topological depth
  const depthMap = new Map<string, number>();
  const getDepth = (title: string, visited = new Set<string>()): number => {
    if (depthMap.has(title)) return depthMap.get(title)!;
    if (visited.has(title)) return 0; // cycle guard
    visited.add(title);
    const node = nodes.find((n) => n.title === title);
    if (!node || node.dependsOn.length === 0) { depthMap.set(title, 0); return 0; }
    const maxParent = Math.max(...node.dependsOn.map((d) => getDepth(d, visited)));
    const depth = maxParent + 1;
    depthMap.set(title, depth);
    return depth;
  };

  for (const node of nodes) {
    node.depth = getDepth(node.title);
  }

  return nodes.sort((a, b) => a.depth - b.depth || a.title.localeCompare(b.title));
}

/**
 * Render ASCII dependency graph.
 */
export function renderGraph(nodes: GraphNode[]): string[] {
  if (nodes.length === 0) return ["  (no tasks to visualize)"];

  const lines: string[] = [];
  const maxDepth = Math.max(...nodes.map((n) => n.depth));

  // group by depth
  const byDepth = new Map<number, GraphNode[]>();
  for (const n of nodes) {
    if (!byDepth.has(n.depth)) byDepth.set(n.depth, []);
    byDepth.get(n.depth)!.push(n);
  }

  const statusIcon = (s: string): string => {
    switch (s) {
      case "completed": return "✓";
      case "active": return "▶";
      case "failed": return "✗";
      case "paused": return "⏸";
      case "pending": return "○";
      default: return "?";
    }
  };

  for (let depth = 0; depth <= maxDepth; depth++) {
    const group = byDepth.get(depth) ?? [];
    const indent = "  ".repeat(depth + 1);
    const depthLabel = depth === 0 ? "roots" : `depth ${depth}`;

    if (depth > 0) {
      // draw connection lines
      for (const node of group) {
        for (const dep of node.dependsOn) {
          lines.push(`${indent}  └─ depends on: ${dep}`);
        }
      }
    }

    for (const node of group) {
      const icon = statusIcon(node.status);
      const deps = node.dependsOn.length > 0 ? ` ← [${node.dependsOn.join(", ")}]` : "";
      lines.push(`${indent}${icon} ${node.title} (${node.status})${deps}`);
    }

    if (depth < maxDepth) {
      lines.push(`${indent}  │`);
    }
  }

  lines.unshift(`  Dependency graph (${nodes.length} tasks, max depth ${maxDepth}):`);
  return lines;
}

/**
 * Detect cycles in the dependency graph.
 */
export function detectCycles(tasks: readonly TaskState[]): string[][] {
  const cycles: string[][] = [];
  const visited = new Set<string>();
  const stack = new Set<string>();
  const depsMap = new Map(tasks.map((t) => [t.sessionTitle, t.dependsOn ?? []]));

  const dfs = (title: string, path: string[]): void => {
    if (stack.has(title)) {
      const cycleStart = path.indexOf(title);
      if (cycleStart >= 0) cycles.push(path.slice(cycleStart));
      return;
    }
    if (visited.has(title)) return;
    visited.add(title);
    stack.add(title);
    for (const dep of depsMap.get(title) ?? []) {
      dfs(dep, [...path, title]);
    }
    stack.delete(title);
  };

  for (const t of tasks) dfs(t.sessionTitle, []);
  return cycles;
}

/**
 * Format cycle warnings for TUI display.
 */
export function formatCycles(cycles: string[][]): string[] {
  if (cycles.length === 0) return ["  ✓ No dependency cycles detected"];
  return [
    `  ⚠ ${cycles.length} dependency cycle${cycles.length !== 1 ? "s" : ""} detected:`,
    ...cycles.map((c) => `    ${c.join(" → ")} → ${c[0]}`),
  ];
}
