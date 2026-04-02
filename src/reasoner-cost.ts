// reasoner-cost.ts — track per-reasoning-call token usage and cost.
// records input/output tokens per call for optimizer insights.
// parses token usage from reasoner responses and tmux output.

export interface ReasonerCallSample {
  timestamp: number;
  sessionTitle: string;   // which session triggered the reasoning
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  costUsd: number;        // estimated cost based on per-token pricing
}

export interface ReasonerCostSummary {
  totalCalls: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  avgInputTokens: number;
  avgOutputTokens: number;
  avgDurationMs: number;
  avgCostPerCall: number;
  callsPerHour: number;
  costPerHour: number;
}

// rough per-token costs (configurable, defaults to Claude Sonnet 4 pricing)
const DEFAULT_INPUT_COST_PER_MILLION = 3.0;   // $3 / 1M input tokens
const DEFAULT_OUTPUT_COST_PER_MILLION = 15.0;  // $15 / 1M output tokens

/**
 * Estimate cost for a single reasoning call.
 */
export function estimateCallCost(
  inputTokens: number,
  outputTokens: number,
  inputCostPerMillion = DEFAULT_INPUT_COST_PER_MILLION,
  outputCostPerMillion = DEFAULT_OUTPUT_COST_PER_MILLION,
): number {
  return (inputTokens * inputCostPerMillion + outputTokens * outputCostPerMillion) / 1_000_000;
}

/**
 * Parse token counts from a reasoner response or pane output line.
 * Looks for patterns like "1,234 input tokens" or "tokens: 1234/5678".
 */
export function parseTokenUsage(text: string): { input: number; output: number } | null {
  // pattern: "N input tokens, M output tokens"
  const explicit = text.match(/(\d[\d,]*)\s*input\s*tokens?.*?(\d[\d,]*)\s*output\s*tokens?/i);
  if (explicit) {
    return {
      input: parseInt(explicit[1].replace(/,/g, ""), 10),
      output: parseInt(explicit[2].replace(/,/g, ""), 10),
    };
  }
  // pattern: "tokens: N/M" or "tokens: N in / M out"
  const slashed = text.match(/tokens?:\s*(\d[\d,]*)[\s/]+(\d[\d,]*)/i);
  if (slashed) {
    return {
      input: parseInt(slashed[1].replace(/,/g, ""), 10),
      output: parseInt(slashed[2].replace(/,/g, ""), 10),
    };
  }
  return null;
}

/**
 * Track reasoner call costs over time.
 */
export class ReasonerCostTracker {
  private samples: ReasonerCallSample[] = [];
  private windowMs: number;

  constructor(windowMs = 2 * 60 * 60_000) { // 2-hour window
    this.windowMs = windowMs;
  }

  /** Record a reasoning call. */
  recordCall(
    sessionTitle: string,
    inputTokens: number,
    outputTokens: number,
    durationMs: number,
    now = Date.now(),
  ): void {
    const costUsd = estimateCallCost(inputTokens, outputTokens);
    this.samples.push({ timestamp: now, sessionTitle, inputTokens, outputTokens, durationMs, costUsd });
    this.prune(now);
  }

  /** Compute aggregate cost summary. */
  getSummary(now = Date.now()): ReasonerCostSummary {
    this.prune(now);
    const n = this.samples.length;
    if (n === 0) {
      return { totalCalls: 0, totalInputTokens: 0, totalOutputTokens: 0, totalCostUsd: 0, avgInputTokens: 0, avgOutputTokens: 0, avgDurationMs: 0, avgCostPerCall: 0, callsPerHour: 0, costPerHour: 0 };
    }

    let totalInput = 0, totalOutput = 0, totalCost = 0, totalDuration = 0;
    for (const s of this.samples) {
      totalInput += s.inputTokens;
      totalOutput += s.outputTokens;
      totalCost += s.costUsd;
      totalDuration += s.durationMs;
    }

    const spanMs = Math.max(1, now - this.samples[0].timestamp);
    const hoursSpan = spanMs / 3_600_000;

    return {
      totalCalls: n,
      totalInputTokens: totalInput,
      totalOutputTokens: totalOutput,
      totalCostUsd: totalCost,
      avgInputTokens: Math.round(totalInput / n),
      avgOutputTokens: Math.round(totalOutput / n),
      avgDurationMs: Math.round(totalDuration / n),
      avgCostPerCall: totalCost / n,
      callsPerHour: n / hoursSpan,
      costPerHour: totalCost / hoursSpan,
    };
  }

  /** Get the number of tracked calls (for testing). */
  get callCount(): number {
    return this.samples.length;
  }

  /** Format summary for TUI display. */
  formatSummary(now = Date.now()): string[] {
    const s = this.getSummary(now);
    if (s.totalCalls === 0) return ["  (no reasoner calls tracked)"];
    const lines: string[] = [];
    lines.push(`  Reasoner cost: ${s.totalCalls} calls, $${s.totalCostUsd.toFixed(4)} total`);
    lines.push(`  Tokens: ${s.totalInputTokens.toLocaleString()} in / ${s.totalOutputTokens.toLocaleString()} out`);
    lines.push(`  Avg: ${s.avgInputTokens.toLocaleString()} in + ${s.avgOutputTokens.toLocaleString()} out per call (${s.avgDurationMs}ms)`);
    lines.push(`  Rate: ${s.callsPerHour.toFixed(1)} calls/hr, $${s.costPerHour.toFixed(4)}/hr`);
    return lines;
  }

  private prune(now: number): void {
    const cutoff = now - this.windowMs;
    this.samples = this.samples.filter((s) => s.timestamp >= cutoff);
  }
}
