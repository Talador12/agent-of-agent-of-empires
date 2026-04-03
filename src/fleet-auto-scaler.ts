// fleet-auto-scaler.ts — add/remove session slots based on queue depth
// and utilization. computes scaling recommendations (scale-up, scale-down,
// hold) from current load vs target utilization.

export interface ScalerInput {
  currentSlots: number;
  activeSlots: number;
  queuedTasks: number;
  completionsPerHour: number;
  arrivalsPerHour: number;
}

export interface ScalingDecision {
  action: "scale-up" | "scale-down" | "hold";
  currentSlots: number;
  recommendedSlots: number;
  delta: number;
  reason: string;
  utilizationPct: number;
}

export interface AutoScalerConfig {
  minSlots: number;
  maxSlots: number;
  targetUtilizationPct: number; // aim for this utilization
  scaleUpThreshold: number;     // utilization % to trigger scale-up
  scaleDownThreshold: number;   // utilization % to trigger scale-down
  cooldownMs: number;           // min time between scaling actions
}

const DEFAULT_CONFIG: AutoScalerConfig = {
  minSlots: 1, maxSlots: 20, targetUtilizationPct: 70,
  scaleUpThreshold: 85, scaleDownThreshold: 40, cooldownMs: 300_000,
};

export interface AutoScalerState {
  config: AutoScalerConfig;
  lastScaleAt: number;
  scaleHistory: Array<{ timestamp: number; action: string; from: number; to: number }>;
}

/**
 * Create auto-scaler state.
 */
export function createAutoScaler(config?: Partial<AutoScalerConfig>): AutoScalerState {
  return { config: { ...DEFAULT_CONFIG, ...config }, lastScaleAt: 0, scaleHistory: [] };
}

/**
 * Compute scaling decision.
 */
export function computeScaling(state: AutoScalerState, input: ScalerInput, now = Date.now()): ScalingDecision {
  const cfg = state.config;
  const util = input.currentSlots > 0 ? Math.round((input.activeSlots / input.currentSlots) * 100) : 0;
  const inCooldown = now - state.lastScaleAt < cfg.cooldownMs;

  if (inCooldown) {
    return { action: "hold", currentSlots: input.currentSlots, recommendedSlots: input.currentSlots, delta: 0, reason: "in cooldown", utilizationPct: util };
  }

  // scale up: high utilization or deep queue
  if (util >= cfg.scaleUpThreshold || input.queuedTasks > input.currentSlots) {
    const needed = Math.max(1, Math.ceil(input.queuedTasks / 2));
    const target = Math.min(cfg.maxSlots, input.currentSlots + needed);
    if (target > input.currentSlots) {
      return { action: "scale-up", currentSlots: input.currentSlots, recommendedSlots: target, delta: target - input.currentSlots, reason: `util ${util}%, queue ${input.queuedTasks}`, utilizationPct: util };
    }
  }

  // scale down: low utilization and no queue
  if (util <= cfg.scaleDownThreshold && input.queuedTasks === 0) {
    const target = Math.max(cfg.minSlots, Math.ceil(input.activeSlots / (cfg.targetUtilizationPct / 100)));
    if (target < input.currentSlots) {
      return { action: "scale-down", currentSlots: input.currentSlots, recommendedSlots: target, delta: target - input.currentSlots, reason: `util ${util}%, no queue`, utilizationPct: util };
    }
  }

  return { action: "hold", currentSlots: input.currentSlots, recommendedSlots: input.currentSlots, delta: 0, reason: `util ${util}% within range`, utilizationPct: util };
}

/**
 * Record a scaling action.
 */
export function recordScaling(state: AutoScalerState, decision: ScalingDecision, now = Date.now()): void {
  if (decision.action !== "hold") {
    state.lastScaleAt = now;
    state.scaleHistory.push({ timestamp: now, action: decision.action, from: decision.currentSlots, to: decision.recommendedSlots });
    if (state.scaleHistory.length > 50) state.scaleHistory = state.scaleHistory.slice(-50);
  }
}

/**
 * Format scaling decision for TUI display.
 */
export function formatAutoScaler(decision: ScalingDecision, state: AutoScalerState): string[] {
  const lines: string[] = [];
  const icon = decision.action === "scale-up" ? "↑" : decision.action === "scale-down" ? "↓" : "→";
  lines.push(`  Auto-Scaler ${icon} [${decision.action}]: ${decision.currentSlots} slots, ${decision.utilizationPct}% util`);
  if (decision.delta !== 0) lines.push(`    Recommend: ${decision.currentSlots} → ${decision.recommendedSlots} (${decision.delta > 0 ? "+" : ""}${decision.delta})`);
  lines.push(`    Reason: ${decision.reason}`);
  if (state.scaleHistory.length > 0) {
    const recent = state.scaleHistory.slice(-3);
    lines.push(`    Recent: ${recent.map((h) => `${h.action} ${h.from}→${h.to}`).join(", ")}`);
  }
  return lines;
}
