// daemon-startup-profiler.ts — measure module init time for cold-start
// optimization. records timing for each module's initialization phase,
// identifies slow modules, and provides optimization recommendations.

export interface InitTiming {
  moduleName: string;
  durationMs: number;
  order: number;
}

export interface StartupProfile {
  timings: InitTiming[];
  totalMs: number;
  slowestModule: string | null;
  moduleCount: number;
}

/**
 * Startup profiler — records module init timings.
 */
export class DaemonStartupProfiler {
  private timings: InitTiming[] = [];
  private starts = new Map<string, number>();
  private order = 0;
  private startedAt = 0;

  /** Mark the beginning of startup profiling. */
  begin(now = Date.now()): void {
    this.startedAt = now;
    this.timings = [];
    this.order = 0;
  }

  /** Start timing a module's init. */
  startModule(name: string, now = Date.now()): void {
    this.starts.set(name, now);
  }

  /** End timing a module's init. */
  endModule(name: string, now = Date.now()): void {
    const start = this.starts.get(name);
    if (start === undefined) return;
    this.timings.push({ moduleName: name, durationMs: now - start, order: this.order++ });
    this.starts.delete(name);
  }

  /** Get the startup profile. */
  getProfile(now = Date.now()): StartupProfile {
    const totalMs = this.startedAt > 0 ? now - this.startedAt : 0;
    const sorted = [...this.timings].sort((a, b) => b.durationMs - a.durationMs);
    return {
      timings: this.timings,
      totalMs,
      slowestModule: sorted.length > 0 ? sorted[0].moduleName : null,
      moduleCount: this.timings.length,
    };
  }

  /** Get modules slower than a threshold. */
  getSlowModules(thresholdMs = 50): InitTiming[] {
    return this.timings.filter((t) => t.durationMs > thresholdMs).sort((a, b) => b.durationMs - a.durationMs);
  }

  /** Get total recorded init time. */
  totalInitMs(): number {
    return this.timings.reduce((a, t) => a + t.durationMs, 0);
  }
}

/**
 * Format startup profile for TUI display.
 */
export function formatStartupProfile(profiler: DaemonStartupProfiler): string[] {
  const profile = profiler.getProfile();
  if (profile.moduleCount === 0) return ["  Startup profiler: no timing data (run during daemon startup)"];
  const lines: string[] = [];
  const totalInit = profiler.totalInitMs();
  lines.push(`  Startup Profile (${profile.moduleCount} modules, ${totalInit}ms init, ${profile.totalMs}ms total):`);
  const slow = profiler.getSlowModules(10);
  if (slow.length > 0) {
    lines.push("  Slowest modules:");
    for (const t of slow.slice(0, 8)) {
      const pct = totalInit > 0 ? Math.round((t.durationMs / totalInit) * 100) : 0;
      const bar = "█".repeat(Math.min(20, Math.round(pct / 5)));
      lines.push(`    ${t.moduleName.padEnd(24)} ${(t.durationMs + "ms").padStart(6)} ${(pct + "%").padStart(4)} ${bar}`);
    }
  }
  if (profile.slowestModule) lines.push(`  Bottleneck: ${profile.slowestModule} — optimize for faster cold start`);
  return lines;
}
