// goal-cascading.ts — parent goals auto-generate child goals across
// dependent sessions. when a high-level goal is decomposed, child goals
// are assigned to sessions that match the repo/domain, creating a
// cascading tree of work.

export interface CascadeGoal {
  id: number;
  parentId: number | null;
  sessionTitle: string;
  goal: string;
  repo: string;
  status: "pending" | "active" | "completed" | "failed";
  children: number[]; // child goal IDs
  depth: number;
}

export interface CascadeState {
  goals: CascadeGoal[];
  nextId: number;
  maxDepth: number;
}

/**
 * Create cascade state.
 */
export function createCascadeState(maxDepth = 3): CascadeState {
  return { goals: [], nextId: 1, maxDepth };
}

/**
 * Add a root-level parent goal.
 */
export function addParentGoal(state: CascadeState, sessionTitle: string, goal: string, repo: string): CascadeGoal {
  const g: CascadeGoal = {
    id: state.nextId++,
    parentId: null,
    sessionTitle, goal, repo,
    status: "active",
    children: [],
    depth: 0,
  };
  state.goals.push(g);
  return g;
}

/**
 * Cascade a child goal from a parent.
 */
export function cascadeChild(
  state: CascadeState,
  parentId: number,
  sessionTitle: string,
  goal: string,
  repo: string,
): CascadeGoal | null {
  const parent = state.goals.find((g) => g.id === parentId);
  if (!parent) return null;
  if (parent.depth >= state.maxDepth) return null; // depth limit

  const child: CascadeGoal = {
    id: state.nextId++,
    parentId,
    sessionTitle, goal, repo,
    status: "pending",
    children: [],
    depth: parent.depth + 1,
  };
  parent.children.push(child.id);
  state.goals.push(child);
  return child;
}

/**
 * Mark a cascade goal as completed. If all children of a parent are done,
 * marks the parent as completed too (bottom-up propagation).
 */
export function completeCascadeGoal(state: CascadeState, goalId: number): boolean {
  const goal = state.goals.find((g) => g.id === goalId);
  if (!goal) return false;
  goal.status = "completed";

  // propagate up: if all siblings of parent are done, complete parent
  if (goal.parentId !== null) {
    const parent = state.goals.find((g) => g.id === goal.parentId);
    if (parent) {
      const allChildrenDone = parent.children.every((cid) => {
        const child = state.goals.find((g) => g.id === cid);
        return child?.status === "completed";
      });
      if (allChildrenDone && parent.children.length > 0) {
        parent.status = "completed";
      }
    }
  }

  return true;
}

/**
 * Get the cascade tree for a root goal.
 */
export function getCascadeTree(state: CascadeState, rootId: number): CascadeGoal[] {
  const tree: CascadeGoal[] = [];
  const root = state.goals.find((g) => g.id === rootId);
  if (!root) return tree;

  const queue = [root];
  while (queue.length > 0) {
    const node = queue.shift()!;
    tree.push(node);
    for (const cid of node.children) {
      const child = state.goals.find((g) => g.id === cid);
      if (child) queue.push(child);
    }
  }

  return tree;
}

/**
 * Get all root (parentless) goals.
 */
export function getRootGoals(state: CascadeState): CascadeGoal[] {
  return state.goals.filter((g) => g.parentId === null);
}

/**
 * Get cascade stats.
 */
export function cascadeStats(state: CascadeState): { total: number; roots: number; maxDepthUsed: number; completed: number; pending: number } {
  const maxDepth = state.goals.reduce((m, g) => Math.max(m, g.depth), 0);
  return {
    total: state.goals.length,
    roots: state.goals.filter((g) => g.parentId === null).length,
    maxDepthUsed: maxDepth,
    completed: state.goals.filter((g) => g.status === "completed").length,
    pending: state.goals.filter((g) => g.status === "pending").length,
  };
}

/**
 * Format cascade tree for TUI display.
 */
export function formatCascadeTree(state: CascadeState): string[] {
  const stats = cascadeStats(state);
  const lines: string[] = [];
  lines.push(`  Goal Cascading (${stats.total} goals, ${stats.roots} roots, depth ${stats.maxDepthUsed}/${state.maxDepth}):`);

  if (state.goals.length === 0) {
    lines.push("    No cascading goals defined");
    return lines;
  }

  const roots = getRootGoals(state);
  for (const root of roots) {
    const tree = getCascadeTree(state, root.id);
    for (const node of tree) {
      const indent = "  ".repeat(node.depth);
      const icon = node.status === "completed" ? "✓" : node.status === "active" ? "▶" : node.status === "failed" ? "✗" : "○";
      lines.push(`    ${indent}${icon} #${node.id} [${node.sessionTitle}] ${node.goal.slice(0, 50)}`);
    }
  }

  return lines;
}
