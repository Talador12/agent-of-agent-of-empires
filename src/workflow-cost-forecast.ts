// workflow-cost-forecast.ts — estimate total workflow cost before starting.
// uses per-stage task difficulty + historical cost patterns to project spend.

import type { WorkflowDefinition } from "./workflow-engine.js";
import { scoreDifficulty } from "./difficulty-scorer.js";

export interface WorkflowCostForecast {
  workflowName: string;
  totalEstimatedCostUsd: number;
  totalEstimatedHours: number;
  stages: Array<{
    name: string;
    taskCount: number;
    estimatedCostUsd: number;
    estimatedHours: number;
  }>;
  confidence: "low" | "medium" | "high";
}

// rough cost per difficulty point per hour (based on typical LLM usage)
const COST_PER_DIFFICULTY_HOUR = 0.50; // $0.50/difficulty-point/hour

/**
 * Estimate the total cost of running a workflow.
 */
export function forecastWorkflowCost(
  workflow: WorkflowDefinition,
  historicalCostPerHour?: number,
): WorkflowCostForecast {
  const costRate = historicalCostPerHour ?? COST_PER_DIFFICULTY_HOUR;
  let totalCost = 0;
  let totalHours = 0;

  const stages = workflow.stages.map((stage) => {
    let stageCost = 0;
    let stageHours = 0;

    for (const task of stage.tasks) {
      const difficulty = scoreDifficulty(task.sessionTitle, task.goal);
      const hours = difficulty.estimatedHours;
      const cost = hours * costRate * (difficulty.score / 5); // scale by difficulty
      stageCost += cost;
      stageHours = Math.max(stageHours, hours); // parallel tasks: max duration
    }

    totalCost += stageCost;
    totalHours += stageHours; // sequential stages: sum durations

    return {
      name: stage.name,
      taskCount: stage.tasks.length,
      estimatedCostUsd: Math.round(stageCost * 100) / 100,
      estimatedHours: Math.round(stageHours * 10) / 10,
    };
  });

  const confidence = historicalCostPerHour ? "medium" : "low";

  return {
    workflowName: workflow.name,
    totalEstimatedCostUsd: Math.round(totalCost * 100) / 100,
    totalEstimatedHours: Math.round(totalHours * 10) / 10,
    stages,
    confidence,
  };
}

/**
 * Format workflow cost forecast for TUI display.
 */
export function formatWorkflowCostForecast(forecast: WorkflowCostForecast): string[] {
  const conf = forecast.confidence === "high" ? "●" : forecast.confidence === "medium" ? "◐" : "○";
  const lines: string[] = [];
  lines.push(`  ${conf} Workflow cost forecast: "${forecast.workflowName}"`);
  lines.push(`  Total: ~$${forecast.totalEstimatedCostUsd.toFixed(2)} over ~${forecast.totalEstimatedHours}h`);
  lines.push("");
  for (const s of forecast.stages) {
    lines.push(`  ${s.name}: ${s.taskCount} task${s.taskCount !== 1 ? "s" : ""}, ~$${s.estimatedCostUsd.toFixed(2)}, ~${s.estimatedHours}h`);
  }
  return lines;
}
