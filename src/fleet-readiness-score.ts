// fleet-readiness-score.ts — composite readiness metric for production
// workloads. evaluates whether the fleet is ready to handle real work
// by checking config, capacity, health, compliance, and tooling.

export interface ReadinessCheck {
  name: string;
  passed: boolean;
  weight: number;
  detail: string;
}

export interface ReadinessReport {
  score: number;       // 0-100
  grade: "READY" | "CAUTION" | "NOT READY";
  checks: ReadinessCheck[];
  passedCount: number;
  totalCount: number;
}

export interface ReadinessInputs {
  configValid: boolean;
  reasonerConnected: boolean;
  sessionCount: number;
  poolCapacity: number;       // max slots
  healthScore: number;        // 0-100
  complianceViolations: number;
  unresolvedIncidents: number;
  watchdogEnabled: boolean;
  costBudgetSet: boolean;
  contextFilesLoaded: boolean;
}

/**
 * Evaluate fleet operational readiness.
 */
export function evaluateReadiness(inputs: ReadinessInputs): ReadinessReport {
  const checks: ReadinessCheck[] = [];

  checks.push({ name: "config-valid", passed: inputs.configValid, weight: 15, detail: inputs.configValid ? "config passes validation" : "config has errors" });
  checks.push({ name: "reasoner-connected", passed: inputs.reasonerConnected, weight: 20, detail: inputs.reasonerConnected ? "reasoner backend reachable" : "reasoner not connected" });
  checks.push({ name: "sessions-active", passed: inputs.sessionCount > 0, weight: 10, detail: `${inputs.sessionCount} sessions registered` });
  checks.push({ name: "pool-capacity", passed: inputs.sessionCount < inputs.poolCapacity, weight: 10, detail: `${inputs.sessionCount}/${inputs.poolCapacity} slots used` });
  checks.push({ name: "fleet-health", passed: inputs.healthScore >= 60, weight: 15, detail: `health ${inputs.healthScore}%` });
  checks.push({ name: "compliance", passed: inputs.complianceViolations === 0, weight: 10, detail: inputs.complianceViolations === 0 ? "no violations" : `${inputs.complianceViolations} violations` });
  checks.push({ name: "incidents-clear", passed: inputs.unresolvedIncidents === 0, weight: 10, detail: inputs.unresolvedIncidents === 0 ? "no unresolved incidents" : `${inputs.unresolvedIncidents} unresolved` });
  checks.push({ name: "watchdog-enabled", passed: inputs.watchdogEnabled, weight: 5, detail: inputs.watchdogEnabled ? "watchdog active" : "watchdog disabled" });
  checks.push({ name: "cost-budget", passed: inputs.costBudgetSet, weight: 5, detail: inputs.costBudgetSet ? "budget configured" : "no budget set" });
  checks.push({ name: "context-loaded", passed: inputs.contextFilesLoaded, weight: 5, detail: inputs.contextFilesLoaded ? "context files loaded" : "no context files" });

  const totalWeight = checks.reduce((a, c) => a + c.weight, 0);
  const passedWeight = checks.filter((c) => c.passed).reduce((a, c) => a + c.weight, 0);
  const score = Math.round((passedWeight / totalWeight) * 100);

  const grade: ReadinessReport["grade"] = score >= 80 ? "READY" : score >= 50 ? "CAUTION" : "NOT READY";

  return {
    score,
    grade,
    checks,
    passedCount: checks.filter((c) => c.passed).length,
    totalCount: checks.length,
  };
}

/**
 * Format readiness report for TUI display.
 */
export function formatReadiness(report: ReadinessReport): string[] {
  const icon = report.grade === "READY" ? "🟢" : report.grade === "CAUTION" ? "🟡" : "🔴";
  const lines: string[] = [];
  lines.push(`  Fleet Readiness ${icon} ${report.grade} (${report.score}%, ${report.passedCount}/${report.totalCount} checks passed):`);
  for (const c of report.checks) {
    const mark = c.passed ? "✓" : "✗";
    lines.push(`    ${mark} ${c.name} (w:${c.weight}): ${c.detail}`);
  }
  return lines;
}
