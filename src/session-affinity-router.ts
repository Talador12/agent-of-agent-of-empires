// session-affinity-router.ts — assign sessions to preferred reasoner instances.
// routes sessions based on repo path, tags, historical performance, and explicit
// affinity rules. supports sticky routing (prefer last-used instance) and
// weighted scoring for multi-criteria decisions. zero dependencies.

/** available reasoner instance */
export interface ReasonerInstance {
  id: string;
  backend: string;              // "opencode" | "claude-code"
  model?: string;
  maxConcurrent: number;
  currentLoad: number;
  tags?: string[];              // capability tags (e.g. "frontend", "rust", "infra")
}

/** session requesting routing */
export interface RoutableSession {
  title: string;
  repo?: string;
  tags?: string[];
  lastReasonerId?: string;      // sticky: prefer this instance if available
}

/** explicit affinity rule */
export interface AffinityRule {
  match: { repo?: string; tag?: string };
  preferInstanceId?: string;
  preferBackend?: string;
  weight?: number;              // bonus score for matching (default: 20)
}

/** routing decision */
export interface RoutingDecision {
  sessionTitle: string;
  instanceId: string;
  score: number;
  reasons: string[];
}

/** routing result */
export interface RoutingResult {
  decisions: RoutingDecision[];
  unroutable: string[];         // sessions that couldn't be assigned
  instanceLoads: Map<string, number>; // projected load per instance
}

/** performance history for sticky routing */
export interface PerformanceRecord {
  instanceId: string;
  sessionTitle: string;
  successCount: number;
  failCount: number;
  avgDurationMs: number;
}

/** state for the affinity router */
export interface AffinityState {
  rules: AffinityRule[];
  history: PerformanceRecord[];
}

/** create initial affinity state */
export function createAffinityState(rules: AffinityRule[] = []): AffinityState {
  return { rules, history: [] };
}

/** record a reasoning call outcome for future routing decisions */
export function recordOutcome(
  state: AffinityState,
  instanceId: string,
  sessionTitle: string,
  success: boolean,
  durationMs: number,
): void {
  let record = state.history.find(
    (r) => r.instanceId === instanceId && r.sessionTitle === sessionTitle,
  );
  if (!record) {
    record = { instanceId, sessionTitle, successCount: 0, failCount: 0, avgDurationMs: 0 };
    state.history.push(record);
  }
  if (success) record.successCount++;
  else record.failCount++;

  const total = record.successCount + record.failCount;
  record.avgDurationMs = record.avgDurationMs * ((total - 1) / total) + durationMs / total;

  // cap history
  if (state.history.length > 500) {
    state.history = state.history.slice(-250);
  }
}

/** score an instance for a session */
function scoreInstance(
  instance: ReasonerInstance,
  session: RoutableSession,
  rules: AffinityRule[],
  history: PerformanceRecord[],
): { score: number; reasons: string[] } {
  let score = 50; // base score
  const reasons: string[] = [];

  // capacity: penalize full instances, bonus for light load
  const loadPct = instance.currentLoad / Math.max(1, instance.maxConcurrent);
  if (loadPct >= 1) {
    score -= 100; // effectively blocked
    reasons.push("at capacity");
  } else if (loadPct < 0.5) {
    score += 10;
    reasons.push("light load");
  }

  // sticky routing: prefer last-used instance
  if (session.lastReasonerId === instance.id) {
    score += 15;
    reasons.push("sticky (last used)");
  }

  // tag matching: bonus for shared tags
  if (instance.tags && session.tags) {
    const shared = instance.tags.filter((t) => session.tags!.includes(t));
    if (shared.length > 0) {
      score += shared.length * 5;
      reasons.push(`tags: ${shared.join(", ")}`);
    }
  }

  // affinity rules
  for (const rule of rules) {
    let matches = false;
    if (rule.match.repo && session.repo?.includes(rule.match.repo)) matches = true;
    if (rule.match.tag && session.tags?.includes(rule.match.tag)) matches = true;
    if (matches) {
      if (rule.preferInstanceId === instance.id) {
        score += rule.weight ?? 20;
        reasons.push(`affinity rule: ${rule.match.repo ?? rule.match.tag}`);
      }
      if (rule.preferBackend === instance.backend) {
        score += (rule.weight ?? 20) / 2;
        reasons.push(`backend affinity: ${rule.preferBackend}`);
      }
    }
  }

  // historical performance
  const perf = history.find(
    (r) => r.instanceId === instance.id && r.sessionTitle === session.title,
  );
  if (perf) {
    const total = perf.successCount + perf.failCount;
    if (total >= 3) {
      const successRate = perf.successCount / total;
      if (successRate > 0.8) {
        score += 10;
        reasons.push(`history: ${Math.round(successRate * 100)}% success`);
      } else if (successRate < 0.5) {
        score -= 15;
        reasons.push(`history: ${Math.round(successRate * 100)}% success (poor)`);
      }
    }
  }

  return { score, reasons };
}

/** route sessions to reasoner instances */
export function routeSessions(
  sessions: RoutableSession[],
  instances: ReasonerInstance[],
  state: AffinityState,
): RoutingResult {
  const decisions: RoutingDecision[] = [];
  const unroutable: string[] = [];
  const loadDelta = new Map<string, number>(); // track projected load changes

  for (const session of sessions) {
    let best: { instanceId: string; score: number; reasons: string[] } | null = null;

    for (const instance of instances) {
      const projectedLoad = instance.currentLoad + (loadDelta.get(instance.id) ?? 0);
      const adjustedInstance = { ...instance, currentLoad: projectedLoad };
      const { score, reasons } = scoreInstance(adjustedInstance, session, state.rules, state.history);

      if (!best || score > best.score) {
        best = { instanceId: instance.id, score, reasons };
      }
    }

    if (best && best.score > 0) {
      decisions.push({
        sessionTitle: session.title,
        instanceId: best.instanceId,
        score: best.score,
        reasons: best.reasons,
      });
      loadDelta.set(best.instanceId, (loadDelta.get(best.instanceId) ?? 0) + 1);
    } else {
      unroutable.push(session.title);
    }
  }

  // compute projected loads
  const instanceLoads = new Map<string, number>();
  for (const inst of instances) {
    instanceLoads.set(inst.id, inst.currentLoad + (loadDelta.get(inst.id) ?? 0));
  }

  return { decisions, unroutable, instanceLoads };
}

/** format routing result for TUI display */
export function formatAffinityRouting(result: RoutingResult): string[] {
  const lines: string[] = [];
  lines.push(`affinity router: ${result.decisions.length} routed, ${result.unroutable.length} unroutable`);

  for (const d of result.decisions) {
    const reasonStr = d.reasons.length > 0 ? ` (${d.reasons.join(", ")})` : "";
    lines.push(`  ${d.sessionTitle} → ${d.instanceId} [score=${d.score}]${reasonStr}`);
  }

  if (result.unroutable.length > 0) {
    lines.push(`  unroutable: ${result.unroutable.join(", ")}`);
  }

  lines.push("  instance loads:");
  for (const [id, load] of result.instanceLoads) {
    lines.push(`    ${id}: ${load}`);
  }

  return lines;
}
