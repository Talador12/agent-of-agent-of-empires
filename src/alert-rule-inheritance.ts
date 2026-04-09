// alert-rule-inheritance.ts — child alert rules inherit parent severity, cooldown, and conditions.
// builds a tree of alert rules where children override only what they specify,
// inheriting everything else from their parent. supports multi-level depth.
// zero dependencies.

/** alert severity levels */
export type AlertSeverity = "info" | "warning" | "error" | "critical";

/** rule definition with optional parent reference */
export interface InheritableRule {
  id: string;
  parentId?: string;
  name: string;
  severity?: AlertSeverity;
  cooldownMs?: number;
  condition?: string;      // human-readable condition description
  enabled?: boolean;
  tags?: string[];
}

/** resolved rule with all inherited fields filled in */
export interface ResolvedRule {
  id: string;
  parentId: string | null;
  name: string;
  severity: AlertSeverity;
  cooldownMs: number;
  condition: string;
  enabled: boolean;
  tags: string[];
  depth: number;           // 0 = root, 1 = child of root, etc.
  inheritedFrom: string[]; // list of field names inherited from ancestors
}

/** inheritance resolution result */
export interface InheritanceResult {
  rules: ResolvedRule[];
  rootCount: number;
  maxDepth: number;
  orphanIds: string[];     // rules referencing non-existent parents
  circularIds: string[];   // rules involved in circular references
}

const DEFAULT_SEVERITY: AlertSeverity = "warning";
const DEFAULT_COOLDOWN_MS = 300_000; // 5 minutes
const DEFAULT_CONDITION = "always";

/** resolve inheritance for a set of rules */
export function resolveInheritance(rules: InheritableRule[]): InheritanceResult {
  const ruleMap = new Map<string, InheritableRule>();
  for (const r of rules) ruleMap.set(r.id, r);

  const resolved = new Map<string, ResolvedRule>();
  const orphanIds: string[] = [];
  const circularIds: string[] = [];

  // detect cycles via DFS
  function hasCircle(id: string): boolean {
    const visited = new Set<string>();
    let current: string | undefined = id;
    while (current) {
      if (visited.has(current)) return true;
      visited.add(current);
      current = ruleMap.get(current)?.parentId;
    }
    return false;
  }

  // recursively resolve a rule
  function resolve(id: string, resolving = new Set<string>()): ResolvedRule | null {
    if (resolved.has(id)) return resolved.get(id)!;
    if (resolving.has(id)) return null; // circular
    resolving.add(id);

    const rule = ruleMap.get(id);
    if (!rule) return null;

    // no parent — resolve as root
    if (!rule.parentId) {
      const r: ResolvedRule = {
        id: rule.id,
        parentId: null,
        name: rule.name,
        severity: rule.severity ?? DEFAULT_SEVERITY,
        cooldownMs: rule.cooldownMs ?? DEFAULT_COOLDOWN_MS,
        condition: rule.condition ?? DEFAULT_CONDITION,
        enabled: rule.enabled ?? true,
        tags: rule.tags ?? [],
        depth: 0,
        inheritedFrom: [],
      };
      resolved.set(id, r);
      return r;
    }

    // parent doesn't exist
    if (!ruleMap.has(rule.parentId)) {
      orphanIds.push(id);
      const r: ResolvedRule = {
        id: rule.id,
        parentId: rule.parentId,
        name: rule.name,
        severity: rule.severity ?? DEFAULT_SEVERITY,
        cooldownMs: rule.cooldownMs ?? DEFAULT_COOLDOWN_MS,
        condition: rule.condition ?? DEFAULT_CONDITION,
        enabled: rule.enabled ?? true,
        tags: rule.tags ?? [],
        depth: 0,
        inheritedFrom: [],
      };
      resolved.set(id, r);
      return r;
    }

    // resolve parent first
    const parent = resolve(rule.parentId, resolving);
    if (!parent) {
      circularIds.push(id);
      return null;
    }

    const inheritedFrom: string[] = [];
    if (rule.severity === undefined) inheritedFrom.push("severity");
    if (rule.cooldownMs === undefined) inheritedFrom.push("cooldownMs");
    if (rule.condition === undefined) inheritedFrom.push("condition");
    if (rule.enabled === undefined) inheritedFrom.push("enabled");

    const r: ResolvedRule = {
      id: rule.id,
      parentId: rule.parentId,
      name: rule.name,
      severity: rule.severity ?? parent.severity,
      cooldownMs: rule.cooldownMs ?? parent.cooldownMs,
      condition: rule.condition ?? parent.condition,
      enabled: rule.enabled ?? parent.enabled,
      tags: rule.tags ?? parent.tags,
      depth: parent.depth + 1,
      inheritedFrom,
    };
    resolved.set(id, r);
    return r;
  }

  // check for cycles first
  for (const rule of rules) {
    if (hasCircle(rule.id)) {
      circularIds.push(rule.id);
    }
  }

  // resolve all non-circular rules
  for (const rule of rules) {
    if (!circularIds.includes(rule.id)) {
      resolve(rule.id);
    }
  }

  const resolvedRules = [...resolved.values()];
  const rootCount = resolvedRules.filter((r) => r.parentId === null).length;
  const maxDepth = resolvedRules.reduce((max, r) => Math.max(max, r.depth), 0);

  return {
    rules: resolvedRules,
    rootCount,
    maxDepth,
    orphanIds: [...new Set(orphanIds)],
    circularIds: [...new Set(circularIds)],
  };
}

