// metrics-export.ts — Prometheus-compatible /metrics endpoint for daemon observability.
// exports fleet health, session counts, cost, reasoning stats as text/plain metrics.

export interface MetricsSnapshot {
  fleetHealth: number;
  totalSessions: number;
  activeSessions: number;
  errorSessions: number;
  totalTasks: number;
  activeTasks: number;
  completedTasks: number;
  failedTasks: number;
  totalCostUsd: number;
  reasonerCallsTotal: number;
  reasonerCostTotal: number;
  cacheHits: number;
  cacheMisses: number;
  alertsFired: number;
  nudgesSent: number;
  nudgesEffective: number;
  pollIntervalMs: number;
  uptimeMs: number;
}

/**
 * Format metrics as Prometheus text exposition format.
 */
export function formatPrometheusMetrics(m: MetricsSnapshot): string {
  const lines: string[] = [];
  const metric = (name: string, help: string, type: string, value: number) => {
    lines.push(`# HELP aoaoe_${name} ${help}`);
    lines.push(`# TYPE aoaoe_${name} ${type}`);
    lines.push(`aoaoe_${name} ${value}`);
  };

  metric("fleet_health", "Fleet health score 0-100", "gauge", m.fleetHealth);
  metric("sessions_total", "Total number of sessions", "gauge", m.totalSessions);
  metric("sessions_active", "Number of active sessions", "gauge", m.activeSessions);
  metric("sessions_error", "Number of sessions in error state", "gauge", m.errorSessions);
  metric("tasks_total", "Total number of tasks", "gauge", m.totalTasks);
  metric("tasks_active", "Number of active tasks", "gauge", m.activeTasks);
  metric("tasks_completed_total", "Total completed tasks", "counter", m.completedTasks);
  metric("tasks_failed_total", "Total failed tasks", "counter", m.failedTasks);
  metric("cost_usd_total", "Total cost in USD", "counter", m.totalCostUsd);
  metric("reasoner_calls_total", "Total reasoning calls made", "counter", m.reasonerCallsTotal);
  metric("reasoner_cost_usd_total", "Total reasoner cost in USD", "counter", m.reasonerCostTotal);
  metric("cache_hits_total", "Observation cache hits", "counter", m.cacheHits);
  metric("cache_misses_total", "Observation cache misses", "counter", m.cacheMisses);
  metric("alerts_fired_total", "Total alerts fired", "counter", m.alertsFired);
  metric("nudges_sent_total", "Total nudges sent", "counter", m.nudgesSent);
  metric("nudges_effective_total", "Nudges that led to progress", "counter", m.nudgesEffective);
  metric("poll_interval_ms", "Current adaptive poll interval", "gauge", m.pollIntervalMs);
  metric("uptime_seconds", "Daemon uptime in seconds", "gauge", Math.round(m.uptimeMs / 1000));

  return lines.join("\n") + "\n";
}

/**
 * Build a metrics snapshot from daemon state.
 */
export function buildMetricsSnapshot(state: Partial<MetricsSnapshot>): MetricsSnapshot {
  return {
    fleetHealth: state.fleetHealth ?? 0,
    totalSessions: state.totalSessions ?? 0,
    activeSessions: state.activeSessions ?? 0,
    errorSessions: state.errorSessions ?? 0,
    totalTasks: state.totalTasks ?? 0,
    activeTasks: state.activeTasks ?? 0,
    completedTasks: state.completedTasks ?? 0,
    failedTasks: state.failedTasks ?? 0,
    totalCostUsd: state.totalCostUsd ?? 0,
    reasonerCallsTotal: state.reasonerCallsTotal ?? 0,
    reasonerCostTotal: state.reasonerCostTotal ?? 0,
    cacheHits: state.cacheHits ?? 0,
    cacheMisses: state.cacheMisses ?? 0,
    alertsFired: state.alertsFired ?? 0,
    nudgesSent: state.nudgesSent ?? 0,
    nudgesEffective: state.nudgesEffective ?? 0,
    pollIntervalMs: state.pollIntervalMs ?? 10_000,
    uptimeMs: state.uptimeMs ?? 0,
  };
}
