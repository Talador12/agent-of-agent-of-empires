// recovery-playbook.ts — auto-execute recovery steps when session health drops.
// defines named recovery actions and triggers them based on health thresholds.

export type RecoveryAction = "nudge" | "restart" | "pause" | "escalate" | "custom";

export interface RecoveryStep {
  condition: string;       // human-readable trigger condition
  action: RecoveryAction;
  detail: string;          // what to do (e.g., message to send, command to run)
  minHealthScore: number;  // trigger when health drops to or below this
  maxRetries: number;      // max times to attempt this step (default: 1)
}

export interface RecoveryPlan {
  sessionTitle: string;
  steps: Array<RecoveryStep & { triggered: boolean; attempts: number }>;
}

/**
 * Default recovery playbook for a session.
 * Steps are ordered from least to most aggressive.
 */
export function defaultPlaybook(): RecoveryStep[] {
  return [
    { condition: "health < 60", action: "nudge", detail: "Are you making progress? Check your current task.", minHealthScore: 60, maxRetries: 2 },
    { condition: "health < 40", action: "restart", detail: "Session appears stuck — restarting opencode", minHealthScore: 40, maxRetries: 1 },
    { condition: "health < 20", action: "pause", detail: "Critical health — pausing task for human review", minHealthScore: 20, maxRetries: 1 },
    { condition: "health < 10", action: "escalate", detail: "Session in critical state — escalating to operator", minHealthScore: 10, maxRetries: 1 },
  ];
}

/**
 * Manage recovery playbooks per session.
 */
export class RecoveryPlaybookManager {
  private plans = new Map<string, RecoveryPlan>();
  private customPlaybook: RecoveryStep[];

  constructor(playbook?: RecoveryStep[]) {
    this.customPlaybook = playbook ?? defaultPlaybook();
  }

  /**
   * Evaluate a session's health and determine recovery actions.
   * Returns the actions to take (may be empty if no thresholds crossed
   * or max retries exhausted).
   */
  evaluate(sessionTitle: string, healthScore: number): Array<{ action: RecoveryAction; detail: string }> {
    if (!this.plans.has(sessionTitle)) {
      this.plans.set(sessionTitle, {
        sessionTitle,
        steps: this.customPlaybook.map((s) => ({ ...s, triggered: false, attempts: 0 })),
      });
    }

    const plan = this.plans.get(sessionTitle)!;
    const actions: Array<{ action: RecoveryAction; detail: string }> = [];

    for (const step of plan.steps) {
      if (healthScore <= step.minHealthScore && step.attempts < step.maxRetries) {
        if (!step.triggered) {
          step.triggered = true;
          step.attempts++;
          actions.push({ action: step.action, detail: step.detail });
        }
      }
      // reset trigger if health recovers
      if (healthScore > step.minHealthScore + 10) {
        step.triggered = false;
      }
    }

    return actions;
  }

  /** Clear recovery state for a session (task completed/removed). */
  clearSession(sessionTitle: string): void {
    this.plans.delete(sessionTitle);
  }

  /** Get the plan for a session. */
  getPlan(sessionTitle: string): RecoveryPlan | undefined {
    return this.plans.get(sessionTitle);
  }

  /** Format recovery states for TUI display. */
  formatAll(): string[] {
    const plans = [...this.plans.values()];
    if (plans.length === 0) return ["  (no recovery plans active)"];
    const lines: string[] = [];
    for (const p of plans) {
      const triggered = p.steps.filter((s) => s.triggered);
      const icon = triggered.length > 0 ? "🏥" : "✓";
      const status = triggered.length > 0
        ? triggered.map((s) => `${s.action}(${s.attempts}/${s.maxRetries})`).join(", ")
        : "nominal";
      lines.push(`  ${icon} ${p.sessionTitle}: ${status}`);
    }
    return lines;
  }
}