/** get the inheritance chain for a rule (from root to rule) */
export function getInheritanceChain(rules: ResolvedRule[], ruleId: string): ResolvedRule[] {
  const ruleMap = new Map<string, ResolvedRule>();
  for (const r of rules) ruleMap.set(r.id, r);

  const chain: ResolvedRule[] = [];
  let current = ruleMap.get(ruleId);
  while (current) {
    chain.unshift(current);
    current = current.parentId ? ruleMap.get(current.parentId) : undefined;
  }
  return chain;
}

/** format inheritance tree for TUI display */
export function formatInheritanceTree(result: InheritanceResult): string[] {
  const lines: string[] = [];
  lines.push(`alert rule inheritance: ${result.rules.length} rules, ${result.rootCount} roots, max depth ${result.maxDepth}`);

  if (result.orphanIds.length > 0) {
    lines.push(`  orphans (missing parent): ${result.orphanIds.join(", ")}`);
  }
  if (result.circularIds.length > 0) {
    lines.push(`  circular refs: ${result.circularIds.join(", ")}`);
  }

  // build tree view
  const byParent = new Map<string | null, ResolvedRule[]>();
  for (const r of result.rules) {
    const key = r.parentId ?? null;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(r);
  }

  function renderTree(parentId: string | null, indent: string): void {
    const children = byParent.get(parentId) ?? [];
    for (let i = 0; i < children.length; i++) {
      const r = children[i];
      const isLast = i === children.length - 1;
      const prefix = indent + (isLast ? "└── " : "├── ");
      const inherited = r.inheritedFrom.length > 0 ? ` (inherits: ${r.inheritedFrom.join(", ")})` : "";
      const status = r.enabled ? r.severity : `${r.severity} [disabled]`;
      lines.push(`${prefix}${r.name} [${status}] cd=${Math.round(r.cooldownMs / 1000)}s${inherited}`);
      renderTree(r.id, indent + (isLast ? "    " : "│   "));
    }
  }

  renderTree(null, "  ");

  // orphans listed separately
  for (const id of result.orphanIds) {
    const r = result.rules.find((rule) => rule.id === id);
    if (r) lines.push(`  ? ${r.name} [orphan, parent=${r.parentId}]`);
  }

  return lines;
}
