// batch-goal-assignment.ts — parse structured goal manifests for bulk goal loading.
// accepts a simple key-value text format (not YAML to avoid deps) for defining
// multiple session goals, dependencies, priorities, and tags in one file.
// zero dependencies.

/** parsed goal from a manifest */
export interface ManifestGoal {
  session: string;
  goal: string;
  priority?: "critical" | "high" | "normal" | "low";
  dependsOn?: string[];
  tags?: string[];
  budgetUsd?: number;
  repo?: string;
}

/** parse result */
export interface ManifestResult {
  goals: ManifestGoal[];
  errors: ManifestError[];
  warnings: string[];
}

/** parse error */
export interface ManifestError {
  line: number;
  message: string;
}

/** assignment result after applying a manifest */
export interface AssignmentResult {
  assigned: ManifestGoal[];
  skipped: { session: string; reason: string }[];
  depErrors: string[];   // dependency references to non-existent sessions
}

/**
 * Parse a goal manifest from text format.
 *
 * Format:
 *   # comment
 *   [session-name]
 *   goal: text description
 *   priority: high
 *   depends: other-session, another-session
 *   tags: frontend, react
 *   budget: 5.00
 *   repo: /path/to/repo
 *
 * Multiple [session] blocks in one manifest.
 */
export function parseManifest(text: string): ManifestResult {
  const goals: ManifestGoal[] = [];
  const errors: ManifestError[] = [];
  const warnings: string[] = [];

  const lines = text.split("\n");
  let current: Partial<ManifestGoal> | null = null;
  let lineNum = 0;

  function flush(): void {
    if (!current) return;
    if (!current.session) {
      // shouldn't happen — session is set when [block] opens
      return;
    }
    if (!current.goal) {
      warnings.push(`session "${current.session}" has no goal defined`);
    }
    goals.push({
      session: current.session,
      goal: current.goal ?? "",
      priority: current.priority,
      dependsOn: current.dependsOn,
      tags: current.tags,
      budgetUsd: current.budgetUsd,
      repo: current.repo,
    });
    current = null;
  }

  for (const rawLine of lines) {
    lineNum++;
    const line = rawLine.trim();

    // skip empty lines and comments
    if (!line || line.startsWith("#")) continue;

    // session header: [session-name]
    const headerMatch = line.match(/^\[([^\]]+)\]$/);
    if (headerMatch) {
      flush();
      current = { session: headerMatch[1].trim() };
      continue;
    }

    // key: value pairs inside a session block
    const kvMatch = line.match(/^(\w[\w-]*):\s*(.*)$/);
    if (!kvMatch) {
      errors.push({ line: lineNum, message: `invalid syntax: "${line}"` });
      continue;
    }

    if (!current) {
      errors.push({ line: lineNum, message: `key-value outside of [session] block: "${line}"` });
      continue;
    }

    const [, key, value] = kvMatch;
    switch (key.toLowerCase()) {
      case "goal":
        current.goal = value;
        break;
      case "priority": {
        const p = value.toLowerCase();
        if (["critical", "high", "normal", "low"].includes(p)) {
          current.priority = p as ManifestGoal["priority"];
        } else {
          errors.push({ line: lineNum, message: `invalid priority: "${value}" (use critical/high/normal/low)` });
        }
        break;
      }
      case "depends":
      case "depends-on":
      case "dependson":
        current.dependsOn = value.split(",").map((s) => s.trim()).filter(Boolean);
        break;
      case "tags":
        current.tags = value.split(",").map((s) => s.trim()).filter(Boolean);
        break;
      case "budget":
        current.budgetUsd = parseFloat(value);
        if (isNaN(current.budgetUsd)) {
          errors.push({ line: lineNum, message: `invalid budget: "${value}"` });
          current.budgetUsd = undefined;
        }
        break;
      case "repo":
        current.repo = value;
        break;
      default:
        warnings.push(`unknown key "${key}" on line ${lineNum}`);
        break;
    }
  }

  flush();
  return { goals, errors, warnings };
}

/** validate a manifest's dependency references */
export function validateDependencies(goals: ManifestGoal[]): string[] {
  const sessionNames = new Set(goals.map((g) => g.session));
  const errors: string[] = [];
  for (const g of goals) {
    if (g.dependsOn) {
      for (const dep of g.dependsOn) {
        if (!sessionNames.has(dep)) {
          errors.push(`"${g.session}" depends on "${dep}" which is not in the manifest`);
        }
      }
    }
  }
  return errors;
}

/** apply a manifest, checking against existing sessions */
export function applyManifest(
  manifest: ManifestResult,
  existingSessions: string[],
): AssignmentResult {
  const existingSet = new Set(existingSessions.map((s) => s.toLowerCase()));
  const assigned: ManifestGoal[] = [];
  const skipped: { session: string; reason: string }[] = [];

  for (const goal of manifest.goals) {
    if (!existingSet.has(goal.session.toLowerCase())) {
      skipped.push({ session: goal.session, reason: "session not found" });
      continue;
    }
    if (!goal.goal) {
      skipped.push({ session: goal.session, reason: "no goal defined" });
      continue;
    }
    assigned.push(goal);
  }

  const depErrors = validateDependencies(manifest.goals);
  return { assigned, skipped, depErrors };
}

/** generate a manifest template from existing sessions */
export function generateTemplate(sessions: { title: string; repo?: string }[]): string {
  const lines: string[] = ["# aoaoe goal manifest", "# edit goals below and load with /batch-goal", ""];
  for (const s of sessions) {
    lines.push(`[${s.title}]`);
    lines.push(`goal: `);
    if (s.repo) lines.push(`repo: ${s.repo}`);
    lines.push(`priority: normal`);
    lines.push("");
  }
  return lines.join("\n");
}

/** format manifest result for TUI display */
export function formatManifest(result: ManifestResult): string[] {
  const lines: string[] = [];
  lines.push(`batch goals: ${result.goals.length} goals parsed`);

  for (const g of result.goals) {
    const parts = [g.session];
    if (g.priority) parts.push(`[${g.priority}]`);
    if (g.dependsOn?.length) parts.push(`deps: ${g.dependsOn.join(", ")}`);
    if (g.tags?.length) parts.push(`tags: ${g.tags.join(", ")}`);
    if (g.budgetUsd !== undefined) parts.push(`$${g.budgetUsd.toFixed(2)}`);
    lines.push(`  ${parts.join(" · ")}`);
    if (g.goal) lines.push(`    goal: ${g.goal}`);
  }

  if (result.errors.length > 0) {
    lines.push(`  errors:`);
    for (const e of result.errors) lines.push(`    line ${e.line}: ${e.message}`);
  }
  if (result.warnings.length > 0) {
    lines.push(`  warnings:`);
    for (const w of result.warnings) lines.push(`    ${w}`);
  }

  return lines;
}

/** format assignment result for TUI display */
export function formatAssignment(result: AssignmentResult): string[] {
  const lines: string[] = [];
  lines.push(`batch assignment: ${result.assigned.length} assigned, ${result.skipped.length} skipped`);

  for (const g of result.assigned) {
    lines.push(`  ✓ ${g.session}: ${g.goal}`);
  }
  for (const s of result.skipped) {
    lines.push(`  ✗ ${s.session}: ${s.reason}`);
  }
  if (result.depErrors.length > 0) {
    lines.push(`  dependency errors:`);
    for (const e of result.depErrors) lines.push(`    ${e}`);
  }

  return lines;
}
