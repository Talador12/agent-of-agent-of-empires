// daemon-state-portable.ts — portable daemon state export/import.
// serializes daemon state to a self-contained JSON file that can be
// transferred between machines or used for backup/restore.

export interface PortableState {
  version: string;
  exportedAt: string;
  exportedBy: string;
  daemonVersion: string;
  state: {
    tasks: unknown[];
    config: Record<string, unknown>;
    healthScore: number;
    uptimeMs: number;
    tickCount: number;
    moduleCount: number;
    commandCount: number;
    testCount: number;
  };
  metadata: {
    hostname: string;
    nodeVersion: string;
    platform: string;
  };
}

/**
 * Export daemon state to a portable format.
 */
export function exportState(opts: {
  daemonVersion: string;
  tasks: unknown[];
  config: Record<string, unknown>;
  healthScore: number;
  uptimeMs: number;
  tickCount: number;
  moduleCount: number;
  commandCount: number;
  testCount: number;
}): PortableState {
  return {
    version: "1.0",
    exportedAt: new Date().toISOString(),
    exportedBy: "aoaoe",
    daemonVersion: opts.daemonVersion,
    state: {
      tasks: opts.tasks,
      config: sanitizeConfig(opts.config),
      healthScore: opts.healthScore,
      uptimeMs: opts.uptimeMs,
      tickCount: opts.tickCount,
      moduleCount: opts.moduleCount,
      commandCount: opts.commandCount,
      testCount: opts.testCount,
    },
    metadata: {
      hostname: typeof process !== "undefined" ? (process.env.HOSTNAME ?? "unknown") : "unknown",
      nodeVersion: typeof process !== "undefined" ? process.version : "unknown",
      platform: typeof process !== "undefined" ? process.platform : "unknown",
    },
  };
}

/**
 * Validate an imported state file.
 */
export function validateImport(data: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (typeof data !== "object" || data === null) { errors.push("not an object"); return { valid: false, errors }; }
  const obj = data as Record<string, unknown>;
  if (typeof obj.version !== "string") errors.push("missing version");
  if (typeof obj.exportedAt !== "string") errors.push("missing exportedAt");
  if (typeof obj.daemonVersion !== "string") errors.push("missing daemonVersion");
  if (typeof obj.state !== "object" || obj.state === null) errors.push("missing state");
  if (typeof obj.metadata !== "object" || obj.metadata === null) errors.push("missing metadata");
  return { valid: errors.length === 0, errors };
}

/**
 * Get a human-readable summary of a portable state.
 */
export function stateSummary(state: PortableState): string[] {
  return [
    `Version: ${state.daemonVersion} (format v${state.version})`,
    `Exported: ${state.exportedAt}`,
    `Platform: ${state.metadata.platform} / ${state.metadata.nodeVersion}`,
    `Tasks: ${state.state.tasks.length} | Health: ${state.state.healthScore}%`,
    `Uptime: ${Math.round(state.state.uptimeMs / 3_600_000 * 10) / 10}h | Ticks: ${state.state.tickCount}`,
    `Modules: ${state.state.moduleCount} | Commands: ${state.state.commandCount} | Tests: ${state.state.testCount}`,
  ];
}

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

/**
 * Format state export for TUI display.
 */
export function formatStateExport(state: PortableState): string[] {
  const lines: string[] = [];
  const size = JSON.stringify(state).length;
  lines.push(`  State Export (${Math.round(size / 1024)}KB):`);
  for (const l of stateSummary(state)) lines.push(`    ${l}`);
  return lines;
}
