// fleet-runbook-library.ts — pre-built runbooks for common fleet
// operational scenarios. provides searchable, parameterized runbook
// definitions that operators can execute step by step.

export interface RunbookStep {
  order: number;
  action: string;
  description: string;
  command?: string;     // TUI command to execute
  automated: boolean;   // can be auto-executed vs manual
}

export interface Runbook {
  id: string;
  name: string;
  description: string;
  category: "incident" | "maintenance" | "scaling" | "cost" | "debugging";
  steps: RunbookStep[];
  tags: string[];
}

const BUILTIN_RUNBOOKS: Runbook[] = [
  {
    id: "stuck-session", name: "Stuck Session Recovery",
    description: "Recover a session that is stuck with no progress",
    category: "incident",
    tags: ["stuck", "recovery", "session"],
    steps: [
      { order: 1, action: "check-heartbeat", description: "Verify session pane is alive", command: "/heartbeat", automated: true },
      { order: 2, action: "check-sentiment", description: "Analyze output tone", command: "/sentiment", automated: true },
      { order: 3, action: "nudge-session", description: "Send a nudge to unstick", automated: false },
      { order: 4, action: "check-progress", description: "Wait 2 ticks, check for progress", command: "/goal-confidence", automated: true },
      { order: 5, action: "restart-if-needed", description: "Restart session if still stuck", automated: false },
    ],
  },
  {
    id: "cost-overspend", name: "Cost Overspend Mitigation",
    description: "Respond to sessions exceeding cost budgets",
    category: "cost",
    tags: ["cost", "budget", "throttle"],
    steps: [
      { order: 1, action: "check-cost-regression", description: "Identify cost anomalies", command: "/cost-regression", automated: true },
      { order: 2, action: "check-forecast", description: "Review cost projections", command: "/cost-forecast", automated: true },
      { order: 3, action: "throttle", description: "Apply cost throttle", command: "/cost-throttle", automated: true },
      { order: 4, action: "review-budget", description: "Review budget allocation", command: "/budget-plan", automated: true },
      { order: 5, action: "pause-if-needed", description: "Pause highest-burn session", automated: false },
    ],
  },
  {
    id: "fleet-health-drop", name: "Fleet Health Recovery",
    description: "Respond to fleet-wide health degradation",
    category: "incident",
    tags: ["health", "fleet", "recovery"],
    steps: [
      { order: 1, action: "check-health", description: "Get composite health score", command: "/health-score", automated: true },
      { order: 2, action: "check-incidents", description: "Review incident timeline", command: "/incidents", automated: true },
      { order: 3, action: "check-anomalies", description: "Look for correlated anomalies", command: "/anomaly-corr", automated: true },
      { order: 4, action: "check-compliance", description: "Run compliance check", command: "/compliance", automated: true },
      { order: 5, action: "generate-handoff", description: "Generate handoff for escalation", command: "/handoff", automated: true },
    ],
  },
  {
    id: "scale-up", name: "Fleet Scale-Up",
    description: "Add capacity when queue is deep",
    category: "scaling",
    tags: ["scaling", "capacity", "pool"],
    steps: [
      { order: 1, action: "check-capacity", description: "Review capacity forecast", command: "/capacity-forecast", automated: true },
      { order: 2, action: "check-scaler", description: "Get auto-scaler recommendation", command: "/auto-scaler", automated: true },
      { order: 3, action: "warm-slots", description: "Pre-warm standby slots", command: "/warm-standby", automated: true },
      { order: 4, action: "scale", description: "Increase pool size", automated: false },
    ],
  },
  {
    id: "shift-handoff", name: "Operator Shift Handoff",
    description: "Prepare fleet state for incoming operator",
    category: "maintenance",
    tags: ["handoff", "shift", "operator"],
    steps: [
      { order: 1, action: "generate-digest", description: "Generate daily digest", command: "/daily-digest", automated: true },
      { order: 2, action: "generate-handoff", description: "Generate handoff notes", command: "/handoff", automated: true },
      { order: 3, action: "check-readiness", description: "Verify fleet readiness", command: "/readiness", automated: true },
      { order: 4, action: "check-slas", description: "Review goal SLAs", command: "/goal-sla", automated: true },
      { order: 5, action: "review-alerts", description: "Review active alerts", command: "/alert-dashboard", automated: true },
    ],
  },
  {
    id: "debug-session", name: "Session Debugging",
    description: "Deep-dive debug a problematic session",
    category: "debugging",
    tags: ["debug", "session", "output"],
    steps: [
      { order: 1, action: "check-structured-log", description: "Parse output into structured events", command: "/structured-log", automated: true },
      { order: 2, action: "check-output-diff", description: "Compare recent output changes", automated: false },
      { order: 3, action: "check-annotations", description: "Review output annotations", command: "/annotate", automated: true },
      { order: 4, action: "check-lang", description: "Detect programming language", command: "/lang-detect", automated: true },
      { order: 5, action: "export-transcript", description: "Export full transcript for analysis", automated: false },
    ],
  },
];

/**
 * Get all available runbooks.
 */
export function listRunbooks(userRunbooks: Runbook[] = []): Runbook[] {
  return [...BUILTIN_RUNBOOKS, ...userRunbooks];
}

/**
 * Get a runbook by ID.
 */
export function getRunbook(id: string, userRunbooks: Runbook[] = []): Runbook | null {
  return listRunbooks(userRunbooks).find((r) => r.id === id) ?? null;
}

/**
 * Search runbooks by keyword (matches name, description, tags).
 */
export function searchRunbooks(query: string, userRunbooks: Runbook[] = []): Runbook[] {
  const q = query.toLowerCase();
  return listRunbooks(userRunbooks).filter((r) =>
    r.name.toLowerCase().includes(q) ||
    r.description.toLowerCase().includes(q) ||
    r.tags.some((t) => t.includes(q)),
  );
}

/**
 * Format runbook list for TUI display.
 */
export function formatRunbookList(runbooks: Runbook[]): string[] {
  if (runbooks.length === 0) return ["  Runbook Library: no runbooks found"];
  const lines: string[] = [];
  lines.push(`  Runbook Library (${runbooks.length} runbooks):`);
  for (const r of runbooks) {
    lines.push(`    [${r.id}] ${r.name} (${r.category}, ${r.steps.length} steps)`);
    lines.push(`      ${r.description}`);
  }
  return lines;
}

/**
 * Format a single runbook's steps for TUI display.
 */
export function formatRunbookSteps(runbook: Runbook): string[] {
  const lines: string[] = [];
  lines.push(`  Runbook: ${runbook.name}`);
  lines.push(`  ${runbook.description}`);
  for (const s of runbook.steps) {
    const auto = s.automated ? "🤖" : "👤";
    const cmd = s.command ? ` → ${s.command}` : "";
    lines.push(`    ${s.order}. ${auto} ${s.description}${cmd}`);
  }
  return lines;
}
