// goal-critical-path.ts — identify the longest dependency chain in the
// task graph for scheduling optimization. the critical path determines
// the minimum time to complete all work, regardless of parallelism.

export interface CriticalPathNode {
  sessionTitle: string;
  goal: string;
  durationEstHours: number;
  dependsOn: string[];
  depth: number; // distance from root in critical path
}

export interface CriticalPathResult {
  path: CriticalPathNode[];
  totalDurationHours: number;
  maxDepth: number;
  bottleneck: string | null; // longest individual node
  parallelizable: number;   // tasks NOT on the critical path
}

/**
 * Build an adjacency list from dependency declarations.
 */
function buildAdjacency(nodes: CriticalPathNode[]): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  for (const n of nodes) adj.set(n.sessionTitle, n.dependsOn);
  return adj;
}

/**
 * Compute longest path in a DAG using dynamic programming.
 * Returns the critical path (longest chain of dependencies).
 */
export function computeCriticalPath(nodes: CriticalPathNode[]): CriticalPathResult {
  if (nodes.length === 0) return { path: [], totalDurationHours: 0, maxDepth: 0, bottleneck: null, parallelizable: 0 };

  const nodeMap = new Map(nodes.map((n) => [n.sessionTitle, n]));
  const adj = buildAdjacency(nodes);

  // topological sort + longest path DP
  const dist = new Map<string, number>(); // session -> longest path duration ending at this node
  const prev = new Map<string, string | null>(); // for path reconstruction
  const visited = new Set<string>();
  const order: string[] = [];

  function dfs(title: string): void {
    if (visited.has(title)) return;
    visited.add(title);
    for (const dep of adj.get(title) ?? []) {
      if (nodeMap.has(dep)) dfs(dep);
    }
    order.push(title);
  }

  for (const n of nodes) dfs(n.sessionTitle);

  // initialize
  for (const n of nodes) {
    dist.set(n.sessionTitle, n.durationEstHours);
    prev.set(n.sessionTitle, null);
  }

  // relax edges in topological order
  for (const title of order) {
    const node = nodeMap.get(title)!;
    const myDist = dist.get(title)!;
    // for each node that depends on this one, check if we extend longest path
    for (const [other, deps] of adj) {
      if (deps.includes(title)) {
        const otherNode = nodeMap.get(other)!;
        const newDist = myDist + otherNode.durationEstHours;
        if (newDist > (dist.get(other) ?? 0)) {
          dist.set(other, newDist);
          prev.set(other, title);
        }
      }
    }
  }

  // find the end of the critical path (max dist)
  let maxTitle = nodes[0].sessionTitle;
  let maxDist = 0;
  for (const [title, d] of dist) {
    if (d > maxDist) { maxDist = d; maxTitle = title; }
  }

  // reconstruct path
  const path: CriticalPathNode[] = [];
  let current: string | null = maxTitle;
  let depth = 0;
  while (current) {
    const node = nodeMap.get(current)!;
    path.unshift({ ...node, depth });
    current = prev.get(current) ?? null;
    depth++;
  }

  // assign correct depths (root = 0)
  path.forEach((n, i) => { n.depth = i; });

  // find bottleneck (longest single node on critical path)
  const bottleneck = path.length > 0
    ? path.reduce((a, b) => a.durationEstHours > b.durationEstHours ? a : b).sessionTitle
    : null;

  const criticalTitles = new Set(path.map((n) => n.sessionTitle));
  const parallelizable = nodes.filter((n) => !criticalTitles.has(n.sessionTitle)).length;

  return { path, totalDurationHours: maxDist, maxDepth: path.length, bottleneck, parallelizable };
}

/**
 * Format critical path for TUI display.
 */
export function formatCriticalPath(result: CriticalPathResult): string[] {
  if (result.path.length === 0) return ["  Critical path: no dependency graph to analyze"];
  const lines: string[] = [];
  lines.push(`  Critical Path (${result.path.length} nodes, ${result.totalDurationHours.toFixed(1)}h total, ${result.parallelizable} parallelizable):`);
  for (const n of result.path) {
    const indent = "  ".repeat(n.depth);
    const marker = n.sessionTitle === result.bottleneck ? " ← bottleneck" : "";
    lines.push(`    ${indent}→ ${n.sessionTitle} (${n.durationEstHours.toFixed(1)}h)${marker}`);
  }
  if (result.bottleneck) {
    lines.push(`    Bottleneck: ${result.bottleneck} — optimize this to shorten critical path`);
  }
  return lines;
}
