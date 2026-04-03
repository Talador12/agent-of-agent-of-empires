// goal-celebration.ts — auto-generate achievement summaries for completed
// goals. produces a scannable "ship log" entry with stats, duration,
// highlights, and a fun achievement badge.

export interface CelebrationInput {
  sessionTitle: string;
  goal: string;
  repo: string;
  startedAt: number;
  completedAt: number;
  costUsd: number;
  progressEntries: number;
  taskCount: number;
  errorCount: number;
}

export interface CelebrationResult {
  sessionTitle: string;
  badge: string;
  title: string;
  durationStr: string;
  stats: string;
  highlights: string[];
}

const BADGES: Array<{ condition: (i: CelebrationInput) => boolean; badge: string; title: string }> = [
  { condition: (i) => i.costUsd < 1 && i.errorCount === 0, badge: "💎", title: "Flawless Diamond" },
  { condition: (i) => i.errorCount === 0, badge: "🏆", title: "Zero Errors" },
  { condition: (i) => (i.completedAt - i.startedAt) < 1_800_000, badge: "⚡", title: "Speed Run" },
  { condition: (i) => i.costUsd < 2, badge: "💰", title: "Budget Hero" },
  { condition: (i) => i.progressEntries >= 10, badge: "📊", title: "Well Tracked" },
  { condition: (i) => i.taskCount >= 5, badge: "🎯", title: "Multi-Tasker" },
  { condition: (i) => true, badge: "✅", title: "Mission Complete" },
];

function formatDuration(ms: number): string {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  if (h > 0) return `${h}h${m}m`;
  return `${m}m`;
}

/**
 * Generate a celebration for a completed goal.
 */
export function celebrate(input: CelebrationInput): CelebrationResult {
  const durationMs = input.completedAt - input.startedAt;
  const durationStr = formatDuration(durationMs);

  // pick best badge
  const matched = BADGES.find((b) => b.condition(input))!;

  const highlights: string[] = [];
  if (input.errorCount === 0) highlights.push("Zero errors throughout");
  if (durationMs < 3_600_000) highlights.push(`Completed in under an hour (${durationStr})`);
  if (input.costUsd < 1) highlights.push(`Ultra-efficient: only $${input.costUsd.toFixed(2)}`);
  if (input.progressEntries > 5) highlights.push(`${input.progressEntries} progress checkpoints logged`);
  if (highlights.length === 0) highlights.push("Goal achieved successfully");

  const stats = `${durationStr} | $${input.costUsd.toFixed(2)} | ${input.progressEntries} progress | ${input.errorCount} errors`;

  return { sessionTitle: input.sessionTitle, badge: matched.badge, title: matched.title, durationStr, stats, highlights };
}

/**
 * Format celebration for TUI display.
 */
export function formatCelebration(result: CelebrationResult): string[] {
  const lines: string[] = [];
  lines.push(`  ${result.badge} ${result.title}: ${result.sessionTitle} — SHIPPED!`);
  lines.push(`    ${result.stats}`);
  for (const h of result.highlights) lines.push(`    ★ ${h}`);
  return lines;
}

/**
 * Format celebrations for multiple completions.
 */
export function formatCelebrations(results: CelebrationResult[]): string[] {
  if (results.length === 0) return ["  Celebrations: no recently completed goals"];
  const lines: string[] = [];
  lines.push(`  Goal Celebrations (${results.length} shipped):`);
  for (const r of results) lines.push(...formatCelebration(r));
  return lines;
}
