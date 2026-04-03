// fleet-leaderboard.ts — rank sessions by productivity metrics.
// provides a competitive leaderboard view showing completion rate,
// velocity, cost efficiency, and overall productivity score.

export interface LeaderboardEntry {
  sessionTitle: string;
  completedTasks: number;
  totalTasks: number;
  completionRate: number;       // 0-100
  velocityPctPerHr: number;     // progress %/hr
  costUsd: number;
  costPerCompletion: number;    // $/completed task (Infinity if 0 completions)
  productivityScore: number;    // composite 0-100
  rank: number;
}

export interface LeaderboardInput {
  sessionTitle: string;
  completedTasks: number;
  totalTasks: number;
  velocityPctPerHr: number;
  costUsd: number;
}

/**
 * Compute the leaderboard from session productivity inputs.
 * Score = weighted: 40% completion rate, 30% velocity (normalized), 30% cost efficiency.
 */
export function computeLeaderboard(inputs: LeaderboardInput[]): LeaderboardEntry[] {
  if (inputs.length === 0) return [];

  // normalize velocity — highest velocity gets 100
  const maxVelocity = Math.max(...inputs.map((i) => i.velocityPctPerHr), 0.001);

  // normalize cost efficiency — lowest cost per completion gets 100
  const costPerCompletions = inputs.map((i) =>
    i.completedTasks > 0 ? i.costUsd / i.completedTasks : Infinity,
  );
  const finiteCosts = costPerCompletions.filter((c) => isFinite(c));
  const minCostPer = finiteCosts.length > 0 ? Math.min(...finiteCosts) : 1;
  const maxCostPer = finiteCosts.length > 0 ? Math.max(...finiteCosts) : 1;
  const costRange = maxCostPer - minCostPer || 1;

  const entries: LeaderboardEntry[] = inputs.map((input, idx) => {
    const completionRate = input.totalTasks > 0
      ? Math.round((input.completedTasks / input.totalTasks) * 100)
      : 0;

    const velocityNorm = Math.round((input.velocityPctPerHr / maxVelocity) * 100);

    const cpc = costPerCompletions[idx];
    const costEfficiency = isFinite(cpc)
      ? Math.round((1 - (cpc - minCostPer) / costRange) * 100)
      : 0;

    const productivityScore = Math.round(
      completionRate * 0.4 + velocityNorm * 0.3 + costEfficiency * 0.3,
    );

    return {
      sessionTitle: input.sessionTitle,
      completedTasks: input.completedTasks,
      totalTasks: input.totalTasks,
      completionRate,
      velocityPctPerHr: input.velocityPctPerHr,
      costUsd: input.costUsd,
      costPerCompletion: cpc,
      productivityScore,
      rank: 0, // set after sort
    };
  });

  entries.sort((a, b) => b.productivityScore - a.productivityScore);
  entries.forEach((e, i) => { e.rank = i + 1; });

  return entries;
}

/**
 * Format the leaderboard for TUI display.
 */
export function formatLeaderboard(entries: LeaderboardEntry[]): string[] {
  if (entries.length === 0) return ["  Leaderboard: no session data"];
  const lines: string[] = [];
  lines.push(`  Fleet Leaderboard (${entries.length} sessions):`);
  lines.push(`  ${"#".padStart(3)} ${"Session".padEnd(20)} ${"Score".padStart(5)} ${"Done".padStart(6)} ${"Vel".padStart(6)} ${"Cost".padStart(8)}`);
  lines.push(`  ${"─".repeat(3)} ${"─".repeat(20)} ${"─".repeat(5)} ${"─".repeat(6)} ${"─".repeat(6)} ${"─".repeat(8)}`);
  for (const e of entries) {
    const medal = e.rank === 1 ? "🥇" : e.rank === 2 ? "🥈" : e.rank === 3 ? "🥉" : `  ${e.rank}`;
    const done = `${e.completedTasks}/${e.totalTasks}`;
    const vel = `${e.velocityPctPerHr.toFixed(1)}`;
    const cost = `$${e.costUsd.toFixed(2)}`;
    lines.push(`  ${medal.toString().padStart(3)} ${e.sessionTitle.slice(0, 20).padEnd(20)} ${e.productivityScore.toString().padStart(5)} ${done.padStart(6)} ${vel.padStart(6)} ${cost.padStart(8)}`);
  }
  return lines;
}
