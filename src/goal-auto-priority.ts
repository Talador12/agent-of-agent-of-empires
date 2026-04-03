// goal-auto-priority.ts — rank goals by business impact + urgency from
// metadata. scores each goal based on keywords, repo importance, age,
// dependency count, and explicit priority tags.

export interface GoalPriorityInput {
  sessionTitle: string;
  goal: string;
  repo: string;
  createdAt: number;
  dependencyCount: number;  // how many other sessions depend on this
  tags: Map<string, string>;
  status: string;
}

export interface GoalPriorityResult {
  sessionTitle: string;
  goal: string;
  score: number;         // 0-100 composite priority score
  rank: number;
  factors: PriorityFactor[];
}

export interface PriorityFactor {
  name: string;
  score: number;  // contribution to total
  reason: string;
}

const URGENCY_KEYWORDS = new Set(["fix", "bug", "critical", "urgent", "hotfix", "incident", "security", "vulnerability", "breaking", "regression", "crash", "outage"]);
const IMPACT_KEYWORDS = new Set(["deploy", "release", "migration", "infrastructure", "auth", "payment", "billing", "production", "customer"]);

/**
 * Score a single goal for priority.
 */
export function scoreGoal(input: GoalPriorityInput, now = Date.now()): GoalPriorityResult {
  const factors: PriorityFactor[] = [];
  const words = input.goal.toLowerCase().split(/\s+/);

  // urgency keywords (0-30)
  const urgencyHits = words.filter((w) => URGENCY_KEYWORDS.has(w)).length;
  const urgencyScore = Math.min(30, urgencyHits * 10);
  if (urgencyHits > 0) factors.push({ name: "urgency-keywords", score: urgencyScore, reason: `${urgencyHits} urgency keyword${urgencyHits > 1 ? "s" : ""}` });

  // impact keywords (0-20)
  const impactHits = words.filter((w) => IMPACT_KEYWORDS.has(w)).length;
  const impactScore = Math.min(20, impactHits * 7);
  if (impactHits > 0) factors.push({ name: "impact-keywords", score: impactScore, reason: `${impactHits} impact keyword${impactHits > 1 ? "s" : ""}` });

  // dependency count (0-20) — more dependents = higher priority
  const depScore = Math.min(20, input.dependencyCount * 5);
  if (input.dependencyCount > 0) factors.push({ name: "dependencies", score: depScore, reason: `${input.dependencyCount} session${input.dependencyCount > 1 ? "s" : ""} depend on this` });

  // age (0-15) — older tasks get priority boost to prevent starvation
  const ageHours = (now - input.createdAt) / 3_600_000;
  const ageScore = Math.min(15, Math.floor(ageHours / 2));
  if (ageScore > 0) factors.push({ name: "age", score: ageScore, reason: `${Math.round(ageHours)}h old` });

  // explicit priority tag (0-15)
  const priorityTag = input.tags.get("priority") ?? input.tags.get("p");
  let tagScore = 0;
  if (priorityTag === "critical" || priorityTag === "p0") tagScore = 15;
  else if (priorityTag === "high" || priorityTag === "p1") tagScore = 10;
  else if (priorityTag === "medium" || priorityTag === "p2") tagScore = 5;
  if (tagScore > 0) factors.push({ name: "priority-tag", score: tagScore, reason: `tag: ${priorityTag}` });

  const totalScore = Math.min(100, urgencyScore + impactScore + depScore + ageScore + tagScore);
  return { sessionTitle: input.sessionTitle, goal: input.goal, score: totalScore, rank: 0, factors };
}

/**
 * Rank all goals by priority score.
 */
export function rankGoals(inputs: GoalPriorityInput[], now = Date.now()): GoalPriorityResult[] {
  const results = inputs.map((i) => scoreGoal(i, now));
  results.sort((a, b) => b.score - a.score);
  results.forEach((r, i) => { r.rank = i + 1; });
  return results;
}

/**
 * Format goal priority rankings for TUI display.
 */
export function formatGoalPriority(results: GoalPriorityResult[]): string[] {
  if (results.length === 0) return ["  Goal priority: no goals to rank"];
  const lines: string[] = [];
  lines.push(`  Goal Auto-Priority (${results.length} goals):`);
  for (const r of results) {
    const factorSummary = r.factors.map((f) => f.name).join(", ") || "base";
    lines.push(`    #${r.rank} [${r.score}] ${r.sessionTitle}: ${r.goal.slice(0, 50)}`);
    lines.push(`       factors: ${factorSummary}`);
  }
  return lines;
}
