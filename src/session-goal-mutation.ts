// session-goal-mutation.ts — track how goals change over time.
// records goal text at each change, computes diff between versions,
// and detects scope creep or goal refinement patterns.

export interface GoalMutation {
  sessionTitle: string;
  version: number;
  goal: string;
  changedAt: number;
  changeType: "initial" | "refined" | "expanded" | "narrowed" | "replaced";
}

export interface MutationState {
  history: Map<string, GoalMutation[]>; // session -> goal versions
}

/**
 * Create mutation tracking state.
 */
export function createMutationState(): MutationState {
  return { history: new Map() };
}

/**
 * Record a goal change for a session.
 */
export function recordGoalChange(state: MutationState, sessionTitle: string, goal: string, now = Date.now()): GoalMutation {
  if (!state.history.has(sessionTitle)) state.history.set(sessionTitle, []);
  const versions = state.history.get(sessionTitle)!;
  const version = versions.length + 1;

  let changeType: GoalMutation["changeType"] = "initial";
  if (versions.length > 0) {
    const prev = versions[versions.length - 1].goal;
    const prevWordArr = prev.toLowerCase().split(/\s+/).filter(Boolean);
    const newWordArr = goal.toLowerCase().split(/\s+/).filter(Boolean);
    const prevSet = new Set(prevWordArr);
    const newSet = new Set(newWordArr);
    const overlap = [...prevSet].filter((w) => newSet.has(w)).length;
    const similarity = Math.max(prevSet.size, newSet.size) > 0 ? overlap / Math.max(prevSet.size, newSet.size) : 0;

    if (similarity < 0.2) changeType = "replaced";
    else if (newWordArr.length > prevWordArr.length * 1.5 + 1) changeType = "expanded";
    else if (newWordArr.length < prevWordArr.length * 0.5) changeType = "narrowed";
    else changeType = "refined";
  }

  const mutation: GoalMutation = { sessionTitle, version, goal, changedAt: now, changeType };
  versions.push(mutation);
  return mutation;
}

/**
 * Get goal history for a session.
 */
export function getGoalHistory(state: MutationState, sessionTitle: string): GoalMutation[] {
  return state.history.get(sessionTitle) ?? [];
}

/**
 * Detect scope creep (multiple expansions without narrowing).
 */
export function detectScopeCreep(state: MutationState, sessionTitle: string): boolean {
  const history = getGoalHistory(state, sessionTitle);
  if (history.length < 3) return false;
  const recent = history.slice(-3);
  return recent.filter((m) => m.changeType === "expanded").length >= 2;
}

/**
 * Get mutation stats across all sessions.
 */
export function mutationStats(state: MutationState): { sessionsTracked: number; totalMutations: number; avgMutationsPerSession: number; scopeCreepSessions: string[] } {
  let total = 0;
  const creep: string[] = [];
  for (const [title, versions] of state.history) {
    total += versions.length;
    if (detectScopeCreep(state, title)) creep.push(title);
  }
  return {
    sessionsTracked: state.history.size,
    totalMutations: total,
    avgMutationsPerSession: state.history.size > 0 ? Math.round((total / state.history.size) * 10) / 10 : 0,
    scopeCreepSessions: creep,
  };
}

/**
 * Format mutation history for TUI display.
 */
export function formatMutationHistory(state: MutationState, sessionTitle?: string): string[] {
  const lines: string[] = [];
  if (sessionTitle) {
    const history = getGoalHistory(state, sessionTitle);
    if (history.length === 0) { lines.push(`  Goal Mutations [${sessionTitle}]: no history`); return lines; }
    lines.push(`  Goal Mutations [${sessionTitle}] (${history.length} versions):`);
    for (const m of history) {
      const time = new Date(m.changedAt).toISOString().slice(11, 19);
      lines.push(`    v${m.version} [${m.changeType}] ${time}: ${m.goal.slice(0, 60)}`);
    }
  } else {
    const stats = mutationStats(state);
    lines.push(`  Goal Mutations (${stats.sessionsTracked} sessions, ${stats.totalMutations} changes, avg ${stats.avgMutationsPerSession}/session):`);
    if (stats.scopeCreepSessions.length > 0) lines.push(`    ⚠ Scope creep detected: ${stats.scopeCreepSessions.join(", ")}`);
  }
  return lines;
}
