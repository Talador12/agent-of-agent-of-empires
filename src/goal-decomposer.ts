// goal-decomposer.ts — auto-split complex goals into sub-tasks with dependencies.
// parses goal text for structural hints (bullet points, numbered steps, "then"/"after")
// and produces a dependency graph of sub-goals. no LLM call — pattern-based.

import type { TaskDefinition } from "./types.js";

export interface SubGoal {
  id: string;            // e.g., "task-1", "task-2"
  goal: string;
  dependsOn: string[];   // ids of prerequisites
  order: number;         // original position in the goal text
}

export interface DecompositionResult {
  originalGoal: string;
  subGoals: SubGoal[];
  hasSequentialDeps: boolean;
  parallelGroups: SubGoal[][]; // groups that can run in parallel
}

// patterns that indicate sequential dependency between steps
const SEQUENTIAL_MARKERS = /\b(then|after|once|next|finally|before|followed by|when done)\b/i;
const NUMBERED_STEP = /^\s*(\d+)[.)]\s+(.+)/;
const BULLET_STEP = /^\s*[-*•]\s+(.+)/;

/**
 * Decompose a complex goal into sub-goals with dependency relationships.
 */
export function decomposeGoal(goal: string, baseTitle = "task"): DecompositionResult {
  const lines = goal.split("\n").map((l) => l.trim()).filter(Boolean);

  // try numbered steps first
  const numbered = lines.map((l) => NUMBERED_STEP.exec(l)).filter(Boolean);
  if (numbered.length >= 2) {
    return buildFromSteps(goal, numbered.map((m) => m![2]), baseTitle, true);
  }

  // try bullet points
  const bulleted = lines.map((l) => BULLET_STEP.exec(l)).filter(Boolean);
  if (bulleted.length >= 2) {
    // check for sequential markers in the text
    const hasSequential = SEQUENTIAL_MARKERS.test(goal);
    return buildFromSteps(goal, bulleted.map((m) => m![1]), baseTitle, hasSequential);
  }

  // try splitting on sequential markers
  const parts = goal.split(SEQUENTIAL_MARKERS).filter((p) => p.trim() && !SEQUENTIAL_MARKERS.test(p));
  if (parts.length >= 2) {
    return buildFromSteps(goal, parts.map((p) => p.trim()), baseTitle, true);
  }

  // can't decompose — return as single goal
  return {
    originalGoal: goal,
    subGoals: [{ id: `${baseTitle}-1`, goal, dependsOn: [], order: 0 }],
    hasSequentialDeps: false,
    parallelGroups: [[{ id: `${baseTitle}-1`, goal, dependsOn: [], order: 0 }]],
  };
}

function buildFromSteps(
  originalGoal: string,
  steps: string[],
  baseTitle: string,
  sequential: boolean,
): DecompositionResult {
  const subGoals: SubGoal[] = steps.map((step, i) => ({
    id: `${baseTitle}-${i + 1}`,
    goal: step.trim(),
    dependsOn: sequential && i > 0 ? [`${baseTitle}-${i}`] : [],
    order: i,
  }));

  // build parallel groups: sequential = each step is its own group; parallel = all in one group
  const parallelGroups: SubGoal[][] = sequential
    ? subGoals.map((s) => [s])
    : [subGoals];

  return { originalGoal, subGoals, hasSequentialDeps: sequential, parallelGroups };
}

/**
 * Convert decomposition result into TaskDefinition array for task manager.
 */
export function subGoalsToTaskDefs(
  decomposition: DecompositionResult,
  template: Omit<TaskDefinition, "goal" | "sessionTitle" | "dependsOn">,
): TaskDefinition[] {
  return decomposition.subGoals.map((sg) => ({
    ...template,
    sessionTitle: sg.id,
    goal: sg.goal,
    dependsOn: sg.dependsOn.length > 0 ? sg.dependsOn : undefined,
  }));
}

/**
 * Format decomposition for TUI display.
 */
export function formatDecomposition(result: DecompositionResult): string[] {
  if (result.subGoals.length <= 1) return ["  (goal is atomic — cannot decompose further)"];
  const lines: string[] = [];
  lines.push(`  Decomposed into ${result.subGoals.length} sub-goals (${result.hasSequentialDeps ? "sequential" : "parallel"}):`);
  for (const sg of result.subGoals) {
    const deps = sg.dependsOn.length > 0 ? ` (after: ${sg.dependsOn.join(", ")})` : "";
    lines.push(`  ${sg.id}: ${sg.goal}${deps}`);
  }
  if (result.parallelGroups.length > 1) {
    lines.push(`  Parallel groups: ${result.parallelGroups.length} waves`);
  }
  return lines;
}
