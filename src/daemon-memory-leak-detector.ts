// daemon-memory-leak-detector.ts — track heap growth over time with leak alerts.
// monitors heap used MB across ticks, detects sustained growth patterns that
// indicate memory leaks. uses linear regression to project heap exhaustion.
// zero dependencies.

/** leak detection result */
export type LeakStatus = "ok" | "warning" | "likely-leak" | "critical";

/** a heap sample */
export interface HeapSample {
  timestamp: number;
  heapUsedMB: number;
  heapTotalMB: number;
}

/** leak detector state */
export interface LeakDetectorState {
  samples: HeapSample[];
  maxSamples: number;
  baselineHeapMB: number | null;  // established after warmup
  warmupSamples: number;
  alerts: LeakAlert[];
}

/** a leak alert */
export interface LeakAlert {
  timestamp: number;
  status: LeakStatus;
  heapUsedMB: number;
  growthRateMBPerHour: number;
  projectedExhaustionMs: number | null;
  message: string;
}

/** leak analysis result */
export interface LeakAnalysis {
  status: LeakStatus;
  currentHeapMB: number;
  baselineHeapMB: number;
  growthMB: number;              // current - baseline
  growthPct: number;             // % growth from baseline
  growthRateMBPerHour: number;
  projectedExhaustionMs: number | null;  // when heap total would be exceeded
  sampleCount: number;
  r2: number;                    // R² of linear fit (1.0 = perfect line = definite leak)
}

/** create leak detector state */
export function createLeakDetector(maxSamples = 300, warmupSamples = 10): LeakDetectorState {
  return {
    samples: [],
    maxSamples,
    baselineHeapMB: null,
    warmupSamples,
    alerts: [],
  };
}

/** record a heap sample */
export function recordHeapSample(state: LeakDetectorState, now = Date.now()): HeapSample {
  const mem = process.memoryUsage();
  const sample: HeapSample = {
    timestamp: now,
    heapUsedMB: Math.round(mem.heapUsed / 1_048_576 * 100) / 100,
    heapTotalMB: Math.round(mem.heapTotal / 1_048_576 * 100) / 100,
  };
  state.samples.push(sample);

  // establish baseline after warmup
  if (state.baselineHeapMB === null && state.samples.length >= state.warmupSamples) {
    const warmup = state.samples.slice(0, state.warmupSamples);
    state.baselineHeapMB = warmup.reduce((s, v) => s + v.heapUsedMB, 0) / warmup.length;
  }

  // trim
  if (state.samples.length > state.maxSamples) {
    state.samples = state.samples.slice(-state.maxSamples);
  }

  return sample;
}

/** compute linear regression: returns slope (MB/ms) and R² */
export function linearRegression(samples: HeapSample[]): { slopeMBPerMs: number; r2: number } {
  const n = samples.length;
  if (n < 2) return { slopeMBPerMs: 0, r2: 0 };

  const t0 = samples[0].timestamp;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
  for (const s of samples) {
    const x = s.timestamp - t0;
    const y = s.heapUsedMB;
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumX2 += x * x;
    sumY2 += y * y;
  }

  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return { slopeMBPerMs: 0, r2: 0 };

  const slopeMBPerMs = (n * sumXY - sumX * sumY) / denom;

  // R² calculation
  const meanY = sumY / n;
  let ssTot = 0, ssRes = 0;
  const intercept = (sumY - slopeMBPerMs * sumX) / n;
  for (const s of samples) {
    const x = s.timestamp - t0;
    const predicted = intercept + slopeMBPerMs * x;
    ssTot += (s.heapUsedMB - meanY) ** 2;
    ssRes += (s.heapUsedMB - predicted) ** 2;
  }
  const r2 = ssTot === 0 ? 0 : Math.max(0, 1 - ssRes / ssTot);

  return { slopeMBPerMs, r2: Math.round(r2 * 1000) / 1000 };
}

