// fleet-event-bus.ts — typed pub/sub event system for decoupled module
// communication. modules publish events (e.g. "session:error", "cost:exceeded")
// and other modules subscribe to react without tight coupling.

export type EventType =
  | "session:started" | "session:stopped" | "session:error" | "session:idle"
  | "session:completed" | "session:stuck" | "session:graduated"
  | "task:activated" | "task:completed" | "task:failed" | "task:paused"
  | "cost:exceeded" | "cost:warning" | "cost:anomaly"
  | "health:degraded" | "health:recovered" | "health:critical"
  | "fleet:snapshot" | "fleet:sla-breach"
  | "approval:pending" | "approval:resolved"
  | "reasoner:called" | "reasoner:cached" | "reasoner:throttled";

export interface FleetEvent {
  type: EventType;
  timestamp: number;
  sessionTitle?: string;
  detail: string;
  metadata?: Record<string, unknown>;
}

export type EventHandler = (event: FleetEvent) => void;

interface Subscription {
  id: number;
  type: EventType | "*";
  handler: EventHandler;
}

/**
 * A typed pub/sub event bus for fleet-wide module communication.
 */
export class FleetEventBus {
  private subscriptions: Subscription[] = [];
  private nextId = 1;
  private history: FleetEvent[] = [];
  private maxHistory: number;

  constructor(maxHistory = 200) {
    this.maxHistory = maxHistory;
  }

  /** Subscribe to a specific event type (or "*" for all). Returns unsubscribe ID. */
  on(type: EventType | "*", handler: EventHandler): number {
    const id = this.nextId++;
    this.subscriptions.push({ id, type, handler });
    return id;
  }

  /** Unsubscribe by subscription ID. */
  off(id: number): boolean {
    const idx = this.subscriptions.findIndex((s) => s.id === id);
    if (idx === -1) return false;
    this.subscriptions.splice(idx, 1);
    return true;
  }

  /** Publish an event to all matching subscribers. */
  emit(event: FleetEvent): void {
    this.history.push(event);
    if (this.history.length > this.maxHistory) {
      this.history = this.history.slice(-this.maxHistory);
    }
    for (const sub of this.subscriptions) {
      if (sub.type === "*" || sub.type === event.type) {
        try { sub.handler(event); } catch { /* swallow subscriber errors */ }
      }
    }
  }

  /** Convenience: emit an event from type + detail. */
  publish(type: EventType, detail: string, sessionTitle?: string, metadata?: Record<string, unknown>): void {
    this.emit({ type, timestamp: Date.now(), detail, sessionTitle, metadata });
  }

  /** Get recent event history, optionally filtered by type. */
  getHistory(type?: EventType, limit = 50): FleetEvent[] {
    const filtered = type ? this.history.filter((e) => e.type === type) : this.history;
    return filtered.slice(-limit);
  }

  /** Get event counts by type. */
  getCounts(): Map<string, number> {
    const counts = new Map<string, number>();
    for (const e of this.history) {
      counts.set(e.type, (counts.get(e.type) ?? 0) + 1);
    }
    return counts;
  }

  /** Get the total number of active subscriptions. */
  getSubscriptionCount(): number {
    return this.subscriptions.length;
  }
}

/**
 * Format event bus state for TUI display.
 */
export function formatEventBus(bus: FleetEventBus): string[] {
  const counts = bus.getCounts();
  const recent = bus.getHistory(undefined, 10);
  const lines: string[] = [];
  lines.push(`  Fleet Event Bus (${bus.getSubscriptionCount()} subscribers, ${recent.length} recent events):`);

  if (counts.size > 0) {
    lines.push("  Event counts:");
    const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
    for (const [type, count] of sorted.slice(0, 8)) {
      lines.push(`    ${type}: ${count}`);
    }
  }

  if (recent.length > 0) {
    lines.push("  Recent events:");
    for (const e of recent.slice(-5)) {
      const time = new Date(e.timestamp).toISOString().slice(11, 19);
      const session = e.sessionTitle ? ` [${e.sessionTitle}]` : "";
      lines.push(`    ${time} ${e.type}${session}: ${e.detail.slice(0, 60)}`);
    }
  }

  return lines;
}
