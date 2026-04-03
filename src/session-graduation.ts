// session-graduation.ts — auto-promote sessions from confirm→auto mode
// based on track record. sessions that consistently produce good outcomes
// earn trust and get promoted to less restrictive execution modes.

export type TrustMode = "observe" | "confirm" | "auto";

export interface GraduationState {
  sessionTitle: string;
  currentMode: TrustMode;
  successfulActions: number;
  failedActions: number;
  successRate: number;      // 0.0-1.0
  ticksSincePromotion: number;
  promotionHistory: Array<{ from: TrustMode; to: TrustMode; at: number }>;
}

export interface GraduationConfig {
  promoteThreshold: number;     // min success rate to promote (default: 0.9)
  minActionsForPromotion: number; // min actions before eligible (default: 10)
  demoteThreshold: number;      // success rate below which to demote (default: 0.5)
  cooldownTicks: number;        // min ticks between promotions (default: 30)
}

const DEFAULT_CONFIG: GraduationConfig = {
  promoteThreshold: 0.9,
  minActionsForPromotion: 10,
  demoteThreshold: 0.5,
  cooldownTicks: 30,
};

const TRUST_ORDER: TrustMode[] = ["observe", "confirm", "auto"];

/**
 * Manage session trust graduation.
 */
export class GraduationManager {
  private states = new Map<string, GraduationState>();
  private config: GraduationConfig;

  constructor(config: Partial<GraduationConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** Record a successful action for a session. */
  recordSuccess(sessionTitle: string): void {
    const state = this.ensureState(sessionTitle);
    state.successfulActions++;
    state.successRate = state.successfulActions / (state.successfulActions + state.failedActions);
  }

  /** Record a failed action for a session. */
  recordFailure(sessionTitle: string): void {
    const state = this.ensureState(sessionTitle);
    state.failedActions++;
    state.successRate = state.successfulActions / (state.successfulActions + state.failedActions);
  }

  /** Tick — check if any session should be promoted or demoted. */
  evaluate(sessionTitle: string, now = Date.now()): { action: "promote" | "demote" | "none"; from: TrustMode; to: TrustMode } {
    const state = this.ensureState(sessionTitle);
    state.ticksSincePromotion++;
    const totalActions = state.successfulActions + state.failedActions;

    // check for demotion first
    if (totalActions >= 5 && state.successRate < this.config.demoteThreshold) {
      const currentIdx = TRUST_ORDER.indexOf(state.currentMode);
      if (currentIdx > 0) {
        const from = state.currentMode;
        const to = TRUST_ORDER[currentIdx - 1];
        state.currentMode = to;
        state.ticksSincePromotion = 0;
        state.promotionHistory.push({ from, to, at: now });
        return { action: "demote", from, to };
      }
    }

    // check for promotion
    if (
      totalActions >= this.config.minActionsForPromotion &&
      state.successRate >= this.config.promoteThreshold &&
      state.ticksSincePromotion >= this.config.cooldownTicks
    ) {
      const currentIdx = TRUST_ORDER.indexOf(state.currentMode);
      if (currentIdx < TRUST_ORDER.length - 1) {
        const from = state.currentMode;
        const to = TRUST_ORDER[currentIdx + 1];
        state.currentMode = to;
        state.ticksSincePromotion = 0;
        state.promotionHistory.push({ from, to, at: now });
        return { action: "promote", from, to };
      }
    }

    return { action: "none", from: state.currentMode, to: state.currentMode };
  }

  /** Get state for a session. */
  getState(sessionTitle: string): GraduationState | undefined {
    return this.states.get(sessionTitle);
  }

  /** Format all graduation states for TUI display. */
  formatAll(): string[] {
    const states = [...this.states.values()];
    if (states.length === 0) return ["  (no graduation data)"];
    const lines: string[] = [];
    for (const s of states) {
      const total = s.successfulActions + s.failedActions;
      const rate = total > 0 ? `${Math.round(s.successRate * 100)}%` : "n/a";
      const icon = s.currentMode === "auto" ? "🟢" : s.currentMode === "confirm" ? "🟡" : "🔴";
      lines.push(`  ${icon} ${s.sessionTitle}: ${s.currentMode} (${rate} success, ${total} actions, ${s.promotionHistory.length} promotions)`);
    }
    return lines;
  }

  private ensureState(sessionTitle: string): GraduationState {
    if (!this.states.has(sessionTitle)) {
      this.states.set(sessionTitle, {
        sessionTitle,
        currentMode: "confirm",
        successfulActions: 0,
        failedActions: 0,
        successRate: 0,
        ticksSincePromotion: 0,
        promotionHistory: [],
      });
    }
    return this.states.get(sessionTitle)!;
  }
}
