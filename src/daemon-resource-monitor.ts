// daemon-resource-monitor.ts — track CPU/memory/disk usage per daemon tick.
// samples process.memoryUsage() and process.cpuUsage() each tick, maintains
// rolling history, detects anomalies and trends. zero dependencies.

/** a single resource sample */
export interface ResourceSample {
  timestamp: number;
  heapUsedMB: number;
  heapTotalMB: number;
  rssMB: number;
  externalMB: number;
  cpuUserMs: number;       // cumulative user CPU ms since last sample
  cpuSystemMs: number;     // cumulative system CPU ms since last sample
  tickNum: number;
}

/** resource trend */
export type ResourceTrend = "increasing" | "decreasing" | "stable";

/** resource monitor state */
export interface ResourceMonitorState {
  samples: ResourceSample[];
  maxSamples: number;
  lastCpuUsage: { user: number; system: number } | null;
  peakHeapMB: number;
  peakRssMB: number;
}

/** resource summary */
export interface ResourceSummary {
  currentHeapMB: number;
  currentRssMB: number;
  peakHeapMB: number;
  peakRssMB: number;
  avgHeapMB: number;
  avgRssMB: number;
  heapTrend: ResourceTrend;
  rssTrend: ResourceTrend;
  cpuAvgUserMsPerTick: number;
  cpuAvgSystemMsPerTick: number;
  sampleCount: number;
  heapUtilizationPct: number;  // heapUsed / heapTotal
}

/** create resource monitor state */
export function createResourceMonitor(maxSamples = 300): ResourceMonitorState {
  return {
    samples: [],
    maxSamples,
    lastCpuUsage: null,
    peakHeapMB: 0,
    peakRssMB: 0,
  };
}

/** record a resource sample (call once per tick) */
export function recordSample(
  state: ResourceMonitorState,
  tickNum: number,
  now = Date.now(),
): ResourceSample {
  const mem = process.memoryUsage();
  const cpu = process.cpuUsage();

  const heapUsedMB = Math.round(mem.heapUsed / 1_048_576 * 100) / 100;
  const heapTotalMB = Math.round(mem.heapTotal / 1_048_576 * 100) / 100;
  const rssMB = Math.round(mem.rss / 1_048_576 * 100) / 100;
  const externalMB = Math.round(mem.external / 1_048_576 * 100) / 100;

  let cpuUserMs = 0;
  let cpuSystemMs = 0;
  if (state.lastCpuUsage) {
    cpuUserMs = Math.round((cpu.user - state.lastCpuUsage.user) / 1000);
    cpuSystemMs = Math.round((cpu.system - state.lastCpuUsage.system) / 1000);
  }
  state.lastCpuUsage = { user: cpu.user, system: cpu.system };

  const sample: ResourceSample = {
    timestamp: now,
    heapUsedMB,
    heapTotalMB,
    rssMB,
    externalMB,
    cpuUserMs,
    cpuSystemMs,
    tickNum,
  };

  state.samples.push(sample);
  if (heapUsedMB > state.peakHeapMB) state.peakHeapMB = heapUsedMB;
  if (rssMB > state.peakRssMB) state.peakRssMB = rssMB;

  // trim old samples
  if (state.samples.length > state.maxSamples) {
    state.samples = state.samples.slice(-state.maxSamples);
  }

  return sample;
}

/** detect trend from samples (compare first half avg to second half avg) */
export function detectTrend(values: number[]): ResourceTrend {
  if (values.length < 4) return "stable";
  const mid = Math.floor(values.length / 2);
  const firstHalf = values.slice(0, mid);
  const secondHalf = values.slice(mid);
  const avgFirst = firstHalf.reduce((s, v) => s + v, 0) / firstHalf.length;
  const avgSecond = secondHalf.reduce((s, v) => s + v, 0) / secondHalf.length;
  const diff = avgSecond - avgFirst;
  const threshold = avgFirst * 0.1; // 10% change threshold
  if (diff > threshold) return "increasing";
  if (diff < -threshold) return "decreasing";
  return "stable";
}

