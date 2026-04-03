// fleet-ops-dashboard.ts — full-screen fleet monitor data model.
// aggregates all key fleet metrics into a single dashboard view:
// session table, health bar, cost summary, incident count, capacity,
// and recent events. renders as multi-section TUI output.

export interface DashboardSession {
  title: string;
  status: string;
  healthPct: number;
  costUsd: number;
  progressPct: number;
  sentiment: string;
  idleMinutes: number;
}

export interface DashboardData {
  timestamp: number;
  sessions: DashboardSession[];
  fleetHealth: number;
  totalCostUsd: number;
  unresolvedIncidents: number;
  poolUtilizationPct: number;
  readinessGrade: string;
  recentEvents: string[];
  uptimeHours: number;
  tickCount: number;
}

/**
 * Build dashboard data from fleet state.
 */
export function buildDashboardData(opts: {
  sessions: DashboardSession[];
  fleetHealth: number;
  totalCostUsd: number;
  unresolvedIncidents: number;
  poolUtilizationPct: number;
  readinessGrade: string;
  recentEvents: string[];
  uptimeHours: number;
  tickCount: number;
}): DashboardData {
  return { timestamp: Date.now(), ...opts };
}

/**
 * Format full-screen dashboard for TUI display.
 */
export function formatOpsDashboard(data: DashboardData): string[] {
  const lines: string[] = [];
  const healthIcon = data.fleetHealth >= 80 ? "🟢" : data.fleetHealth >= 50 ? "🟡" : "🔴";

  // header
  lines.push(`  ╔═══════════════════════════════════════════════════════════╗`);
  lines.push(`  ║  Fleet Operations Dashboard ${healthIcon}  ${data.readinessGrade.padStart(10)}  ║`);
  lines.push(`  ╠═══════════════════════════════════════════════════════════╣`);

  // metrics bar
  const uptime = `${data.uptimeHours.toFixed(1)}h`;
  lines.push(`  ║  Health: ${data.fleetHealth}%  Cost: $${data.totalCostUsd.toFixed(2)}  Pool: ${data.poolUtilizationPct}%  Up: ${uptime}  Ticks: ${data.tickCount}  ║`);
  lines.push(`  ║  Incidents: ${data.unresolvedIncidents} unresolved  Sessions: ${data.sessions.length}${"".padEnd(20)}║`);
  lines.push(`  ╠═══════════════════════════════════════════════════════════╣`);

  // session table
  if (data.sessions.length > 0) {
    lines.push(`  ║  ${"Session".padEnd(14)} ${"Status".padEnd(10)} ${"HP".padStart(4)} ${"Cost".padStart(7)} ${"Prog".padStart(5)} ${"Mood".padEnd(8)} ║`);
    lines.push(`  ║  ${"─".repeat(14)} ${"─".repeat(10)} ${"─".repeat(4)} ${"─".repeat(7)} ${"─".repeat(5)} ${"─".repeat(8)} ║`);
    for (const s of data.sessions.slice(0, 8)) {
      const hp = `${s.healthPct}%`;
      const cost = `$${s.costUsd.toFixed(2)}`;
      const prog = `${s.progressPct}%`;
      lines.push(`  ║  ${s.title.slice(0, 14).padEnd(14)} ${s.status.slice(0, 10).padEnd(10)} ${hp.padStart(4)} ${cost.padStart(7)} ${prog.padStart(5)} ${s.sentiment.slice(0, 8).padEnd(8)} ║`);
    }
    if (data.sessions.length > 8) lines.push(`  ║  ... ${data.sessions.length - 8} more sessions${"".padEnd(36)}║`);
  }

  // recent events
  if (data.recentEvents.length > 0) {
    lines.push(`  ╠═══════════════════════════════════════════════════════════╣`);
    lines.push(`  ║  Recent Events:${"".padEnd(44)}║`);
    for (const e of data.recentEvents.slice(0, 3)) {
      lines.push(`  ║    ${e.slice(0, 55).padEnd(55)}║`);
    }
  }

  lines.push(`  ╚═══════════════════════════════════════════════════════════╝`);
  return lines;
}
