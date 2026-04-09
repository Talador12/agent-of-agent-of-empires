// fleet-priority-matrix.ts — 2D urgency vs importance matrix for sessions.
// classifies sessions into quadrants (do-first, schedule, delegate, eliminate)
// using urgency signals (errors, stuck, deadline) and importance signals
// (priority, dependencies, cost). zero dependencies.

/** urgency level */
export type UrgencyLevel = "critical" | "high" | "medium" | "low";

/** importance level */
export type ImportanceLevel = "critical" | "high" | "medium" | "low";

/** matrix quadrant */
export type Quadrant = "do-first" | "schedule" | "delegate" | "eliminate";

/** input for matrix classification */
export interface MatrixInput {
  sessionTitle: string;
  // urgency signals
  hasErrors: boolean;
  isStuck: boolean;
  stuckDurationMs: number;
  nudgeCount: number;
  healthScore: number;       // 0-100
  deadlineMs?: number;       // ms until deadline (0 = no deadline)
  // importance signals
  priority: "critical" | "high" | "normal" | "low";
  dependentCount: number;    // how many other tasks depend on this
  costUsd: number;           // accumulated cost
  progressPct: number;       // 0-100
  isBlocking: boolean;       // blocks other sessions
}

/** classified session with quadrant assignment */
export interface MatrixEntry {
  sessionTitle: string;
  urgency: UrgencyLevel;
  urgencyScore: number;      // 0-100
  importance: ImportanceLevel;
  importanceScore: number;   // 0-100
  quadrant: Quadrant;
  recommendation: string;
}

/** matrix result */
export interface MatrixResult {
  entries: MatrixEntry[];
  quadrantCounts: Record<Quadrant, number>;
  avgUrgency: number;
  avgImportance: number;
}

/** compute urgency score (0-100) */
export function computeUrgency(input: MatrixInput): number {
  let score = 0;

  // errors are urgent
  if (input.hasErrors) score += 30;

  // stuck is urgent, more so with duration
  if (input.isStuck) {
    score += 20;
    if (input.stuckDurationMs > 600_000) score += 10;  // >10 min
    if (input.stuckDurationMs > 1_800_000) score += 10; // >30 min
  }

  // nudge count signals repeated urgency
  score += Math.min(15, input.nudgeCount * 5);

  // low health is urgent
  if (input.healthScore < 30) score += 15;
  else if (input.healthScore < 60) score += 5;

  // deadline proximity
  if (input.deadlineMs !== undefined && input.deadlineMs > 0) {
    if (input.deadlineMs < 3_600_000) score += 20;       // <1 hour
    else if (input.deadlineMs < 86_400_000) score += 10;  // <1 day
  }

  return Math.min(100, score);
}

/** compute importance score (0-100) */
export function computeImportance(input: MatrixInput): number {
  let score = 0;

  // priority is the primary signal
  switch (input.priority) {
    case "critical": score += 40; break;
    case "high": score += 25; break;
    case "normal": score += 10; break;
    case "low": score += 0; break;
  }

  // blocking other sessions = important
  if (input.isBlocking) score += 20;

  // dependent count
  score += Math.min(15, input.dependentCount * 5);

  // cost invested (sunk cost signals importance of completion)
  if (input.costUsd > 5) score += 5;
  if (input.costUsd > 20) score += 5;

  // near-completion is important to finish
  if (input.progressPct > 80) score += 10;
  else if (input.progressPct > 50) score += 5;

  return Math.min(100, score);
}

/** classify urgency score into level */
function urgencyLevel(score: number): UrgencyLevel {
  if (score >= 70) return "critical";
  if (score >= 45) return "high";
  if (score >= 20) return "medium";
  return "low";
}

/** classify importance score into level */
function importanceLevel(score: number): ImportanceLevel {
  if (score >= 60) return "critical";
  if (score >= 40) return "high";
  if (score >= 20) return "medium";
  return "low";
}

/** determine quadrant from urgency + importance */
export function classifyQuadrant(urgencyScore: number, importanceScore: number): Quadrant {
  const urgent = urgencyScore >= 45;
  const important = importanceScore >= 40;
  if (urgent && important) return "do-first";
  if (!urgent && important) return "schedule";
  if (urgent && !important) return "delegate";
  return "eliminate";
}

