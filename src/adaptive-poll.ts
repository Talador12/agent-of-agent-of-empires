// adaptive-poll.ts — dynamic poll interval: speed up when sessions are active,
// slow down when everything is idle. avoids wasting CPU/API on sleeping sessions
// while staying responsive when work is happening.

export interface AdaptivePollConfig {
  minIntervalMs: number;  // fastest poll rate (default: 5s)
  maxIntervalMs: number;  // slowest poll rate (default: 60s)
  baseIntervalMs: number; // configured default (from aoaoe.config.json)
  rampUpFactor: number;   // multiply interval by this when idle (default: 1.5)
  rampDownFactor: number; // divide interval by this when active (default: 2)
}

const DEFAULT_CONFIG: AdaptivePollConfig = {
  minIntervalMs: 5_000,
  maxIntervalMs: 60_000,
  baseIntervalMs: 10_000,
  rampUpFactor: 1.5,
  rampDownFactor: 2,
};

/**
 * Track session activity and compute adaptive poll intervals.
 * Call `recordTick()` after each daemonTick with the number of changes observed.
 */
export class AdaptivePollController {
  private config: AdaptivePollConfig;
  private currentIntervalMs: number;
  private consecutiveIdleTicks = 0;
  private consecutiveActiveTicks = 0;

  constructor(config: Partial<AdaptivePollConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.currentIntervalMs = this.config.baseIntervalMs;
  }

  /**
   * Record the result of a tick and update the interval.
   * @param changeCount - number of session changes in this tick
   * @param hadReasonerAction - whether the reasoner took an action
   */
  recordTick(changeCount: number, hadReasonerAction: boolean): void {
    const active = changeCount > 0 || hadReasonerAction;

    if (active) {
      this.consecutiveActiveTicks++;
      this.consecutiveIdleTicks = 0;
      // ramp down (speed up) when active
      if (this.consecutiveActiveTicks >= 2) {
        this.currentIntervalMs = Math.max(
          this.config.minIntervalMs,
          Math.round(this.currentIntervalMs / this.config.rampDownFactor),
        );
      }
    } else {
      this.consecutiveIdleTicks++;
      this.consecutiveActiveTicks = 0;
      // ramp up (slow down) when idle — but only after 3+ idle ticks
      if (this.consecutiveIdleTicks >= 3) {
        this.currentIntervalMs = Math.min(
          this.config.maxIntervalMs,
          Math.round(this.currentIntervalMs * this.config.rampUpFactor),
        );
      }
    }
  }

  /** Get the current adaptive poll interval. */
  get intervalMs(): number {
    return this.currentIntervalMs;
  }

  /** Reset to base interval (e.g., on operator input). */
  reset(): void {
    this.currentIntervalMs = this.config.baseIntervalMs;
    this.consecutiveIdleTicks = 0;
    this.consecutiveActiveTicks = 0;
  }

  /** Get a human-readable status string. */
  formatStatus(): string {
    const mode = this.consecutiveActiveTicks >= 2 ? "fast" : this.consecutiveIdleTicks >= 3 ? "slow" : "normal";
    return `poll: ${(this.currentIntervalMs / 1000).toFixed(1)}s (${mode}, idle=${this.consecutiveIdleTicks}, active=${this.consecutiveActiveTicks})`;
  }
}
