// fleet-compliance-checker.ts — verify all sessions follow org policy
// for naming conventions, cost budgets, required tags, and configuration.
// reports violations with severity and remediation suggestions.

export type ViolationSeverity = "error" | "warning" | "info";

export interface ComplianceViolation {
  sessionTitle: string;
  rule: string;
  severity: ViolationSeverity;
  message: string;
  suggestion?: string;
}

export interface CompliancePolicy {
  namingPattern?: RegExp;          // session title must match
  namingDescription?: string;      // human-readable naming rule
  requiredTags?: string[];         // tags every session must have
  maxBudgetUsd?: number;           // per-session cost cap
  maxIdleMinutes?: number;         // max idle before violation
  requireGoal?: boolean;           // sessions must have a goal set
  requireRepo?: boolean;           // sessions must have a repo set
  bannedPatterns?: { pattern: RegExp; reason: string }[]; // patterns that must not appear in goals
}

export interface SessionForCompliance {
  title: string;
  goal: string;
  repo: string;
  costUsd: number;
  tags: Map<string, string>;
  idleMinutes: number;
}

const DEFAULT_POLICY: CompliancePolicy = {
  namingPattern: /^[a-z0-9][a-z0-9-]{1,30}$/,
  namingDescription: "lowercase alphanumeric + hyphens, 2-31 chars",
  requiredTags: [],
  maxBudgetUsd: 50,
  maxIdleMinutes: 30,
  requireGoal: true,
  requireRepo: true,
  bannedPatterns: [],
};

/**
 * Check a session against compliance policy.
 */
export function checkCompliance(
  session: SessionForCompliance,
  policy: Partial<CompliancePolicy> = {},
): ComplianceViolation[] {
  const p = { ...DEFAULT_POLICY, ...policy };
  const violations: ComplianceViolation[] = [];

  // naming convention
  if (p.namingPattern && !p.namingPattern.test(session.title)) {
    violations.push({
      sessionTitle: session.title,
      rule: "naming-convention",
      severity: "warning",
      message: `Title "${session.title}" does not match naming policy`,
      suggestion: p.namingDescription ? `Expected: ${p.namingDescription}` : undefined,
    });
  }

  // required tags
  if (p.requiredTags) {
    for (const tag of p.requiredTags) {
      if (!session.tags.has(tag)) {
        violations.push({
          sessionTitle: session.title,
          rule: "required-tag",
          severity: "warning",
          message: `Missing required tag: "${tag}"`,
          suggestion: `Add tag with /session-tag ${session.title} ${tag}=<value>`,
        });
      }
    }
  }

  // budget cap
  if (p.maxBudgetUsd !== undefined && session.costUsd > p.maxBudgetUsd) {
    violations.push({
      sessionTitle: session.title,
      rule: "budget-exceeded",
      severity: "error",
      message: `Cost $${session.costUsd.toFixed(2)} exceeds limit $${p.maxBudgetUsd}`,
      suggestion: "Pause session or increase budget",
    });
  }

  // idle check
  if (p.maxIdleMinutes !== undefined && session.idleMinutes > p.maxIdleMinutes) {
    violations.push({
      sessionTitle: session.title,
      rule: "max-idle",
      severity: "warning",
      message: `Idle for ${session.idleMinutes}m (limit: ${p.maxIdleMinutes}m)`,
      suggestion: "Nudge or pause the session",
    });
  }

  // require goal
  if (p.requireGoal && (!session.goal || session.goal.trim().length === 0)) {
    violations.push({
      sessionTitle: session.title,
      rule: "require-goal",
      severity: "error",
      message: "No goal set",
      suggestion: "Set a goal before activating",
    });
  }

  // require repo
  if (p.requireRepo && (!session.repo || session.repo.trim().length === 0)) {
    violations.push({
      sessionTitle: session.title,
      rule: "require-repo",
      severity: "error",
      message: "No repo set",
    });
  }

  // banned patterns in goals
  if (p.bannedPatterns) {
    for (const bp of p.bannedPatterns) {
      if (bp.pattern.test(session.goal)) {
        violations.push({
          sessionTitle: session.title,
          rule: "banned-pattern",
          severity: "error",
          message: `Goal contains banned pattern: ${bp.reason}`,
        });
      }
    }
  }

  return violations;
}

/**
 * Check all sessions in a fleet.
 */
export function checkFleetCompliance(
  sessions: SessionForCompliance[],
  policy?: Partial<CompliancePolicy>,
): ComplianceViolation[] {
  const all: ComplianceViolation[] = [];
  for (const s of sessions) all.push(...checkCompliance(s, policy));
  return all.sort((a, b) => {
    const sev = { error: 0, warning: 1, info: 2 };
    return sev[a.severity] - sev[b.severity];
  });
}

/**
 * Format compliance report for TUI display.
 */
export function formatComplianceReport(violations: ComplianceViolation[], sessionCount: number): string[] {
  const lines: string[] = [];
  const errors = violations.filter((v) => v.severity === "error").length;
  const warns = violations.filter((v) => v.severity === "warning").length;
  const status = errors > 0 ? "NON-COMPLIANT" : warns > 0 ? "WARNINGS" : "COMPLIANT";
  lines.push(`  Fleet Compliance: ${status} (${sessionCount} sessions, ${violations.length} violations)`);

  if (violations.length === 0) {
    lines.push("    All sessions pass compliance checks");
  } else {
    for (const v of violations) {
      const icon = v.severity === "error" ? "✗" : v.severity === "warning" ? "⚠" : "ℹ";
      lines.push(`  ${icon} [${v.rule}] ${v.sessionTitle}: ${v.message}`);
      if (v.suggestion) lines.push(`    → ${v.suggestion}`);
    }
  }
  return lines;
}