/** compute resource summary from current state */
export function summarizeResources(state: ResourceMonitorState): ResourceSummary {
  const samples = state.samples;
  if (samples.length === 0) {
    return {
      currentHeapMB: 0,
      currentRssMB: 0,
      peakHeapMB: 0,
      peakRssMB: 0,
      avgHeapMB: 0,
      avgRssMB: 0,
      heapTrend: "stable",
      rssTrend: "stable",
      cpuAvgUserMsPerTick: 0,
      cpuAvgSystemMsPerTick: 0,
      sampleCount: 0,
      heapUtilizationPct: 0,
    };
  }

  const latest = samples[samples.length - 1];
  const avgHeapMB = Math.round(samples.reduce((s, v) => s + v.heapUsedMB, 0) / samples.length * 100) / 100;
  const avgRssMB = Math.round(samples.reduce((s, v) => s + v.rssMB, 0) / samples.length * 100) / 100;

  const cpuSamples = samples.filter((s) => s.cpuUserMs > 0 || s.cpuSystemMs > 0);
  const cpuAvgUserMsPerTick = cpuSamples.length > 0
    ? Math.round(cpuSamples.reduce((s, v) => s + v.cpuUserMs, 0) / cpuSamples.length)
    : 0;
  const cpuAvgSystemMsPerTick = cpuSamples.length > 0
    ? Math.round(cpuSamples.reduce((s, v) => s + v.cpuSystemMs, 0) / cpuSamples.length)
    : 0;

  const heapTrend = detectTrend(samples.map((s) => s.heapUsedMB));
  const rssTrend = detectTrend(samples.map((s) => s.rssMB));

  const heapUtilizationPct = latest.heapTotalMB > 0
    ? Math.round((latest.heapUsedMB / latest.heapTotalMB) * 100)
    : 0;

  return {
    currentHeapMB: latest.heapUsedMB,
    currentRssMB: latest.rssMB,
    peakHeapMB: state.peakHeapMB,
    peakRssMB: state.peakRssMB,
    avgHeapMB,
    avgRssMB,
    heapTrend,
    rssTrend,
    cpuAvgUserMsPerTick,
    cpuAvgSystemMsPerTick,
    sampleCount: samples.length,
    heapUtilizationPct,
  };
}

/** format resource monitor for TUI display */
export function formatResourceMonitor(state: ResourceMonitorState): string[] {
  const summary = summarizeResources(state);
  const lines: string[] = [];

  lines.push(`resource monitor: ${summary.sampleCount} samples`);
  lines.push(`  heap: ${summary.currentHeapMB}MB / peak ${summary.peakHeapMB}MB / avg ${summary.avgHeapMB}MB [${summary.heapTrend}] (${summary.heapUtilizationPct}% utilized)`);
  lines.push(`  rss:  ${summary.currentRssMB}MB / peak ${summary.peakRssMB}MB / avg ${summary.avgRssMB}MB [${summary.rssTrend}]`);
  lines.push(`  cpu:  ${summary.cpuAvgUserMsPerTick}ms user + ${summary.cpuAvgSystemMsPerTick}ms sys per tick`);

  // sparkline of heap usage
  if (state.samples.length >= 4) {
    const heapValues = state.samples.slice(-20).map((s) => s.heapUsedMB);
    const max = Math.max(...heapValues);
    const min = Math.min(...heapValues);
    const range = max - min || 1;
    const chars = "▁▂▃▄▅▆▇█";
    const sparkline = heapValues.map((v) => {
      const idx = Math.min(7, Math.floor(((v - min) / range) * 7));
      return chars[idx];
    }).join("");
    lines.push(`  heap trend: ${sparkline} (${min.toFixed(1)}-${max.toFixed(1)}MB)`);
  }

  return lines;
}
