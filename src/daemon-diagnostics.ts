// daemon-diagnostics.ts — /doctor command that checks config, environment,
// runtime performance, and connectivity, then reports issues with severity
// and suggested fixes. a one-stop health check for the daemon itself.

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";

export type CheckSeverity = "ok" | "warn" | "error" | "info";

export interface DiagnosticCheck {
  name: string;
  severity: CheckSeverity;
  message: string;
  suggestion?: string;
}

export interface DiagnosticReport {
  checks: DiagnosticCheck[];
  passCount: number;
  warnCount: number;
  errorCount: number;
  infoCount: number;
}

/**
 * Run all diagnostic checks and produce a report.
 */
export function runDiagnostics(opts: {
  configPath?: string;
  stateDir?: string;
  reasonerBackend?: string;
  pollIntervalMs?: number;
  nodeVersion?: string;
  uptimeMs?: number;
  tickCount?: number;
  sessionCount?: number;
  testMode?: boolean;
}): DiagnosticReport {
  const checks: DiagnosticCheck[] = [];

  // 1. node version
  const nodeVer = opts.nodeVersion ?? process.version;
  const major = parseInt(nodeVer.replace("v", "").split(".")[0], 10);
  if (major >= 20) {
    checks.push({ name: "node-version", severity: "ok", message: `Node ${nodeVer}` });
  } else {
    checks.push({ name: "node-version", severity: "error", message: `Node ${nodeVer} — requires >=20`, suggestion: "Upgrade to Node 20 or later" });
  }

  // 2. config file exists
  const cfgPath = opts.configPath ?? resolve(homedir(), ".aoaoe", "aoaoe.config.json");
  if (opts.testMode || existsSync(cfgPath)) {
    checks.push({ name: "config-file", severity: "ok", message: `Config: ${cfgPath}` });
  } else {
    checks.push({ name: "config-file", severity: "warn", message: "No config file found", suggestion: "Run aoaoe init to generate one" });
  }

  // 3. state directory
  const stateDir = opts.stateDir ?? resolve(homedir(), ".aoaoe");
  if (opts.testMode || existsSync(stateDir)) {
    checks.push({ name: "state-dir", severity: "ok", message: `State dir: ${stateDir}` });
  } else {
    checks.push({ name: "state-dir", severity: "warn", message: "State directory missing", suggestion: `Create ${stateDir}` });
  }

  // 4. reasoner backend
  const backend = opts.reasonerBackend ?? "unknown";
  if (backend === "opencode" || backend === "claude-code") {
    checks.push({ name: "reasoner", severity: "ok", message: `Reasoner: ${backend}` });
  } else {
    checks.push({ name: "reasoner", severity: "warn", message: `Reasoner: ${backend} (non-standard)`, suggestion: "Use 'opencode' or 'claude-code'" });
  }

  // 5. poll interval sanity
  const poll = opts.pollIntervalMs ?? 10_000;
  if (poll < 1000) {
    checks.push({ name: "poll-interval", severity: "error", message: `Poll interval ${poll}ms is dangerously fast`, suggestion: "Set pollIntervalMs >= 1000" });
  } else if (poll > 120_000) {
    checks.push({ name: "poll-interval", severity: "warn", message: `Poll interval ${poll}ms is very slow`, suggestion: "Consider lowering for faster response" });
  } else {
    checks.push({ name: "poll-interval", severity: "ok", message: `Poll interval: ${poll}ms` });
  }

  // 6. uptime
  if (opts.uptimeMs !== undefined) {
    const hours = Math.round(opts.uptimeMs / 3_600_000 * 10) / 10;
    checks.push({ name: "uptime", severity: "info", message: `Uptime: ${hours}h` });
  }

  // 7. tick count
  if (opts.tickCount !== undefined) {
    checks.push({ name: "tick-count", severity: "info", message: `Ticks: ${opts.tickCount}` });
  }

  // 8. session count
  if (opts.sessionCount !== undefined) {
    if (opts.sessionCount === 0) {
      checks.push({ name: "sessions", severity: "warn", message: "No active sessions", suggestion: "Register sessions with aoe add or aoaoe register" });
    } else {
      checks.push({ name: "sessions", severity: "ok", message: `Sessions: ${opts.sessionCount}` });
    }
  }

  // 9. actions.log exists
  const actionsLog = resolve(stateDir, "actions.log");
  if (opts.testMode || existsSync(actionsLog)) {
    checks.push({ name: "actions-log", severity: "ok", message: "Actions log: present" });
  } else {
    checks.push({ name: "actions-log", severity: "info", message: "Actions log: not yet created (normal for first run)" });
  }

  const passCount = checks.filter((c) => c.severity === "ok").length;
  const warnCount = checks.filter((c) => c.severity === "warn").length;
  const errorCount = checks.filter((c) => c.severity === "error").length;
  const infoCount = checks.filter((c) => c.severity === "info").length;

  return { checks, passCount, warnCount, errorCount, infoCount };
}

/**
 * Format diagnostic report for TUI display.
 */
export function formatDiagnostics(report: DiagnosticReport): string[] {
  const lines: string[] = [];
  const status = report.errorCount > 0 ? "ISSUES FOUND" : report.warnCount > 0 ? "WARNINGS" : "ALL CLEAR";
  lines.push(`  ═══ Daemon Diagnostics: ${status} ═══`);
  lines.push(`  ${report.passCount} ok, ${report.warnCount} warn, ${report.errorCount} error, ${report.infoCount} info`);
  lines.push("");
  for (const c of report.checks) {
    const icon = c.severity === "ok" ? "✓" : c.severity === "warn" ? "⚠" : c.severity === "error" ? "✗" : "ℹ";
    lines.push(`  ${icon} [${c.name}] ${c.message}`);
    if (c.suggestion) lines.push(`    → ${c.suggestion}`);
  }
  return lines;
}
