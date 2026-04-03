// goal-similarity.ts — detect sessions with overlapping goals for coordination.
// uses Jaccard similarity on keyword sets to find related tasks.

import { extractKeywords } from "./drift-detector.js";
import type { TaskState } from "./types.js";

export interface SimilarityPair {
  titleA: string;
  titleB: string;
  similarity: number;   // 0.0-1.0
  sharedKeywords: string[];
}

/**
 * Compute Jaccard similarity between two keyword sets.
 */
export function jaccardSimilarity(setA: Set<string>, setB: Set<string>): number {
  if (setA.size === 0 && setB.size === 0) return 0;
  let intersection = 0;
  for (const w of setA) if (setB.has(w)) intersection++;
  const union = setA.size + setB.size - intersection;
  return union > 0 ? intersection / union : 0;
}

/**
 * Find pairs of tasks with similar goals.
 */
export function findSimilarGoals(tasks: readonly TaskState[], threshold = 0.3): SimilarityPair[] {
  const keywordSets = tasks.map((t) => ({
    title: t.sessionTitle,
    keywords: new Set(extractKeywords(t.goal)),
  }));

  const pairs: SimilarityPair[] = [];
  for (let i = 0; i < keywordSets.length; i++) {
    for (let j = i + 1; j < keywordSets.length; j++) {
      const sim = jaccardSimilarity(keywordSets[i].keywords, keywordSets[j].keywords);
      if (sim >= threshold) {
        const shared = [...keywordSets[i].keywords].filter((w) => keywordSets[j].keywords.has(w));
        pairs.push({
          titleA: keywordSets[i].title,
          titleB: keywordSets[j].title,
          similarity: Math.round(sim * 100) / 100,
          sharedKeywords: shared,
        });
      }
    }
  }

  return pairs.sort((a, b) => b.similarity - a.similarity);
}

/**
 * Format similarity pairs for TUI display.
 */
export function formatSimilarGoals(pairs: SimilarityPair[]): string[] {
  if (pairs.length === 0) return ["  (no similar goals detected)"];
  const lines: string[] = [];
  lines.push(`  Similar goals (${pairs.length} pair${pairs.length !== 1 ? "s" : ""}):`);
  for (const p of pairs) {
    lines.push(`  ${Math.round(p.similarity * 100)}% — "${p.titleA}" ↔ "${p.titleB}" [${p.sharedKeywords.join(", ")}]`);
  }
  return lines;
}
