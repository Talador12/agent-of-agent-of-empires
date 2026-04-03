// session-structured-log.ts — parse session output into structured events.
// identifies common patterns (test results, git operations, build outputs,
// errors, costs) and converts them into typed log entries.

export type LogEventType = "test-result" | "build-result" | "git-operation" | "error" | "cost-update" | "progress" | "prompt" | "unknown";

export interface StructuredLogEntry {
  type: LogEventType;
  timestamp: number;
  sessionTitle: string;
  rawLine: string;
  parsed: Record<string, string | number | boolean>;
}

const PARSERS: Array<{ type: LogEventType; pattern: RegExp; extract: (m: RegExpMatchArray) => Record<string, string | number | boolean> }> = [
  { type: "test-result", pattern: /(\d+)\s+(?:tests?|specs?)\s+pass/i, extract: (m) => ({ passed: parseInt(m[1]), status: "pass" }) },
  { type: "test-result", pattern: /(\d+)\s+(?:tests?|specs?)\s+fail/i, extract: (m) => ({ failed: parseInt(m[1]), status: "fail" }) },
  { type: "build-result", pattern: /build\s+(succeeded|successful|complete|failed|error)/i, extract: (m) => ({ status: m[1].toLowerCase().includes("fail") || m[1].toLowerCase().includes("error") ? "fail" : "pass" }) },
  { type: "git-operation", pattern: /(?:commit|push|merge|rebase|pull|checkout|branch)\s/i, extract: (m) => ({ operation: m[0].trim().toLowerCase() }) },
  { type: "error", pattern: /(ERROR|FATAL|FAIL|panic|exception|crash)[:.\s]/i, extract: (m) => ({ level: m[1].toUpperCase() }) },
  { type: "cost-update", pattern: /\$(\d+\.?\d*)/i, extract: (m) => ({ costUsd: parseFloat(m[1]) }) },
  { type: "progress", pattern: /(?:step|phase|stage)\s+(\d+)/i, extract: (m) => ({ step: parseInt(m[1]) }) },
  { type: "prompt", pattern: /(?:\?|permission|allow|approve|confirm)\s/i, extract: () => ({ needsInput: true }) },
];

/**
 * Parse a single output line into a structured log entry.
 */
export function parseLine(sessionTitle: string, line: string, now = Date.now()): StructuredLogEntry {
  const stripped = line.replace(/\x1b\[[0-9;]*[mABCDHJKST]/g, "");
  for (const parser of PARSERS) {
    const match = stripped.match(parser.pattern);
    if (match) {
      return { type: parser.type, timestamp: now, sessionTitle, rawLine: stripped.slice(0, 200), parsed: parser.extract(match) };
    }
  }
  return { type: "unknown", timestamp: now, sessionTitle, rawLine: stripped.slice(0, 200), parsed: {} };
}

/**
 * Parse multiple output lines.
 */
export function parseOutputLines(sessionTitle: string, lines: string[], now = Date.now()): StructuredLogEntry[] {
  return lines.map((l) => parseLine(sessionTitle, l, now));
}

/**
 * Filter to only recognized (non-unknown) entries.
 */
export function filterRecognized(entries: StructuredLogEntry[]): StructuredLogEntry[] {
  return entries.filter((e) => e.type !== "unknown");
}

/**
 * Get event type counts.
 */
export function eventTypeCounts(entries: StructuredLogEntry[]): Map<LogEventType, number> {
  const counts = new Map<LogEventType, number>();
  for (const e of entries) counts.set(e.type, (counts.get(e.type) ?? 0) + 1);
  return counts;
}

/**
 * Format structured log entries for TUI display.
 */
export function formatStructuredLog(entries: StructuredLogEntry[]): string[] {
  const recognized = filterRecognized(entries);
  if (recognized.length === 0) return ["  Structured log: no recognized patterns in output"];
  const lines: string[] = [];
  const counts = eventTypeCounts(recognized);
  const countStr = Array.from(counts.entries()).map(([t, c]) => `${t}:${c}`).join(" ");
  lines.push(`  Structured Log (${recognized.length} recognized events: ${countStr}):`);
  for (const e of recognized.slice(-10)) {
    const time = new Date(e.timestamp).toISOString().slice(11, 19);
    const parsed = Object.entries(e.parsed).map(([k, v]) => `${k}=${v}`).join(" ");
    lines.push(`    ${time} [${e.type}] ${parsed} — ${e.rawLine.slice(0, 50)}`);
  }
  return lines;
}
