// goal-confidence-estimator.ts — predict goal completion probability from
// early signals. uses progress velocity, error frequency, time elapsed,
// and output pattern indicators to estimate confidence 0-100%.

export interface ConfidenceInput {
  sessionTitle: string;
  goal: string;
  progressPct: number;          // current progress estimate (0-100)
  velocityPctPerHr: number;     // progress velocity
  errorCount: number;           // errors since task start
  elapsedHours: number;         // time since task start
  positiveSignals: number;      // positive output patterns (tests pass, etc)
  negativeSignals: number;      // negative output patterns (failures, etc)
  stuckTicks: number;           // consecutive ticks with no progress
}

export interface ConfidenceResult {
  sessionTitle: string;
  confidence: number;           // 0-100% completion probability
  trend: "rising" | "falling" | "steady";
  factors: { name: string; impact: number; detail: string }[];
  etaHours: number | null;
}

/**
 * Estimate goal completion confidence from early signals.
 */
export function estimateConfidence(input: ConfidenceInput): ConfidenceResult {
  const factors: ConfidenceResult["factors"] = [];
  let confidence = 50; // base

  // progress factor (±25): higher progress = higher confidence
  const progressBoost = Math.round((input.progressPct - 50) * 0.5);
  confidence += progressBoost;
  if (progressBoost !== 0) factors.push({ name: "progress", impact: progressBoost, detail: `${input.progressPct}% complete` });

  // velocity factor (±15): positive velocity = rising confidence
  if (input.velocityPctPerHr > 5) {
    const velBoost = Math.min(15, Math.round(input.velocityPctPerHr));
    confidence += velBoost;
    factors.push({ name: "velocity", impact: velBoost, detail: `${input.velocityPctPerHr.toFixed(1)}%/hr` });
  } else if (input.velocityPctPerHr < 1 && input.elapsedHours > 1) {
    confidence -= 10;
    factors.push({ name: "velocity", impact: -10, detail: "stagnant" });
  }

  // error penalty (0 to -20): more errors = lower confidence
  if (input.errorCount > 0) {
    const errorPenalty = Math.min(20, input.errorCount * 5);
    confidence -= errorPenalty;
    factors.push({ name: "errors", impact: -errorPenalty, detail: `${input.errorCount} error${input.errorCount > 1 ? "s" : ""}` });
  }

  // signal balance (±10): positive signals boost, negative sink
  const signalBalance = input.positiveSignals - input.negativeSignals;
  if (signalBalance > 0) {
    const boost = Math.min(10, signalBalance * 3);
    confidence += boost;
    factors.push({ name: "signals", impact: boost, detail: `${input.positiveSignals}+ / ${input.negativeSignals}-` });
  } else if (signalBalance < 0) {
    const penalty = Math.min(10, Math.abs(signalBalance) * 3);
    confidence -= penalty;
    factors.push({ name: "signals", impact: -penalty, detail: `${input.positiveSignals}+ / ${input.negativeSignals}-` });
  }

  // stuck penalty (0 to -15): consecutive stuck ticks
  if (input.stuckTicks > 2) {
    const stuckPenalty = Math.min(15, input.stuckTicks * 3);
    confidence -= stuckPenalty;
    factors.push({ name: "stuck", impact: -stuckPenalty, detail: `${input.stuckTicks} ticks` });
  }

  // time pressure (±5): very long tasks lose confidence
  if (input.elapsedHours > 8 && input.progressPct < 50) {
    confidence -= 5;
    factors.push({ name: "time-pressure", impact: -5, detail: `${input.elapsedHours.toFixed(1)}h with <50% progress` });
  }

  confidence = Math.max(0, Math.min(100, confidence));

  // trend: compare factors for net direction
  const totalImpact = factors.reduce((a, f) => a + f.impact, 0);
  const trend: ConfidenceResult["trend"] = totalImpact > 5 ? "rising" : totalImpact < -5 ? "falling" : "steady";

  // ETA from velocity
  const remaining = 100 - input.progressPct;
  const eta = input.velocityPctPerHr > 0.5 ? Math.round((remaining / input.velocityPctPerHr) * 10) / 10 : null;

  return { sessionTitle: input.sessionTitle, confidence, trend, factors, etaHours: eta };
}

/**
 * Estimate confidence for multiple sessions.
 */
export function estimateFleetConfidence(inputs: ConfidenceInput[]): ConfidenceResult[] {
  return inputs.map(estimateConfidence).sort((a, b) => a.confidence - b.confidence); // worst first
}

/**
 * Format confidence results for TUI display.
 */
export function formatConfidence(results: ConfidenceResult[]): string[] {
  if (results.length === 0) return ["  Goal confidence: no active goals"];
  const lines: string[] = [];
  lines.push(`  Goal Confidence Estimator (${results.length} goals):`);
  for (const r of results) {
    const icon = r.confidence >= 70 ? "🟢" : r.confidence >= 40 ? "🟡" : "🔴";
    const arrow = r.trend === "rising" ? "↑" : r.trend === "falling" ? "↓" : "→";
    const eta = r.etaHours !== null ? ` ETA:${r.etaHours}h` : "";
    lines.push(`    ${icon} ${r.sessionTitle}: ${r.confidence}% ${arrow}${eta}`);
    for (const f of r.factors) {
      const sign = f.impact >= 0 ? "+" : "";
      lines.push(`      ${sign}${f.impact} ${f.name}: ${f.detail}`);
    }
  }
  return lines;
}
