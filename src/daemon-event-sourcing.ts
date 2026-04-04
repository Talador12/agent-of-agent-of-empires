// daemon-event-sourcing.ts — full event-sourced state reconstruction.
// records every state change as an immutable event, enabling replay
// from any point in time and full audit trail.

export interface StateEvent {
  id: number;
  timestamp: number;
  type: string;
  payload: Record<string, unknown>;
  source: string; // which module produced this event
}

export interface EventStore {
  events: StateEvent[];
  nextId: number;
  maxEvents: number;
}

/**
 * Create an event store.
 */
export function createEventStore(maxEvents = 1000): EventStore {
  return { events: [], nextId: 1, maxEvents };
}

/**
 * Append an event to the store.
 */
export function appendEvent(store: EventStore, type: string, payload: Record<string, unknown>, source: string, now = Date.now()): StateEvent {
  const event: StateEvent = { id: store.nextId++, timestamp: now, type, payload, source };
  store.events.push(event);
  if (store.events.length > store.maxEvents) store.events = store.events.slice(-store.maxEvents);
  return event;
}

/**
 * Query events by type.
 */
export function queryByType(store: EventStore, type: string): StateEvent[] {
  return store.events.filter((e) => e.type === type);
}

/**
 * Query events by source module.
 */
export function queryBySource(store: EventStore, source: string): StateEvent[] {
  return store.events.filter((e) => e.source === source);
}

/**
 * Query events in a time range.
 */
export function queryByTimeRange(store: EventStore, startMs: number, endMs: number): StateEvent[] {
  return store.events.filter((e) => e.timestamp >= startMs && e.timestamp <= endMs);
}

/**
 * Get event type counts.
 */
export function eventTypeCounts(store: EventStore): Map<string, number> {
  const counts = new Map<string, number>();
  for (const e of store.events) counts.set(e.type, (counts.get(e.type) ?? 0) + 1);
  return counts;
}

/**
 * Replay events through a reducer to reconstruct state.
 */
export function replayEvents<T>(store: EventStore, initialState: T, reducer: (state: T, event: StateEvent) => T, upToId?: number): T {
  let state = initialState;
  for (const e of store.events) {
    if (upToId !== undefined && e.id > upToId) break;
    state = reducer(state, e);
  }
  return state;
}

/**
 * Get store stats.
 */
export function eventStoreStats(store: EventStore): { totalEvents: number; types: number; sources: number; oldestMs: number; newestMs: number } {
  const types = new Set(store.events.map((e) => e.type)).size;
  const sources = new Set(store.events.map((e) => e.source)).size;
  return {
    totalEvents: store.events.length,
    types, sources,
    oldestMs: store.events.length > 0 ? store.events[0].timestamp : 0,
    newestMs: store.events.length > 0 ? store.events[store.events.length - 1].timestamp : 0,
  };
}

/**
 * Format event store for TUI display.
 */
export function formatEventStore(store: EventStore): string[] {
  const stats = eventStoreStats(store);
  const lines: string[] = [];
  lines.push(`  Event Store (${stats.totalEvents} events, ${stats.types} types, ${stats.sources} sources):`);
  if (store.events.length === 0) {
    lines.push("    No events recorded");
  } else {
    const counts = eventTypeCounts(store);
    const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
    lines.push("    Top event types:");
    for (const [type, count] of sorted.slice(0, 5)) lines.push(`      ${type}: ${count}`);
    const recent = store.events.slice(-3);
    lines.push("    Recent:");
    for (const e of recent) {
      const time = new Date(e.timestamp).toISOString().slice(11, 19);
      lines.push(`      ${time} [${e.source}] ${e.type}`);
    }
  }
  return lines;
}
