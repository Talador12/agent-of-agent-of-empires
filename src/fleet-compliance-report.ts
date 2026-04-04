// fleet-compliance-report.ts — generate structured compliance reports
// for auditing and documentation. aggregates compliance checks, SLA
// status, incident history, and cost data into a single report.

export interface ComplianceReportInput {
  periodLabel: string;
  complianceViolations: Array<{ session: string; rule: string; severity: string }>;
  slaBreaches: Array<{ session: string; slaHours: number; actualHours: number }>;
  incidents: Array<{ session: string; type: string; resolved: boolean }>;
  totalCostUsd: number;
  budgetUsd: number;
  sessionCount: number;
  healthScore: number;
}

export interface ComplianceReport {
  periodLabel: string;
  generatedAt: string;
  overallStatus: "compliant" | "non-compliant" | "at-risk";
  score: number; // 0-100
  sections: ComplianceSection[];
}

export interface ComplianceSection {
  title: string;
  status: "pass" | "warn" | "fail";
  items: string[];
}

/**
 * Generate a compliance report.
 */
export function generateComplianceReport(input: ComplianceReportInput): ComplianceReport {
  const sections: ComplianceSection[] = [];
  let totalScore = 100;

  // policy compliance
  const policyStatus = input.complianceViolations.length === 0 ? "pass" : input.complianceViolations.some((v) => v.severity === "error") ? "fail" : "warn";
  const policyItems = input.complianceViolations.length === 0
    ? ["All sessions pass policy checks"]
    : input.complianceViolations.map((v) => `${v.session}: ${v.rule} (${v.severity})`);
  sections.push({ title: "Policy Compliance", status: policyStatus, items: policyItems });
  if (policyStatus === "fail") totalScore -= 30;
  else if (policyStatus === "warn") totalScore -= 10;

  // SLA compliance
  const slaStatus = input.slaBreaches.length === 0 ? "pass" : "fail";
  const slaItems = input.slaBreaches.length === 0
    ? ["All goals within SLA limits"]
    : input.slaBreaches.map((b) => `${b.session}: ${b.actualHours.toFixed(1)}h / ${b.slaHours}h SLA`);
  sections.push({ title: "SLA Compliance", status: slaStatus, items: slaItems });
  if (slaStatus === "fail") totalScore -= 20;

  // incident management
  const unresolvedIncidents = input.incidents.filter((i) => !i.resolved);
  const incidentStatus = unresolvedIncidents.length === 0 ? "pass" : unresolvedIncidents.length > 3 ? "fail" : "warn";
  sections.push({
    title: "Incident Management",
    status: incidentStatus,
    items: [`${input.incidents.length} total, ${unresolvedIncidents.length} unresolved`],
  });
  if (incidentStatus === "fail") totalScore -= 20;
  else if (incidentStatus === "warn") totalScore -= 10;

  // cost management
  const costOverBudget = input.totalCostUsd > input.budgetUsd;
  const costStatus = !costOverBudget ? "pass" : input.totalCostUsd > input.budgetUsd * 1.5 ? "fail" : "warn";
  sections.push({
    title: "Cost Management",
    status: costStatus,
    items: [`$${input.totalCostUsd.toFixed(2)} / $${input.budgetUsd.toFixed(2)} budget (${Math.round((input.totalCostUsd / input.budgetUsd) * 100)}%)`],
  });
  if (costStatus === "fail") totalScore -= 15;
  else if (costStatus === "warn") totalScore -= 5;

  // fleet health
  const healthStatus = input.healthScore >= 70 ? "pass" : input.healthScore >= 40 ? "warn" : "fail";
  sections.push({ title: "Fleet Health", status: healthStatus, items: [`${input.healthScore}% health score`] });
  if (healthStatus === "fail") totalScore -= 15;
  else if (healthStatus === "warn") totalScore -= 5;

  totalScore = Math.max(0, totalScore);
  const overallStatus: ComplianceReport["overallStatus"] = totalScore >= 80 ? "compliant" : totalScore >= 50 ? "at-risk" : "non-compliant";

  return { periodLabel: input.periodLabel, generatedAt: new Date().toISOString(), overallStatus, score: totalScore, sections };
}

/**
 * Format compliance report for TUI display.
 */
export function formatComplianceReportTui(report: ComplianceReport): string[] {
  const icon = report.overallStatus === "compliant" ? "✓" : report.overallStatus === "at-risk" ? "⚠" : "✗";
  const lines: string[] = [];
  lines.push(`  Compliance Report [${report.periodLabel}] ${icon} ${report.overallStatus.toUpperCase()} (${report.score}/100):`);
  for (const s of report.sections) {
    const sIcon = s.status === "pass" ? "✓" : s.status === "warn" ? "⚠" : "✗";
    lines.push(`    ${sIcon} ${s.title}:`);
    for (const item of s.items) lines.push(`      ${item}`);
  }
  return lines;
}

/**
 * Format compliance report as markdown.
 */
export function formatComplianceReportMd(report: ComplianceReport): string {
  const parts: string[] = [];
  parts.push(`# Compliance Report — ${report.periodLabel}`);
  parts.push(`\n**Status:** ${report.overallStatus.toUpperCase()} (${report.score}/100)`);
  parts.push(`**Generated:** ${report.generatedAt}`);
  for (const s of report.sections) {
    const icon = s.status === "pass" ? "✅" : s.status === "warn" ? "⚠️" : "❌";
    parts.push(`\n## ${icon} ${s.title}`);
    for (const item of s.items) parts.push(`- ${item}`);
  }
  return parts.join("\n");
}
