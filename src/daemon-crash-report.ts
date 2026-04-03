// daemon-crash-report.ts — auto-generate diagnostic report on unexpected
// exit. captures daemon state, recent events, active sessions, error
// history, and config into a structured report for debugging.

export interface CrashReportData {
  timestamp: string;
  uptime: string;
  tickCount: number;
  nodeVersion: string;
  error?: { message: string; stack?: string };
  recentEvents: string[];
  activeSessions: string[];
  unresolvedIncidents: number;
  healthScore: number;
  config: Record<string, unknown>;
  memoryUsage: { heapUsedMB: number; rssMB: number };
}

export interface CrashReport {
  data: CrashReportData;
  formatted: string;
  filename: string;
}

/**
 * Generate a crash report from current daemon state.
 */
export function generateCrashReport(opts: {
  uptimeMs: number;
  tickCount: number;
  error?: Error;
  recentEvents?: string[];
  activeSessions?: string[];
  unresolvedIncidents?: number;
  healthScore?: number;
  config?: Record<string, unknown>;
}): CrashReport {
  const now = new Date();
  const mem = typeof process !== "undefined" && process.memoryUsage
    ? process.memoryUsage()
    : { heapUsed: 0, rss: 0 };

  const data: CrashReportData = {
    timestamp: now.toISOString(),
    uptime: formatDuration(opts.uptimeMs),
    tickCount: opts.tickCount,
    nodeVersion: typeof process !== "undefined" ? process.version : "unknown",
    error: opts.error ? { message: opts.error.message, stack: opts.error.stack?.slice(0, 500) } : undefined,
    recentEvents: (opts.recentEvents ?? []).slice(-10),
    activeSessions: opts.activeSessions ?? [],
    unresolvedIncidents: opts.unresolvedIncidents ?? 0,
    healthScore: opts.healthScore ?? 0,
    config: sanitizeConfig(opts.config ?? {}),
    memoryUsage: {
      heapUsedMB: Math.round(mem.heapUsed / 1_048_576),
      rssMB: Math.round(mem.rss / 1_048_576),
    },
  };

  const formatted = formatCrashReport(data);
  const filename = `crash-${now.toISOString().replace(/[:.]/g, "-")}.txt`;

  return { data, formatted, filename };
}

/**
 * Sanitize config for crash report (strip secrets).
 */
function sanitizeConfig(config: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(config)) {
    const lk = k.toLowerCase();
    if (lk.includes("secret") || lk.includes("token") || lk.includes("password") || lk.includes("key")) {
      sanitized[k] = "[REDACTED]";
    } else if (typeof v === "object" && v !== null && !Array.isArray(v)) {
      sanitized[k] = sanitizeConfig(v as Record<string, unknown>);
    } else {
      sanitized[k] = v;
    }
  }
  return sanitized;
}

function formatDuration(ms: number): string {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return `${h}h${m}m`;
}

/**
 * Format crash report data as human-readable text.
 */
export function formatCrashReport(data: CrashReportData): string {
  const lines: string[] = [];
  lines.push("═══ AOAOE CRASH REPORT ═══");
  lines.push(`Timestamp: ${data.timestamp}`);
  lines.push(`Uptime: ${data.uptime} | Ticks: ${data.tickCount} | Node: ${data.nodeVersion}`);
  lines.push(`Memory: heap ${data.memoryUsage.heapUsedMB}MB / RSS ${data.memoryUsage.rssMB}MB`);
  lines.push(`Health: ${data.healthScore}% | Unresolved incidents: ${data.unresolvedIncidents}`);

  if (data.error) {
    lines.push("\n── Error ──");
    lines.push(data.error.message);
    if (data.error.stack) lines.push(data.error.stack);
  }

  if (data.activeSessions.length > 0) {
    lines.push(`\n── Active Sessions (${data.activeSessions.length}) ──`);
    for (const s of data.activeSessions) lines.push(`  ${s}`);
  }

  if (data.recentEvents.length > 0) {
    lines.push(`\n── Recent Events (${data.recentEvents.length}) ──`);
    for (const e of data.recentEvents) lines.push(`  ${e}`);
  }

  return lines.join("\n");
}

/**
 * Format crash report for TUI display (preview).
 */
export function formatCrashReportTui(report: CrashReport): string[] {
  const lines: string[] = [];
  lines.push(`  Crash Report Preview (would save to ${report.filename}):`);
  const preview = report.formatted.split("\n").slice(0, 10);
  for (const l of preview) lines.push(`    ${l}`);
  if (report.formatted.split("\n").length > 10) {
    lines.push(`    ... ${report.formatted.split("\n").length - 10} more lines`);
  }
  return lines;
}
