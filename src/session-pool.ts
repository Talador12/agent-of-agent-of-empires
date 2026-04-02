// session-pool.ts — cap concurrent active sessions to control spend.
// enforces a maximum number of simultaneously active tasks.
// when at capacity, new tasks queue as "pending" until a slot opens.

import type { TaskState } from "./types.js";

export interface PoolConfig {
  maxConcurrent: number; // max active tasks at once (default: 5)
}

export interface PoolStatus {
  maxConcurrent: number;
  activeCount: number;
  pendingCount: number;
  availableSlots: number;
  atCapacity: boolean;
}

const DEFAULT_CONFIG: PoolConfig = { maxConcurrent: 5 };

/**
 * Manage the pool of concurrent active sessions.
 */
export class SessionPoolManager {
  private config: PoolConfig;

  constructor(config: Partial<PoolConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** Get the current pool status from task states. */
  getStatus(tasks: readonly TaskState[]): PoolStatus {
    const activeCount = tasks.filter((t) => t.status === "active").length;
    const pendingCount = tasks.filter((t) => t.status === "pending").length;
    const availableSlots = Math.max(0, this.config.maxConcurrent - activeCount);
    return {
      maxConcurrent: this.config.maxConcurrent,
      activeCount,
      pendingCount,
      availableSlots,
      atCapacity: activeCount >= this.config.maxConcurrent,
    };
  }

  /**
   * Determine which pending tasks should be activated to fill available slots.
   * Returns session titles in priority order (oldest createdAt first).
   */
  getActivatable(tasks: readonly TaskState[]): string[] {
    const status = this.getStatus(tasks);
    if (status.availableSlots <= 0) return [];

    const pending = tasks
      .filter((t) => t.status === "pending" && !t.dependsOn?.length)
      .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));

    return pending.slice(0, status.availableSlots).map((t) => t.sessionTitle);
  }

  /**
   * Check if a task should be blocked from activating due to pool limits.
   */
  shouldBlock(tasks: readonly TaskState[]): boolean {
    return this.getStatus(tasks).atCapacity;
  }

  /** Update the max concurrent limit. */
  setMaxConcurrent(max: number): void {
    this.config.maxConcurrent = Math.max(1, max);
  }

  /** Format pool status for TUI display. */
  formatStatus(tasks: readonly TaskState[]): string[] {
    const s = this.getStatus(tasks);
    const bar = "●".repeat(s.activeCount) + "○".repeat(s.availableSlots) + "⊘".repeat(Math.max(0, s.pendingCount - s.availableSlots));
    const lines: string[] = [];
    lines.push(`  Session pool: ${bar}  ${s.activeCount}/${s.maxConcurrent} active, ${s.pendingCount} pending`);
    if (s.atCapacity && s.pendingCount > 0) {
      lines.push(`  ⚠ At capacity — ${s.pendingCount} task${s.pendingCount !== 1 ? "s" : ""} queued`);
    }
    const activatable = this.getActivatable(tasks);
    if (activatable.length > 0) {
      lines.push(`  Next up: ${activatable.join(", ")}`);
    }
    return lines;
  }
}
