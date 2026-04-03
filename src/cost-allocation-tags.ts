// cost-allocation-tags.ts — label sessions by team/project for cost attribution.
// tags are key-value pairs attached to sessions, used to group costs in reports.

export interface CostTag {
  key: string;
  value: string;
}

export interface TaggedSession {
  sessionTitle: string;
  tags: CostTag[];
  costUsd: number;
}

export interface TagReport {
  tagKey: string;
  groups: Array<{ value: string; sessions: number; totalCostUsd: number }>;
}

/**
 * Group sessions by a tag key and sum costs.
 */
export function groupByTag(sessions: TaggedSession[], tagKey: string): TagReport {
  const groups = new Map<string, { sessions: number; totalCostUsd: number }>();

  for (const s of sessions) {
    const tag = s.tags.find((t) => t.key === tagKey);
    const value = tag?.value ?? "(untagged)";
    const group = groups.get(value) ?? { sessions: 0, totalCostUsd: 0 };
    group.sessions++;
    group.totalCostUsd += s.costUsd;
    groups.set(value, group);
  }

  return {
    tagKey,
    groups: [...groups.entries()]
      .map(([value, g]) => ({ value, ...g }))
      .sort((a, b) => b.totalCostUsd - a.totalCostUsd),
  };
}

/**
 * Format tag report for TUI display.
 */
export function formatTagReport(report: TagReport): string[] {
  if (report.groups.length === 0) return [`  (no sessions tagged with "${report.tagKey}")`];
  const lines: string[] = [];
  lines.push(`  Cost by ${report.tagKey}:`);
  for (const g of report.groups) {
    lines.push(`  ${g.value.padEnd(20)} ${g.sessions} session${g.sessions !== 1 ? "s" : ""}  $${g.totalCostUsd.toFixed(2)}`);
  }
  return lines;
}

/**
 * Parse tags from a config string: "team=platform,project=aoaoe"
 */
export function parseTags(tagStr: string): CostTag[] {
  if (!tagStr) return [];
  return tagStr.split(",").map((pair) => {
    const [key, ...rest] = pair.split("=");
    return { key: key.trim(), value: rest.join("=").trim() };
  }).filter((t) => t.key && t.value);
}
