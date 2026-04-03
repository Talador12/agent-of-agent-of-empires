// session-compare.ts — side-by-side comparison of two sessions.
// shows status, progress, cost, and activity for two sessions together.

import type { TaskState, DaemonSessionState } from "./types.js";

export interface SessionComparison {
  titleA: string;
  titleB: string;
  fields: Array<{ label: string; valueA: string; valueB: string; winner?: "a" | "b" | "tie" }>;
}

/**
 * Compare two sessions across multiple dimensions.
 */
export function compareSessions(
  a: { session: DaemonSessionState; task?: TaskState },
  b: { session: DaemonSessionState; task?: TaskState },
): SessionComparison {
  const fields: SessionComparison["fields"] = [];
  const f = (label: string, va: string, vb: string, winner?: "a" | "b" | "tie") =>
    fields.push({ label, valueA: va, valueB: vb, winner });

  f("Status", a.session.status, b.session.status);
  f("Tool", a.session.tool, b.session.tool);

  const costA = parseCost(a.session.costStr);
  const costB = parseCost(b.session.costStr);
  f("Cost", a.session.costStr ?? "—", b.session.costStr ?? "—",
    costA < costB ? "a" : costB < costA ? "b" : "tie");

  const progA = a.task?.progress.length ?? 0;
  const progB = b.task?.progress.length ?? 0;
  f("Progress entries", String(progA), String(progB),
    progA > progB ? "a" : progB > progA ? "b" : "tie");

  f("Goal", truncate(a.task?.goal ?? "—", 40), truncate(b.task?.goal ?? "—", 40));
  f("Task status", a.task?.status ?? "—", b.task?.status ?? "—");

  return { titleA: a.session.title, titleB: b.session.title, fields };
}

/**
 * Format comparison for TUI display.
 */
export function formatComparison(cmp: SessionComparison): string[] {
  const lines: string[] = [];
  const colW = 25;
  lines.push(`  Compare: "${cmp.titleA}" vs "${cmp.titleB}"`);
  lines.push(`  ${"".padEnd(18)} ${cmp.titleA.padEnd(colW)} ${cmp.titleB.padEnd(colW)}`);
  lines.push(`  ${"─".repeat(18)} ${"─".repeat(colW)} ${"─".repeat(colW)}`);
  for (const f of cmp.fields) {
    const wA = f.winner === "a" ? "◄" : " ";
    const wB = f.winner === "b" ? "◄" : " ";
    lines.push(`  ${f.label.padEnd(18)} ${(f.valueA + wA).padEnd(colW)} ${(f.valueB + wB).padEnd(colW)}`);
  }
  return lines;
}

function parseCost(s?: string): number {
  if (!s) return 0;
  const m = s.match(/\$(\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : 0;
}
function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 3) + "..." : s;
}
