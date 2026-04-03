// goal-refiner.ts — learn from completed tasks to improve future goals.
// analyzes patterns in completed task goals, progress entries, and outcomes
// to suggest refinements for similar future tasks.

import type { TaskState } from "./types.js";

export interface GoalPattern {
  keywords: string[];     // common keywords in successful goals
  avgProgressEntries: number;
  avgDurationMs: number;
  successRate: number;
  sampleSize: number;
}

export interface GoalRefinement {
  originalGoal: string;
  suggestions: string[];
  confidence: "high" | "medium" | "low";
  basedOn: number;        // number of historical tasks analyzed
}

/**
 * Analyze completed tasks to extract patterns.
 */
export function analyzeCompletedTasks(tasks: readonly TaskState[]): GoalPattern {
  const completed = tasks.filter((t) => t.status === "completed" && t.completedAt && t.createdAt);
  const failed = tasks.filter((t) => t.status === "failed");

  if (completed.length === 0) {
    return { keywords: [], avgProgressEntries: 0, avgDurationMs: 0, successRate: 0, sampleSize: 0 };
  }

  // extract common keywords from successful goals
  const wordCounts = new Map<string, number>();
  for (const t of completed) {
    const words = t.goal.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
    const unique = new Set(words);
    for (const w of unique) {
      wordCounts.set(w, (wordCounts.get(w) ?? 0) + 1);
    }
  }
  const keywords = [...wordCounts.entries()]
    .filter(([, count]) => count >= Math.ceil(completed.length * 0.3)) // appear in 30%+ of tasks
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([word]) => word);

  const durations = completed.map((t) => t.completedAt! - t.createdAt!);
  const progressCounts = completed.map((t) => t.progress.length);
  const successRate = completed.length / (completed.length + failed.length);

  return {
    keywords,
    avgProgressEntries: Math.round(progressCounts.reduce((a, b) => a + b, 0) / completed.length),
    avgDurationMs: Math.round(durations.reduce((a, b) => a + b, 0) / completed.length),
    successRate,
    sampleSize: completed.length,
  };
}

/**
 * Suggest refinements for a new goal based on historical patterns.
 */
export function refineGoal(goal: string, patterns: GoalPattern): GoalRefinement {
  const suggestions: string[] = [];
  const goalLower = goal.toLowerCase();

  // check for missing structural elements
  const hasBullets = /^\s*[-*•]\s/m.test(goal);
  const hasNumbers = /^\s*\d+[.)]\s/m.test(goal);
  if (!hasBullets && !hasNumbers && goal.split("\n").length <= 2) {
    suggestions.push("Consider breaking the goal into numbered steps or bullet points — completed tasks averaged " +
      `${patterns.avgProgressEntries} progress entries`);
  }

  // check goal length
  const wordCount = goal.split(/\s+/).length;
  if (wordCount < 5) {
    suggestions.push("Goal is very brief — more specific goals tend to complete faster");
  }

  // suggest mentioning testing if not already there
  if (!goalLower.includes("test") && !goalLower.includes("verify") && !goalLower.includes("check")) {
    suggestions.push("Consider adding a testing/verification step — it's common in successful tasks");
  }

  // suggest mentioning commit/push if not there
  if (!goalLower.includes("commit") && !goalLower.includes("push") && !goalLower.includes("pr") && !goalLower.includes("merge")) {
    suggestions.push("Consider adding a commit/push step to define a clear completion signal");
  }

  // estimate duration
  if (patterns.avgDurationMs > 0) {
    const hours = Math.round(patterns.avgDurationMs / 3_600_000 * 10) / 10;
    suggestions.push(`Based on ${patterns.sampleSize} completed tasks, expect ~${hours}h to completion`);
  }

  const confidence = patterns.sampleSize >= 10 ? "high" : patterns.sampleSize >= 3 ? "medium" : "low";

  return {
    originalGoal: goal,
    suggestions,
    confidence,
    basedOn: patterns.sampleSize,
  };
}

/**
 * Format goal refinement for TUI display.
 */
export function formatGoalRefinement(refinement: GoalRefinement): string[] {
  if (refinement.suggestions.length === 0) return ["  ✓ Goal looks good — no refinements suggested"];
  const conf = refinement.confidence === "high" ? "●" : refinement.confidence === "medium" ? "◐" : "○";
  const lines: string[] = [];
  lines.push(`  ${conf} Goal refinement (based on ${refinement.basedOn} completed tasks):`);
  for (const s of refinement.suggestions) {
    lines.push(`    → ${s}`);
  }
  return lines;
}
