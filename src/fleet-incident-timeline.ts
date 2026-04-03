// fleet-incident-timeline.ts — chronological view of all errors, failures,
// recoveries, and notable events across sessions. provides a unified
// timeline for post-mortem analysis and shift handoffs.

export type IncidentType = "error" | "failure" | "recovery" | "stuck" | "idle-timeout" | "budget-exceeded" | "restart" | "escalation";

export interface IncidentEvent {
  timestamp: number;
  sessionTitle: string;
  type: IncidentType;
  message: string;
  resolved: boolean;
}

/**
 * Fleet-wide incident timeline tracker.
 */
export class FleetIncidentTimeline {
  private events: IncidentEvent[] = [];
  private maxEvents: number;

  constructor(maxEvents = 500) {
    this.maxEvents = maxEvents;
  }

  /** Record an incident event. */
  record(sessionTitle: string, type: IncidentType, message: string, resolved = false, now = Date.now()): void {
    this.events.push({ timestamp: now, sessionTitle, type, message: message.slice(0, 200), resolved });
    if (this.events.length > this.maxEvents) {
      this.events = this.events.slice(-this.maxEvents);
    }
  }

  /** Mark the most recent unresolved incident for a session as resolved. */
  resolve(sessionTitle: string, type?: IncidentType, now = Date.now()): boolean {
    for (let i = this.events.length - 1; i >= 0; i--) {
      const e = this.events[i];
      if (e.sessionTitle === sessionTitle && !e.resolved && (!type || e.type === type)) {
        e.resolved = true;
        return true;
      }
    }
    return false;
  }

  /** Get all events, optionally filtered. */
  getEvents(opts?: { sessionTitle?: string; type?: IncidentType; sinceMs?: number; unresolvedOnly?: boolean }): IncidentEvent[] {
    let filtered = this.events;
    if (opts?.sessionTitle) filtered = filtered.filter((e) => e.sessionTitle === opts.sessionTitle);
    if (opts?.type) filtered = filtered.filter((e) => e.type === opts.type);
    if (opts?.sinceMs) { const cutoff = Date.now() - opts.sinceMs; filtered = filtered.filter((e) => e.timestamp >= cutoff); }
    if (opts?.unresolvedOnly) filtered = filtered.filter((e) => !e.resolved);
    return filtered;
  }

  /** Get incident counts by type. */
  countByType(): Map<IncidentType, number> {
    const counts = new Map<IncidentType, number>();
    for (const e of this.events) counts.set(e.type, (counts.get(e.type) ?? 0) + 1);
    return counts;
  }

  /** Get sessions with the most incidents. */
  hotSessions(limit = 5): Array<{ sessionTitle: string; count: number }> {
    const counts = new Map<string, number>();
    for (const e of this.events) counts.set(e.sessionTitle, (counts.get(e.sessionTitle) ?? 0) + 1);
    return Array.from(counts.entries())
      .map(([sessionTitle, count]) => ({ sessionTitle, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  }

  /** Get unresolved incident count. */
  unresolvedCount(): number {
    return this.events.filter((e) => !e.resolved).length;
  }

  /** Get total event count. */
  totalCount(): number {
    return this.events.length;
  }
}

/**
 * Format incident timeline for TUI display.
 */
export function formatIncidentTimeline(timeline: FleetIncidentTimeline, limit = 15): string[] {
  const events = timeline.getEvents();
  const unresolved = timeline.unresolvedCount();
  const lines: string[] = [];
  lines.push(`  Fleet Incident Timeline (${events.length} events, ${unresolved} unresolved):`);

  if (events.length === 0) {
    lines.push("    No incidents recorded");
    return lines;
  }

  // type counts
  const counts = timeline.countByType();
  const countParts: string[] = [];
  for (const [type, count] of counts) countParts.push(`${type}:${count}`);
  lines.push(`    ${countParts.join("  ")}`);

  // recent events
  const recent = events.slice(-limit);
  for (const e of recent) {
    const time = new Date(e.timestamp).toISOString().slice(11, 19);
    const icon = e.type === "error" ? "✗" : e.type === "failure" ? "💥" : e.type === "recovery" ? "✓" : e.type === "stuck" ? "⏳" : "⚠";
    const status = e.resolved ? " [resolved]" : "";
    lines.push(`    ${time} ${icon} [${e.sessionTitle}] ${e.type}: ${e.message.slice(0, 70)}${status}`);
  }

  // hot sessions
  const hot = timeline.hotSessions(3);
  if (hot.length > 0) {
    lines.push("    Most incidents: " + hot.map((h) => `${h.sessionTitle}(${h.count})`).join(", "));
  }

  return lines;
}
