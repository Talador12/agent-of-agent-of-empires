// UI payload builders for the slots declared in aoe-plugin.toml. Each builder
// is typed to exactly one slot's host schema (docs/plugin-api.md): the host
// parses every entry with deny_unknown_fields and rejects the whole push with
// -32602 on a stray key, so a payload may only carry what its own slot
// declares. Only `pane` and `settings-page` take a `blocks` list — it is stored
// as opaque JSON, and *that* is the one forward-compatible surface (unknown
// block kinds render as nothing). Everything else, `card` included, is strict:
// `card` is { title, body, tone } and nothing more. Slot ↔ payload is pinned in
// `UiSlotPayloads`, which `HostClient.uiStateSet` keys off, so a mismatch is a
// compile error instead of a warning once per tick.

import type { QueueRow } from "./attention.js";
import { formatDuration } from "./attention.js";
import type { SpawnReport } from "./spawn.js";

export interface UiBlock {
  kind: string;
  [key: string]: unknown;
}

/** The host's tone vocabulary (docs/plugin-api.md, "Block kinds"). Distinct
 * from `ui.notify`'s tones, which are info/success/warning/error. */
export type Tone = "neutral" | "info" | "success" | "warn" | "danger";

export interface CardPayload {
  title: string;
  body: string;
  tone?: Tone;
}

export interface StatusBarPayload {
  text: string;
  tone?: Tone;
}

export interface RowBadgePayload {
  items: Array<{ text: string; tone?: Tone; tooltip?: string }>;
}

export interface RowColumnPayload {
  text: string;
  sort_value: number;
}

export interface SortKeyPayload {
  label: string;
  column: string;
  direction: "asc" | "desc";
}

export interface PanePayload {
  title: string;
  icon?: string;
  default_location?: "right" | "bottom";
  blocks: UiBlock[];
}

export interface SettingsPagePayload {
  title: string;
  blocks: UiBlock[];
}

/** Slot name → payload schema, mirroring the `[[ui]]` entries in the manifest. */
export interface UiSlotPayloads {
  card: CardPayload;
  "status-bar": StatusBarPayload;
  "row-badge": RowBadgePayload;
  "row-column": RowColumnPayload;
  "sort-key": SortKeyPayload;
  pane: PanePayload;
  "settings-page": SettingsPagePayload;
}

const TONE_BY_STATUS: Record<string, Tone> = {
  Error: "danger",
  Waiting: "warn",
  Unknown: "warn",
  Stopped: "warn",
  Idle: "info",
};

export interface WorkerStatusSummary {
  paused: boolean;
  dryRun: boolean;
  reasoner: string;
  lastTickAt?: number;
  lastTickSummary?: string;
  quiet?: boolean;
}

const TOP_N = 5;
const URGENT_SCORE = 60;

function modeLine(summary: WorkerStatusSummary): string {
  if (summary.paused) return "Orchestrator paused.";
  return summary.dryRun
    ? `Dry run — recommending only (reasoner: ${summary.reasoner}).`
    : `Live (reasoner: ${summary.reasoner}).`;
}

/** Global dashboard card. The card slot has no block vocabulary, so the top of
 * the queue is flattened into `body` text; the full ranked list with its action
 * buttons lives on the settings page (see {@link queuePagePayload}). */
export function queueCardPayload(rows: QueueRow[], summary: WorkerStatusSummary): CardPayload {
  const lines: string[] = [modeLine(summary)];
  if (summary.quiet) lines.push("Quiet hours: observing only.");
  const top = rows.slice(0, TOP_N);
  if (top.length === 0) {
    lines.push("No sessions need attention.");
  } else {
    for (const row of top) {
      lines.push(
        `${Math.round(row.attentionScore)}  ${row.title} — ${row.status} · ${formatDuration(row.inStatusForMs)}`
      );
    }
    if (rows.length > top.length) {
      lines.push(`+${rows.length - top.length} more ranked sessions`);
    }
  }
  return { title: "Orchestrator queue", body: lines.join("\n"), tone: cardTone(rows, summary) };
}

function cardTone(rows: QueueRow[], summary: WorkerStatusSummary): Tone {
  if (summary.paused) return "warn";
  if (rows.some((r) => r.status === "Error")) return "danger";
  if (rows.some((r) => r.attentionScore >= URGENT_SCORE)) return "warn";
  return "info";
}

/** Global settings page: the ranked queue in full, plus the orchestrator's
 * controls. This is the block-carrying global surface — the card is not. */
