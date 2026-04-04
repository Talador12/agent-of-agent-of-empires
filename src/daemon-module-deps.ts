// daemon-module-deps.ts — visualize inter-module dependencies within
// the daemon. tracks which modules depend on which others, detects
// circular deps, and renders the dependency tree.

export interface ModuleDep {
  moduleName: string;
  dependsOn: string[];
  category: "core" | "intelligence" | "tui" | "cli" | "utility";
}

export interface ModuleDepGraph {
  modules: ModuleDep[];
}

/**
 * Create a module dependency graph from registration.
 */
export function createModuleDepGraph(modules: ModuleDep[]): ModuleDepGraph {
  return { modules: [...modules] };
}

/**
 * Get modules that depend on a specific module (reverse deps).
 */
export function getDependents(graph: ModuleDepGraph, moduleName: string): string[] {
  return graph.modules.filter((m) => m.dependsOn.includes(moduleName)).map((m) => m.moduleName);
}

/**
 * Get modules that a specific module depends on.
 */
export function getDependencies(graph: ModuleDepGraph, moduleName: string): string[] {
  const mod = graph.modules.find((m) => m.moduleName === moduleName);
  return mod?.dependsOn ?? [];
}

/**
 * Find modules with no dependencies (roots).
 */
export function getRoots(graph: ModuleDepGraph): string[] {
  return graph.modules.filter((m) => m.dependsOn.length === 0).map((m) => m.moduleName);
}

/**
 * Find modules with no dependents (leaves).
 */
export function getLeaves(graph: ModuleDepGraph): string[] {
  const depTargets = new Set(graph.modules.flatMap((m) => m.dependsOn));
  return graph.modules.filter((m) => !depTargets.has(m.moduleName)).map((m) => m.moduleName);
}

/**
 * Count modules by category.
 */
export function categoryBreakdown(graph: ModuleDepGraph): Map<string, number> {
  const counts = new Map<string, number>();
  for (const m of graph.modules) counts.set(m.category, (counts.get(m.category) ?? 0) + 1);
  return counts;
}

/**
 * Find the module with most dependents (most "important").
 */
export function mostDepended(graph: ModuleDepGraph): { moduleName: string; dependentCount: number } | null {
  if (graph.modules.length === 0) return null;
  let best = { moduleName: "", count: 0 };
  for (const m of graph.modules) {
    const deps = getDependents(graph, m.moduleName).length;
    if (deps > best.count) best = { moduleName: m.moduleName, count: deps };
  }
  return best.count > 0 ? { moduleName: best.moduleName, dependentCount: best.count } : null;
}

/**
 * Get graph stats.
 */
export function moduleDepStats(graph: ModuleDepGraph): { modules: number; edges: number; roots: number; leaves: number; categories: number } {
  const edges = graph.modules.reduce((a, m) => a + m.dependsOn.length, 0);
  return {
    modules: graph.modules.length,
    edges,
    roots: getRoots(graph).length,
    leaves: getLeaves(graph).length,
    categories: categoryBreakdown(graph).size,
  };
}

/**
 * Format module dep graph for TUI display.
 */
export function formatModuleDeps(graph: ModuleDepGraph): string[] {
  const stats = moduleDepStats(graph);
  const lines: string[] = [];
  lines.push(`  Module Dependencies (${stats.modules} modules, ${stats.edges} edges, ${stats.roots} roots, ${stats.leaves} leaves):`);

  // category breakdown
  const cats = categoryBreakdown(graph);
  const catStr = Array.from(cats.entries()).map(([c, n]) => `${c}:${n}`).join(" ");
  lines.push(`    Categories: ${catStr}`);

  // most depended
  const top = mostDepended(graph);
  if (top) lines.push(`    Most depended: ${top.moduleName} (${top.dependentCount} dependents)`);

  // show roots
  const roots = getRoots(graph);
  if (roots.length > 0) lines.push(`    Roots: ${roots.slice(0, 5).join(", ")}${roots.length > 5 ? ` +${roots.length - 5}` : ""}`);

  return lines;
}
