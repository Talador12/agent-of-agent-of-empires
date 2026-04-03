// goal-sla-enforcement.ts — per-goal time limits with auto-escalation
// on breach. tracks goal start times, monitors elapsed time, and fires
// alerts/escalations when SLA thresholds are exceeded.

export interface GoalSla {
  sessionTitle: string;
  goal: string;
  startedAt: number;
  slaHours: number;
  warningPct: number;  // % of SLA at which to warn (default 80)
}

export type SlaStatus = "ok" | "warning" | "breached";

export interface SlaCheck {
  sessionTitle: string;
  goal: string;
  status: SlaStatus;
  elapsedHours: number;
  slaHours: number;
  remainingHours: number;
  pctUsed: number;
  message: string;
}

export interface SlaState {
  goals: GoalSla[];
}

/**
 * Create SLA state.
 */
export function createSlaState(): SlaState {
  return { goals: [] };
}

/**
 * Register a goal with an SLA time limit.
 */
export function registerGoalSla(state: SlaState, sessionTitle: string, goal: string, slaHours: number, warningPct = 80, now = Date.now()): void {
  // remove existing SLA for this session
  state.goals = state.goals.filter((g) => g.sessionTitle !== sessionTitle);
  state.goals.push({ sessionTitle, goal, startedAt: now, slaHours, warningPct });
}

/**
 * Remove a goal SLA (e.g. when completed).
 */
export function removeGoalSla(state: SlaState, sessionTitle: string): boolean {
  const before = state.goals.length;
  state.goals = state.goals.filter((g) => g.sessionTitle !== sessionTitle);
  return state.goals.length < before;
}

/**
 * Check all goals against their SLAs.
 */
export function checkGoalSlas(state: SlaState, now = Date.now()): SlaCheck[] {
  return state.goals.map((g) => {
    const elapsedMs = now - g.startedAt;
    const elapsedHours = elapsedMs / 3_600_000;
    const remainingHours = Math.max(0, g.slaHours - elapsedHours);
    const pctUsed = g.slaHours > 0 ? Math.round((elapsedHours / g.slaHours) * 100) : 0;

    let status: SlaStatus = "ok";
    let message: string;

    if (pctUsed >= 100) {
      status = "breached";
      message = `SLA breached: ${elapsedHours.toFixed(1)}h elapsed, limit was ${g.slaHours}h`;
    } else if (pctUsed >= g.warningPct) {
      status = "warning";
      message = `SLA warning: ${pctUsed}% used (${remainingHours.toFixed(1)}h remaining)`;
    } else {
      message = `On track: ${pctUsed}% used (${remainingHours.toFixed(1)}h remaining)`;
    }

    return { sessionTitle: g.sessionTitle, goal: g.goal, status, elapsedHours: Math.round(elapsedHours * 10) / 10, slaHours: g.slaHours, remainingHours: Math.round(remainingHours * 10) / 10, pctUsed, message };
  }).sort((a, b) => b.pctUsed - a.pctUsed);
}

/**
 * Get breached SLAs.
 */
export function getBreachedSlas(state: SlaState, now = Date.now()): SlaCheck[] {
  return checkGoalSlas(state, now).filter((c) => c.status === "breached");
}

/**
 * Format SLA checks for TUI display.
 */
export function formatSlaChecks(checks: SlaCheck[]): string[] {
  if (checks.length === 0) return ["  Goal SLAs: no SLAs registered"];
  const lines: string[] = [];
  const breached = checks.filter((c) => c.status === "breached").length;
  const warning = checks.filter((c) => c.status === "warning").length;
  lines.push(`  Goal SLA Enforcement (${checks.length} goals: ${breached} breached, ${warning} warning):`);
  for (const c of checks) {
    const icon = c.status === "breached" ? "🔴" : c.status === "warning" ? "🟡" : "🟢";
    lines.push(`    ${icon} ${c.sessionTitle}: ${c.pctUsed}% of ${c.slaHours}h SLA — ${c.message}`);
  }
  return lines;
}
