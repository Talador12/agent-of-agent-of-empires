// session-heartbeat.ts — detect tmux pane crashes independent of AoE status.
// tracks per-session liveness via output hash changes. if a pane produces
// no new output for N consecutive ticks while marked "working", it's likely
// crashed or frozen. escalates: stale → unresponsive → dead.

export type HeartbeatStatus = "alive" | "stale" | "unresponsive" | "dead";

export interface SessionHeartbeat {
  sessionTitle: string;
  status: HeartbeatStatus;
  lastOutputHash: string;
  lastChangeAt: number;
  staleTicks: number;
  missedTicks: number; // consecutive ticks without output change
}

export interface HeartbeatState {
  sessions: Map<string, SessionHeartbeat>;
}

/**
 * Create a fresh heartbeat state.
 */
export function createHeartbeatState(): HeartbeatState {
  return { sessions: new Map() };
}

/**
 * Record a heartbeat tick for a session. outputHash should be the SHA-256
 * (or any fast hash) of the current pane output.
 */
export function recordHeartbeat(
  state: HeartbeatState,
  sessionTitle: string,
  outputHash: string,
  now = Date.now(),
): void {
  const existing = state.sessions.get(sessionTitle);
  if (!existing) {
    state.sessions.set(sessionTitle, {
      sessionTitle,
      status: "alive",
      lastOutputHash: outputHash,
      lastChangeAt: now,
      staleTicks: 0,
      missedTicks: 0,
    });
    return;
  }

  if (outputHash !== existing.lastOutputHash) {
    // output changed — session is alive
    existing.lastOutputHash = outputHash;
    existing.lastChangeAt = now;
    existing.staleTicks = 0;
    existing.missedTicks = 0;
    existing.status = "alive";
  } else {
    // no change — increment miss counter
    existing.missedTicks++;
  }
}

/**
 * Evaluate heartbeat statuses based on missed ticks.
 * staleTicks: ticks before "stale" (default 5)
 * unresponsiveTicks: ticks before "unresponsive" (default 10)
 * deadTicks: ticks before "dead" (default 20)
 */
export function evaluateHeartbeats(
  state: HeartbeatState,
  activeSessions: string[],
  staleTicks = 5,
  unresponsiveTicks = 10,
  deadTicks = 20,
): SessionHeartbeat[] {
  const results: SessionHeartbeat[] = [];

  for (const title of activeSessions) {
    const hb = state.sessions.get(title);
    if (!hb) continue;

    if (hb.missedTicks >= deadTicks) {
      hb.status = "dead";
    } else if (hb.missedTicks >= unresponsiveTicks) {
      hb.status = "unresponsive";
    } else if (hb.missedTicks >= staleTicks) {
      hb.status = "stale";
    } else {
      hb.status = "alive";
    }

    hb.staleTicks = hb.missedTicks;
    results.push({ ...hb });
  }

  return results.sort((a, b) => b.missedTicks - a.missedTicks);
}

/**
 * Remove a session from heartbeat tracking.
 */
export function removeHeartbeat(state: HeartbeatState, sessionTitle: string): void {
  state.sessions.delete(sessionTitle);
}

/**
 * Format heartbeat statuses for TUI display.
 */
export function formatHeartbeats(heartbeats: SessionHeartbeat[]): string[] {
  if (heartbeats.length === 0) return ["  Heartbeat: no sessions tracked"];
  const problems = heartbeats.filter((h) => h.status !== "alive");
  const lines: string[] = [];
  if (problems.length === 0) {
    lines.push(`  Heartbeat: all ${heartbeats.length} sessions alive`);
  } else {
    lines.push(`  Heartbeat: ${problems.length} issue${problems.length !== 1 ? "s" : ""} detected:`);
    for (const h of problems) {
      const icon = h.status === "dead" ? "💀" : h.status === "unresponsive" ? "⚠" : "⏳";
      const age = Math.round((Date.now() - h.lastChangeAt) / 60_000);
      lines.push(`  ${icon} ${h.sessionTitle}: ${h.status} (${h.missedTicks} ticks, last output ${age}m ago)`);
    }
  }
  return lines;
}
