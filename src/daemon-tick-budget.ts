// daemon-tick-budget.ts — allocate compute time budget per tick phase.
// prevents any single phase from consuming the entire tick. sets max
// durations per phase and tracks overruns.

export interface PhaseBudget {
  phase: string;
  budgetMs: number;
  actualMs: number;
  overrun: boolean;
}

export interface TickBudgetConfig {
  totalBudgetMs: number;
  phaseAllocations: Map<string, number>; // phase -> % of total
}

export interface TickBudgetState {
  config: TickBudgetConfig;
  overruns: Array<{ tickNum: number; phase: string; budgetMs: number; actualMs: number }>;
  maxOverruns: number;
}

/**
 * Create tick budget state with default allocations.
 */
export function createTickBudget(totalBudgetMs = 10_000): TickBudgetState {
  const phaseAllocations = new Map<string, number>([
    ["poll", 30],     // 30% for polling
    ["reason", 40],   // 40% for reasoning
    ["execute", 20],  // 20% for execution
    ["post-tick", 10],// 10% for post-tick housekeeping
  ]);
  return { config: { totalBudgetMs, phaseAllocations }, overruns: [], maxOverruns: 50 };
}

/**
 * Get the budget in ms for a specific phase.
 */
export function getPhaseBudget(state: TickBudgetState, phase: string): number {
  const pct = state.config.phaseAllocations.get(phase) ?? 10;
  return Math.round(state.config.totalBudgetMs * (pct / 100));
}

/**
 * Check all phases against their budgets.
 */
export function checkBudgets(state: TickBudgetState, tickNum: number, actuals: Map<string, number>): PhaseBudget[] {
  const results: PhaseBudget[] = [];
  for (const [phase, pct] of state.config.phaseAllocations) {
    const budgetMs = Math.round(state.config.totalBudgetMs * (pct / 100));
    const actualMs = actuals.get(phase) ?? 0;
    const overrun = actualMs > budgetMs;
    results.push({ phase, budgetMs, actualMs, overrun });
    if (overrun) {
      state.overruns.push({ tickNum, phase, budgetMs, actualMs });
      if (state.overruns.length > state.maxOverruns) state.overruns = state.overruns.slice(-state.maxOverruns);
    }
  }
  return results;
}

/**
 * Get recent overruns.
 */
export function recentOverruns(state: TickBudgetState, limit = 5): TickBudgetState["overruns"] {
  return state.overruns.slice(-limit);
}

/**
 * Get the most overrun phase.
 */
export function worstPhase(state: TickBudgetState): { phase: string; count: number } | null {
  if (state.overruns.length === 0) return null;
  const counts = new Map<string, number>();
  for (const o of state.overruns) counts.set(o.phase, (counts.get(o.phase) ?? 0) + 1);
  let worst = { phase: "", count: 0 };
  for (const [p, c] of counts) { if (c > worst.count) worst = { phase: p, count: c }; }
  return worst.count > 0 ? worst : null;
}

/**
 * Format tick budget for TUI display.
 */
export function formatTickBudget(state: TickBudgetState): string[] {
  const lines: string[] = [];
  const worst = worstPhase(state);
  lines.push(`  Tick Budget (${state.config.totalBudgetMs}ms total, ${state.overruns.length} overruns):`);
  for (const [phase, pct] of state.config.phaseAllocations) {
    const budget = Math.round(state.config.totalBudgetMs * (pct / 100));
    const marker = worst?.phase === phase ? " ← worst" : "";
    lines.push(`    ${phase.padEnd(12)} ${pct}% = ${budget}ms${marker}`);
  }
  const recent = recentOverruns(state, 3);
  if (recent.length > 0) {
    lines.push("  Recent overruns:");
    for (const o of recent) lines.push(`    tick#${o.tickNum} ${o.phase}: ${o.actualMs}ms > ${o.budgetMs}ms`);
  }
  return lines;
}
