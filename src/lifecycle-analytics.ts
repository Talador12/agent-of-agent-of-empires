// lifecycle-analytics.ts — track creation-to-completion patterns over time.
// records task lifecycle events and computes aggregate statistics for
// throughput, average duration, success rate, and bottleneck identification.

import type { TaskState } from "./types.js";

export interface LifecycleRecord {
  sessionTitle: string;
  repo: string;
  createdAt: number;
  completedAt?: number;
  status: string;
  durationMs?: number;
  progressEntries: number;
}

export interface LifecycleStats {
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  activeTasks: number;
  avgDurationMs: number;
  medianDurationMs: number;
  successRate: number;           // 0.0-1.0
  throughputPerDay: number;      // completed tasks per 24h
  avgProgressEntries: number;
  longestTask: { title: string; durationMs: number } | null;
  fastestTask: { title: string; durationMs: number } | null;
}

/**
 * Build lifecycle records from task states.
 */
export function buildLifecycleRecords(tasks: readonly TaskState[]): LifecycleRecord[] {
  return tasks.map((t) => {
    const durationMs = (t.completedAt && t.createdAt) ? t.completedAt - t.createdAt : undefined;
    return {
      sessionTitle: t.sessionTitle,
      repo: t.repo,
      createdAt: t.createdAt ?? 0,
      completedAt: t.completedAt,
      status: t.status,
      durationMs,
      progressEntries: t.progress.length,
    };
  });
}

/**
 * Compute aggregate lifecycle statistics.
 */
export function computeLifecycleStats(records: LifecycleRecord[]): LifecycleStats {
  const completed = records.filter((r) => r.status === "completed" && r.durationMs);
  const failed = records.filter((r) => r.status === "failed");
  const active = records.filter((r) => r.status === "active");

  const durations = completed.map((r) => r.durationMs!).sort((a, b) => a - b);
  const avgDuration = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;
  const medianDuration = durations.length > 0 ? durations[Math.floor(durations.length / 2)] : 0;

  // throughput: completed tasks per 24h based on time span
  let throughput = 0;
  if (completed.length >= 2) {
    const timestamps = completed.map((r) => r.completedAt!).sort();
    const spanMs = timestamps[timestamps.length - 1] - timestamps[0];
    if (spanMs > 0) throughput = (completed.length / spanMs) * 86_400_000;
  }

  const successRate = (completed.length + failed.length) > 0
    ? completed.length / (completed.length + failed.length)
    : 0;

  const avgProgress = records.length > 0
    ? records.reduce((sum, r) => sum + r.progressEntries, 0) / records.length
    : 0;

  const longest = durations.length > 0
    ? completed.reduce((best, r) => (r.durationMs! > (best.durationMs ?? 0) ? r : best))
    : null;
  const fastest = durations.length > 0
    ? completed.reduce((best, r) => (r.durationMs! < (best.durationMs ?? Infinity) ? r : best))
    : null;

  return {
    totalTasks: records.length,
    completedTasks: completed.length,
    failedTasks: failed.length,
    activeTasks: active.length,
    avgDurationMs: Math.round(avgDuration),
    medianDurationMs: Math.round(medianDuration),
    successRate,
    throughputPerDay: throughput,
    avgProgressEntries: Math.round(avgProgress),
    longestTask: longest ? { title: longest.sessionTitle, durationMs: longest.durationMs! } : null,
    fastestTask: fastest ? { title: fastest.sessionTitle, durationMs: fastest.durationMs! } : null,
  };
}

/**
 * Format lifecycle stats for TUI display.
 */
export function formatLifecycleStats(stats: LifecycleStats): string[] {
  if (stats.totalTasks === 0) return ["  (no task lifecycle data)"];
  const lines: string[] = [];
  lines.push(`  Lifecycle: ${stats.totalTasks} tasks (${stats.completedTasks} done, ${stats.failedTasks} failed, ${stats.activeTasks} active)`);
  lines.push(`  Success rate: ${Math.round(stats.successRate * 100)}%  |  Throughput: ${stats.throughputPerDay.toFixed(1)} tasks/day`);
  if (stats.avgDurationMs > 0) {
    lines.push(`  Duration: avg ${fmtMs(stats.avgDurationMs)}, median ${fmtMs(stats.medianDurationMs)}`);
  }
  if (stats.longestTask) lines.push(`  Longest: "${stats.longestTask.title}" (${fmtMs(stats.longestTask.durationMs)})`);
  if (stats.fastestTask) lines.push(`  Fastest: "${stats.fastestTask.title}" (${fmtMs(stats.fastestTask.durationMs)})`);
  lines.push(`  Avg progress entries: ${stats.avgProgressEntries}`);
  return lines;
}

function fmtMs(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  const h = Math.floor(ms / 3_600_000);
  const m = Math.round((ms % 3_600_000) / 60_000);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}
