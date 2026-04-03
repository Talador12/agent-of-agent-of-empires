// fleet-budget-planner.ts — distribute a total cost budget across sessions
// by priority, progress, and efficiency. ensures high-priority tasks get
// more budget while preventing starvation of lower-priority work.

export interface BudgetPlanInput {
  sessionTitle: string;
  priorityScore: number;     // 0-100 from goal-auto-priority
  progressPct: number;        // 0-100 current progress
  costUsd: number;            // spent so far
  burnRatePerHr: number;      // current $/hr
  status: string;
}

export interface BudgetAllocationResult {
  sessionTitle: string;
  allocatedBudgetUsd: number;
  remainingBudgetUsd: number;
  pctOfTotal: number;
  reason: string;
}

export interface BudgetPlan {
  totalBudgetUsd: number;
  allocations: BudgetAllocationResult[];
  unallocatedUsd: number;
  reserveUsd: number;         // emergency reserve
}

/**
 * Distribute budget across sessions.
 */
export function planBudget(
  inputs: BudgetPlanInput[],
  totalBudgetUsd: number,
  reservePct = 10,
): BudgetPlan {
  if (inputs.length === 0 || totalBudgetUsd <= 0) {
    return { totalBudgetUsd, allocations: [], unallocatedUsd: totalBudgetUsd, reserveUsd: 0 };
  }

  const reserveUsd = Math.round(totalBudgetUsd * (reservePct / 100) * 100) / 100;
  const distributableUsd = totalBudgetUsd - reserveUsd;

  // filter to active/pending sessions only
  const eligible = inputs.filter((i) => i.status === "active" || i.status === "pending");
  if (eligible.length === 0) {
    return { totalBudgetUsd, allocations: [], unallocatedUsd: distributableUsd, reserveUsd };
  }

  // score each session: priority * (1 - progress/200) to give more to less-done high-priority tasks
  const scored = eligible.map((i) => ({
    ...i,
    allocScore: Math.max(1, i.priorityScore) * (1 - i.progressPct / 200), // near-complete tasks get less
  }));

  // minimum allocation: ensure no session gets $0
  const minPerSession = Math.min(1.0, distributableUsd / eligible.length);

  const totalScore = scored.reduce((a, s) => a + s.allocScore, 0);

  const allocations: BudgetAllocationResult[] = scored.map((s) => {
    const share = totalScore > 0 ? (s.allocScore / totalScore) * distributableUsd : distributableUsd / eligible.length;
    const allocated = Math.max(minPerSession, Math.round(share * 100) / 100);
    const remaining = Math.max(0, allocated - s.costUsd);

    let reason: string;
    if (s.priorityScore >= 70) reason = "high priority";
    else if (s.progressPct >= 80) reason = "near completion — reduced allocation";
    else reason = "standard allocation";

    return {
      sessionTitle: s.sessionTitle,
      allocatedBudgetUsd: allocated,
      remainingBudgetUsd: remaining,
      pctOfTotal: Math.round((allocated / totalBudgetUsd) * 100),
      reason,
    };
  });

  const totalAllocated = allocations.reduce((a, b) => a + b.allocatedBudgetUsd, 0);
  const unallocated = Math.max(0, Math.round((distributableUsd - totalAllocated) * 100) / 100);

  return { totalBudgetUsd, allocations, unallocatedUsd: unallocated, reserveUsd };
}

/**
 * Format budget plan for TUI display.
 */
export function formatBudgetPlan(plan: BudgetPlan): string[] {
  const lines: string[] = [];
  lines.push(`  Fleet Budget Plan ($${plan.totalBudgetUsd.toFixed(2)} total, $${plan.reserveUsd.toFixed(2)} reserve):`);
  if (plan.allocations.length === 0) {
    lines.push("    No eligible sessions for budget allocation");
    return lines;
  }
  lines.push(`  ${"Session".padEnd(18)} ${"Budget".padStart(9)} ${"Remain".padStart(9)} ${"% Tot".padStart(6)} ${"Reason"}`);
  for (const a of plan.allocations) {
    lines.push(`  ${a.sessionTitle.slice(0, 18).padEnd(18)} ${"$" + a.allocatedBudgetUsd.toFixed(2).padStart(8)} ${"$" + a.remainingBudgetUsd.toFixed(2).padStart(8)} ${(a.pctOfTotal + "%").padStart(6)} ${a.reason}`);
  }
  if (plan.unallocatedUsd > 0) {
    lines.push(`    Unallocated: $${plan.unallocatedUsd.toFixed(2)}`);
  }
  return lines;
}
