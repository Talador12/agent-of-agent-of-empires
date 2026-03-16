// export.ts — pure functions for exporting session timelines as JSON or Markdown
// reads actions.log (JSONL) and tui-history.jsonl, merges into a unified timeline

import { toActionLogEntry } from "./types.js";
import type { HistoryEntry } from "./tui-history.js";

// ── types ───────────────────────────────────────────────────────────────────

export interface TimelineEntry {
  ts: number;                           // epoch ms
  source: "action" | "activity";        // which log produced this
  tag: string;                          // action type or activity tag
  text: string;                         // detail / message
  success?: boolean;                    // action entries only
  session?: string;                     // action entries only
}

// ── parsers ─────────────────────────────────────────────────────────────────

// parse actions.log JSONL lines into timeline entries
export function parseActionLogEntries(lines: string[]): TimelineEntry[] {
  const entries: TimelineEntry[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const entry = toActionLogEntry(JSON.parse(line));
      if (!entry) continue;
      // skip wait actions (noise in post-mortems)
      if (entry.action.action === "wait") continue;
      entries.push({
        ts: entry.timestamp,
        source: "action",
        tag: entry.action.action,
        text: entry.detail || `${entry.action.action} on ${entry.action.session ?? "unknown"}`,
        success: entry.success,
        session: entry.action.session ?? entry.action.title,
      });
    } catch {
      // skip malformed lines
    }
  }
  return entries;
}

// convert tui-history entries into timeline entries
export function parseActivityEntries(entries: HistoryEntry[]): TimelineEntry[] {
  return entries.map((e) => ({
    ts: e.ts,
    source: "activity" as const,
    tag: e.tag,
    text: e.text,
  }));
}

// ── merge + filter ──────────────────────────────────────────────────────────

// merge multiple sources into a single chronological timeline
export function mergeTimeline(...sources: TimelineEntry[][]): TimelineEntry[] {
  const all = sources.flat();
  all.sort((a, b) => a.ts - b.ts);
  return all;
}

// filter entries by time window (keep entries newer than cutoff)
export function filterByAge(entries: TimelineEntry[], maxAgeMs: number, now = Date.now()): TimelineEntry[] {
  const cutoff = now - maxAgeMs;
  return entries.filter((e) => e.ts >= cutoff);
}

// ── duration parser ─────────────────────────────────────────────────────────

// parse human-friendly duration strings: "1h", "6h", "24h", "2d", "7d", "30d"
export function parseDuration(input: string): number | null {
  const match = input.match(/^(\d+)(h|d)$/);
  if (!match) return null;
  const val = parseInt(match[1], 10);
  if (val <= 0) return null;
  const unit = match[2];
  if (unit === "h") return val * 60 * 60 * 1000;
  if (unit === "d") return val * 24 * 60 * 60 * 1000;
  return null;
}

// ── formatters ──────────────────────────────────────────────────────────────

// format timeline as pretty-printed JSON
export function formatTimelineJson(entries: TimelineEntry[]): string {
  const output = entries.map((e) => {
    const obj: Record<string, unknown> = {
      time: new Date(e.ts).toISOString(),
      source: e.source,
      tag: e.tag,
      text: e.text,
    };
    if (e.success !== undefined) obj.success = e.success;
    if (e.session) obj.session = e.session;
    return obj;
  });
  return JSON.stringify(output, null, 2) + "\n";
}

// format timeline as a readable Markdown post-mortem document
export function formatTimelineMarkdown(entries: TimelineEntry[]): string {
  if (entries.length === 0) {
    return "# aoaoe Session Export\n\n_No entries in the selected time range._\n";
  }

  const lines: string[] = [];
  const now = new Date();
  const first = new Date(entries[0].ts);
  const last = new Date(entries[entries.length - 1].ts);

  lines.push("# aoaoe Session Export");
  lines.push("");
  lines.push(`**Generated**: ${now.toISOString()}`);
  lines.push(`**Range**: ${first.toISOString()} — ${last.toISOString()}`);
  lines.push(`**Entries**: ${entries.length}`);
  lines.push("");
  lines.push("## Timeline");
  lines.push("");

  // group entries by hour
  let currentHour = "";
  for (const entry of entries) {
    const d = new Date(entry.ts);
    const hour = d.toLocaleString("en-US", {
      month: "short", day: "numeric", hour: "numeric", minute: undefined, hour12: true,
    }).replace(/:00/, "");
    // simpler: just use HH:00 block headers
    const hourKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:00`;

    if (hourKey !== currentHour) {
      if (currentHour) lines.push("");
      lines.push(`### ${hourKey}`);
      lines.push("");
      currentHour = hourKey;
    }

    const time = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
    const icon = entry.source === "action"
      ? (entry.success ? "+" : "!")
      : "·";
    const sessionPart = entry.session ? ` → ${entry.session}` : "";
    const text = entry.text.length > 120 ? entry.text.slice(0, 117) + "..." : entry.text;
    lines.push(`- \`${time}\` ${icon} **${entry.tag}**${sessionPart}: ${text}`);
  }

  lines.push("");
  return lines.join("\n");
}
