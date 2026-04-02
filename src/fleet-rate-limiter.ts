// fleet-rate-limiter.ts — cap total API spend across all sessions.
// tracks cumulative cost and blocks reasoner calls when the fleet-wide
// budget is exceeded or the hourly rate limit is hit.

export interface FleetRateLimitConfig {
  maxHourlyCostUsd: number;      // max $/hr across all sessions (default: 10)
  maxDailyCostUsd: number;       // max $/day across all sessions (default: 100)
  cooldownMs: number;            // pause duration when limit hit (default: 5min)
}

export interface FleetRateLimitStatus {
  hourlyCostUsd: number;
  dailyCostUsd: number;
  hourlyLimit: number;
  dailyLimit: number;
  blocked: boolean;
  blockedUntil: number;          // 0 if not blocked
  reason: string;
}

const DEFAULT_CONFIG: FleetRateLimitConfig = {
  maxHourlyCostUsd: 10,
  maxDailyCostUsd: 100,
  cooldownMs: 5 * 60_000,
};

/**
 * Fleet-wide rate limiter for LLM API spend.
 */
export class FleetRateLimiter {
  private config: FleetRateLimitConfig;
  private costSamples: Array<{ timestamp: number; costUsd: number }> = [];
  private blockedUntil = 0;

  constructor(config: Partial<FleetRateLimitConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** Record a reasoning call cost. */
  recordCost(costUsd: number, now = Date.now()): void {
    this.costSamples.push({ timestamp: now, costUsd });
    this.prune(now);
  }

  /** Check if reasoning should be blocked. */
  isBlocked(now = Date.now()): boolean {
    if (now < this.blockedUntil) return true;
    const status = this.getStatus(now);
    return status.blocked;
  }

  /** Get current rate limit status. */
  getStatus(now = Date.now()): FleetRateLimitStatus {
    this.prune(now);

    // check if still in cooldown
    if (now < this.blockedUntil) {
      return {
        hourlyCostUsd: this.getHourlyCost(now),
        dailyCostUsd: this.getDailyCost(now),
        hourlyLimit: this.config.maxHourlyCostUsd,
        dailyLimit: this.config.maxDailyCostUsd,
        blocked: true,
        blockedUntil: this.blockedUntil,
        reason: `cooldown until ${new Date(this.blockedUntil).toISOString().slice(11, 19)}`,
      };
    }

    const hourlyCost = this.getHourlyCost(now);
    const dailyCost = this.getDailyCost(now);

    if (hourlyCost >= this.config.maxHourlyCostUsd) {
      this.blockedUntil = now + this.config.cooldownMs;
      return {
        hourlyCostUsd: hourlyCost, dailyCostUsd: dailyCost,
        hourlyLimit: this.config.maxHourlyCostUsd, dailyLimit: this.config.maxDailyCostUsd,
        blocked: true, blockedUntil: this.blockedUntil,
        reason: `hourly limit exceeded: $${hourlyCost.toFixed(2)} >= $${this.config.maxHourlyCostUsd}`,
      };
    }

    if (dailyCost >= this.config.maxDailyCostUsd) {
      this.blockedUntil = now + this.config.cooldownMs;
      return {
        hourlyCostUsd: hourlyCost, dailyCostUsd: dailyCost,
        hourlyLimit: this.config.maxHourlyCostUsd, dailyLimit: this.config.maxDailyCostUsd,
        blocked: true, blockedUntil: this.blockedUntil,
        reason: `daily limit exceeded: $${dailyCost.toFixed(2)} >= $${this.config.maxDailyCostUsd}`,
      };
    }

    return {
      hourlyCostUsd: hourlyCost, dailyCostUsd: dailyCost,
      hourlyLimit: this.config.maxHourlyCostUsd, dailyLimit: this.config.maxDailyCostUsd,
      blocked: false, blockedUntil: 0, reason: "ok",
    };
  }

  /** Format status for TUI display. */
  formatStatus(now = Date.now()): string[] {
    const s = this.getStatus(now);
    const icon = s.blocked ? "🔴" : "🟢";
    return [
      `  ${icon} Fleet rate limit: $${s.hourlyCostUsd.toFixed(2)}/$${s.hourlyLimit} hourly, $${s.dailyCostUsd.toFixed(2)}/$${s.dailyLimit} daily`,
      s.blocked ? `  ⏸ Blocked: ${s.reason}` : `  ✅ Reasoning allowed`,
    ];
  }

  private getHourlyCost(now: number): number {
    const cutoff = now - 3_600_000;
    return this.costSamples.filter((s) => s.timestamp >= cutoff).reduce((sum, s) => sum + s.costUsd, 0);
  }

  private getDailyCost(now: number): number {
    const cutoff = now - 24 * 3_600_000;
    return this.costSamples.filter((s) => s.timestamp >= cutoff).reduce((sum, s) => sum + s.costUsd, 0);
  }

  private prune(now: number): void {
    const cutoff = now - 25 * 3_600_000; // keep 25h for daily window
    this.costSamples = this.costSamples.filter((s) => s.timestamp >= cutoff);
  }
}
