// cross-session-knowledge.ts — share learnings between sessions.
// captures reusable insights (errors solved, patterns found, commands that work)
// and makes them available to other sessions working on related repos/goals.
// zero dependencies.

/** a captured knowledge entry */
export interface KnowledgeEntry {
  id: string;
  sourceSession: string;
  sourceRepo?: string;
  category: KnowledgeCategory;
  summary: string;
  detail?: string;
  tags: string[];
  createdAt: number;
  usedBy: string[];           // sessions that consumed this knowledge
  useCount: number;
}

export type KnowledgeCategory =
  | "error-fix"               // solved an error
  | "pattern"                 // discovered a useful pattern
  | "command"                 // useful command or workflow
  | "config"                  // configuration that works
  | "dependency"              // dependency info (versions, conflicts)
  | "testing"                 // test strategies or fixes
  | "performance"             // performance insights
  | "general";                // other

/** knowledge store state */
export interface KnowledgeStore {
  entries: KnowledgeEntry[];
  maxEntries: number;
  nextId: number;
}

/** search criteria */
export interface KnowledgeQuery {
  category?: KnowledgeCategory;
  tags?: string[];
  repo?: string;
  keyword?: string;
  limit?: number;
}

/** create a new knowledge store */
export function createKnowledgeStore(maxEntries = 500): KnowledgeStore {
  return { entries: [], maxEntries, nextId: 1 };
}

/** add a knowledge entry */
export function addKnowledge(
  store: KnowledgeStore,
  entry: Omit<KnowledgeEntry, "id" | "createdAt" | "usedBy" | "useCount">,
  now = Date.now(),
): KnowledgeEntry {
  const knowledge: KnowledgeEntry = {
    ...entry,
    id: `k-${store.nextId++}`,
    createdAt: now,
    usedBy: [],
    useCount: 0,
  };
  store.entries.push(knowledge);

  // evict oldest if over capacity
  if (store.entries.length > store.maxEntries) {
    // keep most-used and most-recent; evict least-used oldest
    store.entries.sort((a, b) => {
      if (a.useCount !== b.useCount) return b.useCount - a.useCount;
      return b.createdAt - a.createdAt;
    });
    store.entries = store.entries.slice(0, store.maxEntries);
  }

  return knowledge;
}

/** record that a session consumed a knowledge entry */
export function recordUsage(store: KnowledgeStore, knowledgeId: string, sessionTitle: string): boolean {
  const entry = store.entries.find((e) => e.id === knowledgeId);
  if (!entry) return false;
  entry.useCount++;
  if (!entry.usedBy.includes(sessionTitle)) {
    entry.usedBy.push(sessionTitle);
  }
  return true;
}

/** search for relevant knowledge */
export function searchKnowledge(store: KnowledgeStore, query: KnowledgeQuery): KnowledgeEntry[] {
  let results = [...store.entries];

  if (query.category) {
    results = results.filter((e) => e.category === query.category);
  }

  if (query.tags && query.tags.length > 0) {
    const queryTags = new Set(query.tags.map((t) => t.toLowerCase()));
    results = results.filter((e) => e.tags.some((t) => queryTags.has(t.toLowerCase())));
  }

  if (query.repo) {
    const repoLower = query.repo.toLowerCase();
    results = results.filter((e) => e.sourceRepo?.toLowerCase().includes(repoLower));
  }

  if (query.keyword) {
    const kw = query.keyword.toLowerCase();
    results = results.filter(
      (e) =>
        e.summary.toLowerCase().includes(kw) ||
        (e.detail?.toLowerCase().includes(kw) ?? false) ||
        e.tags.some((t) => t.toLowerCase().includes(kw)),
    );
  }

  // sort by relevance: use count desc, then recency
  results.sort((a, b) => {
    if (a.useCount !== b.useCount) return b.useCount - a.useCount;
    return b.createdAt - a.createdAt;
  });

  return results.slice(0, query.limit ?? 20);
}

/** find knowledge relevant to a session (by repo + goal keywords) */
export function findRelevant(
  store: KnowledgeStore,
  sessionTitle: string,
  repo?: string,
  goalKeywords?: string[],
  limit = 5,
): KnowledgeEntry[] {
  // combine repo match + keyword match, dedupe, rank
  const candidates = new Map<string, { entry: KnowledgeEntry; score: number }>();

  for (const entry of store.entries) {
    // skip self-sourced
    if (entry.sourceSession === sessionTitle) continue;

    let score = 0;

    // repo match
    if (repo && entry.sourceRepo) {
      if (entry.sourceRepo === repo) score += 20;
      else if (entry.sourceRepo.split("/").pop() === repo.split("/").pop()) score += 10;
    }

    // keyword match
    if (goalKeywords) {
      for (const kw of goalKeywords) {
        const kwLower = kw.toLowerCase();
        if (entry.summary.toLowerCase().includes(kwLower)) score += 5;
        if (entry.tags.some((t) => t.toLowerCase().includes(kwLower))) score += 3;
      }
    }

    // popularity bonus
    score += Math.min(10, entry.useCount * 2);

    if (score > 0) {
      candidates.set(entry.id, { entry, score });
    }
  }

  return [...candidates.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((c) => c.entry);
}

/** format knowledge store for TUI display */
export function formatKnowledgeStore(store: KnowledgeStore): string[] {
  const lines: string[] = [];
  lines.push(`knowledge store: ${store.entries.length}/${store.maxEntries} entries`);

  // category breakdown
  const byCat = new Map<string, number>();
  for (const e of store.entries) byCat.set(e.category, (byCat.get(e.category) ?? 0) + 1);
  if (byCat.size > 0) {
    const cats = [...byCat.entries()].sort((a, b) => b[1] - a[1]);
    lines.push(`  categories: ${cats.map(([c, n]) => `${c}(${n})`).join(", ")}`);
  }

  // total usage
  const totalUses = store.entries.reduce((sum, e) => sum + e.useCount, 0);
  const uniqueConsumers = new Set(store.entries.flatMap((e) => e.usedBy)).size;
  lines.push(`  total uses: ${totalUses} across ${uniqueConsumers} sessions`);

  // most popular
  const popular = [...store.entries].sort((a, b) => b.useCount - a.useCount).slice(0, 3);
  if (popular.length > 0 && popular[0].useCount > 0) {
    lines.push("  most used:");
    for (const e of popular) {
      if (e.useCount === 0) break;
      lines.push(`    [${e.category}] ${e.summary} (${e.useCount} uses)`);
    }
  }

  // most recent
  const recent = [...store.entries].sort((a, b) => b.createdAt - a.createdAt).slice(0, 3);
  if (recent.length > 0) {
    lines.push("  recent:");
    for (const e of recent) {
      lines.push(`    [${e.category}] ${e.summary} (from ${e.sourceSession})`);
    }
  }

  return lines;
}
