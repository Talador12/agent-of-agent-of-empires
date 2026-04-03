// ab-reasoning.ts — run two reasoner backends on the same observation,
// compare their outputs, and track which performs better over time.

import type { ReasonerResult, Action } from "./types.js";

export interface ABTrialResult {
  timestamp: number;
  backendA: string;
  backendB: string;
  actionsA: Action[];
  actionsB: Action[];
  confidenceA?: string;
  confidenceB?: string;
  winner: "a" | "b" | "tie";
  reason: string;
}

export interface ABStats {
  totalTrials: number;
  winsA: number;
  winsB: number;
  ties: number;
  backendA: string;
  backendB: string;
}

/**
 * Compare two reasoner results and determine which is better.
 * Heuristic: more specific actions > wait, higher confidence > lower,
 * fewer redundant actions = better.
 */
export function compareResults(
  resultA: ReasonerResult,
  resultB: ReasonerResult,
  backendA: string,
  backendB: string,
  now = Date.now(),
): ABTrialResult {
  let scoreA = 0;
  let scoreB = 0;

  // prefer non-wait actions over wait
  const nonWaitA = resultA.actions.filter((a) => a.action !== "wait").length;
  const nonWaitB = resultB.actions.filter((a) => a.action !== "wait").length;
  if (nonWaitA > nonWaitB) scoreA += 2;
  else if (nonWaitB > nonWaitA) scoreB += 2;

  // prefer higher confidence
  const confOrder: Record<string, number> = { high: 3, medium: 2, low: 1 };
  const confA = confOrder[resultA.confidence ?? "medium"] ?? 2;
  const confB = confOrder[resultB.confidence ?? "medium"] ?? 2;
  if (confA > confB) scoreA += 1;
  else if (confB > confA) scoreB += 1;

  // prefer fewer total actions (more focused)
  if (resultA.actions.length > 0 && resultB.actions.length > 0) {
    if (resultA.actions.length < resultB.actions.length) scoreA += 1;
    else if (resultB.actions.length < resultA.actions.length) scoreB += 1;
  }

  const winner = scoreA > scoreB ? "a" : scoreB > scoreA ? "b" : "tie";
  const reason = `A(${nonWaitA} actions, ${resultA.confidence ?? "?"}) vs B(${nonWaitB} actions, ${resultB.confidence ?? "?"})`;

  return {
    timestamp: now,
    backendA,
    backendB,
    actionsA: resultA.actions,
    actionsB: resultB.actions,
    confidenceA: resultA.confidence,
    confidenceB: resultB.confidence,
    winner,
    reason,
  };
}

/**
 * Track A/B trial results over time.
 */
export class ABReasoningTracker {
  private trials: ABTrialResult[] = [];
  private backendA: string;
  private backendB: string;

  constructor(backendA: string, backendB: string) {
    this.backendA = backendA;
    this.backendB = backendB;
  }

  /** Record a trial result. */
  recordTrial(result: ABTrialResult): void {
    this.trials.push(result);
  }

  /** Get aggregate stats. */
  getStats(): ABStats {
    return {
      totalTrials: this.trials.length,
      winsA: this.trials.filter((t) => t.winner === "a").length,
      winsB: this.trials.filter((t) => t.winner === "b").length,
      ties: this.trials.filter((t) => t.winner === "tie").length,
      backendA: this.backendA,
      backendB: this.backendB,
    };
  }

  /** Format stats for TUI display. */
  formatStats(): string[] {
    const s = this.getStats();
    if (s.totalTrials === 0) return ["  (no A/B trials recorded yet)"];
    const pctA = s.totalTrials > 0 ? Math.round((s.winsA / s.totalTrials) * 100) : 0;
    const pctB = s.totalTrials > 0 ? Math.round((s.winsB / s.totalTrials) * 100) : 0;
    return [
      `  A/B Reasoning: ${s.totalTrials} trials`,
      `  ${s.backendA}: ${s.winsA} wins (${pctA}%)`,
      `  ${s.backendB}: ${s.winsB} wins (${pctB}%)`,
      `  Ties: ${s.ties}`,
      s.winsA > s.winsB ? `  → ${s.backendA} is performing better` :
      s.winsB > s.winsA ? `  → ${s.backendB} is performing better` :
      `  → Both backends performing equally`,
    ];
  }
}
