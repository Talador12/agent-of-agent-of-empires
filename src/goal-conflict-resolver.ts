// goal-conflict-resolver.ts — detect conflicting or overlapping goals across
// sessions and suggest resolution strategies. uses keyword extraction and
// path overlap to find sessions that may step on each other's toes.

export interface GoalConflict {
  sessionA: string;
  sessionB: string;
  conflictType: "file-overlap" | "goal-overlap" | "dependency-cycle";
  description: string;
  severity: "low" | "medium" | "high";
  suggestion: string;
}

export interface GoalInfo {
  sessionTitle: string;
  goal: string;
  repo: string;
  files?: string[]; // recently edited files (if available)
}

/**
 * Extract keywords from a goal string for overlap comparison.
 */
export function extractKeywords(goal: string): string[] {
  const stopwords = new Set(["the", "a", "an", "and", "or", "in", "on", "to", "for", "of", "is", "it", "be", "do", "this", "that", "with"]);
  return goal
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stopwords.has(w));
}

/**
 * Compute Jaccard similarity between two keyword sets.
 */
function jaccardSimilarity(a: string[], b: string[]): number {
  const setA = new Set(a);
  const setB = new Set(b);
  let intersection = 0;
  for (const w of setA) if (setB.has(w)) intersection++;
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Detect conflicts between goals of active sessions.
 */
export function detectGoalConflicts(goals: GoalInfo[], dependsOnMap?: Map<string, string[]>): GoalConflict[] {
  const conflicts: GoalConflict[] = [];

  for (let i = 0; i < goals.length; i++) {
    for (let j = i + 1; j < goals.length; j++) {
      const a = goals[i];
      const b = goals[j];

      // check goal keyword overlap
      const kwA = extractKeywords(a.goal);
      const kwB = extractKeywords(b.goal);
      const similarity = jaccardSimilarity(kwA, kwB);
      if (similarity > 0.4) {
        conflicts.push({
          sessionA: a.sessionTitle,
          sessionB: b.sessionTitle,
          conflictType: "goal-overlap",
          description: `${Math.round(similarity * 100)}% goal keyword overlap`,
          severity: similarity > 0.7 ? "high" : similarity > 0.5 ? "medium" : "low",
          suggestion: similarity > 0.6
            ? "Consider merging these into a single session or splitting goals more clearly"
            : "Monitor for duplicate work — goals have moderate overlap",
        });
      }

      // check file overlap (if file lists are available)
      if (a.files && b.files && a.files.length > 0 && b.files.length > 0) {
        const filesA = new Set(a.files);
        const sharedFiles = b.files.filter((f) => filesA.has(f));
        if (sharedFiles.length > 0) {
          conflicts.push({
            sessionA: a.sessionTitle,
            sessionB: b.sessionTitle,
            conflictType: "file-overlap",
            description: `${sharedFiles.length} shared file${sharedFiles.length !== 1 ? "s" : ""}: ${sharedFiles.slice(0, 3).join(", ")}`,
            severity: sharedFiles.length > 3 ? "high" : sharedFiles.length > 1 ? "medium" : "low",
            suggestion: "Pause the lower-priority session to avoid merge conflicts",
          });
        }
      }

      // check dependency cycles
      if (dependsOnMap) {
        const aDeps = dependsOnMap.get(a.sessionTitle) ?? [];
        const bDeps = dependsOnMap.get(b.sessionTitle) ?? [];
        if (aDeps.includes(b.sessionTitle) && bDeps.includes(a.sessionTitle)) {
          conflicts.push({
            sessionA: a.sessionTitle,
            sessionB: b.sessionTitle,
            conflictType: "dependency-cycle",
            description: `circular dependency: ${a.sessionTitle} ↔ ${b.sessionTitle}`,
            severity: "high",
            suggestion: "Break the cycle by removing one dependency direction",
          });
        }
      }
    }
  }

  return conflicts.sort((a, b) => {
    const sev = { high: 0, medium: 1, low: 2 };
    return sev[a.severity] - sev[b.severity];
  });
}

/**
 * Format goal conflicts for TUI display.
 */
export function formatGoalConflicts(conflicts: GoalConflict[]): string[] {
  if (conflicts.length === 0) return ["  Goal conflicts: none detected"];
  const lines: string[] = [];
  lines.push(`  Goal conflicts: ${conflicts.length} detected:`);
  for (const c of conflicts) {
    const icon = c.severity === "high" ? "🔴" : c.severity === "medium" ? "🟡" : "🟢";
    lines.push(`  ${icon} ${c.sessionA} ↔ ${c.sessionB} [${c.conflictType}]`);
    lines.push(`    ${c.description}`);
    lines.push(`    → ${c.suggestion}`);
  }
  return lines;
}
