// action-replay.ts — step through daemon decision history for post-mortem
// analysis. loads action log entries, groups by tick, and provides
// navigation + what-if filtering to understand why decisions were made.

export interface ReplayEntry {
  tickNum: number;
  timestamp: number;
  actions: ReplayAction[];
}

export interface ReplayAction {
  actionType: string;
  sessionTitle: string;
  detail: string;
  success: boolean;
  timestamp: number;
}

export interface ReplayState {
  entries: ReplayEntry[];
  currentIdx: number;
  filter?: string; // session title filter
}

/**
 * Build replay state from raw action log lines (JSONL).
 */
export function buildReplayState(logLines: string[], tickIntervalMs = 30_000): ReplayState {
  const actions: ReplayAction[] = [];

  for (const line of logLines) {
    try {
      const parsed = JSON.parse(line);
      if (!parsed.timestamp || !parsed.action) continue;
      actions.push({
        actionType: parsed.action.action ?? "unknown",
        sessionTitle: parsed.action.session ?? parsed.action.title ?? "",
        detail: parsed.detail ?? "",
        success: parsed.success ?? true,
        timestamp: parsed.timestamp,
      });
    } catch { /* skip malformed lines */ }
  }

  if (actions.length === 0) return { entries: [], currentIdx: 0 };

  // group into ticks by timestamp proximity
  actions.sort((a, b) => a.timestamp - b.timestamp);
  const entries: ReplayEntry[] = [];
  let currentTick: ReplayEntry = { tickNum: 1, timestamp: actions[0].timestamp, actions: [] };

  for (const a of actions) {
    if (a.timestamp - currentTick.timestamp > tickIntervalMs) {
      entries.push(currentTick);
      currentTick = { tickNum: entries.length + 1, timestamp: a.timestamp, actions: [] };
    }
    currentTick.actions.push(a);
  }
  entries.push(currentTick);

  return { entries, currentIdx: entries.length - 1 };
}

/**
 * Navigate to a specific tick in the replay.
 */
export function seekTo(state: ReplayState, tickNum: number): ReplayEntry | null {
  const idx = state.entries.findIndex((e) => e.tickNum === tickNum);
  if (idx === -1) return null;
  state.currentIdx = idx;
  return state.entries[idx];
}

/**
 * Step forward/backward through replay.
 */
export function step(state: ReplayState, direction: "forward" | "backward"): ReplayEntry | null {
  if (direction === "forward" && state.currentIdx < state.entries.length - 1) {
    state.currentIdx++;
  } else if (direction === "backward" && state.currentIdx > 0) {
    state.currentIdx--;
  }
  return state.entries[state.currentIdx] ?? null;
}

/**
 * Get the current replay entry.
 */
export function currentEntry(state: ReplayState): ReplayEntry | null {
  return state.entries[state.currentIdx] ?? null;
}

/**
 * Filter replay to only show actions for a specific session.
 */
export function filterBySession(state: ReplayState, sessionTitle: string | null): ReplayEntry[] {
  state.filter = sessionTitle ?? undefined;
  if (!sessionTitle) return state.entries;
  return state.entries.map((e) => ({
    ...e,
    actions: e.actions.filter((a) => a.sessionTitle.toLowerCase() === sessionTitle.toLowerCase()),
  })).filter((e) => e.actions.length > 0);
}

/**
 * Get replay summary statistics.
 */
export function replayStats(state: ReplayState): { totalTicks: number; totalActions: number; failedActions: number; sessionsInvolved: number } {
  const allActions = state.entries.flatMap((e) => e.actions);
  const sessions = new Set(allActions.map((a) => a.sessionTitle).filter(Boolean));
  return {
    totalTicks: state.entries.length,
    totalActions: allActions.length,
    failedActions: allActions.filter((a) => !a.success).length,
    sessionsInvolved: sessions.size,
  };
}

/**
 * Format replay entry for TUI display.
 */
export function formatReplayEntry(entry: ReplayEntry | null, total: number): string[] {
  if (!entry) return ["  Action replay: no entries loaded"];
  const lines: string[] = [];
  const time = new Date(entry.timestamp).toISOString().slice(11, 19);
  lines.push(`  ▶ Tick #${entry.tickNum}/${total} @ ${time} (${entry.actions.length} actions):`);
  for (const a of entry.actions) {
    const icon = a.success ? "✓" : "✗";
    const session = a.sessionTitle ? `[${a.sessionTitle}] ` : "";
    lines.push(`    ${icon} ${session}${a.actionType}: ${a.detail.slice(0, 60)}`);
  }
  return lines;
}

/**
 * Format replay stats for TUI display.
 */
export function formatReplayStats(state: ReplayState): string[] {
  const stats = replayStats(state);
  if (stats.totalTicks === 0) return ["  Action replay: no action history loaded"];
  return [
    `  Action Replay (${stats.totalTicks} ticks, ${stats.totalActions} actions, ${stats.failedActions} failed, ${stats.sessionsInvolved} sessions)`,
    `  Position: tick ${(state.entries[state.currentIdx]?.tickNum ?? 0)}/${stats.totalTicks}${state.filter ? ` [filter: ${state.filter}]` : ""}`,
  ];
}
