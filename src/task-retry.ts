// task-retry.ts — auto-retry failed tasks with exponential backoff + jitter.
// tracks retry state per task, computes next retry time, and determines
// when a task should be retried or has exhausted its retry budget.

export interface RetryState {
  sessionTitle: string;
  failedAt: number;
  retryCount: number;
  nextRetryAt: number;
  exhausted: boolean; // true = no more retries
}

export interface RetryConfig {
  maxRetries: number;     // max attempts before giving up (default: 3)
  baseDelayMs: number;    // initial delay (default: 60s)
  maxDelayMs: number;     // cap on delay (default: 30min)
  jitterFraction: number; // random jitter 0.0-1.0 (default: 0.2)
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 60_000,      // 1 minute
  maxDelayMs: 30 * 60_000,  // 30 minutes
  jitterFraction: 0.2,
};

/**
 * Compute the delay for a given retry attempt using exponential backoff + jitter.
 * delay = min(baseDelay * 2^attempt, maxDelay) * (1 ± jitter)
 */
export function computeRetryDelay(
  attempt: number,
  config: RetryConfig = DEFAULT_RETRY_CONFIG,
): number {
  const exponential = config.baseDelayMs * Math.pow(2, attempt);
  const capped = Math.min(exponential, config.maxDelayMs);
  // jitter: uniform random within ±jitterFraction of capped value
  const jitterRange = capped * config.jitterFraction;
  const jitter = (Math.random() * 2 - 1) * jitterRange;
  return Math.max(0, Math.round(capped + jitter));
}

/**
 * Compute retry delay deterministically (no randomness — for testing).
 */
export function computeRetryDelayDeterministic(
  attempt: number,
  config: RetryConfig = DEFAULT_RETRY_CONFIG,
): number {
  const exponential = config.baseDelayMs * Math.pow(2, attempt);
  return Math.min(exponential, config.maxDelayMs);
}

/**
 * Track retry state per task and manage the retry lifecycle.
 */
export class TaskRetryManager {
  private retries = new Map<string, RetryState>();
  private config: RetryConfig;

  constructor(config: Partial<RetryConfig> = {}) {
    this.config = { ...DEFAULT_RETRY_CONFIG, ...config };
  }

  /** Record a task failure and schedule a retry. Returns the retry state. */
  recordFailure(sessionTitle: string, now = Date.now()): RetryState {
    const existing = this.retries.get(sessionTitle);
    const retryCount = existing ? existing.retryCount + 1 : 1;
    const exhausted = retryCount > this.config.maxRetries;

    const delay = exhausted ? 0 : computeRetryDelay(retryCount - 1, this.config);
    const nextRetryAt = exhausted ? 0 : now + delay;

    const state: RetryState = {
      sessionTitle,
      failedAt: now,
      retryCount,
      nextRetryAt,
      exhausted,
    };
    this.retries.set(sessionTitle, state);
    return state;
  }

  /** Check if a task is due for retry. */
  isDueForRetry(sessionTitle: string, now = Date.now()): boolean {
    const state = this.retries.get(sessionTitle);
    if (!state || state.exhausted) return false;
    return now >= state.nextRetryAt;
  }

  /** Get tasks that are due for retry right now. */
  getDueRetries(now = Date.now()): RetryState[] {
    const due: RetryState[] = [];
    for (const state of this.retries.values()) {
      if (!state.exhausted && now >= state.nextRetryAt) {
        due.push(state);
      }
    }
    return due;
  }

  /** Mark a task as successfully retried (clear retry state). */
  clearRetry(sessionTitle: string): void {
    this.retries.delete(sessionTitle);
  }

  /** Get the retry state for a task. */
  getState(sessionTitle: string): RetryState | undefined {
    return this.retries.get(sessionTitle);
  }

  /** Get all retry states. */
  getAllStates(): RetryState[] {
    return [...this.retries.values()];
  }

  /** Format retry states for TUI display. */
  formatRetries(now = Date.now()): string[] {
    const states = this.getAllStates();
    if (states.length === 0) return ["  (no tasks pending retry)"];
    const lines: string[] = [];
    for (const s of states) {
      const icon = s.exhausted ? "✗" : "⟳";
      const status = s.exhausted
        ? `exhausted (${s.retryCount}/${this.config.maxRetries})`
        : `retry ${s.retryCount}/${this.config.maxRetries}`;
      const eta = s.exhausted ? "" : `, next in ${formatMs(s.nextRetryAt - now)}`;
      lines.push(`  ${icon} ${s.sessionTitle}: ${status}${eta}`);
    }
    return lines;
  }
}

function formatMs(ms: number): string {
  if (ms <= 0) return "now";
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  return `${Math.round(ms / 3_600_000)}h`;
}