export function queuePagePayload(
  rows: QueueRow[],
  summary: WorkerStatusSummary,
  spawnReport?: SpawnReport
): SettingsPagePayload {
  const blocks: UiBlock[] = [];
  blocks.push({ kind: "note", text: modeLine(summary), tone: summary.paused ? "warn" : "info" });
  if (summary.quiet) {
    blocks.push({ kind: "note", text: "Quiet hours: observing only.", tone: "info" });
  }
  const top = rows.slice(0, TOP_N);
  if (top.length === 0) {
    blocks.push({ kind: "note", text: "No sessions need attention." });
  } else {
    for (const row of top) {
      blocks.push({
        kind: "row",
        label: row.title,
        value: `${row.attentionScore}`,
        sublabel: `${row.status} · ${formatDuration(row.inStatusForMs)}`,
        tone: TONE_BY_STATUS[row.status],
      });
    }
    if (rows.length > top.length) {
      blocks.push({ kind: "note", text: `+${rows.length - top.length} more ranked sessions` });
    }
  }
  blocks.push({ kind: "divider" });
  blocks.push({ kind: "action", label: "Tick now", method: "aoaoe.tick" });
  blocks.push(
    summary.paused
      ? { kind: "action", label: "Resume", method: "aoaoe.resume" }
      : { kind: "action", label: "Pause", method: "aoaoe.pause" }
  );
  if (spawnReport) {
    blocks.push({ kind: "divider" }, ...spawnReportBlocks(spawnReport));
  }
  return { title: "Orchestrator queue", blocks };
}

/** Status-bar segment: tiny counts. */
export function statusBarPayload(rows: QueueRow[], summary: WorkerStatusSummary): StatusBarPayload {
  if (summary.paused) return { text: "orch ⏸", tone: "warn" };
  const urgent = rows.filter((r) => r.attentionScore >= URGENT_SCORE).length;
  if (urgent > 0) return { text: `orch ${urgent}!`, tone: "warn" };
  return { text: `orch ${rows.length}` };
}

/** Per-session row badge, only pushed for sessions that rank high. */
export function attentionBadgePayload(row: QueueRow): RowBadgePayload {
  return {
    items: [
      {
        text: `attn ${Math.round(row.attentionScore)}`,
        tone: TONE_BY_STATUS[row.status] ?? "info",
        tooltip: row.reasons.join("; ") || "attention score",
      },
    ],
  };
}

/** Per-session sortable column. */
export function attentionColumnPayload(row: QueueRow): RowColumnPayload {
  return { text: String(Math.round(row.attentionScore)), sort_value: row.attentionScore };
}

/** Global sort option over the attention column. */
export function attentionSortPayload(): SortKeyPayload {
  return { label: "Attention", column: "attention_score", direction: "desc" };
}

/** Per-session pane: signals + recommendation detail. */
export function sessionPanePayload(row: QueueRow, recommendation: string | undefined): PanePayload {
  const blocks: UiBlock[] = [
    { kind: "heading", text: "Attention" },
    { kind: "row", label: "Score", value: String(row.attentionScore), tone: TONE_BY_STATUS[row.status] },
    { kind: "row", label: "Status", value: row.status, sublabel: `for ${formatDuration(row.inStatusForMs)}` },
    { kind: "row", label: "Managed", value: row.pluginOwned ? "orchestrator-created" : "advisory only" },
  ];
  if (row.reasons.length > 0) {
    blocks.push({
      kind: "section",
      title: "Signals",
      children: row.reasons.map((r) => ({ kind: "note", text: r })),
    });
  }
  if (recommendation) {
    blocks.push({ kind: "divider" });
    blocks.push({ kind: "note", text: recommendation, tone: "info" });
  }
  blocks.push({ kind: "divider" });
  blocks.push({ kind: "action", label: "Tick now", method: "aoaoe.tick" });
  return { title: "Orchestrator", icon: "radar", blocks };
}

/** Spawn report rendered into the queue settings page after a spawn run. */
export function spawnReportBlocks(report: SpawnReport): UiBlock[] {
  const blocks: UiBlock[] = [{ kind: "heading", text: `Spawn: ${report.repo || "(unconfigured)"}` }];
  if (report.error) {
    blocks.push({ kind: "note", text: report.error, tone: "danger" });
    return blocks;
  }
  if (report.outcomes.length === 0) {
    blocks.push({ kind: "note", text: "No open issues matched." });
    return blocks;
  }
  for (const o of report.outcomes) {
    const state = o.planned
      ? "would spawn (dry run)"
      : o.created
        ? `spawned ${o.sessionId}`
        : o.skippedReason ?? "skipped";
    blocks.push({
      kind: "row",
      label: `#${o.issue.number} ${o.issue.title}`,
      value: state,
      tone: o.created ? "success" : o.planned ? "info" : "warn",
      href: o.issue.url || undefined,
    });
  }
  return blocks;
}
