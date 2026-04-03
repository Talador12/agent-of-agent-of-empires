// difficulty-allocator.ts — assign more resources to harder tasks.
// uses difficulty scores to weight pool slot allocation, giving complex
// tasks priority over simpler ones when slots are limited.

import type { DifficultyScore } from "./difficulty-scorer.js";

export interface AllocationResult {
  sessionTitle: string;
  difficultyScore: number;
  allocationWeight: number;  // normalized 0.0-1.0 relative to fleet
  recommendedSlots: number;  // suggested concurrent slot allocation
  action: "prioritize" | "normal" | "deprioritize";
}

/**
 * Compute resource allocation weights from difficulty scores.
 * Harder tasks get more weight, which translates to priority in
 * pool slot allocation and reasoner attention.
 */
export function computeAllocation(
  scores: DifficultyScore[],
  totalSlots: number,
): AllocationResult[] {
  if (scores.length === 0) return [];

  const totalDifficulty = scores.reduce((sum, s) => sum + s.score, 0);
  if (totalDifficulty === 0) {
    return scores.map((s) => ({
      sessionTitle: s.sessionTitle,
      difficultyScore: s.score,
      allocationWeight: 1 / scores.length,
      recommendedSlots: Math.max(1, Math.round(totalSlots / scores.length)),
      action: "normal" as const,
    }));
  }

  return scores.map((s) => {
    const weight = s.score / totalDifficulty;
    const rawSlots = weight * totalSlots;
    const recommendedSlots = Math.max(1, Math.round(rawSlots));

    const avgScore = totalDifficulty / scores.length;
    const action: AllocationResult["action"] =
      s.score > avgScore * 1.5 ? "prioritize" :
      s.score < avgScore * 0.5 ? "deprioritize" :
      "normal";

    return {
      sessionTitle: s.sessionTitle,
      difficultyScore: s.score,
      allocationWeight: weight,
      recommendedSlots,
      action,
    };
  }).sort((a, b) => b.allocationWeight - a.allocationWeight);
}

/**
 * Format allocation results for TUI display.
 */
export function formatAllocation(results: AllocationResult[]): string[] {
  if (results.length === 0) return ["  (no tasks to allocate)"];
  const lines: string[] = [];
  for (const r of results) {
    const icon = r.action === "prioritize" ? "⬆" : r.action === "deprioritize" ? "⬇" : "─";
    const pct = Math.round(r.allocationWeight * 100);
    lines.push(`  ${icon} ${r.sessionTitle}: difficulty ${r.difficultyScore}/10, weight ${pct}%, ${r.recommendedSlots} slot${r.recommendedSlots !== 1 ? "s" : ""} (${r.action})`);
  }
  return lines;
}