/** analyze for leaks */
export function analyzeLeaks(state: LeakDetectorState, now = Date.now()): LeakAnalysis {
  const samples = state.samples;
  if (samples.length < 2 || state.baselineHeapMB === null) {
    return {
      status: "ok",
      currentHeapMB: samples.length > 0 ? samples[samples.length - 1].heapUsedMB : 0,
      baselineHeapMB: state.baselineHeapMB ?? 0,
      growthMB: 0,
      growthPct: 0,
      growthRateMBPerHour: 0,
      projectedExhaustionMs: null,
      sampleCount: samples.length,
      r2: 0,
    };
  }

  const current = samples[samples.length - 1];
  const { slopeMBPerMs, r2 } = linearRegression(samples);
  const growthRateMBPerHour = slopeMBPerMs * 3_600_000;
  const growthMB = Math.round((current.heapUsedMB - state.baselineHeapMB) * 100) / 100;
  const growthPct = state.baselineHeapMB > 0 ? Math.round((growthMB / state.baselineHeapMB) * 100) : 0;

  // project exhaustion: when would heap used reach heap total?
  let projectedExhaustionMs: number | null = null;
  if (slopeMBPerMs > 0 && current.heapTotalMB > current.heapUsedMB) {
    const remainingMB = current.heapTotalMB - current.heapUsedMB;
    const msToExhaustion = remainingMB / slopeMBPerMs;
    projectedExhaustionMs = now + msToExhaustion;
  }

  // classify
  let status: LeakStatus = "ok";
  if (r2 > 0.8 && growthRateMBPerHour > 5) {
    status = "critical";
  } else if (r2 > 0.7 && growthRateMBPerHour > 2) {
    status = "likely-leak";
  } else if (r2 > 0.5 && growthRateMBPerHour > 1) {
    status = "warning";
  } else if (growthPct > 100) {
    status = "warning"; // doubled from baseline regardless of R²
  }

  return {
    status,
    currentHeapMB: current.heapUsedMB,
    baselineHeapMB: state.baselineHeapMB,
    growthMB,
    growthPct,
    growthRateMBPerHour: Math.round(growthRateMBPerHour * 100) / 100,
    projectedExhaustionMs,
    sampleCount: samples.length,
    r2,
  };
}

/** check and potentially fire an alert */
export function checkAndAlert(state: LeakDetectorState, now = Date.now()): LeakAlert | null {
  // cap alerts regardless of outcome
  if (state.alerts.length > 50) state.alerts = state.alerts.slice(-25);

  const analysis = analyzeLeaks(state, now);
  if (analysis.status === "ok") return null;

  const alert: LeakAlert = {
    timestamp: now,
    status: analysis.status,
    heapUsedMB: analysis.currentHeapMB,
    growthRateMBPerHour: analysis.growthRateMBPerHour,
    projectedExhaustionMs: analysis.projectedExhaustionMs,
    message: `${analysis.status}: heap growing ${analysis.growthRateMBPerHour}MB/hr (R²=${analysis.r2}), +${analysis.growthPct}% from baseline`,
  };
  state.alerts.push(alert);

  return alert;
}

/** format leak detector for TUI display */
export function formatLeakDetector(state: LeakDetectorState): string[] {
  const lines: string[] = [];
  const analysis = analyzeLeaks(state);

  const statusIcon = { ok: "✓", warning: "⚠", "likely-leak": "⚠⚠", critical: "✗" }[analysis.status];
  lines.push(`memory leak detector: ${statusIcon} ${analysis.status} (${analysis.sampleCount} samples)`);
  lines.push(`  baseline: ${analysis.baselineHeapMB}MB | current: ${analysis.currentHeapMB}MB | growth: ${analysis.growthMB > 0 ? "+" : ""}${analysis.growthMB}MB (${analysis.growthPct}%)`);
  lines.push(`  growth rate: ${analysis.growthRateMBPerHour}MB/hr | R²: ${analysis.r2}`);

  if (analysis.projectedExhaustionMs) {
    const hoursToExhaustion = (analysis.projectedExhaustionMs - Date.now()) / 3_600_000;
    lines.push(`  projected heap exhaustion: ${Math.round(hoursToExhaustion * 10) / 10}h`);
  }

  if (state.alerts.length > 0) {
    lines.push(`  recent alerts (${state.alerts.length} total):`);
    for (const a of state.alerts.slice(-3)) {
      lines.push(`    [${a.status}] ${a.message}`);
    }
  }

  return lines;
}
