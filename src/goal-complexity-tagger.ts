// goal-complexity-tagger.ts — tag goals with estimated complexity level.
// uses keyword analysis, dependency count, and scope indicators to
// classify goals as trivial, simple, moderate, complex, or epic.

export type ComplexityLevel = "trivial" | "simple" | "moderate" | "complex" | "epic";

export interface ComplexityTag {
  sessionTitle: string;
  goal: string;
  level: ComplexityLevel;
  score: number; // 0-100
  factors: string[];
}

const SCOPE_LARGE = new Set(["refactor", "migrate", "redesign", "rewrite", "overhaul", "architecture", "infrastructure", "platform", "framework", "system"]);
const SCOPE_SMALL = new Set(["fix", "tweak", "update", "bump", "rename", "typo", "lint", "format"]);
const MULTI_INDICATORS = new Set(["and", "also", "plus", "then", "after", "before", "with", "including"]);

/**
 * Estimate goal complexity from text and metadata.
 */
export function estimateComplexity(sessionTitle: string, goal: string, dependencyCount = 0, subGoalCount = 0): ComplexityTag {
  const words = goal.toLowerCase().split(/\s+/);
  let score = 30; // base
  const factors: string[] = [];

  // word count: longer goals tend to be more complex
  if (words.length > 15) { score += 15; factors.push("long description"); }
  else if (words.length > 8) { score += 5; factors.push("moderate description"); }
  else if (words.length <= 3) { score -= 10; factors.push("short description"); }

  // scope keywords
  const largeScope = words.filter((w) => SCOPE_LARGE.has(w)).length;
  const smallScope = words.filter((w) => SCOPE_SMALL.has(w)).length;
  if (largeScope > 0) { score += largeScope * 15; factors.push(`${largeScope} large-scope keyword${largeScope > 1 ? "s" : ""}`); }
  if (smallScope > 0) { score -= smallScope * 10; factors.push(`${smallScope} small-scope keyword${smallScope > 1 ? "s" : ""}`); }

  // multi-task indicators (conjunctions suggesting multiple tasks)
  const multiCount = words.filter((w) => MULTI_INDICATORS.has(w)).length;
  if (multiCount >= 2) { score += 10; factors.push("multiple conjunctions"); }

  // dependencies increase complexity
  if (dependencyCount >= 3) { score += 15; factors.push(`${dependencyCount} dependencies`); }
  else if (dependencyCount >= 1) { score += 5; factors.push(`${dependencyCount} dep${dependencyCount > 1 ? "s" : ""}`); }

  // sub-goals indicate decomposed complexity
  if (subGoalCount >= 5) { score += 10; factors.push(`${subGoalCount} sub-goals`); }

  score = Math.max(0, Math.min(100, score));

  let level: ComplexityLevel;
  if (score >= 80) level = "epic";
  else if (score >= 60) level = "complex";
  else if (score >= 40) level = "moderate";
  else if (score >= 20) level = "simple";
  else level = "trivial";

  return { sessionTitle, goal, level, score, factors };
}

/**
 * Tag all goals in the fleet.
 */
export function tagFleetComplexity(goals: Array<{ sessionTitle: string; goal: string; depCount: number; subGoalCount: number }>): ComplexityTag[] {
  return goals.map((g) => estimateComplexity(g.sessionTitle, g.goal, g.depCount, g.subGoalCount)).sort((a, b) => b.score - a.score);
}

/**
 * Format complexity tags for TUI display.
 */
export function formatComplexityTags(tags: ComplexityTag[]): string[] {
  if (tags.length === 0) return ["  Complexity Tagger: no goals to analyze"];
  const icons: Record<ComplexityLevel, string> = { trivial: "○", simple: "◔", moderate: "◑", complex: "◕", epic: "●" };
  const lines: string[] = [];
  lines.push(`  Goal Complexity (${tags.length} goals):`);
  for (const t of tags) {
    const icon = icons[t.level];
    const factorStr = t.factors.slice(0, 2).join(", ");
    lines.push(`    ${icon} ${t.sessionTitle}: ${t.level} (${t.score}) — ${factorStr}`);
  }
  return lines;
}