/** generate recommendation based on quadrant */
function recommend(quadrant: Quadrant, input: MatrixInput): string {
  switch (quadrant) {
    case "do-first":
      if (input.hasErrors) return "fix errors immediately — high priority and urgent";
      if (input.isStuck) return "unblock now — critical dependency chain";
      return "prioritize — urgent and important";
    case "schedule":
      if (input.progressPct > 80) return "near completion — schedule finish soon";
      if (input.isBlocking) return "important blocker — schedule next available slot";
      return "plan for next cycle — important but not urgent";
    case "delegate":
      if (input.hasErrors) return "errors but low importance — auto-retry or deprioritize";
      return "urgent but not important — consider automation or lower priority";
    case "eliminate":
      if (input.costUsd > 10) return "low priority, high cost — consider pausing";
      return "low priority — defer or drop if no progress";
  }
}

/** classify all sessions into the priority matrix */
export function buildPriorityMatrix(inputs: MatrixInput[]): MatrixResult {
  const entries: MatrixEntry[] = inputs.map((input) => {
    const uScore = computeUrgency(input);
    const iScore = computeImportance(input);
    const quadrant = classifyQuadrant(uScore, iScore);
    return {
      sessionTitle: input.sessionTitle,
      urgency: urgencyLevel(uScore),
      urgencyScore: uScore,
      importance: importanceLevel(iScore),
      importanceScore: iScore,
      quadrant,
      recommendation: recommend(quadrant, input),
    };
  });

  // sort: do-first → schedule → delegate → eliminate, then by urgency desc
  const quadrantOrder: Record<Quadrant, number> = { "do-first": 0, schedule: 1, delegate: 2, eliminate: 3 };
  entries.sort((a, b) => {
    const qDiff = quadrantOrder[a.quadrant] - quadrantOrder[b.quadrant];
    if (qDiff !== 0) return qDiff;
    return b.urgencyScore - a.urgencyScore;
  });

  const quadrantCounts: Record<Quadrant, number> = { "do-first": 0, schedule: 0, delegate: 0, eliminate: 0 };
  for (const e of entries) quadrantCounts[e.quadrant]++;

  const avgUrgency = entries.length > 0 ? Math.round(entries.reduce((s, e) => s + e.urgencyScore, 0) / entries.length) : 0;
  const avgImportance = entries.length > 0 ? Math.round(entries.reduce((s, e) => s + e.importanceScore, 0) / entries.length) : 0;

  return { entries, quadrantCounts, avgUrgency, avgImportance };
}

/** format priority matrix for TUI display */
export function formatPriorityMatrix(result: MatrixResult): string[] {
  const lines: string[] = [];
  const { quadrantCounts, avgUrgency, avgImportance } = result;

  lines.push(`priority matrix: ${result.entries.length} sessions (avg urgency=${avgUrgency}, importance=${avgImportance})`);

  // quadrant summary
  lines.push(`  ┌─────────────────┬─────────────────┐`);
  lines.push(`  │ DO FIRST (${String(quadrantCounts["do-first"]).padStart(2)})  │ SCHEDULE (${String(quadrantCounts.schedule).padStart(2)})  │  ← important`);
  lines.push(`  │ urgent+important │ plan for later   │`);
  lines.push(`  ├─────────────────┼─────────────────┤`);
  lines.push(`  │ DELEGATE (${String(quadrantCounts.delegate).padStart(2)})  │ ELIMINATE (${String(quadrantCounts.eliminate).padStart(2)}) │  ← not important`);
  lines.push(`  │ auto/deprioritze│ defer or drop    │`);
  lines.push(`  └─────────────────┴─────────────────┘`);
  lines.push(`    ↑ urgent           ↑ not urgent`);

  // entries by quadrant
  for (const q of ["do-first", "schedule", "delegate", "eliminate"] as Quadrant[]) {
    const qEntries = result.entries.filter((e) => e.quadrant === q);
    if (qEntries.length === 0) continue;
    lines.push(`  ${q}:`);
    for (const e of qEntries) {
      lines.push(`    ${e.sessionTitle} [U=${e.urgencyScore} I=${e.importanceScore}] ${e.recommendation}`);
    }
  }

  return lines;
}
