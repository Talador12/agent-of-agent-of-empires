// session-context-budget.ts — minimize context tokens while maximizing
// relevance. scores context files by recency, size, and keyword match
// to the current goal, then selects files up to a token budget.

export interface ContextFile {
  path: string;
  sizeBytes: number;
  lastModifiedMs: number;
  content?: string; // loaded lazily
}

export interface BudgetAllocation {
  selectedFiles: ContextFile[];
  totalTokens: number;
  budgetTokens: number;
  droppedFiles: string[];
  utilizationPct: number;
}

export interface ScoredFile {
  file: ContextFile;
  relevanceScore: number;
  estimatedTokens: number;
}

/**
 * Estimate token count from bytes (rough: ~4 chars per token for code).
 */
export function estimateTokens(sizeBytes: number): number {
  return Math.ceil(sizeBytes / 4);
}

/**
 * Score a context file's relevance to a goal.
 */
export function scoreFileRelevance(file: ContextFile, goal: string, now = Date.now()): number {
  let score = 50; // base score

  // recency bonus (0-20): files modified recently are more relevant
  const ageHours = (now - file.lastModifiedMs) / 3_600_000;
  if (ageHours < 1) score += 20;
  else if (ageHours < 24) score += 15;
  else if (ageHours < 168) score += 10; // 1 week
  else score += 5;

  // filename match bonus (0-20): filename contains goal keywords
  const goalWords = goal.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  const basename = file.path.split("/").pop()?.toLowerCase() ?? "";
  const filenameMatches = goalWords.filter((w) => basename.includes(w)).length;
  score += Math.min(20, filenameMatches * 10);

  // important file bonus (0-10): AGENTS.md, claude.md, README get priority
  const importantPatterns = ["agents.md", "claude.md", "readme", "contributing", "codex.md"];
  if (importantPatterns.some((p) => basename.includes(p))) score += 10;

  // size penalty: very large files are less likely to be fully relevant
  const tokens = estimateTokens(file.sizeBytes);
  if (tokens > 5000) score -= 10;
  if (tokens > 10000) score -= 10;

  return Math.max(0, Math.min(100, score));
}

/**
 * Select context files within a token budget, maximizing relevance.
 */
export function allocateContextBudget(
  files: ContextFile[],
  goal: string,
  budgetTokens: number,
  now = Date.now(),
): BudgetAllocation {
  // score and estimate all files
  const scored: ScoredFile[] = files.map((f) => ({
    file: f,
    relevanceScore: scoreFileRelevance(f, goal, now),
    estimatedTokens: estimateTokens(f.sizeBytes),
  }));

  // sort by relevance descending
  scored.sort((a, b) => b.relevanceScore - a.relevanceScore);

  // greedy fill within budget
  const selected: ContextFile[] = [];
  const dropped: string[] = [];
  let totalTokens = 0;

  for (const s of scored) {
    if (totalTokens + s.estimatedTokens <= budgetTokens) {
      selected.push(s.file);
      totalTokens += s.estimatedTokens;
    } else {
      dropped.push(s.file.path);
    }
  }

  return {
    selectedFiles: selected,
    totalTokens,
    budgetTokens,
    droppedFiles: dropped,
    utilizationPct: budgetTokens > 0 ? Math.round((totalTokens / budgetTokens) * 100) : 0,
  };
}

/**
 * Format budget allocation for TUI display.
 */
export function formatContextBudget(allocation: BudgetAllocation): string[] {
  const lines: string[] = [];
  lines.push(`  Context Budget (${allocation.totalTokens}/${allocation.budgetTokens} tokens, ${allocation.utilizationPct}% utilized):`);
  lines.push(`    Selected: ${allocation.selectedFiles.length} files`);
  for (const f of allocation.selectedFiles.slice(0, 8)) {
    const basename = f.path.split("/").pop() ?? f.path;
    const tokens = estimateTokens(f.sizeBytes);
    lines.push(`      ✓ ${basename} (~${tokens} tokens)`);
  }
  if (allocation.droppedFiles.length > 0) {
    lines.push(`    Dropped: ${allocation.droppedFiles.length} files (over budget)`);
    for (const p of allocation.droppedFiles.slice(0, 3)) {
      const basename = p.split("/").pop() ?? p;
      lines.push(`      ✗ ${basename}`);
    }
  }
  return lines;
}
