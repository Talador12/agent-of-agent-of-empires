// extracted tick logic — testable without real shell calls
// the main daemon (index.ts) wires this up with real Poller/Reasoner/Executor;
// tests wire it up with mocks.

import { detectPermissionPrompt, type SessionPolicyState } from "./reasoner/prompt.js";
import type { AoaoeConfig, Observation, Reasoner, ReasonerResult, Action, SessionSnapshot } from "./types.js";

// minimal interfaces so tick() doesn't depend on concrete classes
export interface PollerLike {
  poll(): Promise<Observation>;
}

export interface ExecutorLike {
  execute(actions: Action[], snapshots: SessionSnapshot[]): Promise<ActionResult[]>;
}

export interface ActionResult {
  action: Action;
  success: boolean;
  detail: string;
}

export interface TickResult {
  observation: Observation;
  result: ReasonerResult | null; // null if reasoning was skipped
  executed: ActionResult[];
  skippedReason?: string; // why reasoning was skipped (no changes, no sessions, etc.)
  dryRunActions?: Action[]; // actions that would have been executed in dry-run mode
}

/**
 * One tick of the daemon loop: poll -> reason -> execute.
 * Returns a structured result for testing and inspection.
 */
export async function tick(opts: {
  config: AoaoeConfig;
  poller: PollerLike;
  reasoner: Reasoner;
  executor: ExecutorLike;
  policyStates: Map<string, SessionPolicyState>;
  pollCount: number;
  userMessage?: string;
}): Promise<TickResult> {
  const { config, poller, reasoner, executor, policyStates, pollCount, userMessage } = opts;

  // 1. poll
  const observation = await poller.poll();
  const now = Date.now();

  // update per-session policy tracking
  const changedIds = new Set(observation.changes.map((c) => c.sessionId));
  for (const snap of observation.sessions) {
    const sid = snap.session.id;
    let ps = policyStates.get(sid);
    if (!ps) {
      ps = { sessionId: sid, lastOutputChangeAt: now, consecutiveErrorPolls: 0, hasPermissionPrompt: false };
      policyStates.set(sid, ps);
    }
    if (changedIds.has(sid)) {
      ps.lastOutputChangeAt = now;
    }
    if (snap.session.status === "error") {
      ps.consecutiveErrorPolls++;
    } else {
      ps.consecutiveErrorPolls = 0;
    }
    ps.hasPermissionPrompt = detectPermissionPrompt(snap.output);
  }

  // prune stale policy states
  const activeIds = new Set(observation.sessions.map((s) => s.session.id));
  for (const key of policyStates.keys()) {
    if (!activeIds.has(key)) policyStates.delete(key);
  }

  // attach user message
  if (userMessage) {
    observation.userMessage = userMessage;
  }

  // no sessions and no user message -> skip
  if (observation.sessions.length === 0 && !userMessage) {
    return { observation, result: null, executed: [], skippedReason: "no sessions" };
  }

  // check policy alerts
  const policyAlerts = [...policyStates.values()].filter((ps) =>
    (now - ps.lastOutputChangeAt >= config.policies.maxIdleBeforeNudgeMs) ||
    (ps.consecutiveErrorPolls >= config.policies.maxErrorsBeforeRestart) ||
    (ps.hasPermissionPrompt && config.policies.autoAnswerPermissions)
  );

  // no changes, no user message, no policy alerts -> skip reasoning
  if (observation.changes.length === 0 && !userMessage && policyAlerts.length === 0) {
    return { observation, result: null, executed: [], skippedReason: "no changes" };
  }

  // attach policy context
  observation.policyContext = {
    policies: config.policies,
    sessionStates: [...policyStates.values()],
  };

  // 2. reason
  const result = await reasoner.decide(observation);

  // 3. execute (skip wait-only results)
  const nonWaitActions = result.actions.filter((a) => a.action !== "wait");
  if (nonWaitActions.length === 0) {
    return { observation, result, executed: [] };
  }

  // dry-run: return what would have been executed
  if (config.dryRun) {
    return { observation, result, executed: [], dryRunActions: nonWaitActions };
  }

  const executed = await executor.execute(nonWaitActions, observation.sessions);
  return { observation, result, executed };
}
