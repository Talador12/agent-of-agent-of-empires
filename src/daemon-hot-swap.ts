// daemon-hot-swap.ts — reload intelligence modules without daemon restart.
// tracks module versions, validates new modules before swapping, and
// provides rollback on failure. uses a registry pattern.

export interface ModuleRegistration {
  name: string;
  version: number;
  loadedAt: number;
  enabled: boolean;
  status: "active" | "loading" | "failed" | "disabled";
  errorMessage?: string;
}

export interface SwapResult {
  module: string;
  success: boolean;
  oldVersion: number;
  newVersion: number;
  message: string;
}

export interface HotSwapState {
  modules: Map<string, ModuleRegistration>;
  swapHistory: SwapResult[];
  maxHistory: number;
}

/**
 * Create hot-swap state.
 */
export function createHotSwapState(maxHistory = 50): HotSwapState {
  return { modules: new Map(), swapHistory: [], maxHistory };
}

/**
 * Register a module.
 */
export function registerModule(state: HotSwapState, name: string, version = 1, now = Date.now()): ModuleRegistration {
  const reg: ModuleRegistration = { name, version, loadedAt: now, enabled: true, status: "active" };
  state.modules.set(name, reg);
  return reg;
}

/**
 * Simulate swapping a module to a new version.
 * In a real implementation, this would dynamically import the new module.
 */
export function swapModule(
  state: HotSwapState,
  name: string,
  newVersion: number,
  validate: () => boolean = () => true,
  now = Date.now(),
): SwapResult {
  const existing = state.modules.get(name);
  if (!existing) {
    const result: SwapResult = { module: name, success: false, oldVersion: 0, newVersion, message: `module "${name}" not registered` };
    state.swapHistory.push(result);
    return result;
  }

  const oldVersion = existing.version;
  existing.status = "loading";

  try {
    if (!validate()) {
      existing.status = "active"; // rollback
      const result: SwapResult = { module: name, success: false, oldVersion, newVersion, message: "validation failed — kept old version" };
      state.swapHistory.push(result);
      trimHistory(state);
      return result;
    }

    existing.version = newVersion;
    existing.loadedAt = now;
    existing.status = "active";
    existing.errorMessage = undefined;

    const result: SwapResult = { module: name, success: true, oldVersion, newVersion, message: `swapped v${oldVersion} → v${newVersion}` };
    state.swapHistory.push(result);
    trimHistory(state);
    return result;
  } catch (err) {
    existing.status = "failed";
    existing.errorMessage = err instanceof Error ? err.message : String(err);
    const result: SwapResult = { module: name, success: false, oldVersion, newVersion, message: `swap failed: ${existing.errorMessage}` };
    state.swapHistory.push(result);
    trimHistory(state);
    return result;
  }
}

function trimHistory(state: HotSwapState): void {
  if (state.swapHistory.length > state.maxHistory) {
    state.swapHistory = state.swapHistory.slice(-state.maxHistory);
  }
}

/**
 * Enable/disable a module.
 */
export function setModuleEnabled(state: HotSwapState, name: string, enabled: boolean): boolean {
  const mod = state.modules.get(name);
  if (!mod) return false;
  mod.enabled = enabled;
  mod.status = enabled ? "active" : "disabled";
  return true;
}

/**
 * List all modules.
 */
export function listModules(state: HotSwapState): ModuleRegistration[] {
  return Array.from(state.modules.values());
}

/**
 * Get swap stats.
 */
export function swapStats(state: HotSwapState): { total: number; succeeded: number; failed: number; modules: number } {
  return {
    total: state.swapHistory.length,
    succeeded: state.swapHistory.filter((s) => s.success).length,
    failed: state.swapHistory.filter((s) => !s.success).length,
    modules: state.modules.size,
  };
}

/**
 * Format hot-swap state for TUI display.
 */
export function formatHotSwap(state: HotSwapState): string[] {
  const stats = swapStats(state);
  const lines: string[] = [];
  lines.push(`  Hot Swap (${stats.modules} modules, ${stats.total} swaps: ${stats.succeeded} ok, ${stats.failed} failed):`);
  const mods = listModules(state);
  if (mods.length === 0) {
    lines.push("    No modules registered");
  } else {
    for (const m of mods.slice(0, 10)) {
      const icon = m.status === "active" ? "●" : m.status === "disabled" ? "○" : m.status === "failed" ? "✗" : "◐";
      lines.push(`    ${icon} ${m.name} v${m.version} [${m.status}]`);
    }
    if (mods.length > 10) lines.push(`    ... ${mods.length - 10} more`);
  }
  // recent swaps
  const recent = state.swapHistory.slice(-3);
  if (recent.length > 0) {
    lines.push("  Recent swaps:");
    for (const s of recent) {
      const icon = s.success ? "✓" : "✗";
      lines.push(`    ${icon} ${s.module}: ${s.message}`);
    }
  }
  return lines;
}
