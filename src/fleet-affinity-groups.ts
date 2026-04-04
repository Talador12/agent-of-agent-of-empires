// fleet-affinity-groups.ts — auto-group sessions by repo similarity.
// sessions working on the same or related repos are grouped together
// for coordinated scheduling and conflict awareness.

export interface AffinityGroup {
  name: string;
  sessions: string[];
  commonRepo: string;
  similarity: number; // 0-100, how similar the repos are
}

export interface SessionRepoInfo {
  sessionTitle: string;
  repo: string;
}

/**
 * Extract repo basename for comparison.
 */
function repoBasename(repo: string): string {
  return repo.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? repo;
}

/**
 * Extract repo path segments for overlap comparison.
 */
function repoSegments(repo: string): string[] {
  return repo.replace(/\\/g, "/").split("/").filter((s) => s.length > 0);
}

/**
 * Compute similarity between two repo paths (0-100).
 */
export function repoSimilarity(a: string, b: string): number {
  if (a === b) return 100;
  const segsA = repoSegments(a);
  const segsB = repoSegments(b);
  if (segsA.length === 0 || segsB.length === 0) return 0;

  // same basename = high similarity
  if (repoBasename(a) === repoBasename(b)) return 90;

  // count shared prefix segments
  const minLen = Math.min(segsA.length, segsB.length);
  let shared = 0;
  for (let i = 0; i < minLen; i++) {
    if (segsA[i] === segsB[i]) shared++;
    else break;
  }

  if (shared === 0) return 0;
  return Math.round((shared / Math.max(segsA.length, segsB.length)) * 80);
}

/**
 * Auto-group sessions by repo affinity.
 */
export function computeAffinityGroups(sessions: SessionRepoInfo[], threshold = 50): AffinityGroup[] {
  if (sessions.length === 0) return [];

  const groups: AffinityGroup[] = [];
  const assigned = new Set<string>();

  for (let i = 0; i < sessions.length; i++) {
    if (assigned.has(sessions[i].sessionTitle)) continue;

    const group: string[] = [sessions[i].sessionTitle];
    assigned.add(sessions[i].sessionTitle);

    for (let j = i + 1; j < sessions.length; j++) {
      if (assigned.has(sessions[j].sessionTitle)) continue;
      const sim = repoSimilarity(sessions[i].repo, sessions[j].repo);
      if (sim >= threshold) {
        group.push(sessions[j].sessionTitle);
        assigned.add(sessions[j].sessionTitle);
      }
    }

    if (group.length >= 2) {
      const baseName = repoBasename(sessions[i].repo);
      groups.push({
        name: baseName,
        sessions: group,
        commonRepo: sessions[i].repo,
        similarity: 100, // group anchor similarity
      });
    }
  }

  return groups.sort((a, b) => b.sessions.length - a.sessions.length);
}

/**
 * Format affinity groups for TUI display.
 */
export function formatAffinityGroups(groups: AffinityGroup[]): string[] {
  if (groups.length === 0) return ["  Affinity Groups: no related sessions detected"];
  const lines: string[] = [];
  lines.push(`  Affinity Groups (${groups.length} groups):`);
  for (const g of groups) {
    lines.push(`    ${g.name} (${g.sessions.length} sessions): ${g.sessions.join(", ")}`);
    lines.push(`      repo: ${g.commonRepo}`);
  }
  return lines;
}
