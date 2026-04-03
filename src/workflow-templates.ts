// workflow-templates.ts — pre-built workflow definitions for common patterns.
// each template produces a WorkflowDefinition ready to instantiate.

import type { WorkflowDefinition, WorkflowStage } from "./workflow-engine.js";

export interface WorkflowTemplate {
  name: string;
  description: string;
  stages: Array<{ name: string; taskGoals: string[] }>;
  tags: string[];
}

export const BUILTIN_WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  {
    name: "ci-cd",
    description: "Build → Test → Deploy pipeline",
    stages: [
      { name: "build", taskGoals: ["Build the project and fix any compilation errors"] },
      { name: "test", taskGoals: ["Run the full test suite and fix any failures"] },
      { name: "deploy", taskGoals: ["Deploy to staging/production and verify health checks"] },
    ],
    tags: ["ci", "cd", "deploy"],
  },
  {
    name: "feature-dev",
    description: "Implement → Test → Review → Merge",
    stages: [
      { name: "implement", taskGoals: ["Implement the feature according to the spec"] },
      { name: "test", taskGoals: ["Write unit and integration tests for the new feature", "Run existing tests to verify no regressions"] },
      { name: "review", taskGoals: ["Self-review: check for code quality, security, and documentation"] },
      { name: "merge", taskGoals: ["Create PR, address feedback, merge to main"] },
    ],
    tags: ["feature", "development"],
  },
  {
    name: "refactor",
    description: "Analyze → Refactor → Test → Cleanup",
    stages: [
      { name: "analyze", taskGoals: ["Identify code smells, duplications, and improvement opportunities"] },
      { name: "refactor", taskGoals: ["Apply refactoring changes incrementally with tests passing at each step"] },
      { name: "test", taskGoals: ["Run full test suite, fix any regressions from refactoring"] },
      { name: "cleanup", taskGoals: ["Remove dead code, update documentation, commit with clear message"] },
    ],
    tags: ["refactor", "cleanup"],
  },
  {
    name: "incident-response",
    description: "Triage → Fix → Test → Postmortem",
    stages: [
      { name: "triage", taskGoals: ["Identify root cause from logs and error output"] },
      { name: "fix", taskGoals: ["Implement the fix with minimal blast radius"] },
      { name: "test", taskGoals: ["Verify fix resolves the issue, run regression tests"] },
      { name: "postmortem", taskGoals: ["Document what happened, why, and how to prevent recurrence"] },
    ],
    tags: ["incident", "hotfix", "production"],
  },
  {
    name: "multi-repo",
    description: "Parallel work across multiple repositories",
    stages: [
      { name: "parallel-work", taskGoals: ["Complete assigned work in each repository"] },
      { name: "integration", taskGoals: ["Verify cross-repo integration works correctly"] },
      { name: "release", taskGoals: ["Tag releases and update dependency references"] },
    ],
    tags: ["multi-repo", "monorepo"],
  },
];

/**
 * Find a workflow template by name.
 */
export function findWorkflowTemplate(name: string): WorkflowTemplate | undefined {
  return BUILTIN_WORKFLOW_TEMPLATES.find((t) => t.name.toLowerCase() === name.toLowerCase());
}

/**
 * Instantiate a workflow definition from a template.
 * sessionPrefix is used to generate session titles for each task.
 */
export function instantiateWorkflow(
  template: WorkflowTemplate,
  sessionPrefix: string,
): WorkflowDefinition {
  let taskCounter = 0;
  const stages: WorkflowStage[] = template.stages.map((s) => ({
    name: s.name,
    tasks: s.taskGoals.map((goal) => {
      taskCounter++;
      return { sessionTitle: `${sessionPrefix}-${s.name}-${taskCounter}`, goal };
    }),
  }));

  return { name: `${sessionPrefix}-${template.name}`, stages };
}

/**
 * Format workflow template list for TUI display.
 */
export function formatWorkflowTemplateList(): string[] {
  const lines: string[] = [];
  lines.push(`  Workflow templates (${BUILTIN_WORKFLOW_TEMPLATES.length} built-in):`);
  for (const t of BUILTIN_WORKFLOW_TEMPLATES) {
    const stageNames = t.stages.map((s) => s.name).join(" → ");
    lines.push(`  ${t.name.padEnd(18)} ${stageNames}  [${t.tags.join(", ")}]`);
    lines.push(`    ${t.description}`);
  }
  return lines;
}
