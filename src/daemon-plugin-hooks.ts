// daemon-plugin-hooks.ts — lifecycle hooks for custom logic injection.
// provides pre-tick, post-reason, pre-execute, post-execute, and
// on-error hook points. hooks are registered and invoked in order.

export type HookPhase = "pre-tick" | "post-tick" | "pre-reason" | "post-reason" | "pre-execute" | "post-execute" | "on-error";

export interface HookContext {
  phase: HookPhase;
  tickNum: number;
  sessionTitle?: string;
  data?: Record<string, unknown>;
  timestamp: number;
}

export type HookFn = (ctx: HookContext) => void | Promise<void>;

export interface RegisteredHook {
  id: number;
  phase: HookPhase;
  name: string;
  fn: HookFn;
  priority: number; // lower = runs first
  enabled: boolean;
}

/**
 * Plugin hook manager for daemon lifecycle events.
 */
export class DaemonPluginHooks {
  private hooks: RegisteredHook[] = [];
  private nextId = 1;
  private invocationCount = 0;
  private errorCount = 0;

  /** Register a hook. Returns the hook ID. */
  register(phase: HookPhase, name: string, fn: HookFn, priority = 100): number {
    const id = this.nextId++;
    this.hooks.push({ id, phase, name, fn, priority, enabled: true });
    // sort by priority for consistent execution order
    this.hooks.sort((a, b) => a.priority - b.priority);
    return id;
  }

  /** Unregister a hook by ID. */
  unregister(id: number): boolean {
    const idx = this.hooks.findIndex((h) => h.id === id);
    if (idx === -1) return false;
    this.hooks.splice(idx, 1);
    return true;
  }

  /** Enable/disable a hook by ID. */
  setEnabled(id: number, enabled: boolean): boolean {
    const hook = this.hooks.find((h) => h.id === id);
    if (!hook) return false;
    hook.enabled = enabled;
    return true;
  }

  /** Invoke all hooks for a phase (sync — errors are caught and counted). */
  invoke(phase: HookPhase, ctx: Omit<HookContext, "phase" | "timestamp">): void {
    const fullCtx: HookContext = { ...ctx, phase, timestamp: Date.now() };
    const matching = this.hooks.filter((h) => h.phase === phase && h.enabled);
    for (const hook of matching) {
      try {
        const result = hook.fn(fullCtx);
        // if it returns a promise, we don't await — hooks are fire-and-forget sync
        if (result && typeof (result as Promise<void>).catch === "function") {
          (result as Promise<void>).catch(() => { this.errorCount++; });
        }
        this.invocationCount++;
      } catch {
        this.errorCount++;
      }
    }
  }

  /** Get all registered hooks. */
  listHooks(): RegisteredHook[] {
    return this.hooks.map((h) => ({ ...h }));
  }

  /** Get hooks for a specific phase. */
  hooksForPhase(phase: HookPhase): RegisteredHook[] {
    return this.hooks.filter((h) => h.phase === phase);
  }

  /** Get total registered hook count. */
  hookCount(): number {
    return this.hooks.length;
  }

  /** Get invocation stats. */
  stats(): { hookCount: number; invocations: number; errors: number } {
    return { hookCount: this.hooks.length, invocations: this.invocationCount, errors: this.errorCount };
  }
}

/**
 * Format plugin hooks state for TUI display.
 */
export function formatPluginHooks(hooks: DaemonPluginHooks): string[] {
  const stats = hooks.stats();
  const all = hooks.listHooks();
  const lines: string[] = [];
  lines.push(`  Daemon Plugin Hooks (${stats.hookCount} hooks, ${stats.invocations} invocations, ${stats.errors} errors):`);
  if (all.length === 0) {
    lines.push("    No hooks registered");
  } else {
    const byPhase = new Map<string, RegisteredHook[]>();
    for (const h of all) {
      if (!byPhase.has(h.phase)) byPhase.set(h.phase, []);
      byPhase.get(h.phase)!.push(h);
    }
    for (const [phase, phaseHooks] of byPhase) {
      lines.push(`    ${phase}:`);
      for (const h of phaseHooks) {
        const status = h.enabled ? "●" : "○";
        lines.push(`      ${status} #${h.id} ${h.name} (priority ${h.priority})`);
      }
    }
  }
  return lines;
}
