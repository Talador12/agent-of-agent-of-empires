// fleet-event-replay.ts — replay event bus history for debugging.
// loads serialized event history, provides playback controls
// (play/pause/step/seek), and filters for focused analysis.

import type { FleetEvent, EventType } from "./fleet-event-bus.js";

export interface ReplayPlaybackState {
  events: FleetEvent[];
  cursor: number;
  playing: boolean;
  speedMultiplier: number;
  filter?: EventType;
  sessionFilter?: string;
}

/**
 * Create replay state from event history.
 */
export function createEventReplay(events: FleetEvent[]): ReplayPlaybackState {
  const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp);
  return { events: sorted, cursor: 0, playing: false, speedMultiplier: 1 };
}

/**
 * Step forward N events.
 */
export function stepForward(state: ReplayPlaybackState, n = 1): FleetEvent[] {
  const result: FleetEvent[] = [];
  const filtered = getFilteredEvents(state);
  for (let i = 0; i < n && state.cursor < filtered.length; i++) {
    result.push(filtered[state.cursor]);
    state.cursor++;
  }
  return result;
}

/**
 * Step backward N events.
 */
export function stepBackward(state: ReplayPlaybackState, n = 1): void {
  state.cursor = Math.max(0, state.cursor - n);
}

/**
 * Seek to a specific position (0-based index into filtered events).
 */
export function seekTo(state: ReplayPlaybackState, position: number): void {
  const filtered = getFilteredEvents(state);
  state.cursor = Math.max(0, Math.min(position, filtered.length - 1));
}

/**
 * Seek to a timestamp (finds nearest event at or after).
 */
export function seekToTime(state: ReplayPlaybackState, timestamp: number): void {
  const filtered = getFilteredEvents(state);
  const idx = filtered.findIndex((e) => e.timestamp >= timestamp);
  state.cursor = idx >= 0 ? idx : filtered.length;
}

/**
 * Set event type filter.
 */
export function setFilter(state: ReplayPlaybackState, type?: EventType, session?: string): void {
  state.filter = type;
  state.sessionFilter = session;
  state.cursor = 0; // reset cursor on filter change
}

/**
 * Get current event at cursor.
 */
export function currentEvent(state: ReplayPlaybackState): FleetEvent | null {
  const filtered = getFilteredEvents(state);
  return filtered[state.cursor] ?? null;
}

/**
 * Get filtered events based on current filter settings.
 */
function getFilteredEvents(state: ReplayPlaybackState): FleetEvent[] {
  let events = state.events;
  if (state.filter) events = events.filter((e) => e.type === state.filter);
  if (state.sessionFilter) events = events.filter((e) => e.sessionTitle?.toLowerCase() === state.sessionFilter!.toLowerCase());
  return events;
}

/**
 * Get replay progress info.
 */
export function replayProgress(state: ReplayPlaybackState): { cursor: number; total: number; pct: number; atEnd: boolean } {
  const filtered = getFilteredEvents(state);
  const total = filtered.length;
  return {
    cursor: state.cursor,
    total,
    pct: total > 0 ? Math.round((state.cursor / total) * 100) : 0,
    atEnd: state.cursor >= total,
  };
}

/**
 * Get time range of events.
 */
export function timeRange(state: ReplayPlaybackState): { startMs: number; endMs: number; durationMs: number } | null {
  if (state.events.length === 0) return null;
  const start = state.events[0].timestamp;
  const end = state.events[state.events.length - 1].timestamp;
  return { startMs: start, endMs: end, durationMs: end - start };
}

/**
 * Format event replay state for TUI display.
 */
export function formatEventReplay(state: ReplayPlaybackState): string[] {
  const prog = replayProgress(state);
  const current = currentEvent(state);
  const range = timeRange(state);
  const lines: string[] = [];

  lines.push(`  Event Replay (${prog.cursor}/${prog.total} events, ${prog.pct}%):`);
  if (state.filter || state.sessionFilter) {
    const filters: string[] = [];
    if (state.filter) filters.push(`type:${state.filter}`);
    if (state.sessionFilter) filters.push(`session:${state.sessionFilter}`);
    lines.push(`    Filters: ${filters.join(", ")}`);
  }
  if (range) {
    const dur = Math.round(range.durationMs / 60_000);
    lines.push(`    Time span: ${dur}m`);
  }
  if (current) {
    const time = new Date(current.timestamp).toISOString().slice(11, 19);
    const session = current.sessionTitle ? `[${current.sessionTitle}] ` : "";
    lines.push(`    ▶ ${time} ${current.type} ${session}${current.detail.slice(0, 60)}`);
  } else {
    lines.push("    (no events" + (prog.atEnd ? " — at end" : "") + ")");
  }

  return lines;
}
