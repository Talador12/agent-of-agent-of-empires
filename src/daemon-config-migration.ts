// daemon-config-migration.ts — auto-upgrade config files between versions.
// defines migrations as sequential transforms, detects current version,
// applies needed migrations, and produces upgraded config.

export interface Migration {
  fromVersion: string;
  toVersion: string;
  description: string;
  migrate: (config: Record<string, unknown>) => Record<string, unknown>;
}

export interface MigrationResult {
  originalVersion: string;
  finalVersion: string;
  migrationsApplied: string[];
  success: boolean;
  config: Record<string, unknown>;
  error?: string;
}

const MIGRATIONS: Migration[] = [
  {
    fromVersion: "1.0", toVersion: "2.0",
    description: "Rename pollInterval to pollIntervalMs, add policies block",
    migrate: (c) => {
      const result = { ...c };
      if ("pollInterval" in result) { result.pollIntervalMs = result.pollInterval; delete result.pollInterval; }
      if (!result.policies) result.policies = {};
      result.configVersion = "2.0";
      return result;
    },
  },
  {
    fromVersion: "2.0", toVersion: "3.0",
    description: "Add costBudgets block, rename verbose to logging.verbose",
    migrate: (c) => {
      const result = { ...c };
      if (!result.costBudgets) result.costBudgets = { globalBudgetUsd: 100 };
      if ("verbose" in result) {
        if (!result.logging) result.logging = {};
        (result.logging as Record<string, unknown>).verbose = result.verbose;
        delete result.verbose;
      }
      result.configVersion = "3.0";
      return result;
    },
  },
  {
    fromVersion: "3.0", toVersion: "4.0",
    description: "Add healthPort, normalize reasoner names",
    migrate: (c) => {
      const result = { ...c };
      if (!result.healthPort) result.healthPort = 9090;
      if (result.reasoner === "claude") result.reasoner = "claude-code";
      result.configVersion = "4.0";
      return result;
    },
  },
  {
    fromVersion: "4.0", toVersion: "5.0",
    description: "Add sessionPool, pluginHooks blocks",
    migrate: (c) => {
      const result = { ...c };
      if (!result.sessionPool) result.sessionPool = { maxConcurrent: 5 };
      if (!result.pluginHooks) result.pluginHooks = { enabled: true };
      result.configVersion = "5.0";
      return result;
    },
  },
];

/**
 * Detect config version from the config object.
 */
export function detectVersion(config: Record<string, unknown>): string {
  if (typeof config.configVersion === "string") return config.configVersion;
  // heuristics for old configs
  if ("pollInterval" in config && !("pollIntervalMs" in config)) return "1.0";
  if (!("costBudgets" in config) && "pollIntervalMs" in config) return "2.0";
  if (!("healthPort" in config) && "costBudgets" in config) return "3.0";
  if (!("sessionPool" in config) && "healthPort" in config) return "4.0";
  return "5.0"; // current
}

/**
 * Get migrations needed to go from current to target version.
 */
export function getMigrationsNeeded(fromVersion: string, toVersion = "5.0"): Migration[] {
  const needed: Migration[] = [];
  let current = fromVersion;
  for (const m of MIGRATIONS) {
    if (m.fromVersion === current && current !== toVersion) {
      needed.push(m);
      current = m.toVersion;
    }
  }
  return needed;
}

/**
 * Apply all needed migrations to a config.
 */
export function migrateConfig(config: Record<string, unknown>, targetVersion = "5.0"): MigrationResult {
  const originalVersion = detectVersion(config);
  const needed = getMigrationsNeeded(originalVersion, targetVersion);

  if (needed.length === 0) {
    return { originalVersion, finalVersion: originalVersion, migrationsApplied: [], success: true, config: { ...config } };
  }

  let current = { ...config };
  const applied: string[] = [];

  try {
    for (const m of needed) {
      current = m.migrate(current);
      applied.push(`${m.fromVersion}→${m.toVersion}: ${m.description}`);
    }
    return { originalVersion, finalVersion: targetVersion, migrationsApplied: applied, success: true, config: current };
  } catch (err) {
    return { originalVersion, finalVersion: originalVersion, migrationsApplied: applied, success: false, config, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Format migration result for TUI display.
 */
export function formatMigration(result: MigrationResult): string[] {
  const lines: string[] = [];
  if (result.migrationsApplied.length === 0) {
    lines.push(`  Config Migration: already at v${result.originalVersion} (current)`);
  } else {
    const icon = result.success ? "✓" : "✗";
    lines.push(`  Config Migration ${icon}: v${result.originalVersion} → v${result.finalVersion} (${result.migrationsApplied.length} migrations):`);
    for (const m of result.migrationsApplied) lines.push(`    ${m}`);
    if (result.error) lines.push(`    Error: ${result.error}`);
  }
  return lines;
}
