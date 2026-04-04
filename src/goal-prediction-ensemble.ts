// goal-prediction-ensemble.ts — combine multiple prediction methods
// for more accurate goal completion estimates. averages linear,
// historical, and velocity-based predictions with confidence weighting.

export interface PredictionMethod {
  name: string;
  etaHours: number | null;
  confidence: number; // 0-100
}

export interface EnsemblePrediction {
  sessionTitle: string;
  methods: PredictionMethod[];
  ensembleEtaHours: number | null;
  ensembleConfidence: number;
  agreementPct: number; // how much the methods agree
}

/**
 * Compute ensemble prediction from multiple methods.
 * Uses confidence-weighted average of ETAs.
 */
export function ensemblePredict(sessionTitle: string, methods: PredictionMethod[]): EnsemblePrediction {
  const validMethods = methods.filter((m) => m.etaHours !== null && m.confidence > 0);

  if (validMethods.length === 0) {
    return { sessionTitle, methods, ensembleEtaHours: null, ensembleConfidence: 0, agreementPct: 0 };
  }

  // confidence-weighted average ETA
  const totalWeight = validMethods.reduce((a, m) => a + m.confidence, 0);
  const weightedEta = validMethods.reduce((a, m) => a + m.etaHours! * m.confidence, 0) / totalWeight;

  // ensemble confidence: sqrt of avg confidence (penalizes disagreement)
  const avgConfidence = validMethods.reduce((a, m) => a + m.confidence, 0) / validMethods.length;

  // agreement: how close are the ETAs to each other?
  const etas = validMethods.map((m) => m.etaHours!);
  const etaRange = Math.max(...etas) - Math.min(...etas);
  const etaAvg = etas.reduce((a, b) => a + b, 0) / etas.length;
  const agreementPct = etaAvg > 0 ? Math.max(0, Math.round((1 - etaRange / etaAvg) * 100)) : 100;

  // boost confidence when methods agree
  const ensembleConfidence = Math.min(95, Math.round(avgConfidence * (0.7 + (agreementPct / 100) * 0.3)));

  return {
    sessionTitle,
    methods,
    ensembleEtaHours: Math.round(weightedEta * 10) / 10,
    ensembleConfidence,
    agreementPct,
  };
}

/**
 * Build prediction methods from available data.
 */
export function buildPredictionMethods(opts: {
  currentProgressPct: number;
  elapsedHours: number;
  velocityPctPerHr: number;
  historicalAvgHours?: number;
  historicalConfidence?: number;
}): PredictionMethod[] {
  const methods: PredictionMethod[] = [];
  const remaining = 100 - opts.currentProgressPct;

  // linear extrapolation
  if (opts.currentProgressPct > 0 && opts.elapsedHours > 0) {
    const rate = opts.currentProgressPct / opts.elapsedHours;
    const eta = rate > 0 ? remaining / rate : null;
    methods.push({ name: "linear", etaHours: eta ? Math.round(eta * 10) / 10 : null, confidence: Math.min(60, 20 + opts.currentProgressPct * 0.4) });
  }

  // velocity-based
  if (opts.velocityPctPerHr > 0.5) {
    const eta = remaining / opts.velocityPctPerHr;
    methods.push({ name: "velocity", etaHours: Math.round(eta * 10) / 10, confidence: Math.min(70, 30 + opts.velocityPctPerHr * 2) });
  }

  // historical average
  if (opts.historicalAvgHours !== undefined && opts.historicalAvgHours > 0) {
    const eta = Math.max(0, opts.historicalAvgHours - opts.elapsedHours);
    methods.push({ name: "historical", etaHours: Math.round(eta * 10) / 10, confidence: opts.historicalConfidence ?? 50 });
  }

  return methods;
}

/**
 * Format ensemble predictions for TUI display.
 */
export function formatEnsemblePredictions(predictions: EnsemblePrediction[]): string[] {
  if (predictions.length === 0) return ["  Prediction Ensemble: no active goals"];
  const lines: string[] = [];
  lines.push(`  Prediction Ensemble (${predictions.length} goals):`);
  for (const p of predictions) {
    const eta = p.ensembleEtaHours !== null ? `${p.ensembleEtaHours}h` : "n/a";
    const conf = p.ensembleConfidence > 0 ? `${p.ensembleConfidence}%` : "low";
    const agree = `${p.agreementPct}% agree`;
    lines.push(`    ${p.sessionTitle}: ETA ${eta} (${conf}, ${agree})`);
    for (const m of p.methods) {
      const mEta = m.etaHours !== null ? `${m.etaHours}h` : "n/a";
      lines.push(`      ${m.name}: ${mEta} (${m.confidence}% conf)`);
    }
  }
  return lines;
}
