// smart-session-naming.ts — auto-generate descriptive session titles from
// repo path and goal analysis. extracts meaningful fragments from the repo
// name, goal keywords, and task type to produce short, memorable titles.

export interface NameSuggestion {
  title: string;
  source: string; // explanation of where the name came from
  confidence: "high" | "medium" | "low";
}

/**
 * Extract the repo basename from a path, stripping common prefixes.
 */
export function extractRepoName(repoPath: string): string {
  const parts = repoPath.replace(/\\/g, "/").split("/").filter(Boolean);
  // take last meaningful segment
  const name = parts.length > 0 ? parts[parts.length - 1] : "unknown";
  // strip common suffixes
  return name.replace(/\.(git|repo)$/, "").replace(/-main$/, "").replace(/-master$/, "");
}

/**
 * Extract action verbs and key nouns from a goal string.
 */
export function extractGoalTokens(goal: string): { verbs: string[]; nouns: string[] } {
  const actionVerbs = new Set(["add", "fix", "build", "implement", "create", "update", "refactor", "migrate", "deploy", "test", "optimize", "remove", "upgrade", "configure", "setup", "integrate", "design", "write", "enable", "disable"]);
  const stopwords = new Set(["the", "a", "an", "and", "or", "in", "on", "to", "for", "of", "is", "it", "be", "do", "this", "that", "with", "from", "by", "at", "as", "all", "each", "every", "any", "should", "must", "will", "can", "has", "have", "its", "our", "their"]);

  const words = goal.toLowerCase().replace(/[^a-z0-9\s-]/g, "").split(/\s+/).filter((w) => w.length > 1);
  const verbs = words.filter((w) => actionVerbs.has(w));
  const nouns = words.filter((w) => !actionVerbs.has(w) && !stopwords.has(w) && w.length > 2);

  return { verbs: [...new Set(verbs)], nouns: [...new Set(nouns)] };
}

/**
 * Generate session name suggestions from repo path and goal.
 */
export function suggestSessionNames(repoPath: string, goal: string, existingTitles: string[] = []): NameSuggestion[] {
  const repoName = extractRepoName(repoPath);
  const { verbs, nouns } = extractGoalTokens(goal);
  const existing = new Set(existingTitles.map((t) => t.toLowerCase()));
  const suggestions: NameSuggestion[] = [];

  // strategy 1: repo-verb (e.g. "adventure-fix" or "aoaoe-refactor")
  if (verbs.length > 0) {
    const title = `${repoName}-${verbs[0]}`;
    if (!existing.has(title.toLowerCase())) {
      suggestions.push({ title, source: `repo + action verb "${verbs[0]}"`, confidence: "high" });
    }
  }

  // strategy 2: repo-noun (e.g. "adventure-auth" or "aoaoe-metrics")
  if (nouns.length > 0) {
    const title = `${repoName}-${nouns[0]}`;
    if (!existing.has(title.toLowerCase())) {
      suggestions.push({ title, source: `repo + key noun "${nouns[0]}"`, confidence: "high" });
    }
  }

  // strategy 3: verb-noun (e.g. "fix-auth" or "add-metrics")
  if (verbs.length > 0 && nouns.length > 0) {
    const title = `${verbs[0]}-${nouns[0]}`;
    if (!existing.has(title.toLowerCase())) {
      suggestions.push({ title, source: `action "${verbs[0]}" + target "${nouns[0]}"`, confidence: "medium" });
    }
  }

  // strategy 4: repo-verb-noun (e.g. "adventure-add-auth")
  if (verbs.length > 0 && nouns.length > 0) {
    const title = `${repoName}-${verbs[0]}-${nouns[0]}`.slice(0, 24);
    if (!existing.has(title.toLowerCase())) {
      suggestions.push({ title, source: `repo + verb + noun`, confidence: "medium" });
    }
  }

  // strategy 5: just repo name if nothing else works
  if (suggestions.length === 0) {
    const fallback = repoName.slice(0, 20);
    if (!existing.has(fallback.toLowerCase())) {
      suggestions.push({ title: fallback, source: "repo basename fallback", confidence: "low" });
    } else {
      // add a numeric suffix
      for (let i = 2; i <= 10; i++) {
        const numbered = `${fallback}-${i}`;
        if (!existing.has(numbered.toLowerCase())) {
          suggestions.push({ title: numbered, source: `repo basename + counter`, confidence: "low" });
          break;
        }
      }
    }
  }

  return suggestions;
}

/**
 * Format name suggestions for TUI display.
 */
export function formatNameSuggestions(suggestions: NameSuggestion[]): string[] {
  if (suggestions.length === 0) return ["  Smart naming: no suggestions available"];
  const lines: string[] = [];
  lines.push(`  Session Name Suggestions (${suggestions.length}):`);
  for (const s of suggestions) {
    const conf = s.confidence === "high" ? "●" : s.confidence === "medium" ? "◐" : "○";
    lines.push(`  ${conf} "${s.title}" — ${s.source}`);
  }
  return lines;
}
