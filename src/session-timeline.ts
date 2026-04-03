// session-timeline.ts — build a chronological timeline of a session's key events
// from task progress + audit trail + activity summaries.

import type { TaskState } from "./types.js";

export interface TimelineEvent {
  timestamp: number;
  timeLabel: string;
  category: "progress" | "status" | "action" | "milestone";
  text: string;
}

/**
 * Build a timeline from a task's progress entries.
 */
export function buildTimeline(task: TaskState): TimelineEvent[] {
  const events: TimelineEvent[] = [];

  if (task.createdAt) {
    events.push({ timestamp: task.createdAt, timeLabel: fmtTime(task.createdAt), category: "milestone", text: "task created" });
  }

  for (const p of task.progress) {
    events.push({ timestamp: p.at, timeLabel: fmtTime(p.at), category: "progress", text: p.summary });
  }

  if (task.completedAt) {
    events.push({ timestamp: task.completedAt, timeLabel: fmtTime(task.completedAt), category: "milestone", text: `task ${task.status}` });
  }

  return events.sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * Format timeline for TUI display.
 */
export function formatTimeline(sessionTitle: string, events: TimelineEvent[]): string[] {
  if (events.length === 0) return [`  "${sessionTitle}": no timeline data`];
  const lines: string[] = [];
  const icons = { progress: "→", status: "●", action: "▶", milestone: "★" };
  lines.push(`  Timeline: "${sessionTitle}" (${events.length} events)`);
  for (const e of events) {
    lines.push(`  ${e.timeLabel} ${icons[e.category]} ${e.text}`);
  }
  return lines;
}

function fmtTime(ms: number): string {
  return new Date(ms).toISOString().slice(11, 19);
}
