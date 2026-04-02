// fleet-snapshot.ts — periodic auto-save of fleet state for time-travel debugging.
// captures session states, task progress, summaries, health scores, and costs
// into timestamped snapshots. supports loading past snapshots for comparison.

import { writeFileSync, readFileSync, readdirSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { DaemonSessionState, TaskState } from "./types.js";

const SNAPSHOT_DIR = join(homedir(), ".aoaoe", "fleet-snapshots");
const MAX_SNAPSHOTS = 100; // keep last 100 snapshots

export interface FleetSnapshot {
  timestamp: string;
  epochMs: number;
  sessions: FleetSessionEntry[];
  tasks: FleetTaskEntry[];
  fleetHealth: number; // average health 0-100
  totalCostUsd: number;
}

export interface FleetSessionEntry {
  id: string;
  title: string;
  status: string;
  activity?: string;  // from SessionSummarizer
  costStr?: string;
  contextTokens?: string;
}

export interface FleetTaskEntry {
  sessionTitle: string;
  status: string;
  goal: string;
  progressCount: number;
  lastProgressAt?: number;
}

/** Capture a snapshot of the current fleet state. */
export function captureFleetSnapshot(
  sessions: readonly DaemonSessionState[],
  tasks: readonly TaskState[],
  activitySummaries: Map<string, string>,
  healthScores: Map<string, number>,
  now = Date.now(),
): FleetSnapshot {
  const sessionEntries: FleetSessionEntry[] = sessions.map((s) => ({
    id: s.id,
    title: s.title,
    status: s.status,
    activity: activitySummaries.get(s.title),
    costStr: s.costStr,
    contextTokens: s.contextTokens,
  }));

  const taskEntries: FleetTaskEntry[] = tasks.map((t) => ({
    sessionTitle: t.sessionTitle,
    status: t.status,
    goal: t.goal.length > 100 ? t.goal.slice(0, 97) + "..." : t.goal,
    progressCount: t.progress.length,
    lastProgressAt: t.lastProgressAt,
  }));

  const scores = [...healthScores.values()];
  const fleetHealth = scores.length > 0
    ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
    : 0;

  let totalCost = 0;
  for (const s of sessions) {
    if (s.costStr) {
      const match = s.costStr.match(/\$(\d+(?:\.\d+)?)/);
      if (match) totalCost += parseFloat(match[1]);
    }
  }

  return {
    timestamp: new Date(now).toISOString(),
    epochMs: now,
    sessions: sessionEntries,
    tasks: taskEntries,
    fleetHealth,
    totalCostUsd: totalCost,
  };
}

/** Save a snapshot to disk. */
export function saveFleetSnapshot(snapshot: FleetSnapshot): string {
  mkdirSync(SNAPSHOT_DIR, { recursive: true });
  const filename = `fleet-${snapshot.timestamp.replace(/[:.]/g, "-").slice(0, 19)}.json`;
  const filepath = join(SNAPSHOT_DIR, filename);
  writeFileSync(filepath, JSON.stringify(snapshot, null, 2) + "\n");
  pruneOldSnapshots();
  return filepath;
}

/** List available snapshots (newest first). */
export function listFleetSnapshots(): Array<{ filename: string; timestamp: string; epochMs: number }> {
  if (!existsSync(SNAPSHOT_DIR)) return [];
  const files = readdirSync(SNAPSHOT_DIR)
    .filter((f) => f.startsWith("fleet-") && f.endsWith(".json"))
    .sort()
    .reverse();
  return files.map((f) => {
    // parse timestamp from filename: fleet-2026-04-02T12-30-45.json
    const tsStr = f.replace("fleet-", "").replace(".json", "").replace(/-(\d{2})-(\d{2})-(\d{2})$/, ":$1:$2:$3");
    return { filename: f, timestamp: tsStr, epochMs: new Date(tsStr).getTime() || 0 };
  });
}

/** Load a specific snapshot by filename. */
export function loadFleetSnapshot(filename: string): FleetSnapshot | null {
  const filepath = join(SNAPSHOT_DIR, filename);
  if (!existsSync(filepath)) return null;
  try {
    return JSON.parse(readFileSync(filepath, "utf-8")) as FleetSnapshot;
  } catch {
    return null;
  }
}

/** Format a snapshot for TUI display. */
export function formatFleetSnapshot(snapshot: FleetSnapshot): string[] {
  const lines: string[] = [];
  lines.push(`  Fleet snapshot at ${snapshot.timestamp}`);
  lines.push(`  Health: ${snapshot.fleetHealth}/100  Cost: $${snapshot.totalCostUsd.toFixed(2)}  Sessions: ${snapshot.sessions.length}`);
  lines.push("");
  for (const s of snapshot.sessions) {
    const activity = s.activity ? ` (${s.activity})` : "";
    const cost = s.costStr ? ` ${s.costStr}` : "";
    lines.push(`  ${s.status.padEnd(8)} ${s.title}${activity}${cost}`);
  }
  if (snapshot.tasks.length > 0) {
    lines.push("");
    lines.push("  Tasks:");
    for (const t of snapshot.tasks) {
      const goal = t.goal.length > 50 ? t.goal.slice(0, 47) + "..." : t.goal;
      lines.push(`  ${t.status.padEnd(10)} ${t.sessionTitle}: ${goal} (${t.progressCount} progress entries)`);
    }
  }
  return lines;
}

/** Compare two snapshots and return a diff summary. */
export function diffFleetSnapshots(older: FleetSnapshot, newer: FleetSnapshot): string[] {
  const lines: string[] = [];
  const elapsed = newer.epochMs - older.epochMs;
  const elapsedMin = Math.round(elapsed / 60_000);
  lines.push(`  Fleet diff: ${elapsedMin}min apart`);

  const healthDelta = newer.fleetHealth - older.fleetHealth;
  const healthSign = healthDelta >= 0 ? "+" : "";
  lines.push(`  Health: ${older.fleetHealth} → ${newer.fleetHealth} (${healthSign}${healthDelta})`);

  const costDelta = newer.totalCostUsd - older.totalCostUsd;
  lines.push(`  Cost: $${older.totalCostUsd.toFixed(2)} → $${newer.totalCostUsd.toFixed(2)} (+$${costDelta.toFixed(2)})`);

  // session status changes
  const olderByTitle = new Map(older.sessions.map((s) => [s.title, s]));
  for (const s of newer.sessions) {
    const prev = olderByTitle.get(s.title);
    if (prev && prev.status !== s.status) {
      lines.push(`  ${s.title}: ${prev.status} → ${s.status}`);
    }
    if (!prev) {
      lines.push(`  ${s.title}: (new session)`);
    }
  }
  for (const s of older.sessions) {
    if (!newer.sessions.find((n) => n.title === s.title)) {
      lines.push(`  ${s.title}: (removed)`);
    }
  }

  // task completion changes
  const olderTasks = new Map(older.tasks.map((t) => [t.sessionTitle, t]));
  for (const t of newer.tasks) {
    const prev = olderTasks.get(t.sessionTitle);
    if (prev && prev.status !== t.status) {
      lines.push(`  task ${t.sessionTitle}: ${prev.status} → ${t.status}`);
    }
  }

  return lines;
}

function pruneOldSnapshots(): void {
  try {
    const files = readdirSync(SNAPSHOT_DIR)
      .filter((f) => f.startsWith("fleet-") && f.endsWith(".json"))
      .sort();
    while (files.length > MAX_SNAPSHOTS) {
      const oldest = files.shift()!;
      const { unlinkSync } = require("node:fs");
      unlinkSync(join(SNAPSHOT_DIR, oldest));
    }
  } catch {
    // best-effort pruning
  }
}

/**
 * Determine if it's time to take a fleet snapshot.
 * Default: every 10 minutes (every 60 polls at 10s interval).
 */
export function shouldTakeSnapshot(pollCount: number, everyPolls = 60): boolean {
  if (pollCount < 1) return false;
  return pollCount === 1 || pollCount % everyPolls === 0;
}
