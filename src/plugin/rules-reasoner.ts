// Deterministic Reasoner: no LLM, no tokens, reproducible. Implements the
// "algorithmic orchestration" use case from the design discussion — structured
// outputs are guaranteed because the rules emit the Action schema directly.
//
// Deliberately conservative: it only ever nudges sessions the orchestrator
// created (the executor enforces this too), and everything else becomes a
// `wait` carrying the reason, which the worker surfaces as a recommendation
// in the UI rather than an action.

import type { Observation, Reasoner, ReasonerResult, Action } from "../types.js";

export interface RulesReasonerOpts {
  ownedSessionIds: Set<string>;
  /** How long a session may sit in waiting/idle before a nudge (ms). */
  maxIdleBeforeNudgeMs: number;
  /** Worker-tracked time each session entered its current status. */
  statusSince: (sessionId: string) => number | undefined;
}

const NUDGE_TEXT =
  "Status check from the orchestrator: you appear to be waiting. " +
  "If you are blocked on a question, restate it concisely; otherwise continue with your task.";

export class RulesReasoner implements Reasoner {
  constructor(private readonly opts: RulesReasonerOpts) {}

  async init(): Promise<void> {}
  async shutdown(): Promise<void> {}

  async decide(observation: Observation): Promise<ReasonerResult> {
    const now = observation.timestamp;
    const actions: Action[] = [];
    const notes: string[] = [];

    for (const snap of observation.sessions) {
      const s = snap.session;
      const since = this.opts.statusSince(s.id);
      const inStatusMs = since === undefined ? 0 : Math.max(0, now - since);

      if (s.status === "error") {
        // no restart primitive in the plugin API — recommend, don't act
        notes.push(`${s.title}: in error state; needs a human (no restart primitive in plugin mode)`);
        continue;
      }
      if ((s.status === "waiting" || s.status === "idle") && inStatusMs >= this.opts.maxIdleBeforeNudgeMs) {
        if (this.opts.ownedSessionIds.has(s.id)) {
          actions.push({ action: "send_input", session: s.id, text: NUDGE_TEXT });
        } else {
          notes.push(`${s.title}: ${s.status} for ${Math.round(inStatusMs / 60_000)}m; consider checking in`);
        }
      }
    }

    if (actions.length === 0) {
      actions.push({ action: "wait", reason: notes.length ? notes.join(" | ") : "all sessions healthy" });
    }
    return {
      actions,
      reasoning: notes.length ? notes.join("\n") : undefined,
      confidence: "high", // rules are deterministic; confidence is structural
    };
  }
}
