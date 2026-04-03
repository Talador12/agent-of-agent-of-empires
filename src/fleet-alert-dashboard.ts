// fleet-alert-dashboard.ts — unified view of all active and recent alerts
// with acknowledge/dismiss capability. aggregates alerts from incidents,
// cost, compliance, health, and watchdog into a single pane of glass.

export type AlertSource = "incident" | "cost" | "compliance" | "health" | "watchdog" | "sla" | "custom";

export interface DashboardAlert {
  id: number;
  source: AlertSource;
  severity: "info" | "warning" | "error" | "critical";
  sessionTitle?: string;
  message: string;
  createdAt: number;
  acknowledged: boolean;
  acknowledgedAt?: number;
  acknowledgedBy?: string;
}

export interface AlertDashboardState {
  alerts: DashboardAlert[];
  nextId: number;
  maxAlerts: number;
}

/**
 * Create alert dashboard state.
 */
export function createAlertDashboard(maxAlerts = 200): AlertDashboardState {
  return { alerts: [], nextId: 1, maxAlerts };
}

/**
 * Add an alert.
 */
export function addAlert(state: AlertDashboardState, source: AlertSource, severity: DashboardAlert["severity"], message: string, sessionTitle?: string, now = Date.now()): DashboardAlert {
  const alert: DashboardAlert = { id: state.nextId++, source, severity, message: message.slice(0, 200), sessionTitle, createdAt: now, acknowledged: false };
  state.alerts.push(alert);
  if (state.alerts.length > state.maxAlerts) state.alerts = state.alerts.slice(-state.maxAlerts);
  return alert;
}

/**
 * Acknowledge an alert.
 */
export function acknowledgeAlert(state: AlertDashboardState, id: number, by = "operator", now = Date.now()): boolean {
  const alert = state.alerts.find((a) => a.id === id);
  if (!alert || alert.acknowledged) return false;
  alert.acknowledged = true;
  alert.acknowledgedAt = now;
  alert.acknowledgedBy = by;
  return true;
}

/**
 * Dismiss (remove) an alert.
 */
export function dismissAlert(state: AlertDashboardState, id: number): boolean {
  const idx = state.alerts.findIndex((a) => a.id === id);
  if (idx === -1) return false;
  state.alerts.splice(idx, 1);
  return true;
}

/**
 * Get active (unacknowledged) alerts.
 */
export function activeAlerts(state: AlertDashboardState): DashboardAlert[] {
  return state.alerts.filter((a) => !a.acknowledged);
}

/**
 * Get alerts by source.
 */
export function alertsBySource(state: AlertDashboardState, source: AlertSource): DashboardAlert[] {
  return state.alerts.filter((a) => a.source === source);
}

/**
 * Get alert counts by severity.
 */
export function alertCounts(state: AlertDashboardState): Record<string, number> {
  const counts: Record<string, number> = { critical: 0, error: 0, warning: 0, info: 0 };
  for (const a of state.alerts.filter((a) => !a.acknowledged)) counts[a.severity]++;
  return counts;
}

/**
 * Format alert dashboard for TUI display.
 */
export function formatAlertDashboard(state: AlertDashboardState): string[] {
  const active = activeAlerts(state);
  const counts = alertCounts(state);
  const lines: string[] = [];
  lines.push(`  Alert Dashboard (${active.length} active, ${state.alerts.length} total: ${counts.critical}C ${counts.error}E ${counts.warning}W ${counts.info}I):`);
  if (active.length === 0) {
    lines.push("    No active alerts");
  } else {
    const icons: Record<string, string> = { critical: "🔴", error: "✗", warning: "⚠", info: "ℹ" };
    for (const a of active.slice(0, 10)) {
      const icon = icons[a.severity] ?? "·";
      const session = a.sessionTitle ? `[${a.sessionTitle}] ` : "";
      const ago = Math.round((Date.now() - a.createdAt) / 60_000);
      lines.push(`    ${icon} #${a.id} ${session}${a.source}: ${a.message.slice(0, 60)} (${ago}m ago)`);
    }
    if (active.length > 10) lines.push(`    ... ${active.length - 10} more`);
  }
  return lines;
}
