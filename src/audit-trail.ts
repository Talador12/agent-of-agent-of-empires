// audit-trail.ts — structured audit log of all daemon decisions.
// records every reasoner action, auto-completion, budget enforcement,
// conflict detection, and operator command as a JSONL trail for
// compliance, debugging, and post-mortem analysis.

import { appendFileSync, mkdirSync, existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const AOAOE_DIR = join(homedir(), ".aoaoe");
const AUDIT_FILE = join(AOAOE_DIR, "audit-trail.jsonl");
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB rotation threshold

export type AuditEventType =
  | "reasoner_action"    // action decided by the reasoner
  | "auto_complete"      // goal completion auto-detected
  | "budget_pause"       // session paused for budget exceed
  | "conflict_detected"  // cross-session file conflict
  | "operator_command"   // human operator slash command
  | "task_created"       // new task definition added
  | "task_completed"     // task marked complete
  | "session_error"      // session entered error state
  | "session_restart"    // session restarted (OOM, stuck, etc.)
  | "config_change"      // config hot-reloaded
  | "stuck_nudge"        // stuck session nudged
  | "daemon_start"       // daemon started
  | "daemon_stop"        // daemon stopped
  | "model_enforcement"; // default model enforced on session

export interface AuditEntry {
  timestamp: string;   // ISO 8601
  type: AuditEventType;
  session?: string;    // session title (if applicable)
  detail: string;      // human-readable description
  data?: Record<string, unknown>; // structured metadata
}

/** Append an audit entry to the trail file. */
export function appendAuditEntry(entry: AuditEntry): void {
  try {
    mkdirSync(AOAOE_DIR, { recursive: true });
    rotateIfNeeded();
    appendFileSync(AUDIT_FILE, JSON.stringify(entry) + "\n");
  } catch {
    // best-effort — never crash the daemon for audit logging
  }
}

/** Create and append an audit entry in one call. */
export function audit(
  type: AuditEventType,
  detail: string,
  session?: string,
  data?: Record<string, unknown>,
): void {
  appendAuditEntry({
    timestamp: new Date().toISOString(),
    type,
    session,
    detail,
    data,
  });
}

/** Read recent audit entries (last N). */
export function readRecentAuditEntries(count = 50): AuditEntry[] {
  if (!existsSync(AUDIT_FILE)) return [];
  try {
    const content = readFileSync(AUDIT_FILE, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);
    const recent = lines.slice(-count);
    return recent.map((line) => {
      try { return JSON.parse(line) as AuditEntry; }
      catch { return null; }
    }).filter((e): e is AuditEntry => e !== null);
  } catch {
    return [];
  }
}

/** Count entries by type in the audit trail. */
export function auditStats(): Record<string, number> {
  const entries = readRecentAuditEntries(10_000);
  const counts: Record<string, number> = {};
  for (const e of entries) {
    counts[e.type] = (counts[e.type] ?? 0) + 1;
  }
  return counts;
}

/** Format audit entries for TUI display. */
export function formatAuditEntries(entries: AuditEntry[], maxWidth = 100): string[] {
  if (entries.length === 0) return ["  (no audit entries)"];
  const lines: string[] = [];
  for (const e of entries) {
    const time = e.timestamp.slice(11, 19); // HH:MM:SS
    const session = e.session ? ` [${e.session}]` : "";
    const detail = e.detail.length > maxWidth - 30
      ? e.detail.slice(0, maxWidth - 33) + "..."
      : e.detail;
    lines.push(`  ${time} ${e.type.padEnd(18)}${session} ${detail}`);
  }
  return lines;
}

/** Format audit stats for TUI display. */
export function formatAuditStats(stats: Record<string, number>): string[] {
  const entries = Object.entries(stats).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return ["  (no audit data)"];
  return entries.map(([type, count]) => `  ${type.padEnd(20)} ${count}`);
}

function rotateIfNeeded(): void {
  try {
    if (!existsSync(AUDIT_FILE)) return;
    const stat = statSync(AUDIT_FILE);
    if (stat.size > MAX_FILE_SIZE) {
      const rotated = `${AUDIT_FILE}.${Date.now()}.bak`;
      const { renameSync } = require("node:fs");
      renameSync(AUDIT_FILE, rotated);
    }
  } catch {
    // best-effort rotation
  }
}
