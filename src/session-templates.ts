// session-templates.ts — pre-configured session profiles with tailored prompts.
// each template bundles a prompt style, policy overrides, and context hints
// for common session types (frontend, backend, infra, data, etc.)

import type { TaskDefinition } from "./types.js";

export interface SessionTemplate {
  name: string;
  description: string;
  promptHints: string[];      // extra context lines injected into the reasoner prompt
  policyOverrides: Record<string, unknown>; // partial policy config to merge
  suggestedTool: string;
  tags: string[];
}

/**
 * Built-in session templates.
 */
export const BUILTIN_TEMPLATES: SessionTemplate[] = [
  {
    name: "frontend",
    description: "React/Vue/Svelte web UI development",
    promptHints: [
      "This session works on frontend code (React, Vue, Svelte, or similar).",
      "Prioritize UI correctness, accessibility, and visual regression.",
      "Run `npm run build` and check for TypeScript errors before considering done.",
      "Check for unused imports and console.log statements.",
    ],
    policyOverrides: { maxIdleBeforeNudgeMs: 180_000 },
    suggestedTool: "opencode",
    tags: ["frontend", "ui", "web"],
  },
  {
    name: "backend",
    description: "API/server/service development",
    promptHints: [
      "This session works on backend/API code.",
      "Prioritize correctness, error handling, and test coverage.",
      "Run tests before considering done. Check for unhandled promise rejections.",
      "Ensure database migrations are reversible if applicable.",
    ],
    policyOverrides: { maxIdleBeforeNudgeMs: 120_000, maxErrorsBeforeRestart: 5 },
    suggestedTool: "opencode",
    tags: ["backend", "api", "server"],
  },
  {
    name: "infra",
    description: "Infrastructure, CI/CD, DevOps, Terraform",
    promptHints: [
      "This session works on infrastructure code (Terraform, CI/CD, Docker, k8s).",
      "Be extra cautious with destructive operations.",
      "Validate plans/diffs before applying. Prefer dry-run when available.",
      "Check for hardcoded secrets or credentials.",
    ],
    policyOverrides: { allowDestructive: false, maxIdleBeforeNudgeMs: 300_000 },
    suggestedTool: "opencode",
    tags: ["infra", "devops", "ci"],
  },
  {
    name: "data",
    description: "Data pipelines, ML, analytics",
    promptHints: [
      "This session works on data engineering or ML code.",
      "Watch for large file operations and memory usage.",
      "Validate data transformations with sample inputs.",
      "Check for data leakage in ML pipelines.",
    ],
    policyOverrides: { maxIdleBeforeNudgeMs: 600_000 }, // data jobs can be slow
    suggestedTool: "opencode",
    tags: ["data", "ml", "analytics"],
  },
  {
    name: "docs",
    description: "Documentation, READMEs, wikis",
    promptHints: [
      "This session works on documentation.",
      "Check for broken links, formatting consistency, and spelling.",
      "Ensure code examples are accurate and runnable.",
    ],
    policyOverrides: { maxIdleBeforeNudgeMs: 300_000 },
    suggestedTool: "opencode",
    tags: ["docs", "documentation"],
  },
  {
    name: "security",
    description: "Security audit, vulnerability fixes, hardening",
    promptHints: [
      "This session focuses on security work.",
      "Never commit secrets, credentials, or API keys.",
      "Check for injection vulnerabilities, auth bypasses, and data exposure.",
      "Validate all user inputs. Prefer allowlists over denylists.",
    ],
    policyOverrides: { allowDestructive: false, autoAnswerPermissions: false },
    suggestedTool: "opencode",
    tags: ["security", "audit"],
  },
];

/**
 * Find a template by name (case-insensitive).
 */
export function findTemplate(name: string): SessionTemplate | undefined {
  return BUILTIN_TEMPLATES.find((t) => t.name.toLowerCase() === name.toLowerCase());
}

/**
 * List all available template names.
 */
export function listTemplateNames(): string[] {
  return BUILTIN_TEMPLATES.map((t) => t.name);
}

/**
 * Apply a template to a task definition, merging prompt hints.
 */
export function applyTemplate(template: SessionTemplate, task: TaskDefinition): TaskDefinition {
  return {
    ...task,
    tool: task.tool ?? template.suggestedTool,
    goal: task.goal
      ? (typeof task.goal === "string"
        ? [task.goal, "", "Session template hints:", ...template.promptHints].join("\n")
        : [...task.goal, "", "Session template hints:", ...template.promptHints])
      : template.promptHints.join("\n"),
  };
}

/**
 * Format template list for TUI display.
 */
export function formatTemplateList(): string[] {
  const lines: string[] = [];
  lines.push(`  Session templates (${BUILTIN_TEMPLATES.length} built-in):`);
  for (const t of BUILTIN_TEMPLATES) {
    lines.push(`  ${t.name.padEnd(12)} ${t.description} [${t.tags.join(", ")}]`);
  }
  return lines;
}

/**
 * Format a single template's details.
 */
export function formatTemplateDetail(template: SessionTemplate): string[] {
  const lines: string[] = [];
  lines.push(`  Template: ${template.name}`);
  lines.push(`  ${template.description}`);
  lines.push(`  Tool: ${template.suggestedTool}  Tags: ${template.tags.join(", ")}`);
  lines.push(`  Prompt hints:`);
  for (const h of template.promptHints) lines.push(`    - ${h}`);
  const overrides = Object.entries(template.policyOverrides);
  if (overrides.length > 0) {
    lines.push(`  Policy overrides:`);
    for (const [k, v] of overrides) lines.push(`    ${k}: ${v}`);
  }
  return lines;
}
