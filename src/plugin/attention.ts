// Attention scoring over host session metadata.
//
// The plugin API exposes no pane content, so scoring uses what metadata can
// tell us: the session's status, how long it has sat in that status (tracked
// by the worker across ticks), and whether the orchestrator can act on it
// (it created it) or can only advise. One canonical QueueRow shape feeds the
// dashboard card, the per-session pane, the row-column/sort-key, the status
// command JSON, and the queue.updated event — a single schema by design.

import type { HostSession } from "./host.js";

export interface StatusHistoryEntry {
  status: string;
  since: number; // Date.now() when this status was first observed
}

export interface QueueRow {
  sessionId: string;
  title: string;
  tool: string;
  projectPath: string;
  status: string;
  attentionScore: number;
  inStatusForMs: number;
  pluginOwned: boolean; // true when this plugin created the session (can nudge)
  reasons: string[]; // human-readable scoring signals
}

// base weight per host status — error/waiting need eyes, running is healthy
const STATUS_WEIGHTS: Record<string, number> = {
  Error: 80,
  Waiting: 60,
  Unknown: 30,
  Stopped: 25,
  Idle: 20,
  Starting: 10,
  Creating: 10,
  Running: 0,
  Deleting: 0,
};

// per-minute escalation while a session lingers in a status that wants attention
const ESCALATION_PER_MIN: Record<string, number> = {
  Error: 2.0,
  Waiting: 1.5,
  Idle: 0.5,
  Unknown: 0.5,
  Stopped: 0.2,
};

export const ESCALATION_CAP = 40;

/**
 * Update status history in place from a fresh session listing and return the
 * ranked queue. History keys not present in `sessions` are pruned so the map
 * cannot grow without bound.
 */
export function rankSessions(
  sessions: HostSession[],
  history: Map<string, StatusHistoryEntry>,
  ownedSessionIds: Set<string>,
  now: number
): QueueRow[] {
  const liveIds = new Set(sessions.map((s) => s.id));
  for (const id of history.keys()) {
    if (!liveIds.has(id)) history.delete(id);
  }

  const rows: QueueRow[] = [];
  for (const s of sessions) {
    // snoozed/archived sessions asked not to be ranked; honor that
    if (s.archived || s.snoozed) continue;
    let entry = history.get(s.id);
    if (!entry || entry.status !== s.status) {
      entry = { status: s.status, since: now };
      history.set(s.id, entry);
    }
    const inStatusForMs = Math.max(0, now - entry.since);
    const base = STATUS_WEIGHTS[s.status] ?? 30; // unknown statuses rank mid, fail-visible
    const escalationRate = ESCALATION_PER_MIN[s.status] ?? 0;
    const escalation = Math.min(ESCALATION_CAP, (inStatusForMs / 60_000) * escalationRate);
    const score = Math.round((base + escalation) * 10) / 10;

    const reasons: string[] = [];
    if (base > 0) reasons.push(`status ${s.status}`);
    if (escalation >= 1) reasons.push(`${formatDuration(inStatusForMs)} in ${s.status}`);
    if (ownedSessionIds.has(s.id)) reasons.push("orchestrator-owned");

    rows.push({
      sessionId: s.id,
      title: s.title,
      tool: s.tool,
      projectPath: s.project_path,
      status: s.status,
      attentionScore: score,
      inStatusForMs,
      pluginOwned: ownedSessionIds.has(s.id),
      reasons,
    });
  }

  // stable ordering: score desc, then longest-lingering first, then title
  rows.sort(
    (a, b) =>
      b.attentionScore - a.attentionScore ||
      b.inStatusForMs - a.inStatusForMs ||
      a.title.localeCompare(b.title)
  );
  return rows;
}

export function formatDuration(ms: number): string {
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "<1m";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h${mins % 60 ? ` ${mins % 60}m` : ""}`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

/** Serialize history for plugin.storage persistence (survives worker restarts
 * so escalation clocks don't reset on daemon restart). */
export function historyToJson(history: Map<string, StatusHistoryEntry>): Record<string, StatusHistoryEntry> {
  return Object.fromEntries(history);
}

export function historyFromJson(raw: unknown): Map<string, StatusHistoryEntry> {
  const map = new Map<string, StatusHistoryEntry>();
  if (!raw || typeof raw !== "object") return map;
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    const e = v as Record<string, unknown>;
    if (e && typeof e.status === "string" && typeof e.since === "number") {
      map.set(id, { status: e.status, since: e.since });
    }
  }
  return map;
}
