// audit-search.ts — search and filter audit trail entries by type, session,
// time range, and keyword. builds on audit-trail.ts for the read layer.

import { readRecentAuditEntries } from "./audit-trail.js";
import type { AuditEntry, AuditEventType } from "./audit-trail.js";

export interface AuditSearchQuery {
  type?: AuditEventType;           // filter by event type
  session?: string;                // filter by session title (case-insensitive substring)
  keyword?: string;                // search detail text (case-insensitive substring)
  afterMs?: number;                // entries after this timestamp
  beforeMs?: number;               // entries before this timestamp
  limit?: number;                  // max results (default 50)
}

/**
 * Search audit trail entries with multiple filter criteria.
 * All filters are AND-ed — entries must match all specified criteria.
 */
export function searchAuditTrail(query: AuditSearchQuery): AuditEntry[] {
  // load a generous window for filtering (10k entries max)
  const all = readRecentAuditEntries(10_000);
  const limit = query.limit ?? 50;
  const results: AuditEntry[] = [];

  for (const entry of all) {
    if (query.type && entry.type !== query.type) continue;

    if (query.session) {
      const needle = query.session.toLowerCase();
      if (!entry.session?.toLowerCase().includes(needle)) continue;
    }

    if (query.keyword) {
      const needle = query.keyword.toLowerCase();
      if (!entry.detail.toLowerCase().includes(needle)) continue;
    }

    if (query.afterMs) {
      const entryMs = new Date(entry.timestamp).getTime();
      if (entryMs < query.afterMs) continue;
    }

    if (query.beforeMs) {
      const entryMs = new Date(entry.timestamp).getTime();
      if (entryMs > query.beforeMs) continue;
    }

    results.push(entry);
    if (results.length >= limit) break;
  }

  return results;
}

/**
 * Parse a search query string into an AuditSearchQuery.
 * Supports: `type:auto_complete session:adventure keyword:budget last:1h limit:20`
 */
export function parseAuditSearchQuery(input: string): AuditSearchQuery {
  const query: AuditSearchQuery = {};
  const tokens = input.split(/\s+/).filter(Boolean);

  for (const token of tokens) {
    const [key, ...valueParts] = token.split(":");
    const value = valueParts.join(":"); // rejoin in case value has colons

    switch (key.toLowerCase()) {
      case "type":
        query.type = value as AuditEventType;
        break;
      case "session":
        query.session = value;
        break;
      case "keyword":
      case "text":
        query.keyword = value;
        break;
      case "limit":
        query.limit = parseInt(value, 10) || 50;
        break;
      case "last": {
        const ms = parseDurationToMs(value);
        if (ms > 0) query.afterMs = Date.now() - ms;
        break;
      }
      case "before": {
        const ms = parseDurationToMs(value);
        if (ms > 0) query.beforeMs = Date.now() - ms;
        break;
      }
      default:
        // treat bare tokens as keyword search
        if (!query.keyword) query.keyword = token;
        else query.keyword += " " + token;
        break;
    }
  }

  return query;
}

/**
 * Format search results for TUI display.
 */
export function formatAuditSearchResults(results: AuditEntry[], queryStr: string): string[] {
  if (results.length === 0) return [`  audit-search: no results for "${queryStr}"`];
  const lines: string[] = [];
  lines.push(`  audit-search: ${results.length} result${results.length !== 1 ? "s" : ""} for "${queryStr}":`);
  for (const e of results) {
    const time = e.timestamp.slice(11, 19);
    const session = e.session ? ` [${e.session}]` : "";
    const detail = e.detail.length > 80 ? e.detail.slice(0, 77) + "..." : e.detail;
    lines.push(`  ${time} ${e.type}${session} ${detail}`);
  }
  return lines;
}

function parseDurationToMs(s: string): number {
  const match = s.match(/^(\d+)(s|m|h|d)$/);
  if (!match) return 0;
  const n = parseInt(match[1], 10);
  switch (match[2]) {
    case "s": return n * 1000;
    case "m": return n * 60_000;
    case "h": return n * 3_600_000;
    case "d": return n * 86_400_000;
    default: return 0;
  }
}
