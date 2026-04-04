// goal-progress-heatmap.ts — hourly progress visualization across the
// fleet. records progress samples per session per hour, renders a
// heatmap grid showing activity intensity.

export interface ProgressSample {
  sessionTitle: string;
  hour: number; // 0-23
  progressDelta: number; // progress change during this hour
}

export interface HeatmapState {
  grid: Map<string, number[]>; // session -> 24-element array (one per hour)
}

const HEAT_CHARS = " ░▒▓█";

/**
 * Create heatmap state.
 */
export function createHeatmapState(): HeatmapState {
  return { grid: new Map() };
}

/**
 * Record a progress delta for a session at a given hour.
 */
export function recordProgress(state: HeatmapState, sessionTitle: string, hour: number, delta: number): void {
  if (!state.grid.has(sessionTitle)) state.grid.set(sessionTitle, new Array(24).fill(0));
  const row = state.grid.get(sessionTitle)!;
  const h = Math.max(0, Math.min(23, Math.floor(hour)));
  row[h] += Math.max(0, delta);
}

/**
 * Get the heatmap grid for rendering.
 */
export function getHeatmapGrid(state: HeatmapState): Array<{ sessionTitle: string; hours: number[] }> {
  return Array.from(state.grid.entries()).map(([sessionTitle, hours]) => ({ sessionTitle, hours }));
}

/**
 * Find the peak hour across all sessions.
 */
export function peakHour(state: HeatmapState): { hour: number; total: number } | null {
  const hourTotals = new Array(24).fill(0);
  for (const hours of state.grid.values()) {
    for (let i = 0; i < 24; i++) hourTotals[i] += hours[i];
  }
  const max = Math.max(...hourTotals);
  if (max === 0) return null;
  return { hour: hourTotals.indexOf(max), total: max };
}

/**
 * Render a single row as heat characters.
 */
function renderHeatRow(hours: number[], maxVal: number): string {
  return hours.map((v) => {
    if (v === 0) return HEAT_CHARS[0];
    const idx = Math.min(4, Math.ceil((v / maxVal) * 4));
    return HEAT_CHARS[idx];
  }).join("");
}

/**
 * Format heatmap for TUI display.
 */
export function formatProgressHeatmap(state: HeatmapState): string[] {
  const grid = getHeatmapGrid(state);
  if (grid.length === 0) return ["  Progress Heatmap: no data (record progress samples first)"];
  const lines: string[] = [];
  const peak = peakHour(state);
  lines.push(`  Progress Heatmap (${grid.length} sessions, peak: ${peak ? `${peak.hour}:00 (${peak.total} delta)` : "none"}):`);
  lines.push(`  ${"Session".padEnd(14)} 00  03  06  09  12  15  18  21`);

  // find global max for normalization
  let maxVal = 0;
  for (const row of grid) maxVal = Math.max(maxVal, ...row.hours);
  if (maxVal === 0) maxVal = 1;

  for (const row of grid) {
    const heat = renderHeatRow(row.hours, maxVal);
    lines.push(`  ${row.sessionTitle.slice(0, 14).padEnd(14)} ${heat}`);
  }

  lines.push(`  Legend: ${HEAT_CHARS.split("").map((c, i) => `${c}=${i === 0 ? "none" : i === 4 ? "peak" : `${i}`}`).join(" ")}`);
  return lines;
}
