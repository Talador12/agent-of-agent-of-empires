// cost-budget.ts — per-session cost budgets with auto-pause enforcement.
// parses cost strings from tmux output (e.g. "$3.42 spent"), compares against
// configured budget limits, and returns enforcement actions.

import type { TaskState } from "./types.js";

export interface CostBudgetConfig {
  /** Global budget in USD — applies to sessions without a per-session budget. */
  globalBudgetUsd?: number;
  /** Per-session budgets keyed by session title (case-insensitive). */
  sessionBudgets?: Record<string, number>;
}

export interface BudgetStatus {
  sessionTitle: string;
  currentCostUsd: number;
  budgetUsd: number;
  percentUsed: number;
  overBudget: boolean;
  warningLevel: "ok" | "warning" | "critical" | "exceeded";
}

/**
 * Parse a cost string like "$3.42" or "$12.50 spent" into a number.
 * Returns null if the string doesn't contain a valid cost.
 */
export function parseCostUsd(costStr: string | undefined | null): number | null {
  if (!costStr) return null;
  const match = costStr.match(/\$(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const val = parseFloat(match[1]);
  return isFinite(val) ? val : null;
}

/**
 * Get the effective budget for a session: per-session override > global default.
 * Returns null if no budget is configured.
 */
export function getEffectiveBudget(sessionTitle: string, config: CostBudgetConfig): number | null {
  if (config.sessionBudgets) {
    const lower = sessionTitle.toLowerCase();
    for (const [key, value] of Object.entries(config.sessionBudgets)) {
      if (key.toLowerCase() === lower) return value;
    }
  }
  return config.globalBudgetUsd ?? null;
}

/**
 * Compute budget status for a session.
 * Returns null if no budget is configured or no cost data available.
 */
export function computeBudgetStatus(
  sessionTitle: string,
  costStr: string | undefined,
  config: CostBudgetConfig,
): BudgetStatus | null {
  const budget = getEffectiveBudget(sessionTitle, config);
  if (budget === null) return null;

  const cost = parseCostUsd(costStr);
  if (cost === null) return null;

  const percentUsed = budget > 0 ? (cost / budget) * 100 : 0;
  const overBudget = cost >= budget;
  const warningLevel: BudgetStatus["warningLevel"] =
    overBudget ? "exceeded" :
    percentUsed >= 90 ? "critical" :
    percentUsed >= 75 ? "warning" :
    "ok";

  return {
    sessionTitle,
    currentCostUsd: cost,
    budgetUsd: budget,
    percentUsed,
    overBudget,
    warningLevel,
  };
}

/**
 * Check all sessions for budget violations and return those that should be paused.
 * Only returns sessions that are over budget and currently active.
 */
export function findOverBudgetSessions(
  sessions: Array<{ title: string; costStr?: string; status: string }>,
  config: CostBudgetConfig,
): BudgetStatus[] {
  const violations: BudgetStatus[] = [];
  for (const s of sessions) {
    if (s.status !== "active" && s.status !== "working" && s.status !== "running") continue;
    const status = computeBudgetStatus(s.title, s.costStr, config);
    if (status?.overBudget) {
      violations.push(status);
    }
  }
  return violations;
}

/**
 * Format budget status for display in the TUI.
 */
export function formatBudgetAlert(status: BudgetStatus): string {
  return `💰 BUDGET: "${status.sessionTitle}" at $${status.currentCostUsd.toFixed(2)} / $${status.budgetUsd.toFixed(2)} (${Math.round(status.percentUsed)}%) — ${status.overBudget ? "EXCEEDED, auto-pausing" : status.warningLevel}`;
}

/**
 * Format a summary of all budget statuses.
 */
export function formatBudgetSummary(statuses: BudgetStatus[]): string[] {
  if (statuses.length === 0) return ["  (no sessions with budget data)"];
  const lines: string[] = [];
  for (const s of statuses) {
    const bar = "█".repeat(Math.min(10, Math.round(s.percentUsed / 10))) +
                "░".repeat(Math.max(0, 10 - Math.round(s.percentUsed / 10)));
    const icon = s.overBudget ? "🔴" : s.warningLevel === "critical" ? "🟡" : s.warningLevel === "warning" ? "🟠" : "🟢";
    lines.push(`  ${icon} ${bar} ${s.sessionTitle}: $${s.currentCostUsd.toFixed(2)} / $${s.budgetUsd.toFixed(2)} (${Math.round(s.percentUsed)}%)`);
  }
  return lines;
}
