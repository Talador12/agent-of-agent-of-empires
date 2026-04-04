// goal-sparkline-dashboard.ts — all-session sparklines in one view.
// shows progress trajectory for every active session as a compact
// sparkline grid for at-a-glance fleet health.

export interface SparklineEntry {
  sessionTitle: string;
  progressHistory: number[]; // recent progress % values
  currentPct: number;
  trend: "up" | "down" | "flat";
}

const SPARK_CHARS = "▁▂▃▄▅▆▇█";

/**
 * Build a sparkline string from progress values.
 */
export function buildSparkline(values: number[]): string {
  if (values.length === 0) return "";
  const max = Math.max(...values, 1);
  return values.map((v) => SPARK_CHARS[Math.min(7, Math.round((v / max) * 7))]).join("");
}

/**
 * Detect trend from recent values.
 */
export function detectTrend(values: number[]): SparklineEntry["trend"] {
  if (values.length < 3) return "flat";
  const mid = Math.floor(values.length / 2);
  const firstHalf = values.slice(0, mid).reduce((a, b) => a + b, 0) / mid;
  const secondHalf = values.slice(mid).reduce((a, b) => a + b, 0) / (values.length - mid);
  if (secondHalf > firstHalf + 3) return "up";
  if (secondHalf < firstHalf - 3) return "down";
  return "flat";
}

/**
 * Build sparkline entries from session data.
 */
export function buildSparklineEntries(sessions: Array<{ title: string; progressHistory: number[] }>): SparklineEntry[] {
  return sessions.map((s) => ({
    sessionTitle: s.title,
    progressHistory: s.progressHistory,
    currentPct: s.progressHistory.length > 0 ? s.progressHistory[s.progressHistory.length - 1] : 0,
    trend: detectTrend(s.progressHistory),
  })).sort((a, b) => a.currentPct - b.currentPct); // worst progress first
}

/**
 * Format sparkline dashboard for TUI display.
 */
export function formatSparklineDashboard(entries: SparklineEntry[]): string[] {
  if (entries.length === 0) return ["  Sparkline Dashboard: no sessions with progress data"];
  const lines: string[] = [];
  lines.push(`  Progress Sparklines (${entries.length} sessions):`);
  const trendIcons = { up: "↑", down: "↓", flat: "→" };
  for (const e of entries) {
    const spark = buildSparkline(e.progressHistory);
    const icon = trendIcons[e.trend];
    lines.push(`    ${e.sessionTitle.slice(0, 14).padEnd(14)} ${(e.currentPct + "%").padStart(5)} ${icon} ${spark}`);
  }
  return lines;
}
