// goal-progress-burndown.ts — ASCII burndown chart from velocity + remaining work.
// tracks progress samples over time and renders a text-based burndown showing
// actual vs ideal lines, projected completion, and scope change detection.
// zero dependencies.

/** a progress data point */
export interface BurndownSample {
  timestamp: number;
  remainingPct: number;       // 100 - progress%. starts at 100, ends at 0
}

/** burndown state per session */
export interface BurndownState {
  sessionTitle: string;
  samples: BurndownSample[];
  startedAt: number;
  initialRemainingPct: number;
  scopeChanges: number;       // times remaining went UP instead of down
}

/** burndown analysis */
export interface BurndownAnalysis {
  sessionTitle: string;
  currentRemainingPct: number;
  velocityPctPerHour: number;
  projectedCompletionMs: number | null;  // null = stalled or going wrong way
  elapsedHours: number;
  idealRemainingPct: number;  // where we should be for linear completion
  deviation: number;          // actual - ideal (positive = behind schedule)
  status: "ahead" | "on-track" | "behind" | "stalled" | "scope-creep";
  scopeChanges: number;
}

/** chart rendering options */
export interface ChartOptions {
  width: number;              // chart width in columns (default: 40)
  height: number;             // chart height in rows (default: 10)
}

/** create a new burndown state */
export function createBurndown(sessionTitle: string, now = Date.now()): BurndownState {
  return {
    sessionTitle,
    samples: [{ timestamp: now, remainingPct: 100 }],
    startedAt: now,
    initialRemainingPct: 100,
    scopeChanges: 0,
  };
}

/** record a progress sample */
export function recordProgress(state: BurndownState, progressPct: number, now = Date.now()): void {
  const remainingPct = Math.max(0, Math.min(100, 100 - progressPct));
  const prev = state.samples[state.samples.length - 1];

  // detect scope increase (remaining went up)
  if (prev && remainingPct > prev.remainingPct + 1) {
    state.scopeChanges++;
  }

  state.samples.push({ timestamp: now, remainingPct });

  // cap samples to prevent unbounded growth
  if (state.samples.length > 500) {
    state.samples = state.samples.slice(-250);
  }
}

/** analyze the burndown for a session */
export function analyzeBurndown(state: BurndownState, deadlineMs?: number, now = Date.now()): BurndownAnalysis {
  const elapsedMs = now - state.startedAt;
  const elapsedHours = elapsedMs / 3_600_000;
  const current = state.samples[state.samples.length - 1];
  const currentRemainingPct = current?.remainingPct ?? 100;

  // compute velocity from progress made
  const progressMade = state.initialRemainingPct - currentRemainingPct;
  const velocityPctPerHour = elapsedHours > 0.01 ? progressMade / elapsedHours : 0;

  // projected completion
  let projectedCompletionMs: number | null = null;
  if (velocityPctPerHour > 0.1) {
    const hoursRemaining = currentRemainingPct / velocityPctPerHour;
    projectedCompletionMs = now + hoursRemaining * 3_600_000;
  }

  // ideal line: linear from 100% to 0% over deadline (or double elapsed as estimate)
  const totalDurationMs = deadlineMs ?? elapsedMs * 2;
  const idealProgress = totalDurationMs > 0 ? (elapsedMs / totalDurationMs) * 100 : 0;
  const idealRemainingPct = Math.max(0, 100 - idealProgress);
  const deviation = currentRemainingPct - idealRemainingPct;

  // determine status
  let status: BurndownAnalysis["status"];
  if (state.scopeChanges >= 3) {
    status = "scope-creep";
  } else if (velocityPctPerHour < 0.5 && elapsedHours > 0.5) {
    status = "stalled";
  } else if (deviation < -10) {
    status = "ahead";
  } else if (deviation > 15) {
    status = "behind";
  } else {
    status = "on-track";
  }

  return {
    sessionTitle: state.sessionTitle,
    currentRemainingPct,
    velocityPctPerHour: Math.round(velocityPctPerHour * 10) / 10,
    projectedCompletionMs,
    elapsedHours: Math.round(elapsedHours * 10) / 10,
    idealRemainingPct: Math.round(idealRemainingPct),
    deviation: Math.round(deviation),
    status,
    scopeChanges: state.scopeChanges,
  };
}

/** render ASCII burndown chart */
export function renderBurndownChart(
  state: BurndownState,
  opts: Partial<ChartOptions> = {},
): string[] {
  const width = opts.width ?? 40;
  const height = opts.height ?? 10;
  const lines: string[] = [];

  if (state.samples.length < 2) {
    lines.push(`${state.sessionTitle}: insufficient data for chart`);
    return lines;
  }

  // normalize samples to chart dimensions
  const minT = state.samples[0].timestamp;
  const maxT = state.samples[state.samples.length - 1].timestamp;
  const timeRange = maxT - minT || 1;

  // build chart grid
  const grid: string[][] = Array.from({ length: height }, () => Array(width).fill(" "));

  // plot ideal line (diagonal from top-left to bottom-right)
  for (let col = 0; col < width; col++) {
    const idealRemaining = 100 * (1 - col / (width - 1));
    const row = Math.round((1 - idealRemaining / 100) * (height - 1));
    if (row >= 0 && row < height) grid[row][col] = "·";
  }

  // plot actual burndown
  for (const sample of state.samples) {
    const col = Math.round(((sample.timestamp - minT) / timeRange) * (width - 1));
    const row = Math.round((1 - sample.remainingPct / 100) * (height - 1));
    if (col >= 0 && col < width && row >= 0 && row < height) {
      grid[row][col] = "█";
    }
  }

  // render with axis labels
  lines.push(`  ${state.sessionTitle} burndown:`);
  lines.push(`  100% ${"┤"}${grid[0].join("")}┐`);
  for (let r = 1; r < height - 1; r++) {
    const pct = Math.round(100 * (1 - r / (height - 1)));
    const label = `${String(pct).padStart(4)}%`;
    lines.push(`  ${label} │${grid[r].join("")}│`);
  }
  lines.push(`    0% ${"┤"}${grid[height - 1].join("")}┘`);
  lines.push(`       └${"─".repeat(width)}→ time`);
  lines.push(`       · = ideal  █ = actual`);

  return lines;
}

/** format burndown for TUI display (chart + analysis) */
export function formatBurndown(states: BurndownState[]): string[] {
  const lines: string[] = [];
  lines.push(`burndown: ${states.length} sessions tracked`);

  for (const state of states) {
    const analysis = analyzeBurndown(state);
    const chart = renderBurndownChart(state, { width: 30, height: 6 });
    for (const l of chart) lines.push(l);

    const projStr = analysis.projectedCompletionMs
      ? new Date(analysis.projectedCompletionMs).toLocaleTimeString()
      : "unknown";
    lines.push(`    velocity: ${analysis.velocityPctPerHour}%/hr | eta: ${projStr} | status: ${analysis.status}`);
    lines.push(`    deviation: ${analysis.deviation > 0 ? "+" : ""}${analysis.deviation}% from ideal | scope changes: ${analysis.scopeChanges}`);
    lines.push("");
  }

  return lines;
}
