// session-idle-detector.ts — detect prolonged idle sessions and generate alerts.
// tracks last-activity timestamps per session, flags sessions idle beyond
// a configurable threshold, and recommends actions (nudge, pause, reclaim).

export interface IdleSession {
  sessionTitle: string;
  idleDurationMs: number;
  lastActivityAt: number;
  recommendation: "nudge" | "pause" | "reclaim";
}

export interface IdleDetectorState {
  lastActivityMap: Map<string, number>; // sessionTitle -> last activity timestamp
  alertedSessions: Set<string>;         // sessions already flagged this cycle
}

/**
 * Create a fresh idle detector state.
 */
export function createIdleDetector(): IdleDetectorState {
  return {
    lastActivityMap: new Map(),
    alertedSessions: new Set(),
  };
}

/**
 * Record activity for a session. Resets its idle clock and clears any alert flag.
 */
export function recordActivity(state: IdleDetectorState, sessionTitle: string, now = Date.now()): void {
  state.lastActivityMap.set(sessionTitle, now);
  state.alertedSessions.delete(sessionTitle);
}

/**
 * Remove a session from tracking (e.g. after it completes or is removed).
 */
export function removeSession(state: IdleDetectorState, sessionTitle: string): void {
  state.lastActivityMap.delete(sessionTitle);
  state.alertedSessions.delete(sessionTitle);
}

/**
 * Detect idle sessions. Returns sessions that have been idle beyond the threshold.
 * Thresholds: nudge at idleThresholdMs, pause at 2x, reclaim at 3x.
 */
export function detectIdleSessions(
  state: IdleDetectorState,
  activeSessions: string[],
  idleThresholdMs = 300_000, // 5 min default
  now = Date.now(),
): IdleSession[] {
  const results: IdleSession[] = [];

  for (const title of activeSessions) {
    const lastActivity = state.lastActivityMap.get(title);
    if (lastActivity === undefined) {
      // first time seeing this session — start tracking
      state.lastActivityMap.set(title, now);
      continue;
    }

    const idleDurationMs = now - lastActivity;
    if (idleDurationMs < idleThresholdMs) continue;

    let recommendation: IdleSession["recommendation"];
    if (idleDurationMs >= idleThresholdMs * 3) {
      recommendation = "reclaim";
    } else if (idleDurationMs >= idleThresholdMs * 2) {
      recommendation = "pause";
    } else {
      recommendation = "nudge";
    }

    results.push({ sessionTitle: title, idleDurationMs, lastActivityAt: lastActivity, recommendation });
    state.alertedSessions.add(title);
  }

  return results.sort((a, b) => b.idleDurationMs - a.idleDurationMs);
}

/**
 * Format idle session alerts for TUI display.
 */
export function formatIdleAlerts(idles: IdleSession[]): string[] {
  if (idles.length === 0) return ["  Idle detector: all sessions active"];
  const lines: string[] = [];
  lines.push(`  Idle detector: ${idles.length} idle session${idles.length !== 1 ? "s" : ""}:`);
  for (const s of idles) {
    const mins = Math.round(s.idleDurationMs / 60_000);
    const icon = s.recommendation === "reclaim" ? "⊘" : s.recommendation === "pause" ? "⏸" : "⏰";
    lines.push(`  ${icon} ${s.sessionTitle}: idle ${mins}m → ${s.recommendation}`);
  }
  return lines;
}
