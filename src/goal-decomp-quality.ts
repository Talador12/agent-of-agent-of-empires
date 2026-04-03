// goal-decomp-quality.ts — rate how well sub-goals cover the parent goal.
// uses keyword extraction to compare parent goal keywords against the
// union of sub-goal keywords. higher coverage = better decomposition.

export interface DecompQualityInput {
  parentGoal: string;
  subGoals: string[];
}

export interface DecompQualityResult {
  parentGoal: string;
  parentKeywords: string[];
  coveredKeywords: string[];
  uncoveredKeywords: string[];
  coveragePct: number;
  subGoalCount: number;
  avgKeywordsPerSub: number;
  grade: "A" | "B" | "C" | "D" | "F";
  suggestions: string[];
}

const STOPWORDS = new Set(["the", "a", "an", "and", "or", "in", "on", "to", "for", "of", "is", "it", "be", "do", "this", "that", "with", "from", "by", "at", "as", "all", "each", "should", "must", "will", "can"]);

/**
 * Extract meaningful keywords from a goal string.
 */
export function extractKeywords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

/**
 * Score the quality of a goal decomposition.
 */
export function scoreDecomposition(input: DecompQualityInput): DecompQualityResult {
  const parentKw = [...new Set(extractKeywords(input.parentGoal))];
  const subKwSets = input.subGoals.map((g) => new Set(extractKeywords(g)));
  const allSubKw = new Set(subKwSets.flatMap((s) => Array.from(s)));

  const covered = parentKw.filter((k) => allSubKw.has(k));
  const uncovered = parentKw.filter((k) => !allSubKw.has(k));
  const coveragePct = parentKw.length > 0 ? Math.round((covered.length / parentKw.length) * 100) : 0;

  const totalSubKw = subKwSets.reduce((a, s) => a + s.size, 0);
  const avgKwPerSub = input.subGoals.length > 0 ? Math.round((totalSubKw / input.subGoals.length) * 10) / 10 : 0;

  const grade = coveragePct >= 80 ? "A" : coveragePct >= 60 ? "B" : coveragePct >= 40 ? "C" : coveragePct >= 20 ? "D" : "F";

  const suggestions: string[] = [];
  if (uncovered.length > 0) {
    suggestions.push(`Uncovered keywords: ${uncovered.join(", ")} — consider adding sub-goals for these areas`);
  }
  if (input.subGoals.length === 1) {
    suggestions.push("Only 1 sub-goal — decomposition may be too coarse");
  }
  if (input.subGoals.length > 8) {
    suggestions.push(`${input.subGoals.length} sub-goals — consider grouping into fewer higher-level tasks`);
  }
  if (avgKwPerSub < 2) {
    suggestions.push("Sub-goals are very short — add more detail");
  }

  return {
    parentGoal: input.parentGoal,
    parentKeywords: parentKw,
    coveredKeywords: covered,
    uncoveredKeywords: uncovered,
    coveragePct,
    subGoalCount: input.subGoals.length,
    avgKeywordsPerSub: avgKwPerSub,
    grade,
    suggestions,
  };
}

/**
 * Format decomposition quality for TUI display.
 */
export function formatDecompQuality(result: DecompQualityResult): string[] {
  const lines: string[] = [];
  const icon = result.grade === "A" ? "🟢" : result.grade === "B" ? "🟡" : result.grade === "C" ? "🟠" : "🔴";
  lines.push(`  Decomposition Quality ${icon} Grade ${result.grade} (${result.coveragePct}% keyword coverage):`);
  lines.push(`    Parent: "${result.parentGoal.slice(0, 60)}"`);
  lines.push(`    Sub-goals: ${result.subGoalCount} | Avg keywords/sub: ${result.avgKeywordsPerSub}`);
  if (result.uncoveredKeywords.length > 0) {
    lines.push(`    Uncovered: ${result.uncoveredKeywords.join(", ")}`);
  }
  for (const s of result.suggestions) {
    lines.push(`    → ${s}`);
  }
  return lines;
}
