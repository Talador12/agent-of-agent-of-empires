// fleet-config-profiles.ts — named config presets for different workload
// types. provides built-in profiles (dev, ci, incident, conservative) and
// supports user-defined profiles for quick daemon reconfiguration.

export interface ConfigProfile {
  name: string;
  description: string;
  overrides: ConfigOverrides;
}

export interface ConfigOverrides {
  pollIntervalMs?: number;
  reasonIntervalMs?: number;
  verbose?: boolean;
  dryRun?: boolean;
  confirm?: boolean;
  policies?: {
    maxIdleBeforeNudgeMs?: number;
    maxErrorsBeforeRestart?: number;
    autoAnswerPermissions?: boolean;
    actionCooldownMs?: number;
    allowDestructive?: boolean;
  };
}

const BUILTIN_PROFILES: ConfigProfile[] = [
  {
    name: "dev",
    description: "Fast iteration — short poll intervals, auto-answer, verbose",
    overrides: {
      pollIntervalMs: 5_000,
      reasonIntervalMs: 30_000,
      verbose: true,
      policies: { maxIdleBeforeNudgeMs: 60_000, autoAnswerPermissions: true, actionCooldownMs: 10_000 },
    },
  },
  {
    name: "ci",
    description: "CI/CD mode — fast polls, no confirmation, auto-destructive",
    overrides: {
      pollIntervalMs: 5_000,
      reasonIntervalMs: 20_000,
      confirm: false,
      policies: { allowDestructive: true, autoAnswerPermissions: true, maxErrorsBeforeRestart: 2, actionCooldownMs: 5_000 },
    },
  },
  {
    name: "incident",
    description: "Incident response — fastest polls, verbose, cautious actions",
    overrides: {
      pollIntervalMs: 3_000,
      reasonIntervalMs: 15_000,
      verbose: true,
      confirm: true,
      policies: { maxIdleBeforeNudgeMs: 30_000, allowDestructive: false, actionCooldownMs: 5_000 },
    },
  },
  {
    name: "conservative",
    description: "Hands-off — long intervals, dry run, confirm everything",
    overrides: {
      pollIntervalMs: 30_000,
      reasonIntervalMs: 120_000,
      dryRun: true,
      confirm: true,
      policies: { maxIdleBeforeNudgeMs: 300_000, allowDestructive: false, actionCooldownMs: 60_000 },
    },
  },
  {
    name: "overnight",
    description: "Unattended overnight run — moderate pace, auto-answer, budget-conscious",
    overrides: {
      pollIntervalMs: 15_000,
      reasonIntervalMs: 60_000,
      policies: { autoAnswerPermissions: true, maxErrorsBeforeRestart: 5, maxIdleBeforeNudgeMs: 180_000 },
    },
  },
];

/**
 * Get a built-in or user-defined profile by name.
 */
export function getProfile(name: string, userProfiles: ConfigProfile[] = []): ConfigProfile | null {
  const all = [...BUILTIN_PROFILES, ...userProfiles];
  return all.find((p) => p.name.toLowerCase() === name.toLowerCase()) ?? null;
}

/**
 * List all available profiles.
 */
export function listProfiles(userProfiles: ConfigProfile[] = []): ConfigProfile[] {
  return [...BUILTIN_PROFILES, ...userProfiles];
}

/**
 * Apply a profile's overrides to a config object (shallow merge).
 * Returns the merged overrides without mutating the original.
 */
export function applyProfile(profile: ConfigProfile): ConfigOverrides {
  return { ...profile.overrides };
}

/**
 * Format profile list for TUI display.
 */
export function formatProfileList(profiles: ConfigProfile[], activeProfile?: string): string[] {
  if (profiles.length === 0) return ["  Config profiles: none available"];
  const lines: string[] = [];
  lines.push(`  Config Profiles (${profiles.length} available):`);
  for (const p of profiles) {
    const active = p.name === activeProfile ? " ← active" : "";
    lines.push(`  ${p.name.padEnd(14)} ${p.description}${active}`);
  }
  return lines;
}

/**
 * Format a single profile's details for TUI display.
 */
export function formatProfileDetail(profile: ConfigProfile): string[] {
  const lines: string[] = [];
  lines.push(`  Profile: ${profile.name}`);
  lines.push(`  ${profile.description}`);
  lines.push("  Overrides:");
  const o = profile.overrides;
  if (o.pollIntervalMs !== undefined) lines.push(`    pollIntervalMs: ${o.pollIntervalMs}`);
  if (o.reasonIntervalMs !== undefined) lines.push(`    reasonIntervalMs: ${o.reasonIntervalMs}`);
  if (o.verbose !== undefined) lines.push(`    verbose: ${o.verbose}`);
  if (o.dryRun !== undefined) lines.push(`    dryRun: ${o.dryRun}`);
  if (o.confirm !== undefined) lines.push(`    confirm: ${o.confirm}`);
  if (o.policies) {
    for (const [k, v] of Object.entries(o.policies)) {
      if (v !== undefined) lines.push(`    policies.${k}: ${v}`);
    }
  }
  return lines;
}
