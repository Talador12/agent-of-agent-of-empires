// prompt-templates.ts — named system prompt strategies for the reasoner.
// the active template is set via config or /prompt-template command.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { BOLD, DIM, GREEN, RESET } from "../colors.js";

export interface PromptTemplate {
  name: string;
  description: string;
  // preamble is prepended to the base system prompt (adds behavior, doesn't replace)
  preamble: string;
}

const BUILTIN_TEMPLATES: PromptTemplate[] = [
  {
    name: "default",
    description: "balanced supervisor — intervene only when needed",
    preamble: "",
  },
  {
    name: "hands-off",
    description: "minimal intervention — only act on errors and permission prompts",
    preamble: `IMPORTANT OVERRIDE: You are in hands-off mode. Be extremely conservative with interventions.
- Only send_input when a session has an ERROR or a PERMISSION prompt that needs clearing.
- Do NOT nudge idle sessions — they may be thinking or compiling.
- Do NOT send motivational or progress-check messages.
- Prefer "wait" in almost all cases. Let agents work autonomously.
`,
  },
  {
    name: "aggressive",
    description: "proactive supervisor — nudge idle agents, push for progress",
    preamble: `IMPORTANT OVERRIDE: You are in aggressive supervision mode. Be proactive.
- If a session has been idle for more than 60 seconds, nudge it with a prompt.
- If a session seems to be going in circles, redirect it with clearer instructions.
- Report progress frequently — every meaningful commit or test pass.
- Push agents toward completing their goals. Don't let them drift.
- Still avoid micromanaging specific code decisions.
`,
  },
  {
    name: "review-focused",
    description: "PR/MR review cycle — focus on CI, reviewer feedback, rebasing",
    preamble: `IMPORTANT OVERRIDE: You are in review-focused mode. Prioritize PR/MR lifecycle.
- Watch for CI pipeline failures and push fixes immediately.
- Monitor for reviewer comments and address them promptly.
- If a PR is approved, push to merge. If blocked, ping the reviewer.
- Prefer rebasing over merge commits. Keep commit history clean.
- Report progress for each PR status change (CI green, review received, merged).
`,
  },
  {
    name: "shipping",
    description: "ship mode — focus on commits, pushes, and version bumps",
    preamble: `IMPORTANT OVERRIDE: You are in shipping mode. Focus on getting code out the door.
- Push agents to commit and push frequently. Small atomic commits are better than big batches.
- If an agent has uncommitted work, nudge them to commit.
- Report progress for every push/commit.
- Don't let perfect be the enemy of good — ship working code, iterate later.
- Complete tasks as soon as their core goal is met. Don't gold-plate.
`,
  },
];

const AOAOE_DIR = join(homedir(), ".aoaoe");
const USER_TEMPLATES_FILE = join(AOAOE_DIR, "prompt-templates.json");

function loadUserTemplates(): PromptTemplate[] {
  try {
    if (!existsSync(USER_TEMPLATES_FILE)) return [];
    const raw = JSON.parse(readFileSync(USER_TEMPLATES_FILE, "utf-8"));
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      (t: unknown): t is PromptTemplate =>
        !!t && typeof t === "object" &&
        typeof (t as Record<string, unknown>).name === "string" &&
        typeof (t as Record<string, unknown>).preamble === "string"
    ).map((t) => ({
      ...t,
      description: t.description || "(user-defined)",
    }));
  } catch {
    return [];
  }
}

export function getAllPromptTemplates(): PromptTemplate[] {
  const user = loadUserTemplates();
  const userNames = new Set(user.map((t) => t.name.toLowerCase()));
  const builtins = BUILTIN_TEMPLATES.filter((t) => !userNames.has(t.name.toLowerCase()));
  return [...builtins, ...user];
}

export function resolvePromptTemplate(name: string): PromptTemplate | undefined {
  const templates = getAllPromptTemplates();
  const lower = name.toLowerCase();
  return (
    templates.find((t) => t.name.toLowerCase() === lower) ??
    templates.find((t) => t.name.toLowerCase().startsWith(lower))
  );
}

export function applyPromptTemplate(basePrompt: string, templateName: string): string {
  if (!templateName || templateName === "default") return basePrompt;
  const template = resolvePromptTemplate(templateName);
  if (!template || !template.preamble) return basePrompt;
  return `${template.preamble}\n${basePrompt}`;
}

export function formatPromptTemplateList(): string {
  const templates = getAllPromptTemplates();
  const lines: string[] = [];
  lines.push(`  ${BOLD}available prompt templates:${RESET}`);
  lines.push("");
  for (const t of templates) {
    const preview = t.preamble ? t.preamble.split("\n")[0].slice(0, 60) : "(no preamble — base prompt only)";
    lines.push(`  ${GREEN}${t.name}${RESET} — ${t.description}`);
    lines.push(`  ${DIM}  ${preview}${t.preamble.length > 60 ? "..." : ""}${RESET}`);
    lines.push("");
  }
  lines.push(`  ${DIM}custom templates: ${USER_TEMPLATES_FILE}${RESET}`);
  return lines.join("\n");
}
