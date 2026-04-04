// goal-dep-graph-export.ts — export dependency graph as DOT (Graphviz)
// or Mermaid format for documentation, visualization, or embedding in
// markdown files and wikis.

export interface GraphNode {
  sessionTitle: string;
  status: string;
  dependsOn: string[];
}

export type GraphFormat = "dot" | "mermaid" | "ascii";

/**
 * Export dependency graph as DOT (Graphviz) format.
 */
export function exportDot(nodes: GraphNode[]): string {
  const lines: string[] = [];
  lines.push("digraph deps {");
  lines.push("  rankdir=LR;");
  lines.push('  node [shape=box, style=filled];');

  for (const n of nodes) {
    const color = n.status === "completed" ? "#90EE90" : n.status === "active" ? "#87CEEB" : n.status === "failed" ? "#FFB6C1" : "#F0F0F0";
    lines.push(`  "${n.sessionTitle}" [fillcolor="${color}", label="${n.sessionTitle}\\n(${n.status})"];`);
  }

  for (const n of nodes) {
    for (const dep of n.dependsOn) {
      lines.push(`  "${dep}" -> "${n.sessionTitle}";`);
    }
  }

  lines.push("}");
  return lines.join("\n");
}

/**
 * Export dependency graph as Mermaid format.
 */
export function exportMermaid(nodes: GraphNode[]): string {
  const lines: string[] = [];
  lines.push("graph LR");

  const statusStyle: Record<string, string> = {
    completed: ":::completed", active: ":::active", failed: ":::failed",
    pending: ":::pending", paused: ":::paused",
  };

  for (const n of nodes) {
    const style = statusStyle[n.status] ?? "";
    lines.push(`  ${sanitizeId(n.sessionTitle)}["${n.sessionTitle} (${n.status})"]${style}`);
  }

  for (const n of nodes) {
    for (const dep of n.dependsOn) {
      lines.push(`  ${sanitizeId(dep)} --> ${sanitizeId(n.sessionTitle)}`);
    }
  }

  // style definitions
  lines.push("  classDef completed fill:#90EE90,stroke:#333");
  lines.push("  classDef active fill:#87CEEB,stroke:#333");
  lines.push("  classDef failed fill:#FFB6C1,stroke:#333");
  lines.push("  classDef pending fill:#F0F0F0,stroke:#333");
  lines.push("  classDef paused fill:#FFE4B5,stroke:#333");

  return lines.join("\n");
}

function sanitizeId(s: string): string {
  return s.replace(/[^a-zA-Z0-9_]/g, "_");
}

/**
 * Export as simple ASCII representation.
 */
export function exportAscii(nodes: GraphNode[]): string {
  const lines: string[] = [];
  lines.push("Dependency Graph:");
  const roots = nodes.filter((n) => n.dependsOn.length === 0);
  const nodeMap = new Map(nodes.map((n) => [n.sessionTitle, n]));

  function render(title: string, depth: number, visited: Set<string>): void {
    if (visited.has(title)) { lines.push(`${"  ".repeat(depth)}↻ ${title} (cycle)`); return; }
    visited.add(title);
    const node = nodeMap.get(title);
    const status = node?.status ?? "?";
    lines.push(`${"  ".repeat(depth)}${depth > 0 ? "└─ " : ""}${title} [${status}]`);
    const children = nodes.filter((n) => n.dependsOn.includes(title));
    for (const c of children) render(c.sessionTitle, depth + 1, new Set(visited));
  }

  if (roots.length === 0 && nodes.length > 0) {
    for (const n of nodes) lines.push(`  ${n.sessionTitle} [${n.status}]`);
  } else {
    for (const r of roots) render(r.sessionTitle, 0, new Set());
  }

  return lines.join("\n");
}

/**
 * Export in any supported format.
 */
export function exportGraph(nodes: GraphNode[], format: GraphFormat): string {
  switch (format) {
    case "dot": return exportDot(nodes);
    case "mermaid": return exportMermaid(nodes);
    case "ascii": return exportAscii(nodes);
  }
}

/**
 * Get graph stats.
 */
export function graphStats(nodes: GraphNode[]): { nodeCount: number; edgeCount: number; rootCount: number; leafCount: number } {
  const edges = nodes.reduce((a, n) => a + n.dependsOn.length, 0);
  const roots = nodes.filter((n) => n.dependsOn.length === 0).length;
  const depTargets = new Set(nodes.flatMap((n) => n.dependsOn));
  const leaves = nodes.filter((n) => !depTargets.has(n.sessionTitle)).length;
  return { nodeCount: nodes.length, edgeCount: edges, rootCount: roots, leafCount: leaves };
}

/**
 * Format graph export for TUI display.
 */
export function formatGraphExport(nodes: GraphNode[], format: GraphFormat): string[] {
  const stats = graphStats(nodes);
  const lines: string[] = [];
  lines.push(`  Dep Graph Export [${format}] (${stats.nodeCount} nodes, ${stats.edgeCount} edges, ${stats.rootCount} roots, ${stats.leafCount} leaves):`);
  const exported = exportGraph(nodes, format);
  const preview = exported.split("\n").slice(0, 10);
  for (const l of preview) lines.push(`    ${l}`);
  if (exported.split("\n").length > 10) lines.push(`    ... ${exported.split("\n").length - 10} more lines`);
  return lines;
}
