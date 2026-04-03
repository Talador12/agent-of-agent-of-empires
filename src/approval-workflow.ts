// approval-workflow.ts — route low-confidence decisions through the approval
// queue automatically. integrates reasoner confidence levels with the
// existing ApprovalQueue to gate risky actions.

import type { ReasonerResult, Action } from "./types.js";
import type { ApprovalQueue, PendingApproval } from "./approval-queue.js";

export interface ApprovalPolicy {
  requireApprovalBelow: "high" | "medium" | "low"; // confidence threshold (default: "low")
  alwaysApproveActions: string[];  // action types that never need approval (default: ["wait"])
  alwaysRequireActions: string[];  // action types that always need approval (default: ["remove_agent", "stop_session"])
}

const DEFAULT_POLICY: ApprovalPolicy = {
  requireApprovalBelow: "low",
  alwaysApproveActions: ["wait", "report_progress"],
  alwaysRequireActions: ["remove_agent", "stop_session"],
};

/**
 * Filter a reasoner result through the approval workflow.
 * Actions that need approval are queued; approved actions pass through.
 * Returns the filtered result with only immediately-executable actions.
 */
export function filterThroughApproval(
  result: ReasonerResult,
  queue: ApprovalQueue,
  policy: Partial<ApprovalPolicy> = {},
): { immediate: Action[]; queued: string[] } {
  const p = { ...DEFAULT_POLICY, ...policy };
  const immediate: Action[] = [];
  const queued: string[] = [];

  for (const action of result.actions) {
    if (shouldAutoApprove(action, result.confidence, p)) {
      immediate.push(action);
    } else {
      const session = actionSessionTitle(action);
      const id = queue.enqueue(
        session ?? "fleet",
        action.action,
        actionSummary(action),
        result.confidence ?? "medium",
      );
      queued.push(id);
    }
  }

  return { immediate, queued };
}

/**
 * Determine if an action should be auto-approved.
 */
export function shouldAutoApprove(
  action: Action,
  confidence: ReasonerResult["confidence"],
  policy: ApprovalPolicy = DEFAULT_POLICY,
): boolean {
  // always-approve list
  if (policy.alwaysApproveActions.includes(action.action)) return true;

  // always-require list
  if (policy.alwaysRequireActions.includes(action.action)) return false;

  // confidence-based: require approval when confidence is BELOW threshold
  // "low" threshold = require approval for nothing (all pass)
  // "medium" threshold = require approval for "low" confidence
  // "high" threshold = require approval for "low" and "medium"
  const confidenceOrder = { high: 3, medium: 2, low: 1, undefined: 2 };
  const thresholdOrder = { high: 3, medium: 2, low: 1 };
  const confLevel = confidenceOrder[confidence ?? "undefined"];
  const threshold = thresholdOrder[policy.requireApprovalBelow];

  // auto-approve if confidence is AT or ABOVE the threshold
  return confLevel > threshold;
}

function actionSessionTitle(action: Action): string | undefined {
  if ("session" in action && typeof (action as Record<string, unknown>).session === "string") {
    return (action as Record<string, unknown>).session as string;
  }
  return undefined;
}

function actionSummary(action: Action): string {
  switch (action.action) {
    case "send_input": return `send: "${action.text.slice(0, 60)}"`;
    case "start_session": return "start session";
    case "stop_session": return "stop session";
    case "create_agent": return `create: ${action.title}`;
    case "remove_agent": return "remove agent";
    case "report_progress": return `progress: ${action.summary.slice(0, 60)}`;
    case "complete_task": return `complete: ${action.summary.slice(0, 60)}`;
    case "wait": return action.reason ?? "wait";
    default: return (action as { action: string }).action;
  }
}

/**
 * Format approval workflow status for TUI display.
 */
export function formatApprovalWorkflowStatus(
  queuedCount: number,
  immediateCount: number,
): string {
  if (queuedCount === 0) return `all ${immediateCount} actions auto-approved`;
  return `${immediateCount} auto-approved, ${queuedCount} queued for approval`;
}
