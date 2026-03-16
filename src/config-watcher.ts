// config-watcher.ts — watch config file for changes and hot-reload safe fields.
// pure mergeHotReload function + ConfigWatcher class using fs.watch.

import { watch, type FSWatcher } from "node:fs";
import { loadConfig, findConfigFile, validateConfig } from "./config.js";
import type { AoaoeConfig } from "./types.js";

/**
 * Fields that are safe to hot-reload without restarting the daemon.
 * Fields NOT in this list require a daemon restart to take effect.
 *
 * Unsafe (require restart): reasoner, opencode.port, healthPort, dryRun, observe, confirm
 */
const HOT_RELOAD_FIELDS = new Set<string>([
  "pollIntervalMs",
  "sessionDirs",
  "protectedSessions",
  "contextFiles",
  "verbose",
  "captureLinesCount",
  "tuiHistoryRetentionDays",
]);

/** Nested objects where all sub-fields are safe to hot-reload */
const HOT_RELOAD_OBJECTS = new Set<string>([
  "policies",
  "notifications",
]);

/** Describes a single config field change */
export interface ConfigChange {
  field: string;
  oldValue: unknown;
  newValue: unknown;
  applied: boolean; // true if hot-reloaded, false if requires restart
}

/**
 * Merge hot-reloadable fields from fresh config into the current config.
 * Returns: { config: updated config, changes: list of what changed }
 * Non-reloadable fields are left unchanged but reported as changes.
 */
export function mergeHotReload(
  current: AoaoeConfig,
  fresh: AoaoeConfig,
): { config: AoaoeConfig; changes: ConfigChange[] } {
  const changes: ConfigChange[] = [];
  const merged = { ...current };

  // check top-level scalar/array fields
  for (const field of HOT_RELOAD_FIELDS) {
    const key = field as keyof AoaoeConfig;
    const curVal = JSON.stringify(current[key]);
    const freshVal = JSON.stringify(fresh[key]);
    if (curVal !== freshVal) {
      changes.push({ field, oldValue: current[key], newValue: fresh[key], applied: true });
      (merged as Record<string, unknown>)[key] = fresh[key];
    }
  }

  // check nested objects (policies, notifications)
  for (const objField of HOT_RELOAD_OBJECTS) {
    const key = objField as keyof AoaoeConfig;
    const curVal = JSON.stringify(current[key]);
    const freshVal = JSON.stringify(fresh[key]);
    if (curVal !== freshVal) {
      changes.push({ field: objField, oldValue: current[key], newValue: fresh[key], applied: true });
      (merged as Record<string, unknown>)[key] = fresh[key];
    }
  }

  // detect non-reloadable changes (warn user)
  const unsafeFields: Array<keyof AoaoeConfig> = [
    "reasoner", "dryRun", "observe", "confirm", "healthPort",
  ];
  for (const key of unsafeFields) {
    const curVal = JSON.stringify(current[key]);
    const freshVal = JSON.stringify(fresh[key]);
    if (curVal !== freshVal) {
      changes.push({ field: key, oldValue: current[key], newValue: fresh[key], applied: false });
    }
  }
  // check nested non-reloadable (opencode.port)
  if (current.opencode?.port !== fresh.opencode?.port) {
    changes.push({ field: "opencode.port", oldValue: current.opencode?.port, newValue: fresh.opencode?.port, applied: false });
  }

  return { config: merged as AoaoeConfig, changes };
}

/**
 * Format a config change for display in the TUI.
 */
export function formatConfigChange(change: ConfigChange): string {
  const status = change.applied ? "applied" : "requires restart";
  const newVal = typeof change.newValue === "object"
    ? JSON.stringify(change.newValue)
    : String(change.newValue);
  const truncated = newVal.length > 60 ? newVal.slice(0, 57) + "..." : newVal;
  return `${change.field}: ${truncated} (${status})`;
}

export type ConfigChangeCallback = (changes: ConfigChange[], newConfig: AoaoeConfig) => void;

/**
 * ConfigWatcher — watches the config file and calls back when it changes.
 * Debounces rapid changes (editors do save-rename-write sequences).
 */
export class ConfigWatcher {
  private watcher: FSWatcher | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private configPath: string | null = null;
  private callback: ConfigChangeCallback | null = null;
  private currentConfig: AoaoeConfig;
  private debounceMs: number;

  constructor(config: AoaoeConfig, debounceMs = 500) {
    this.currentConfig = config;
    this.debounceMs = debounceMs;
  }

  /** Start watching the config file. Returns the watched path or null. */
  start(callback: ConfigChangeCallback): string | null {
    this.callback = callback;
    this.configPath = findConfigFile();
    if (!this.configPath) return null;

    try {
      this.watcher = watch(this.configPath, { persistent: false }, () => {
        this.scheduleReload();
      });
      this.watcher.on("error", () => {
        // config file may be renamed during save — try to re-watch
        this.stop();
      });
    } catch {
      // watch failed — degrade gracefully
      return null;
    }
    return this.configPath;
  }

  /** Stop watching */
  stop(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.watcher) {
      try { this.watcher.close(); } catch {}
      this.watcher = null;
    }
  }

  /** Get the current config (may have been hot-reloaded) */
  getConfig(): AoaoeConfig {
    return this.currentConfig;
  }

  private scheduleReload(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.doReload();
    }, this.debounceMs);
  }

  private doReload(): void {
    try {
      const fresh = loadConfig();
      validateConfig(fresh);
      const { config, changes } = mergeHotReload(this.currentConfig, fresh);
      if (changes.length > 0) {
        this.currentConfig = config;
        this.callback?.(changes, config);
      }
    } catch (err) {
      // invalid config — ignore silently (keep running with current config)
      console.error(`[config-watcher] reload failed: ${err}`);
    }
  }
}
