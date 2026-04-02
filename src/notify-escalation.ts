// notify-escalation.ts — escalate stuck-task notifications progressively.
// first notification goes to the normal webhook/slack channel. if the task
// stays stuck after N intervals, escalate to a different webhook (DM, SMS, etc.)

export type EscalationLevel = "normal" | "elevated" | "critical";

export interface EscalationState {
  sessionTitle: string;
  level: EscalationLevel;
  notifyCount: number;
  firstNotifiedAt: number;
  lastNotifiedAt: number;
  lastEscalatedAt: number;
}

export interface EscalationConfig {
  elevateAfterCount: number;      // escalate to elevated after N normal notifications (default: 3)
  criticalAfterCount: number;     // escalate to critical after N elevated notifications (default: 6)
  elevatedWebhookUrl?: string;    // webhook for elevated notifications (DM, pager, etc.)
  criticalWebhookUrl?: string;    // webhook for critical notifications (SMS, phone, etc.)
  cooldownMs: number;             // min time between notifications at the same level (default: 10min)
}

const DEFAULT_CONFIG: EscalationConfig = {
  elevateAfterCount: 3,
  criticalAfterCount: 6,
  cooldownMs: 10 * 60_000,
};

/**
 * Manage notification escalation state per session.
 */
export class EscalationManager {
  private states = new Map<string, EscalationState>();
  private config: EscalationConfig;

  constructor(config: Partial<EscalationConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Record that a session needs attention (stuck, erroring, etc.).
   * Returns the escalation action to take, or null if in cooldown.
   */
  recordStuck(sessionTitle: string, now = Date.now()): {
    level: EscalationLevel;
    webhookUrl: string | null;
    message: string;
  } | null {
    let state = this.states.get(sessionTitle);
    if (!state) {
      state = {
        sessionTitle,
        level: "normal",
        notifyCount: 0,
        firstNotifiedAt: now,
        lastNotifiedAt: 0,
        lastEscalatedAt: 0,
      };
      this.states.set(sessionTitle, state);
    }

    // check cooldown
    if (state.lastNotifiedAt > 0 && (now - state.lastNotifiedAt) < this.config.cooldownMs) {
      return null; // in cooldown
    }

    state.notifyCount++;
    state.lastNotifiedAt = now;

    // determine escalation level
    const prevLevel = state.level;
    if (state.notifyCount >= this.config.criticalAfterCount) {
      state.level = "critical";
    } else if (state.notifyCount >= this.config.elevateAfterCount) {
      state.level = "elevated";
    } else {
      state.level = "normal";
    }

    if (state.level !== prevLevel) {
      state.lastEscalatedAt = now;
    }

    // determine webhook
    const webhookUrl = state.level === "critical" ? (this.config.criticalWebhookUrl ?? this.config.elevatedWebhookUrl ?? null)
      : state.level === "elevated" ? (this.config.elevatedWebhookUrl ?? null)
      : null; // normal level uses the default webhook (caller handles)

    const message = state.level === "critical"
      ? `🚨 CRITICAL: "${sessionTitle}" stuck for ${state.notifyCount} notifications — needs human intervention`
      : state.level === "elevated"
      ? `⚠️ ELEVATED: "${sessionTitle}" stuck for ${state.notifyCount} notifications — escalating`
      : `"${sessionTitle}" may be stuck (notification ${state.notifyCount})`;

    return { level: state.level, webhookUrl, message };
  }

  /** Clear escalation state (task recovered or completed). */
  clearSession(sessionTitle: string): void {
    this.states.delete(sessionTitle);
  }

  /** Get escalation state for a session. */
  getState(sessionTitle: string): EscalationState | undefined {
    return this.states.get(sessionTitle);
  }

  /** Get all escalation states. */
  getAllStates(): EscalationState[] {
    return [...this.states.values()];
  }

  /** Format escalation states for TUI display. */
  formatAll(now = Date.now()): string[] {
    const states = this.getAllStates();
    if (states.length === 0) return ["  (no active escalations)"];
    const lines: string[] = [];
    for (const s of states) {
      const icon = s.level === "critical" ? "🚨" : s.level === "elevated" ? "⚠️" : "📢";
      const age = Math.round((now - s.firstNotifiedAt) / 60_000);
      lines.push(`  ${icon} ${s.sessionTitle}: ${s.level} (${s.notifyCount} notifications, ${age}min)`);
    }
    return lines;
  }
}
