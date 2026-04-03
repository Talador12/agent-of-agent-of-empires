// session-dep-auto-detect.ts — infer inter-session dependencies from
// repo path overlap, shared file edits, and goal keyword analysis.
// produces a dependency graph that the scheduler can use for ordering.

export interface DetectedDependency {
  from: string;     // session title (depends on)
  to: string;       // session title (depended upon)
  reason: string;   // why we think this dependency exists
  confidence: "high" | "medium" | "low";
  type: "repo-overlap" | "file-overlap" | "goal-reference" | "explicit";
}

export interface SessionInfo {
  title: string;
  repo: string;
  goal: string;
  recentFiles?: string[];   // recently edited files
  dependsOn?: string[];     // explicitly declared deps
}

/**
 * Extract meaningful path segments from a repo path for comparison.
 */
function repoSegments(repo: string): string[] {
  return repo.replace(/\\/g, "/").split("/").filter((s) => s.length > 0 && s !== "." && s !== "..");
}

/**
 * Check if two repos share a common root (same project, different subdirs).
 */
function reposOverlap(a: string, b: string): boolean {
  const segA = repoSegments(a);
  const segB = repoSegments(b);
  if (segA.length === 0 || segB.length === 0) return false;
  // same repo if last segment matches, or one is a prefix of the other
  if (segA[segA.length - 1] === segB[segB.length - 1]) return true;
  const minLen = Math.min(segA.length, segB.length);
  let shared = 0;
  for (let i = 0; i < minLen; i++) {
    if (segA[i] === segB[i]) shared++;
    else break;
  }
  return shared >= Math.max(1, minLen - 1); // most segments match
}

/**
 * Check if a goal references another session by title.
 */
function goalReferencesSession(goal: string, sessionTitle: string): boolean {
  const normalized = goal.toLowerCase();
  const titleLower = sessionTitle.toLowerCase();
  // direct mention or common patterns like "after <title>", "depends on <title>", "wait for <title>"
  return normalized.includes(titleLower) ||
    normalized.includes(`after ${titleLower}`) ||
    normalized.includes(`depends on ${titleLower}`) ||
    normalized.includes(`wait for ${titleLower}`) ||
    normalized.includes(`blocked by ${titleLower}`);
}

/**
 * Auto-detect dependencies between sessions.
 */
export function detectDependencies(sessions: SessionInfo[]): DetectedDependency[] {
  const deps: DetectedDependency[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < sessions.length; i++) {
    const a = sessions[i];

    // explicit dependencies first
    if (a.dependsOn) {
      for (const depTitle of a.dependsOn) {
        const key = `${a.title}->${depTitle}:explicit`;
        if (!seen.has(key)) {
          deps.push({ from: a.title, to: depTitle, reason: "explicitly declared", confidence: "high", type: "explicit" });
          seen.add(key);
        }
      }
    }

    for (let j = i + 1; j < sessions.length; j++) {
      const b = sessions[j];

      // goal references
      if (goalReferencesSession(a.goal, b.title)) {
        const key = `${a.title}->${b.title}:goal`;
        if (!seen.has(key)) {
          deps.push({ from: a.title, to: b.title, reason: `goal mentions "${b.title}"`, confidence: "medium", type: "goal-reference" });
          seen.add(key);
        }
      }
      if (goalReferencesSession(b.goal, a.title)) {
        const key = `${b.title}->${a.title}:goal`;
        if (!seen.has(key)) {
          deps.push({ from: b.title, to: a.title, reason: `goal mentions "${a.title}"`, confidence: "medium", type: "goal-reference" });
          seen.add(key);
        }
      }

      // file overlap — shared recently edited files imply coordination needed
      if (a.recentFiles && b.recentFiles && a.recentFiles.length > 0 && b.recentFiles.length > 0) {
        const filesA = new Set(a.recentFiles);
        const shared = b.recentFiles.filter((f) => filesA.has(f));
        if (shared.length > 0) {
          const key = `${a.title}<->${b.title}:file`;
          if (!seen.has(key)) {
            deps.push({
              from: a.title, to: b.title,
              reason: `${shared.length} shared file${shared.length !== 1 ? "s" : ""}: ${shared.slice(0, 3).join(", ")}`,
              confidence: shared.length > 2 ? "high" : "medium",
              type: "file-overlap",
            });
            seen.add(key);
          }
        }
      }

      // repo overlap — same repo suggests coordination
      if (reposOverlap(a.repo, b.repo) && a.repo !== b.repo) {
        const key = `${a.title}<->${b.title}:repo`;
        if (!seen.has(key)) {
          deps.push({ from: a.title, to: b.title, reason: `related repos: ${a.repo} / ${b.repo}`, confidence: "low", type: "repo-overlap" });
          seen.add(key);
        }
      }
    }
  }

  return deps.sort((a, b) => {
    const conf = { high: 0, medium: 1, low: 2 };
    return conf[a.confidence] - conf[b.confidence];
  });
}

/**
 * Format detected dependencies for TUI display.
 */
export function formatDetectedDeps(deps: DetectedDependency[]): string[] {
  if (deps.length === 0) return ["  Auto-detect deps: no dependencies found"];
  const lines: string[] = [];
  lines.push(`  Auto-detected Dependencies (${deps.length}):`);
  for (const d of deps) {
    const conf = d.confidence === "high" ? "●" : d.confidence === "medium" ? "◐" : "○";
    const arrow = d.type === "file-overlap" || d.type === "repo-overlap" ? "↔" : "→";
    lines.push(`  ${conf} ${d.from} ${arrow} ${d.to} [${d.type}]`);
    lines.push(`    ${d.reason}`);
  }
  return lines;
}
