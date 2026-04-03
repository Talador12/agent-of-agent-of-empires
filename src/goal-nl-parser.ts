// goal-nl-parser.ts — extract structured goals from freeform natural
// language text. identifies action verbs, target nouns, repo references,
// priority signals, and dependency mentions.

export interface ParsedGoal {
  original: string;
  action: string | null;       // primary verb (fix, build, add, etc)
  target: string | null;       // primary noun/object
  repo: string | null;         // detected repo reference
  priority: "normal" | "high" | "critical";
  dependencies: string[];      // mentioned session/task names
  tags: string[];              // extracted tags (#tag, @mention)
  confidence: number;          // 0-100 parsing confidence
}

const ACTION_VERBS = ["fix", "build", "add", "implement", "create", "update", "refactor", "migrate", "deploy", "test", "optimize", "remove", "upgrade", "configure", "setup", "integrate", "design", "write", "enable", "disable", "debug", "investigate", "resolve"];
const PRIORITY_WORDS = new Map([["critical", "critical"], ["urgent", "critical"], ["asap", "critical"], ["hotfix", "critical"], ["high", "high"], ["important", "high"], ["priority", "high"], ["p0", "critical"], ["p1", "high"]]);

/**
 * Parse a freeform text string into a structured goal.
 */
export function parseGoal(text: string): ParsedGoal {
  const lower = text.toLowerCase().trim();
  const words = lower.split(/\s+/);

  // extract action verb
  let action: string | null = null;
  for (const w of words) {
    if (ACTION_VERBS.includes(w)) { action = w; break; }
  }

  // extract target (first significant noun after the verb)
  let target: string | null = null;
  const stopwords = new Set(["the", "a", "an", "to", "for", "in", "on", "with", "from", "by", "and", "or", "of", "is"]);
  const actionIdx = action ? words.indexOf(action) : -1;
  const afterAction = actionIdx >= 0 ? words.slice(actionIdx + 1) : words;
  for (const w of afterAction) {
    if (w.length > 2 && !stopwords.has(w) && !ACTION_VERBS.includes(w)) { target = w; break; }
  }

  // detect repo references (github/xxx, path/to/repo patterns)
  let repo: string | null = null;
  const repoMatch = text.match(/(?:github|gitlab|bitbucket)\/[\w-]+(?:\/[\w-]+)?/i) ?? text.match(/(?:[\w-]+\/){1,3}[\w-]+\.(?:git|repo)/i);
  if (repoMatch) repo = repoMatch[0];

  // detect priority
  let priority: ParsedGoal["priority"] = "normal";
  for (const [word, level] of PRIORITY_WORDS) {
    if (lower.includes(word)) { priority = level as ParsedGoal["priority"]; break; }
  }

  // extract dependencies ("after X", "depends on X", "blocked by X")
  const dependencies: string[] = [];
  const depPatterns = [/after\s+([\w-]+)/g, /depends?\s+on\s+([\w-]+)/g, /blocked\s+by\s+([\w-]+)/g, /wait(?:ing)?\s+for\s+([\w-]+)/g];
  for (const pat of depPatterns) {
    let m;
    while ((m = pat.exec(lower)) !== null) dependencies.push(m[1]);
  }

  // extract tags (#tag) and mentions (@name)
  const tags: string[] = [];
  const tagMatches = text.match(/[#@][\w-]+/g);
  if (tagMatches) tags.push(...tagMatches);

  // confidence: higher if we found both action + target
  let confidence = 30;
  if (action) confidence += 25;
  if (target) confidence += 25;
  if (repo) confidence += 10;
  if (priority !== "normal") confidence += 5;
  if (dependencies.length > 0) confidence += 5;

  return { original: text, action, target, repo, priority, dependencies, tags, confidence: Math.min(100, confidence) };
}

/**
 * Parse multiple goal lines.
 */
export function parseGoals(lines: string[]): ParsedGoal[] {
  return lines.filter((l) => l.trim().length > 0).map(parseGoal);
}

/**
 * Format parsed goal for TUI display.
 */
export function formatParsedGoal(goal: ParsedGoal): string[] {
  const lines: string[] = [];
  const conf = goal.confidence >= 70 ? "●" : goal.confidence >= 40 ? "◐" : "○";
  lines.push(`  ${conf} "${goal.original.slice(0, 60)}" (${goal.confidence}%)`);
  const parts: string[] = [];
  if (goal.action) parts.push(`action: ${goal.action}`);
  if (goal.target) parts.push(`target: ${goal.target}`);
  if (goal.repo) parts.push(`repo: ${goal.repo}`);
  if (goal.priority !== "normal") parts.push(`priority: ${goal.priority}`);
  if (goal.dependencies.length > 0) parts.push(`deps: ${goal.dependencies.join(", ")}`);
  if (goal.tags.length > 0) parts.push(`tags: ${goal.tags.join(" ")}`);
  if (parts.length > 0) lines.push(`    ${parts.join(" | ")}`);
  return lines;
}

/**
 * Format multiple parsed goals for TUI display.
 */
export function formatParsedGoals(goals: ParsedGoal[]): string[] {
  if (goals.length === 0) return ["  Goal parser: no text to parse"];
  const lines: string[] = [];
  lines.push(`  Goal NL Parser (${goals.length} goals parsed):`);
  for (const g of goals) lines.push(...formatParsedGoal(g));
  return lines;
}
