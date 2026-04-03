// session-replay.ts — replay a session's activity timeline step-by-step.
// reconstructs the session's history from audit trail + fleet snapshots
// and presents it as a chronological narrative for post-mortem analysis.

import { readRecentAuditEntries } from "./audit-trail.js";
import type { AuditEntry } from "./audit-trail.js";

export interface ReplayEvent {
  timestamp: number;
  timeLabel: string;
  type: string;
  detail: string;
}

export interface SessionReplay {
  sessionTitle: string;
  events: ReplayEvent[];
  totalDurationMs: number;
  eventCount: number;
}

/**
 * Build a replay timeline for a session from the audit trail.
 */
export function buildSessionReplay(sessionTitle: string, maxEvents = 200): SessionReplay {
  const all = readRecentAuditEntries(10_000);
  const sessionEvents = all.filter((e) =>
    e.session === sessionTitle ||
    e.detail.toLowerCase().includes(sessionTitle.toLowerCase())
  );

  const events: ReplayEvent[] = sessionEvents.slice(-maxEvents).map((e) => ({
    timestamp: new Date(e.timestamp).getTime(),
    timeLabel: e.timestamp.slice(11, 19),
    type: e.type,
    detail: e.detail,
  }));

  const totalDuration = events.length >= 2
    ? events[events.length - 1].timestamp - events[0].timestamp
    : 0;

  return {
    sessionTitle,
    events,
    totalDurationMs: totalDuration,
    eventCount: events.length,
  };
}

/**
 * Format replay as a chronological narrative.
 */
export function formatReplay(replay: SessionReplay): string[] {
  if (replay.events.length === 0) {
    return [`  No replay data for "${replay.sessionTitle}" (check audit trail)`];
  }

  const lines: string[] = [];
  const durationLabel = replay.totalDurationMs > 0
    ? formatDuration(replay.totalDurationMs)
    : "instant";
  lines.push(`  Replay: "${replay.sessionTitle}" (${replay.eventCount} events, ${durationLabel})`);
  lines.push("");

  let lastTimestamp = 0;
  for (const e of replay.events) {
    // show time gap between events
    if (lastTimestamp > 0) {
      const gap = e.timestamp - lastTimestamp;
      if (gap > 60_000) {
        lines.push(`  ... ${formatDuration(gap)} later ...`);
      }
    }
    lastTimestamp = e.timestamp;

    const icon = eventIcon(e.type);
    lines.push(`  ${e.timeLabel} ${icon} ${e.type}: ${e.detail}`);
  }

  return lines;
}

/**
 * Generate a summary of the replay (for quick review).
 */
export function summarizeReplay(replay: SessionReplay): string[] {
  if (replay.events.length === 0) return [`  "${replay.sessionTitle}": no events`];

  // count by type
  const typeCounts = new Map<string, number>();
  for (const e of replay.events) {
    typeCounts.set(e.type, (typeCounts.get(e.type) ?? 0) + 1);
  }

  const lines: string[] = [];
  lines.push(`  "${replay.sessionTitle}" summary:`);
  lines.push(`  Duration: ${formatDuration(replay.totalDurationMs)}  Events: ${replay.eventCount}`);
  const sorted = [...typeCounts.entries()].sort((a, b) => b[1] - a[1]);
  for (const [type, count] of sorted) {
    lines.push(`    ${eventIcon(type)} ${type}: ${count}`);
  }
  return lines;
}

function eventIcon(type: string): string {
  const icons: Record<string, string> = {
    reasoner_action: "🧠",
    auto_complete: "✅",
    budget_pause: "💰",
    conflict_detected: "⚔",
    operator_command: "👤",
    task_created: "📋",
    task_completed: "🏁",
    session_error: "❌",
    session_restart: "🔄",
    config_change: "⚙",
    stuck_nudge: "👉",
    daemon_start: "🚀",
    daemon_stop: "🛑",
  };
  return icons[type] ?? "·";
}

function formatDuration(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  const h = Math.floor(ms / 3_600_000);
  const m = Math.round((ms % 3_600_000) / 60_000);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}
