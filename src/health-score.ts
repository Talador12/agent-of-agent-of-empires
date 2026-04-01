// health-score.ts — compute per-session health from task state + progress patterns.
// health is a 0-100 score where 100 = healthy, active, progressing.

import type { TaskState } from "./types.js";
import { BOLD, DIM, GREEN, YELLOW, RED, CYAN, RESET } from "./colors.js";

export interface SessionHealth {
  session: string;
  score: number;       // 0-100
  grade: "healthy" | "ok" | "degraded" | "critical" | "inactive";
  factors: string[];   // human-readable explanation of score
}

// compute health score for a single task
export function computeHealth(task: TaskState): SessionHealth {
  const factors: string[] = [];
  let score = 100;
  const now = Date.now();

  // status penalties
  if (task.status === "completed") {
    return { session: task.sessionTitle, score: 100, grade: "healthy", factors: ["completed"] };
  }
  if (task.status === "failed") {
    return { session: task.sessionTitle, score: 0, grade: "critical", factors: ["task failed"] };
  }
  if (task.status === "paused") {
    return { session: task.sessionTitle, score: 30, grade: "degraded", factors: ["paused"] };
  }
  if (task.status === "pending") {
    const hasDeps = task.dependsOn && task.dependsOn.length > 0;
    return { session: task.sessionTitle, score: 50, grade: "inactive", factors: [hasDeps ? "waiting on dependencies" : "not started"] };
  }

  // progress recency (active tasks)
  if (task.lastProgressAt) {
    const ageMs = now - task.lastProgressAt;
    if (ageMs < 10 * 60_000) {
      factors.push("progress <10m ago");
    } else if (ageMs < 30 * 60_000) {
      score -= 10;
      factors.push("progress 10-30m ago");
    } else if (ageMs < 60 * 60_000) {
      score -= 25;
      factors.push("progress 30-60m ago");
    } else if (ageMs < 4 * 60 * 60_000) {
      score -= 40;
      factors.push("progress 1-4h ago");
    } else {
      score -= 55;
      factors.push(`progress ${Math.round(ageMs / 3_600_000)}h ago`);
    }
  } else {
    score -= 60;
    factors.push("no progress ever recorded");
  }

  // stuck nudge count
  const nudges = task.stuckNudgeCount ?? 0;
  if (nudges > 0) {
    score -= Math.min(nudges * 10, 30);
    factors.push(`${nudges} stuck nudge(s)`);
  }

  // progress velocity (more entries = healthier)
  const recentEntries = task.progress.filter((p) => p.at >= now - 4 * 60 * 60_000).length;
  if (recentEntries >= 3) {
    score = Math.min(score + 10, 100);
    factors.push(`${recentEntries} progress entries in 4h`);
  } else if (recentEntries === 0 && task.progress.length > 0) {
    score -= 10;
    factors.push("no progress in last 4h");
  }

  score = Math.max(0, Math.min(100, score));

  const grade: SessionHealth["grade"] =
    score >= 80 ? "healthy" :
    score >= 60 ? "ok" :
    score >= 40 ? "degraded" :
    "critical";

  return { session: task.sessionTitle, score, grade, factors };
}

// compute health for all tasks
export function computeAllHealth(tasks: TaskState[]): SessionHealth[] {
  return tasks.map(computeHealth);
}

// format health report for display
export function formatHealthReport(tasks: TaskState[]): string {
  const healths = computeAllHealth(tasks);
  if (healths.length === 0) return "  (no tasks)";

  const lines: string[] = [];
  lines.push(`  ${BOLD}SESSION HEALTH${RESET}`);
  lines.push(`  ${"-".repeat(60)}`);

  for (const h of healths) {
    const color = h.grade === "healthy" ? GREEN
      : h.grade === "ok" ? CYAN
      : h.grade === "degraded" ? YELLOW
      : h.grade === "critical" ? RED
      : DIM;
    const bar = "█".repeat(Math.round(h.score / 10)) + "░".repeat(10 - Math.round(h.score / 10));
    lines.push(`  ${color}${bar}${RESET} ${h.score.toString().padStart(3)}  ${BOLD}${h.session}${RESET} ${DIM}(${h.grade})${RESET}`);
    lines.push(`  ${DIM}  ${h.factors.join(" · ")}${RESET}`);
  }

  const avg = Math.round(healths.reduce((sum, h) => sum + h.score, 0) / healths.length);
  lines.push("");
  lines.push(`  ${DIM}fleet average: ${avg}/100${RESET}`);

  return lines.join("\n");
}
