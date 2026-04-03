// predictive-scaling.ts — auto-adjust pool size based on workload patterns.
// analyzes historical utilization and upcoming task queue to recommend
// scaling the concurrent session pool up or down.

export interface ScalingRecommendation {
  currentPoolSize: number;
  recommendedPoolSize: number;
  action: "scale-up" | "scale-down" | "maintain";
  reason: string;
  confidence: "low" | "medium" | "high";
}

export interface ScalingInput {
  currentPoolSize: number;
  activeSessions: number;
  pendingTasks: number;
  recentUtilizationPct: number; // avg % of pool used recently (0-100)
  peakUtilizationPct: number;   // peak % in recent window
  averageTaskDurationMs: number;
}

/**
 * Compute a scaling recommendation from current fleet state.
 */
export function recommendScaling(input: ScalingInput): ScalingRecommendation {
  const { currentPoolSize, activeSessions, pendingTasks, recentUtilizationPct, peakUtilizationPct } = input;

  // scale up if utilization is consistently high and tasks are queued
  if (recentUtilizationPct > 80 && pendingTasks > 0) {
    const newSize = Math.min(currentPoolSize * 2, currentPoolSize + pendingTasks);
    return {
      currentPoolSize,
      recommendedPoolSize: Math.ceil(newSize),
      action: "scale-up",
      reason: `${recentUtilizationPct}% utilization with ${pendingTasks} pending tasks`,
      confidence: pendingTasks > 3 ? "high" : "medium",
    };
  }

  // scale up if peak utilization hit 100% (pool was fully saturated)
  if (peakUtilizationPct >= 100 && pendingTasks > 0) {
    return {
      currentPoolSize,
      recommendedPoolSize: currentPoolSize + Math.ceil(pendingTasks * 0.5),
      action: "scale-up",
      reason: `pool saturated (peak ${peakUtilizationPct}%) with ${pendingTasks} waiting`,
      confidence: "high",
    };
  }

  // scale down if utilization is consistently low
  if (recentUtilizationPct < 30 && activeSessions < currentPoolSize * 0.5 && currentPoolSize > 2) {
    const newSize = Math.max(2, Math.ceil(activeSessions * 1.5));
    return {
      currentPoolSize,
      recommendedPoolSize: newSize,
      action: "scale-down",
      reason: `${recentUtilizationPct}% utilization, only ${activeSessions}/${currentPoolSize} active`,
      confidence: recentUtilizationPct < 15 ? "high" : "medium",
    };
  }

  return {
    currentPoolSize,
    recommendedPoolSize: currentPoolSize,
    action: "maintain",
    reason: `utilization ${recentUtilizationPct}% is within normal range`,
    confidence: "high",
  };
}

/**
 * Format scaling recommendation for TUI display.
 */
export function formatScalingRecommendation(rec: ScalingRecommendation): string[] {
  const icon = rec.action === "scale-up" ? "⬆" : rec.action === "scale-down" ? "⬇" : "─";
  const conf = rec.confidence === "high" ? "●" : rec.confidence === "medium" ? "◐" : "○";
  return [
    `  ${icon} ${conf} Pool scaling: ${rec.action} (${rec.currentPoolSize} → ${rec.recommendedPoolSize})`,
    `    ${rec.reason}`,
  ];
}
