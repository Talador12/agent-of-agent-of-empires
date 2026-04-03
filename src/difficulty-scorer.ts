// difficulty-scorer.ts — estimate task complexity before assignment.
// analyzes goal text, file count, and historical patterns to produce
// a difficulty score for scheduling and resource allocation.

export interface DifficultyScore {
  sessionTitle: string;
  score: number;           // 1-10 (1=trivial, 10=very complex)
  label: "trivial" | "easy" | "moderate" | "hard" | "complex";
  factors: string[];
  estimatedHours: number;  // rough estimate
}

/**
 * Score task difficulty from goal text analysis.
 */
export function scoreDifficulty(sessionTitle: string, goal: string, progressCount = 0, elapsedMs = 0): DifficultyScore {
  let score = 3; // baseline: moderate
  const factors: string[] = [];

  // ── Goal length ──────────────────────────────────────────────────
  const goalWords = goal.split(/\s+/).filter(Boolean).length;
  if (goalWords > 100) { score += 2; factors.push(`long goal (${goalWords} words)`); }
  else if (goalWords > 50) { score += 1; factors.push(`detailed goal (${goalWords} words)`); }
  else if (goalWords < 10) { score -= 1; factors.push(`brief goal (${goalWords} words)`); }

  // ── Sub-task count ───────────────────────────────────────────────
  const bullets = goal.split("\n").filter((l) => /^\s*[-*•]\s/.test(l) || /^\s*\d+[.)]\s/.test(l)).length;
  if (bullets >= 5) { score += 2; factors.push(`${bullets} sub-tasks`); }
  else if (bullets >= 3) { score += 1; factors.push(`${bullets} sub-tasks`); }

  // ── Complexity keywords ──────────────────────────────────────────
  const complexKeywords = /\b(refactor|migrate|rewrite|architecture|security|performance|optimize|distributed|concurrent|async|database|schema|deploy|infrastructure|CI\/CD)\b/i;
  const complexMatches = goal.match(new RegExp(complexKeywords.source, "gi"));
  if (complexMatches && complexMatches.length >= 2) { score += 2; factors.push(`complex keywords: ${complexMatches.slice(0, 3).join(", ")}`); }
  else if (complexMatches) { score += 1; factors.push(`complexity: ${complexMatches[0]}`); }

  // ── Simple keywords ──────────────────────────────────────────────
  const simpleKeywords = /\b(fix bug|typo|rename|update docs|bump version|add comment)\b/i;
  if (simpleKeywords.test(goal)) { score -= 1; factors.push("simple task pattern"); }

  // ── Progress rate ────────────────────────────────────────────────
  if (elapsedMs > 2 * 3_600_000 && progressCount < 3) {
    score += 1; factors.push("slow progress rate");
  }

  // clamp
  score = Math.max(1, Math.min(10, score));

  const label: DifficultyScore["label"] =
    score <= 2 ? "trivial" :
    score <= 4 ? "easy" :
    score <= 6 ? "moderate" :
    score <= 8 ? "hard" :
    "complex";

  // rough hour estimate: 0.5h per difficulty point
  const estimatedHours = Math.round(score * 0.5 * 10) / 10;

  return { sessionTitle, score, label, factors, estimatedHours };
}

/**
 * Format difficulty scores for TUI display.
 */
export function formatDifficultyScores(scores: DifficultyScore[]): string[] {
  if (scores.length === 0) return ["  (no tasks to score)"];
  const lines: string[] = [];
  const bar = (s: number) => "█".repeat(s) + "░".repeat(10 - s);
  for (const d of scores) {
    lines.push(`  ${bar(d.score)} ${d.score}/10 ${d.label.padEnd(8)} ${d.sessionTitle} (~${d.estimatedHours}h)`);
    if (d.factors.length > 0) lines.push(`    ${d.factors.join("; ")}`);
  }
  return lines;
}
