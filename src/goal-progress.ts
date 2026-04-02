// goal-progress.ts — estimate % completion of a task based on progress
// entries, output patterns, and goal structure. no LLM call — pure heuristics.

import type { TaskState } from "./types.js";

export interface ProgressEstimate {
  sessionTitle: string;
  percentComplete: number;  // 0-100
  confidence: "low" | "medium" | "high";
  factors: string[];        // human-readable explanation
  progressBar: string;      // ASCII progress bar
}

/**
 * Estimate completion percentage for a task.
 * Combines multiple heuristic signals with different weights.
 */
export function estimateProgress(task: TaskState, recentOutput?: string): ProgressEstimate {
  const factors: string[] = [];
  let totalWeight = 0;
  let weightedSum = 0;

  // ── Signal 1: explicit todo items in goal (bullet count) ──────────
  const goalLines = task.goal.split("\n").map((l) => l.trim()).filter(Boolean);
  const goalItems = goalLines.filter((l) => /^[-*•]\s/.test(l));
  if (goalItems.length >= 2) {
    // estimate done items from progress entries matching goal items
    const progressTexts = task.progress.map((p) => p.summary.toLowerCase());
    let doneCount = 0;
    for (const item of goalItems) {
      const itemWords = item.replace(/^[-*•]\s*/, "").toLowerCase().split(/\s+/).filter((w) => w.length > 3);
      const matched = progressTexts.some((pt) => itemWords.some((w) => pt.includes(w)));
      if (matched) doneCount++;
    }
    const pct = Math.round((doneCount / goalItems.length) * 100);
    factors.push(`${doneCount}/${goalItems.length} goal items matched in progress`);
    weightedSum += pct * 3;
    totalWeight += 3;
  }

  // ── Signal 2: progress entry count vs expected ─────────────────────
  // heuristic: typical task produces 3-10 progress entries before completion
  const progressCount = task.progress.length;
  if (progressCount > 0) {
    const expectedEntries = Math.max(5, goalItems.length * 2);
    const pct = Math.min(90, Math.round((progressCount / expectedEntries) * 100));
    factors.push(`${progressCount} progress entries (est. ${expectedEntries} needed)`);
    weightedSum += pct * 2;
    totalWeight += 2;
  }

  // ── Signal 3: time elapsed vs typical task duration ────────────────
  if (task.createdAt) {
    const elapsedMs = Date.now() - task.createdAt;
    const elapsedHours = elapsedMs / 3_600_000;
    // heuristic: typical task takes 1-4 hours
    const pct = Math.min(85, Math.round((elapsedHours / 3) * 100));
    if (elapsedHours > 0.5) {
      factors.push(`${elapsedHours.toFixed(1)}h elapsed`);
      weightedSum += pct * 1;
      totalWeight += 1;
    }
  }

  // ── Signal 4: output patterns (commit, push, tests passing) ────────
  if (recentOutput) {
    const clean = recentOutput.replace(/\x1b\[[0-9;]*[mABCDHJKST]/g, "");
    if (/[a-f0-9]+\.\.[a-f0-9]+\s+\S+\s*->\s*\S+/.test(clean)) {
      factors.push("git push detected");
      weightedSum += 90 * 2;
      totalWeight += 2;
    }
    if (/ℹ\s+fail\s+0$/.test(clean) || /Tests:\s*\d+\s+passed,?\s*\d+\s+total/i.test(clean)) {
      factors.push("tests passing");
      weightedSum += 80 * 1;
      totalWeight += 1;
    }
  }

  // ── Signal 5: task status ──────────────────────────────────────────
  if (task.status === "completed") {
    return buildEstimate(task.sessionTitle, 100, "high", ["task completed"]);
  }
  if (task.status === "failed") {
    factors.push("task failed");
    // keep existing progress but cap at 80
  }

  // ── Combine ────────────────────────────────────────────────────────
  if (totalWeight === 0) {
    return buildEstimate(task.sessionTitle, 0, "low", ["insufficient data"]);
  }

  const rawPct = Math.round(weightedSum / totalWeight);
  const clampedPct = Math.min(task.status === "failed" ? 80 : 95, Math.max(0, rawPct));
  const confidence = totalWeight >= 6 ? "high" : totalWeight >= 3 ? "medium" : "low";

  return buildEstimate(task.sessionTitle, clampedPct, confidence, factors);
}

function buildEstimate(
  sessionTitle: string,
  percentComplete: number,
  confidence: "low" | "medium" | "high",
  factors: string[],
): ProgressEstimate {
  const filled = Math.round(percentComplete / 5);
  const progressBar = "█".repeat(filled) + "░".repeat(20 - filled) + ` ${percentComplete}%`;
  return { sessionTitle, percentComplete, confidence, factors, progressBar };
}

/**
 * Format progress estimates for TUI display.
 */
export function formatProgressEstimates(estimates: ProgressEstimate[]): string[] {
  if (estimates.length === 0) return ["  (no task progress data)"];
  const lines: string[] = [];
  for (const e of estimates) {
    const conf = e.confidence === "high" ? "●" : e.confidence === "medium" ? "◐" : "○";
    lines.push(`  ${conf} ${e.sessionTitle}: ${e.progressBar}`);
    if (e.factors.length > 0) {
      lines.push(`    ${e.factors.join("; ")}`);
    }
  }
  return lines;
}
