// UI payload builders for the slots declared in aoe-plugin.toml. All shapes
// follow the host's pluginUi renderer contract: pane/card carry a `blocks`
// list, row-column carries { text, sort_value }, sort-key carries
// { label, column, direction }. Unknown fields are ignored by older hosts
// (forward-compatible by design), so these can grow without lockstep releases.

import type { QueueRow } from "./attention.js";
import { formatDuration } from "./attention.js";
import type { SpawnReport } from "./spawn.js";

export interface UiBlock {
  kind: string;
  [key: string]: unknown;
}

const TONE_BY_STATUS: Record<string, string> = {
  Error: "error",
  Waiting: "warning",
  Unknown: "warning",
  Stopped: "warning",
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

/** Global dashboard card: the ranked attention queue at a glance. */
export function queueCardPayload(rows: QueueRow[], summary: WorkerStatusSummary): { title: string; blocks: UiBlock[] } {
  const blocks: UiBlock[] = [];
  blocks.push({
    kind: "note",
    text: summary.paused
      ? "Orchestrator paused."
      : summary.dryRun
        ? `Dry run — recommending only (reasoner: ${summary.reasoner}).`
        : `Live (reasoner: ${summary.reasoner}).`,
    tone: summary.paused ? "warning" : "info",
  });
  if (summary.quiet) {
    blocks.push({ kind: "note", text: "Quiet hours: observing only.", tone: "info" });
  }
  const top = rows.slice(0, 5);
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
  return { title: "Orchestrator queue", blocks };
}

/** Status-bar segment: tiny counts. */
export function statusBarPayload(rows: QueueRow[], summary: WorkerStatusSummary): { text: string; tone?: string } {
  if (summary.paused) return { text: "orch ⏸", tone: "warning" };
  const urgent = rows.filter((r) => r.attentionScore >= 60).length;
  if (urgent > 0) return { text: `orch ${urgent}!`, tone: "warning" };
  return { text: `orch ${rows.length}` };
}

/** Per-session row badge, only pushed for sessions that rank high. */
export function attentionBadgePayload(row: QueueRow): { items: Array<Record<string, unknown>> } {
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
export function attentionColumnPayload(row: QueueRow): { text: string; sort_value: number } {
  return { text: String(Math.round(row.attentionScore)), sort_value: row.attentionScore };
}

/** Global sort option over the attention column. */
export function attentionSortPayload(): { label: string; column: string; direction: string } {
  return { label: "Attention", column: "attention_score", direction: "desc" };
}

/** Per-session pane: signals + recommendation detail. */
export function sessionPanePayload(row: QueueRow, recommendation: string | undefined): { title: string; icon: string; blocks: UiBlock[] } {
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

/** Spawn report rendered into the queue card pane after a spawn run. */
export function spawnReportBlocks(report: SpawnReport): UiBlock[] {
  const blocks: UiBlock[] = [{ kind: "heading", text: `Spawn: ${report.repo || "(unconfigured)"}` }];
  if (report.error) {
    blocks.push({ kind: "note", text: report.error, tone: "error" });
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
      tone: o.created ? "success" : o.planned ? "info" : "warning",
      href: o.issue.url || undefined,
    });
  }
  return blocks;
}
