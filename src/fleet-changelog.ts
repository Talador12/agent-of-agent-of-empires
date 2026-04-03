// fleet-changelog.ts — generate a human-readable changelog of fleet events
// since a given timestamp. useful for shift handoffs and status updates.

import { readRecentAuditEntries } from "./audit-trail.js";
import type { AuditEntry } from "./audit-trail.js";

export interface ChangelogEntry {
  time: string;
  summary: string;
}

/**
 * Generate a changelog from audit trail since a given time.
 */
export function generateChangelog(sinceMs: number, maxEntries = 50): ChangelogEntry[] {
  const entries = readRecentAuditEntries(5000);
  const recent = entries.filter((e) => new Date(e.timestamp).getTime() >= sinceMs);

  // deduplicate similar events within 1 minute
  const deduped: AuditEntry[] = [];
  let lastKey = "";
  for (const e of recent) {
    const key = `${e.type}-${e.session ?? ""}-${e.detail.slice(0, 30)}`;
    if (key !== lastKey) {
      deduped.push(e);
      lastKey = key;
    }
  }

  return deduped.slice(0, maxEntries).map((e) => ({
    time: e.timestamp.slice(11, 19),
    summary: `[${e.type}]${e.session ? ` ${e.session}:` : ""} ${e.detail.slice(0, 100)}`,
  }));
}

/**
 * Format changelog for TUI display.
 */
export function formatChangelog(entries: ChangelogEntry[], label = "recent"): string[] {
  if (entries.length === 0) return [`  Changelog (${label}): no events`];
  const lines: string[] = [];
  lines.push(`  Changelog (${label}, ${entries.length} events):`);
  for (const e of entries) {
    lines.push(`  ${e.time} ${e.summary}`);
  }
  return lines;
}
