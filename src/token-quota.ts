// token-quota.ts — per-model token quotas for fleet-wide rate limiting.
// extends the USD-based rate limiter with token-level granularity per model.

export interface TokenQuota {
  model: string;
  maxInputTokensPerHour: number;
  maxOutputTokensPerHour: number;
}

export interface TokenUsageSample {
  timestamp: number;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export interface TokenQuotaStatus {
  model: string;
  inputTokensUsed: number;
  outputTokensUsed: number;
  inputLimit: number;
  outputLimit: number;
  inputPercent: number;
  outputPercent: number;
  blocked: boolean;
  reason: string;
}

/**
 * Manage per-model token quotas.
 */
export class TokenQuotaManager {
  private quotas: Map<string, TokenQuota>;
  private samples: TokenUsageSample[] = [];
  private windowMs: number;

  constructor(quotas: TokenQuota[] = [], windowMs = 3_600_000) {
    this.quotas = new Map(quotas.map((q) => [q.model, q]));
    this.windowMs = windowMs;
  }

  /** Set or update a quota for a model. */
  setQuota(model: string, maxInput: number, maxOutput: number): void {
    this.quotas.set(model, { model, maxInputTokensPerHour: maxInput, maxOutputTokensPerHour: maxOutput });
  }

  /** Record token usage for a model. */
  recordUsage(model: string, inputTokens: number, outputTokens: number, now = Date.now()): void {
    this.samples.push({ timestamp: now, model, inputTokens, outputTokens });
    this.prune(now);
  }

  /** Check if a model is within its token quota. */
  getStatus(model: string, now = Date.now()): TokenQuotaStatus {
    this.prune(now);
    const quota = this.quotas.get(model);
    if (!quota) {
      return { model, inputTokensUsed: 0, outputTokensUsed: 0, inputLimit: Infinity, outputLimit: Infinity, inputPercent: 0, outputPercent: 0, blocked: false, reason: "no quota set" };
    }

    const cutoff = now - this.windowMs;
    const modelSamples = this.samples.filter((s) => s.model === model && s.timestamp >= cutoff);
    const inputUsed = modelSamples.reduce((sum, s) => sum + s.inputTokens, 0);
    const outputUsed = modelSamples.reduce((sum, s) => sum + s.outputTokens, 0);
    const inputPct = (inputUsed / quota.maxInputTokensPerHour) * 100;
    const outputPct = (outputUsed / quota.maxOutputTokensPerHour) * 100;
    const blocked = inputUsed >= quota.maxInputTokensPerHour || outputUsed >= quota.maxOutputTokensPerHour;

    return {
      model,
      inputTokensUsed: inputUsed,
      outputTokensUsed: outputUsed,
      inputLimit: quota.maxInputTokensPerHour,
      outputLimit: quota.maxOutputTokensPerHour,
      inputPercent: inputPct,
      outputPercent: outputPct,
      blocked,
      reason: blocked
        ? `${inputUsed >= quota.maxInputTokensPerHour ? "input" : "output"} quota exceeded`
        : "ok",
    };
  }

  /** Check if reasoning should be blocked for a model. */
  isBlocked(model: string, now = Date.now()): boolean {
    return this.getStatus(model, now).blocked;
  }

  /** Get status for all models with quotas. */
  getAllStatuses(now = Date.now()): TokenQuotaStatus[] {
    return [...this.quotas.keys()].map((m) => this.getStatus(m, now));
  }

  /** Format for TUI display. */
  formatAll(now = Date.now()): string[] {
    const statuses = this.getAllStatuses(now);
    if (statuses.length === 0) return ["  (no token quotas configured)"];
    const lines: string[] = [];
    for (const s of statuses) {
      const icon = s.blocked ? "🔴" : s.inputPercent > 80 || s.outputPercent > 80 ? "🟡" : "🟢";
      lines.push(`  ${icon} ${s.model}: ${s.inputTokensUsed.toLocaleString()}/${s.inputLimit.toLocaleString()} in, ${s.outputTokensUsed.toLocaleString()}/${s.outputLimit.toLocaleString()} out (${Math.round(Math.max(s.inputPercent, s.outputPercent))}%)`);
    }
    return lines;
  }

  private prune(now: number): void {
    const cutoff = now - this.windowMs * 2;
    this.samples = this.samples.filter((s) => s.timestamp >= cutoff);
  }
}
