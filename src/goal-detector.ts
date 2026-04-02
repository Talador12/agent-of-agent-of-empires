// goal-detector.ts — heuristic detection of goal completion from session output.
// parses tmux pane output for signals that a task is done: commits pushed, tests
// passing, version bumped, "done"/"complete" messages, idle-after-activity patterns.

import type { TaskState } from "./types.js";

export interface CompletionSignal {
  type: "commit_pushed" | "tests_passed" | "version_bumped" | "idle_after_progress" | "explicit_done" | "all_todos_done";
  confidence: number; // 0.0-1.0
  detail: string;
}

// minimum number of progress entries before we consider auto-completing
const MIN_PROGRESS_FOR_AUTO = 2;
// how long a session must be idle after progress to count as "done"
const IDLE_AFTER_PROGRESS_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Scan session output lines for signals that the goal is complete.
 * Returns an array of signals with confidence scores. The caller decides
 * whether to auto-complete based on aggregate confidence.
 */
export function detectCompletionSignals(lines: readonly string[], task: TaskState, now = Date.now()): CompletionSignal[] {
  const signals: CompletionSignal[] = [];

  // strip ANSI from all lines for matching
  const clean = lines.map((l) => l.replace(/\x1b\[[0-9;]*[mABCDHJKST]/g, "").trim()).filter(Boolean);
  const lastN = clean.slice(-40); // focus on recent output

  // ── explicit "done" / "complete" messages ───────────────────────────────
  for (const line of lastN) {
    if (/(?:all\s+(?:tasks?|items?|work)\s+(?:done|completed?|finished))/i.test(line)) {
      signals.push({ type: "explicit_done", confidence: 0.7, detail: line.slice(0, 80) });
    }
    if (/(?:nothing\s+(?:left|more)\s+to\s+do)/i.test(line)) {
      signals.push({ type: "explicit_done", confidence: 0.6, detail: line.slice(0, 80) });
    }
    // AI agent saying it's done with its task
    if (/(?:I(?:'ve| have)\s+completed?\s+(?:all|the|your)\s+)/i.test(line)) {
      signals.push({ type: "explicit_done", confidence: 0.5, detail: line.slice(0, 80) });
    }
  }

  // ── git push detected in output ────────────────────────────────────────
  for (const line of lastN) {
    if (/[a-f0-9]+\.\.[a-f0-9]+\s+\S+\s*->\s*\S+/.test(line)) {
      signals.push({ type: "commit_pushed", confidence: 0.4, detail: line.slice(0, 80) });
    }
  }

  // ── tests all passing ──────────────────────────────────────────────────
  for (const line of lastN) {
    // node:test: "ℹ fail 0"
    if (/^ℹ\s+fail\s+0$/.test(line)) {
      signals.push({ type: "tests_passed", confidence: 0.3, detail: "all tests passing (fail 0)" });
    }
    // jest: "Tests: N passed, N total" with no failures
    const jestMatch = line.match(/Tests:\s*(\d+)\s+passed,?\s*(\d+)\s+total/i);
    if (jestMatch && jestMatch[1] === jestMatch[2]) {
      signals.push({ type: "tests_passed", confidence: 0.3, detail: `${jestMatch[1]}/${jestMatch[2]} tests passed` });
    }
  }

  // ── version bump ────────────────────────────────────────────────────────
  for (const line of lastN) {
    if (/^v\d+\.\d+\.\d+$/.test(line)) {
      signals.push({ type: "version_bumped", confidence: 0.3, detail: line });
    }
  }

  // ── all TODO items done ────────────────────────────────────────────────
  const todosDone = lastN.filter((l) => /^\[✓\]/.test(l) || /^[-*]\s+\[x\]/i.test(l)).length;
  const todosPending = lastN.filter((l) => /^\[\s\]/.test(l) || /^\[•\]/.test(l) || /^[-*]\s+\[\s\]/.test(l)).length;
  if (todosDone > 0 && todosPending === 0) {
    signals.push({ type: "all_todos_done", confidence: 0.5, detail: `${todosDone} todos done, 0 pending` });
  }

  // ── idle after progress ────────────────────────────────────────────────
  if (task.lastProgressAt && task.progress.length >= MIN_PROGRESS_FOR_AUTO) {
    const idleMs = now - task.lastProgressAt;
    if (idleMs >= IDLE_AFTER_PROGRESS_MS) {
      const idleMin = Math.round(idleMs / 60_000);
      signals.push({
        type: "idle_after_progress",
        confidence: Math.min(0.4, 0.2 + (idleMs / (60 * 60_000)) * 0.2), // grows over time, max 0.4
        detail: `idle ${idleMin}m after ${task.progress.length} progress entries`,
      });
    }
  }

  return signals;
}

/**
 * Compute aggregate confidence from multiple signals.
 * Signals are combined with diminishing returns (1 - product of (1 - confidence)).
 */
export function aggregateConfidence(signals: CompletionSignal[]): number {
  if (signals.length === 0) return 0;
  // combined probability: P(at least one correct) = 1 - Π(1 - pᵢ)
  let product = 1;
  for (const s of signals) {
    product *= (1 - s.confidence);
  }
  return 1 - product;
}

/**
 * Determine if a task should be auto-completed based on detected signals.
 * Threshold defaults to 0.7 — requires multiple strong signals to trigger.
 */
export function shouldAutoComplete(
  signals: CompletionSignal[],
  task: TaskState,
  threshold = 0.7,
): { complete: boolean; confidence: number; summary: string } {
  const confidence = aggregateConfidence(signals);
  if (confidence < threshold || task.status !== "active") {
    return { complete: false, confidence, summary: "" };
  }

  // build a human-readable summary from the top signals
  const sorted = [...signals].sort((a, b) => b.confidence - a.confidence);
  const topDetails = sorted.slice(0, 3).map((s) => s.detail);
  const summary = `auto-detected completion (${Math.round(confidence * 100)}% confidence): ${topDetails.join("; ")}`;

  return { complete: true, confidence, summary };
}
