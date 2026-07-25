// Plugin settings, read via the host's `config.get` RPC and re-read when the
// host pushes a `plugin.settings.changed` notification. Defaults mirror
// aoe-plugin.toml exactly — the manifest is the user-facing contract, this
// file is the worker-side fallback when a key has never been written.

import type { HostClient } from "./host.js";

export interface PluginSettings {
  dryRun: boolean;
  tickIntervalSecs: number;
  reasoner: "rules" | "claude-code" | "opencode";
  allowNudge: boolean;
  quietHours: string;
  actionCooldownSecs: number;
  spawnRepo: string;
  spawnLabel: string;
  spawnLimit: number;
  spawnLive: boolean;
  spawnAgent: string;
  spawnModel: string;
  spawnProjectPath: string;
  maxActiveSessions: number;
}

export const SETTING_DEFAULTS: PluginSettings = {
  dryRun: true,
  tickIntervalSecs: 60,
  reasoner: "rules",
  allowNudge: false,
  quietHours: "",
  actionCooldownSecs: 300,
  spawnRepo: "",
  spawnLabel: "",
  spawnLimit: 5,
  spawnLive: false,
  spawnAgent: "",
  spawnModel: "",
  spawnProjectPath: "",
  maxActiveSessions: 5,
};

/** Hard floor on the tick interval so a misconfigured value cannot spin the
 * worker into a poll storm (mirrors the watcher guard from PR #2699). */
export const MIN_TICK_INTERVAL_SECS = 5;

function bool(v: unknown, dflt: boolean): boolean {
  return typeof v === "boolean" ? v : dflt;
}

function int(v: unknown, dflt: number, min: number, max: number): number {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.floor(v) : dflt;
  return Math.min(max, Math.max(min, n));
}

function str(v: unknown, dflt: string): string {
  return typeof v === "string" ? v : dflt;
}

export async function loadSettings(host: HostClient): Promise<PluginSettings> {
  // one RPC per key; the host serves these from local state so this is cheap
  // and keeps us robust to partial writes (each key falls back independently)
  const get = (key: string) => host.configGet(key).catch(() => null);
  const [
    dryRun, tickInterval, reasoner, allowNudge, quietHours, cooldown,
    spawnRepo, spawnLabel, spawnLimit, spawnLive, spawnAgent, spawnModel, spawnProject, maxActive,
  ] = await Promise.all([
    get("dry_run"), get("tick_interval_secs"), get("reasoner"), get("allow_nudge"),
    get("quiet_hours"), get("action_cooldown_secs"), get("spawn_repo"), get("spawn_label"),
    get("spawn_limit"), get("spawn_live"), get("spawn_agent"), get("spawn_model"),
    get("spawn_project_path"), get("max_active_sessions"),
  ]);
  const d = SETTING_DEFAULTS;
  const reasonerStr = str(reasoner, d.reasoner);
  return {
    dryRun: bool(dryRun, d.dryRun),
    tickIntervalSecs: int(tickInterval, d.tickIntervalSecs, MIN_TICK_INTERVAL_SECS, 3600),
    reasoner: reasonerStr === "claude-code" || reasonerStr === "opencode" ? reasonerStr : "rules",
    allowNudge: bool(allowNudge, d.allowNudge),
    quietHours: str(quietHours, d.quietHours),
    actionCooldownSecs: int(cooldown, d.actionCooldownSecs, 0, 86400),
    spawnRepo: str(spawnRepo, d.spawnRepo),
    spawnLabel: str(spawnLabel, d.spawnLabel),
    spawnLimit: int(spawnLimit, d.spawnLimit, 1, 20),
    spawnLive: bool(spawnLive, d.spawnLive),
    spawnAgent: str(spawnAgent, d.spawnAgent),
    spawnModel: str(spawnModel, d.spawnModel),
    spawnProjectPath: str(spawnProject, d.spawnProjectPath),
    maxActiveSessions: int(maxActive, d.maxActiveSessions, 1, 5),
  };
}

/**
 * Parse "HH:MM-HH:MM" quiet hours and test whether `at` falls inside.
 * Overnight ranges (e.g. "22:00-06:00") wrap midnight. Malformed input
 * disables quiet hours rather than silently muting the orchestrator forever.
 */
export function inQuietHours(spec: string, at: Date): boolean {
  const m = /^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/.exec(spec.trim());
  if (!m) return false;
  const [, h1, m1, h2, m2] = m;
  const start = Number(h1) * 60 + Number(m1);
  const end = Number(h2) * 60 + Number(m2);
  if (start >= 1440 || end >= 1440) return false;
  const now = at.getHours() * 60 + at.getMinutes();
  if (start === end) return false;
  return start < end ? now >= start && now < end : now >= start || now < end;
}
