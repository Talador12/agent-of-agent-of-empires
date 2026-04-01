// task-templates.ts — built-in + user-defined task goal templates.
// templates are just named goal strings that can be applied via --template flag.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { BOLD, DIM, GREEN, RESET } from "./colors.js";

export interface TaskTemplate {
  name: string;
  description: string;
  goal: string;
  tool?: string;
  continueOnRoadmap?: boolean;
}

// built-in templates derived from real usage patterns
const BUILTIN_TEMPLATES: TaskTemplate[] = [
  {
    name: "roadmap",
    description: "grind through claude.md/AGENTS.md roadmap items, commit each improvement",
    goal: "Find the roadmap (check claude.md, README.md, AGENTS.md). Pick the next item and implement it. Add new ideas to the roadmap as you or the human think of them. Commit and push after each self-contained improvement.",
    continueOnRoadmap: true,
  },
  {
    name: "roadmap-strict",
    description: "roadmap grind with full tests required before push",
    goal: "Find the roadmap (check claude.md, README.md, AGENTS.md). Pick the next item and implement it with full tests. Add new ideas to the roadmap as you or the human think of them. Commit and push after each self-contained improvement.",
    continueOnRoadmap: true,
  },
  {
    name: "pr-review",
    description: "monitor open PRs/MRs, address review feedback, push fixes, ping reviewers",
    goal: "Check for open PRs/MRs in this repo. Address any review feedback by pushing fixes. Monitor CI pipelines and fix failures. Ping reviewers when changes are ready for re-review. Update claude.md with PR status.",
  },
  {
    name: "bugfix",
    description: "reproduce, fix, test, and commit a specific bug",
    goal: "Investigate the reported bug. Reproduce it with a minimal test case. Fix the root cause. Add regression tests. Commit and push the fix.",
  },
  {
    name: "explore",
    description: "read and understand the codebase, update claude.md with findings",
    goal: "Explore the codebase. Read AGENTS.md and claude.md for context. Understand the architecture, key modules, and current state. Update claude.md with your findings and any issues you discover.",
  },
  {
    name: "ci-fix",
    description: "fix failing CI pipelines — build errors, test failures, flaky tests",
    goal: "Check CI pipeline status. Fix any build errors, test failures, or flaky tests. Push fixes and verify pipelines go green. Add retry config for transient infra failures if needed.",
  },
];

const AOAOE_DIR = join(homedir(), ".aoaoe");
const USER_TEMPLATES_FILE = join(AOAOE_DIR, "templates.json");

// load user-defined templates from ~/.aoaoe/templates.json (optional)
function loadUserTemplates(): TaskTemplate[] {
  try {
    if (!existsSync(USER_TEMPLATES_FILE)) return [];
    const raw = JSON.parse(readFileSync(USER_TEMPLATES_FILE, "utf-8"));
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      (t: unknown): t is TaskTemplate =>
        !!t && typeof t === "object" &&
        typeof (t as Record<string, unknown>).name === "string" &&
        typeof (t as Record<string, unknown>).goal === "string"
    ).map((t) => ({
      ...t,
      description: t.description || "(user-defined)",
    }));
  } catch {
    return [];
  }
}

// get all templates — user templates override builtins with the same name
export function getAllTemplates(): TaskTemplate[] {
  const user = loadUserTemplates();
  const userNames = new Set(user.map((t) => t.name.toLowerCase()));
  const builtins = BUILTIN_TEMPLATES.filter((t) => !userNames.has(t.name.toLowerCase()));
  return [...builtins, ...user];
}

// resolve a template by name (case-insensitive, prefix match)
export function resolveTemplate(name: string): TaskTemplate | undefined {
  const templates = getAllTemplates();
  const lower = name.toLowerCase();
  return (
    templates.find((t) => t.name.toLowerCase() === lower) ??
    templates.find((t) => t.name.toLowerCase().startsWith(lower))
  );
}

// format template list for display
export function formatTemplateList(): string {
  const templates = getAllTemplates();
  const lines: string[] = [];
  lines.push(`  ${BOLD}available task templates:${RESET}`);
  lines.push("");
  for (const t of templates) {
    const goalPreview = t.goal.length > 70 ? t.goal.slice(0, 67) + "..." : t.goal;
    lines.push(`  ${GREEN}${t.name}${RESET} — ${t.description}`);
    lines.push(`  ${DIM}  goal: ${goalPreview}${RESET}`);
    if (t.tool) lines.push(`  ${DIM}  tool: ${t.tool}${RESET}`);
    if (t.continueOnRoadmap) lines.push(`  ${DIM}  continueOnRoadmap: true${RESET}`);
    lines.push("");
  }
  lines.push(`  ${DIM}custom templates: ${USER_TEMPLATES_FILE}${RESET}`);
  return lines.join("\n");
}
