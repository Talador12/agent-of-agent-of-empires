// daemon-audit-report.ts — periodic compliance reports from audit trail.
// aggregates audit entries into a structured report covering actions,
// approvals, escalations, errors, and cost by time period.

export interface AuditReportInput {
  periodLabel: string;
  actions: Array<{ type: string; session: string; timestamp: number; success: boolean }>;
  approvals: Array<{ session: string; status: string }>;
  escalations: number;
  errors: number;
  totalCostUsd: number;
  reasonerCalls: number;
}

export interface AuditReport {
  periodLabel: string;
  generatedAt: string;
  summary: { totalActions: number; successRate: number; approvals: number; escalations: number; errors: number; costUsd: number; reasonerCalls: number };
  actionBreakdown: Map<string, number>;
  sessionActivity: Map<string, number>;
  complianceStatus: "pass" | "review-needed" | "fail";
}

/**
 * Generate an audit report from trail data.
 */
export function generateAuditReport(input: AuditReportInput): AuditReport {
  const successCount = input.actions.filter((a) => a.success).length;
  const successRate = input.actions.length > 0 ? Math.round((successCount / input.actions.length) * 100) : 100;

  const actionBreakdown = new Map<string, number>();
  const sessionActivity = new Map<string, number>();
  for (const a of input.actions) {
    actionBreakdown.set(a.type, (actionBreakdown.get(a.type) ?? 0) + 1);
    sessionActivity.set(a.session, (sessionActivity.get(a.session) ?? 0) + 1);
  }

  let compliance: AuditReport["complianceStatus"] = "pass";
  if (input.errors > 10 || successRate < 80) compliance = "fail";
  else if (input.errors > 3 || input.escalations > 5 || successRate < 95) compliance = "review-needed";

  return {
    periodLabel: input.periodLabel,
    generatedAt: new Date().toISOString(),
    summary: {
      totalActions: input.actions.length,
      successRate,
      approvals: input.approvals.length,
      escalations: input.escalations,
      errors: input.errors,
      costUsd: input.totalCostUsd,
      reasonerCalls: input.reasonerCalls,
    },
    actionBreakdown,
    sessionActivity,
    complianceStatus: compliance,
  };
}

/**
 * Format audit report as markdown.
 */
export function formatAuditReportMarkdown(report: AuditReport): string {
  const s = report.summary;
  const parts: string[] = [];
  parts.push(`# Audit Report — ${report.periodLabel}`);
  parts.push(`\n> Generated: ${report.generatedAt}`);
  parts.push(`\n## Summary`);
  parts.push(`- Actions: ${s.totalActions} (${s.successRate}% success)`);
  parts.push(`- Approvals: ${s.approvals} | Escalations: ${s.escalations} | Errors: ${s.errors}`);
  parts.push(`- Cost: $${s.costUsd.toFixed(2)} | Reasoner calls: ${s.reasonerCalls}`);
  parts.push(`- Compliance: **${report.complianceStatus.toUpperCase()}**`);

  if (report.actionBreakdown.size > 0) {
    parts.push(`\n## Action Breakdown`);
    for (const [type, count] of report.actionBreakdown) parts.push(`- ${type}: ${count}`);
  }

  return parts.join("\n");
}

/**
 * Format audit report for TUI display.
 */
export function formatAuditReportTui(report: AuditReport): string[] {
  const s = report.summary;
  const icon = report.complianceStatus === "pass" ? "✓" : report.complianceStatus === "fail" ? "✗" : "⚠";
  const lines: string[] = [];
  lines.push(`  Audit Report [${report.periodLabel}] ${icon} ${report.complianceStatus.toUpperCase()}`);
  lines.push(`    Actions: ${s.totalActions} (${s.successRate}% success) | Errors: ${s.errors} | Escalations: ${s.escalations}`);
  lines.push(`    Cost: $${s.costUsd.toFixed(2)} | Reasoner: ${s.reasonerCalls} calls | Approvals: ${s.approvals}`);
  if (report.actionBreakdown.size > 0) {
    const top = Array.from(report.actionBreakdown.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5);
    lines.push(`    Top actions: ${top.map(([t, c]) => `${t}(${c})`).join(", ")}`);
  }
  return lines;
}
