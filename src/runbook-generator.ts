// runbook-generator.ts — auto-generate operator runbooks from audit trail patterns.
// analyzes recurring event sequences and produces step-by-step playbooks
// for common scenarios (stuck sessions, budget overruns, error recovery).

import { readRecentAuditEntries } from "./audit-trail.js";
import type { AuditEntry } from "./audit-trail.js";

export interface RunbookStep {
  action: string;
  detail: string;
  frequency: number;  // how often this step appeared
}

export interface GeneratedRunbook {
  title: string;
  scenario: string;
  steps: RunbookStep[];
  basedOnEvents: number;
  confidence: "low" | "medium" | "high";
}

/**
 * Analyze audit trail and generate runbooks for common patterns.
 */
export function generateRunbooks(): GeneratedRunbook[] {
  const entries = readRecentAuditEntries(5_000);
  if (entries.length < 10) return [];

  const runbooks: GeneratedRunbook[] = [];

  // pattern 1: stuck session recovery
  const stuckEntries = entries.filter((e) => e.type === "stuck_nudge" || e.type === "session_restart");
  if (stuckEntries.length >= 3) {
    const actions = countActions(stuckEntries);
    runbooks.push({
      title: "Stuck Session Recovery",
      scenario: "Session has not made progress for >30 minutes",
      steps: actions,
      basedOnEvents: stuckEntries.length,
      confidence: stuckEntries.length >= 10 ? "high" : stuckEntries.length >= 5 ? "medium" : "low",
    });
  }

  // pattern 2: budget management
  const budgetEntries = entries.filter((e) => e.type === "budget_pause");
  if (budgetEntries.length >= 2) {
    runbooks.push({
      title: "Budget Overrun Response",
      scenario: "Session cost exceeds configured budget",
      steps: [
        { action: "Review cost attribution", detail: "Use /cost-report to identify top spenders", frequency: budgetEntries.length },
        { action: "Adjust budget or pause", detail: "Use /budget-predict to estimate remaining runway", frequency: budgetEntries.length },
        { action: "Check for runaway loops", detail: "Use /drift to verify session is on-task", frequency: Math.ceil(budgetEntries.length * 0.5) },
      ],
      basedOnEvents: budgetEntries.length,
      confidence: budgetEntries.length >= 5 ? "high" : "medium",
    });
  }

  // pattern 3: error recovery
  const errorEntries = entries.filter((e) => e.type === "session_error");
  if (errorEntries.length >= 3) {
    runbooks.push({
      title: "Session Error Recovery",
      scenario: "Session enters error state",
      steps: [
        { action: "Check session output", detail: "Use /session-replay to review recent activity", frequency: errorEntries.length },
        { action: "Review recovery playbook", detail: "Use /recovery to see auto-recovery status", frequency: errorEntries.length },
        { action: "Restart if needed", detail: "Recovery playbook auto-restarts at health <40", frequency: Math.ceil(errorEntries.length * 0.3) },
      ],
      basedOnEvents: errorEntries.length,
      confidence: errorEntries.length >= 10 ? "high" : "medium",
    });
  }

  // pattern 4: goal completion
  const completionEntries = entries.filter((e) => e.type === "auto_complete" || e.type === "task_completed");
  if (completionEntries.length >= 3) {
    runbooks.push({
      title: "Task Completion Workflow",
      scenario: "Task auto-detected as complete",
      steps: [
        { action: "Verify completion", detail: "Check /goal-progress and /velocity for confirmation", frequency: completionEntries.length },
        { action: "Review output", detail: "Use /session-replay to verify work quality", frequency: completionEntries.length },
        { action: "Advance dependencies", detail: "Use /schedule to activate dependent tasks", frequency: Math.ceil(completionEntries.length * 0.5) },
      ],
      basedOnEvents: completionEntries.length,
      confidence: completionEntries.length >= 10 ? "high" : "medium",
    });
  }

  return runbooks;
}

/**
 * Format generated runbooks for TUI display.
 */
export function formatGeneratedRunbooks(runbooks: GeneratedRunbook[]): string[] {
  if (runbooks.length === 0) return ["  (insufficient audit data to generate runbooks — need 10+ events)"];
  const lines: string[] = [];
  for (const rb of runbooks) {
    const conf = rb.confidence === "high" ? "●" : rb.confidence === "medium" ? "◐" : "○";
    lines.push(`  ${conf} ${rb.title} (based on ${rb.basedOnEvents} events)`);
    lines.push(`    Scenario: ${rb.scenario}`);
    for (let i = 0; i < rb.steps.length; i++) {
      lines.push(`    ${i + 1}. ${rb.steps[i].action} — ${rb.steps[i].detail}`);
    }
    lines.push("");
  }
  return lines;
}

function countActions(entries: AuditEntry[]): RunbookStep[] {
  const counts = new Map<string, { detail: string; count: number }>();
  for (const e of entries) {
    const key = e.type;
    const existing = counts.get(key);
    if (existing) existing.count++;
    else counts.set(key, { detail: e.detail.slice(0, 80), count: 1 });
  }
  return [...counts.entries()].map(([action, { detail, count }]) => ({
    action, detail, frequency: count,
  })).sort((a, b) => b.frequency - a.frequency);
}
