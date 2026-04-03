// alert-rules.ts — custom fleet health alerting rules beyond SLA threshold.
// define conditions that trigger alerts when met, with configurable
// severity, cooldown, and notification routing.

export type AlertSeverity = "info" | "warning" | "critical";
export type AlertCondition = (ctx: AlertContext) => boolean;

export interface AlertContext {
  fleetHealth: number;
  activeSessions: number;
  errorSessions: number;
  totalCostUsd: number;
  hourlyCostRate: number;
  stuckSessions: number;
  idleMinutes: Map<string, number>; // per-session idle time
}

export interface AlertRule {
  name: string;
  description: string;
  severity: AlertSeverity;
  condition: AlertCondition;
  cooldownMs: number;      // min time between firings
  lastFiredAt: number;
}

export interface FiredAlert {
  ruleName: string;
  severity: AlertSeverity;
  message: string;
  timestamp: number;
}

/**
 * Built-in alert rules.
 */
export function defaultAlertRules(): AlertRule[] {
  return [
    {
      name: "fleet-health-critical",
      description: "Fleet health dropped below 30",
      severity: "critical",
      condition: (ctx) => ctx.fleetHealth < 30,
      cooldownMs: 10 * 60_000,
      lastFiredAt: 0,
    },
    {
      name: "high-error-rate",
      description: "More than 50% of sessions in error state",
      severity: "critical",
      condition: (ctx) => ctx.activeSessions > 0 && (ctx.errorSessions / ctx.activeSessions) > 0.5,
      cooldownMs: 5 * 60_000,
      lastFiredAt: 0,
    },
    {
      name: "cost-spike",
      description: "Hourly cost rate exceeds $5",
      severity: "warning",
      condition: (ctx) => ctx.hourlyCostRate > 5,
      cooldownMs: 15 * 60_000,
      lastFiredAt: 0,
    },
    {
      name: "all-stuck",
      description: "All active sessions are stuck",
      severity: "critical",
      condition: (ctx) => ctx.activeSessions > 0 && ctx.stuckSessions === ctx.activeSessions,
      cooldownMs: 10 * 60_000,
      lastFiredAt: 0,
    },
    {
      name: "no-active-sessions",
      description: "No active sessions running",
      severity: "info",
      condition: (ctx) => ctx.activeSessions === 0,
      cooldownMs: 30 * 60_000,
      lastFiredAt: 0,
    },
  ];
}

/**
 * Evaluate all alert rules against current fleet state.
 */
export function evaluateAlertRules(rules: AlertRule[], ctx: AlertContext, now = Date.now()): FiredAlert[] {
  const fired: FiredAlert[] = [];
  for (const rule of rules) {
    if (now - rule.lastFiredAt < rule.cooldownMs) continue;
    if (rule.condition(ctx)) {
      rule.lastFiredAt = now;
      fired.push({
        ruleName: rule.name,
        severity: rule.severity,
        message: rule.description,
        timestamp: now,
      });
    }
  }
  return fired;
}

/**
 * Format fired alerts for TUI display.
 */
export function formatFiredAlerts(alerts: FiredAlert[]): string[] {
  if (alerts.length === 0) return ["  ✅ no alerts fired"];
  const icons: Record<AlertSeverity, string> = { info: "ℹ", warning: "⚠", critical: "🚨" };
  return alerts.map((a) => `  ${icons[a.severity]} [${a.severity}] ${a.ruleName}: ${a.message}`);
}

/**
 * Format all rules and their status for TUI display.
 */
export function formatAlertRules(rules: AlertRule[], now = Date.now()): string[] {
  const lines: string[] = [];
  lines.push(`  Alert rules (${rules.length}):`);
  for (const r of rules) {
    const cooldownRemaining = Math.max(0, r.cooldownMs - (now - r.lastFiredAt));
    const cooldownStr = cooldownRemaining > 0 ? ` (cooldown: ${Math.round(cooldownRemaining / 60_000)}m)` : "";
    const icon = r.severity === "critical" ? "🚨" : r.severity === "warning" ? "⚠" : "ℹ";
    lines.push(`  ${icon} ${r.name}: ${r.description}${cooldownStr}`);
  }
  return lines;
}
