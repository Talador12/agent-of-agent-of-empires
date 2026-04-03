// goal-progress-prediction.ts — ML-free statistical completion prediction.
// uses historical completion data (duration, progress curve) to predict
// when active goals will finish. no external deps — pure statistics.

export interface CompletionSample {
  durationHours: number;
  progressAtHalfway: number; // progress % at 50% of duration
  errorCount: number;
}

export interface PredictionInput {
  sessionTitle: string;
  goal: string;
  currentProgressPct: number;
  elapsedHours: number;
  errorCount: number;
}

export interface PredictionResult {
  sessionTitle: string;
  predictedDurationHours: number;
  predictedEtaHours: number;
  confidence: number; // 0-100
  method: "historical" | "linear-extrapolation" | "insufficient-data";
  percentile: number; // where this task falls in historical distribution
}

/**
 * Stateful predictor that learns from completed tasks.
 */
export class GoalProgressPredictor {
  private samples: CompletionSample[] = [];
  private maxSamples: number;

  constructor(maxSamples = 100) {
    this.maxSamples = maxSamples;
  }

  /** Record a completed task for future predictions. */
  recordCompletion(durationHours: number, progressAtHalfway: number, errorCount: number): void {
    this.samples.push({ durationHours, progressAtHalfway, errorCount });
    if (this.samples.length > this.maxSamples) {
      this.samples = this.samples.slice(-this.maxSamples);
    }
  }

  /** Predict completion for an active task. */
  predict(input: PredictionInput): PredictionResult {
    if (this.samples.length < 3) {
      // insufficient data — use linear extrapolation
      return this.linearExtrapolation(input);
    }

    return this.historicalPrediction(input);
  }

  private linearExtrapolation(input: PredictionInput): PredictionResult {
    if (input.currentProgressPct <= 0 || input.elapsedHours <= 0) {
      return {
        sessionTitle: input.sessionTitle,
        predictedDurationHours: 0,
        predictedEtaHours: 0,
        confidence: 10,
        method: "insufficient-data",
        percentile: 50,
      };
    }

    const rate = input.currentProgressPct / input.elapsedHours;
    const remaining = 100 - input.currentProgressPct;
    const etaHours = rate > 0 ? remaining / rate : 0;
    const totalDuration = input.elapsedHours + etaHours;

    return {
      sessionTitle: input.sessionTitle,
      predictedDurationHours: Math.round(totalDuration * 10) / 10,
      predictedEtaHours: Math.round(etaHours * 10) / 10,
      confidence: Math.min(60, 20 + input.currentProgressPct * 0.4),
      method: "linear-extrapolation",
      percentile: 50,
    };
  }

  private historicalPrediction(input: PredictionInput): PredictionResult {
    // find similar tasks by error count range
    const similar = this.samples.filter((s) => Math.abs(s.errorCount - input.errorCount) <= 2);
    const pool = similar.length >= 3 ? similar : this.samples;

    const durations = pool.map((s) => s.durationHours).sort((a, b) => a - b);
    const median = durations[Math.floor(durations.length / 2)];
    const p75 = durations[Math.floor(durations.length * 0.75)];

    // adjust prediction based on current progress
    let predictedTotal: number;
    if (input.currentProgressPct > 0 && input.elapsedHours > 0) {
      const linearEst = (input.elapsedHours / input.currentProgressPct) * 100;
      // blend linear estimate with historical median
      predictedTotal = linearEst * 0.6 + median * 0.4;
    } else {
      predictedTotal = median;
    }

    const etaHours = Math.max(0, predictedTotal - input.elapsedHours);

    // percentile: where does this task's elapsed time fall
    const percentile = Math.round((durations.filter((d) => d <= input.elapsedHours).length / durations.length) * 100);

    // confidence: more data + more progress = higher confidence
    const dataConfidence = Math.min(40, pool.length * 4);
    const progressConfidence = Math.min(40, input.currentProgressPct * 0.4);
    const confidence = Math.min(90, 10 + dataConfidence + progressConfidence);

    return {
      sessionTitle: input.sessionTitle,
      predictedDurationHours: Math.round(predictedTotal * 10) / 10,
      predictedEtaHours: Math.round(etaHours * 10) / 10,
      confidence: Math.round(confidence),
      method: "historical",
      percentile,
    };
  }

  /** Get sample count. */
  sampleCount(): number {
    return this.samples.length;
  }
}

/**
 * Format predictions for TUI display.
 */
export function formatPredictions(predictions: PredictionResult[]): string[] {
  if (predictions.length === 0) return ["  Progress prediction: no active goals"];
  const lines: string[] = [];
  lines.push(`  Goal Progress Predictions (${predictions.length} goals):`);
  for (const p of predictions) {
    const conf = p.confidence >= 60 ? "●" : p.confidence >= 30 ? "◐" : "○";
    const method = p.method === "historical" ? "hist" : p.method === "linear-extrapolation" ? "linear" : "n/a";
    lines.push(`    ${conf} ${p.sessionTitle}: ETA ${p.predictedEtaHours}h (total ~${p.predictedDurationHours}h, ${p.confidence}% conf, ${method})`);
  }
  return lines;
}
