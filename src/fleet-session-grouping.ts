// fleet-session-grouping.ts — logical groups (frontend, backend, infra, etc)
// with group-level aggregate stats. operators assign sessions to groups,
// then view per-group health, cost, progress, and session count.

export interface SessionGroup {
  name: string;
  sessions: string[]; // session titles
}

export interface GroupStats {
  name: string;
  sessionCount: number;
  activeSessions: number;
  avgHealthPct: number;
  totalCostUsd: number;
  avgProgressPct: number;
}

export interface GroupingState {
  groups: Map<string, Set<string>>; // group name -> session titles
}

/**
 * Create grouping state.
 */
export function createGroupingState(): GroupingState {
  return { groups: new Map() };
}

/**
 * Create or get a group.
 */
export function createGroup(state: GroupingState, name: string): void {
  if (!state.groups.has(name)) state.groups.set(name, new Set());
}

/**
 * Add a session to a group.
 */
export function addToGroup(state: GroupingState, groupName: string, sessionTitle: string): void {
  createGroup(state, groupName);
  state.groups.get(groupName)!.add(sessionTitle);
}

/**
 * Remove a session from a group.
 */
export function removeFromGroup(state: GroupingState, groupName: string, sessionTitle: string): boolean {
  const group = state.groups.get(groupName);
  if (!group) return false;
  return group.delete(sessionTitle);
}

/**
 * Remove a group entirely.
 */
export function removeGroup(state: GroupingState, groupName: string): boolean {
  return state.groups.delete(groupName);
}

/**
 * Get all sessions in a group.
 */
export function getGroupSessions(state: GroupingState, groupName: string): string[] {
  return Array.from(state.groups.get(groupName) ?? []);
}

/**
 * Get which group a session belongs to (first match).
 */
export function getSessionGroup(state: GroupingState, sessionTitle: string): string | null {
  for (const [name, sessions] of state.groups) {
    if (sessions.has(sessionTitle)) return name;
  }
  return null;
}

/**
 * List all groups with their session counts.
 */
export function listGroups(state: GroupingState): SessionGroup[] {
  return Array.from(state.groups.entries()).map(([name, sessions]) => ({
    name,
    sessions: Array.from(sessions),
  }));
}

/**
 * Compute aggregate stats for a group.
 */
export function computeGroupStats(
  state: GroupingState,
  groupName: string,
  sessionData: Map<string, { active: boolean; healthPct: number; costUsd: number; progressPct: number }>,
): GroupStats | null {
  const sessions = state.groups.get(groupName);
  if (!sessions || sessions.size === 0) return null;

  let activeCount = 0;
  let healthSum = 0;
  let costSum = 0;
  let progressSum = 0;
  let dataCount = 0;

  for (const title of sessions) {
    const data = sessionData.get(title);
    if (data) {
      if (data.active) activeCount++;
      healthSum += data.healthPct;
      costSum += data.costUsd;
      progressSum += data.progressPct;
      dataCount++;
    }
  }

  return {
    name: groupName,
    sessionCount: sessions.size,
    activeSessions: activeCount,
    avgHealthPct: dataCount > 0 ? Math.round(healthSum / dataCount) : 0,
    totalCostUsd: Math.round(costSum * 100) / 100,
    avgProgressPct: dataCount > 0 ? Math.round(progressSum / dataCount) : 0,
  };
}

/**
 * Format grouping state for TUI display.
 */
export function formatGrouping(groups: SessionGroup[]): string[] {
  if (groups.length === 0) return ["  Session Groups: none defined (use /group add <name> <session>)"];
  const lines: string[] = [];
  lines.push(`  Session Groups (${groups.length}):`);
  for (const g of groups) {
    lines.push(`    ${g.name} (${g.sessions.length}): ${g.sessions.join(", ") || "(empty)"}`);
  }
  return lines;
}

/**
 * Format group stats for TUI display.
 */
export function formatGroupStats(stats: GroupStats[]): string[] {
  if (stats.length === 0) return ["  Group stats: no data"];
  const lines: string[] = [];
  lines.push(`  ${"Group".padEnd(14)} ${"Sessions".padStart(8)} ${"Active".padStart(7)} ${"Health".padStart(7)} ${"Cost".padStart(9)} ${"Progress".padStart(9)}`);
  for (const s of stats) {
    lines.push(`  ${s.name.padEnd(14)} ${String(s.sessionCount).padStart(8)} ${String(s.activeSessions).padStart(7)} ${(s.avgHealthPct + "%").padStart(7)} ${"$" + s.totalCostUsd.toFixed(2).padStart(8)} ${(s.avgProgressPct + "%").padStart(9)}`);
  }
  return lines;
}
