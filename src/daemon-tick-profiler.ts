// daemon-tick-profiler.ts — per-phase timing breakdown for each daemon tick.
// records start/end times for poll, reason, execute, and post-tick phases,
// computes per-phase stats, identifies bottlenecks.

export type ProfilePhase = "poll" | "reason" | "execute" | "post-tick" | "total";

export interface TickProfile {
  tickNum: number;
  phases: Map<ProfilePhase, number>; // phase -> duration ms
  timestamp: number;
}

export interface PhaseStats {
  phase: ProfilePhase;
  count: number;
  totalMs: number;
  avgMs: number;
  maxMs: number;
  pctOfTotal: number; // % of total tick time
}

/**
 * Tick profiler — records per-phase timings and computes stats.
 */
export class DaemonTickProfiler {
  private profiles: TickProfile[] = [];
  private maxProfiles: number;
  private currentTick: { tickNum: number; phases: Map<ProfilePhase, number>; starts: Map<ProfilePhase, number>; timestamp: number } | null = null;

  constructor(maxProfiles = 100) {
    this.maxProfiles = maxProfiles;
  }

  /** Start profiling a new tick. */
  startTick(tickNum: number, now = Date.now()): void {
    this.currentTick = { tickNum, phases: new Map(), starts: new Map(), timestamp: now };
  }

  /** Start timing a phase within the current tick. */
  startPhase(phase: ProfilePhase, now = Date.now()): void {
    if (!this.currentTick) return;
    this.currentTick.starts.set(phase, now);
  }

  /** End timing a phase within the current tick. */
  endPhase(phase: ProfilePhase, now = Date.now()): void {
    if (!this.currentTick) return;
    const start = this.currentTick.starts.get(phase);
    if (start === undefined) return;
    this.currentTick.phases.set(phase, now - start);
    this.currentTick.starts.delete(phase);
  }

  /** Finish the current tick and record the profile. */
  endTick(now = Date.now()): TickProfile | null {
    if (!this.currentTick) return null;
    // compute total from individual phases
    const totalFromPhases = Array.from(this.currentTick.phases.values()).reduce((a, b) => a + b, 0);
    this.currentTick.phases.set("total", totalFromPhases);
    const profile: TickProfile = {
      tickNum: this.currentTick.tickNum,
      phases: new Map(this.currentTick.phases),
      timestamp: this.currentTick.timestamp,
    };
    this.profiles.push(profile);
    if (this.profiles.length > this.maxProfiles) {
      this.profiles = this.profiles.slice(-this.maxProfiles);
    }
    this.currentTick = null;
    return profile;
  }

  /** Get stats for each phase across all recorded profiles. */
  getStats(): PhaseStats[] {
    if (this.profiles.length === 0) return [];
    const phases: ProfilePhase[] = ["poll", "reason", "execute", "post-tick", "total"];
    const totalTotal = this.profiles.reduce((a, p) => a + (p.phases.get("total") ?? 0), 0);
    return phases.map((phase) => {
      const durations = this.profiles.map((p) => p.phases.get(phase) ?? 0).filter((d) => d > 0);
      if (durations.length === 0) return { phase, count: 0, totalMs: 0, avgMs: 0, maxMs: 0, pctOfTotal: 0 };
      const total = durations.reduce((a, b) => a + b, 0);
      return {
        phase,
        count: durations.length,
        totalMs: total,
        avgMs: Math.round(total / durations.length),
        maxMs: Math.max(...durations),
        pctOfTotal: totalTotal > 0 ? Math.round((total / totalTotal) * 100) : 0,
      };
    }).filter((s) => s.count > 0);
  }

  /** Get the slowest tick. */
  slowestTick(): TickProfile | null {
    if (this.profiles.length === 0) return null;
    return this.profiles.reduce((slowest, p) => {
      const pTotal = p.phases.get("total") ?? 0;
      const sTotal = slowest.phases.get("total") ?? 0;
      return pTotal > sTotal ? p : slowest;
    });
  }

  /** Get profile count. */
  profileCount(): number {
    return this.profiles.length;
  }

  /** Identify the bottleneck phase (highest % of total). */
  bottleneck(): ProfilePhase | null {
    const stats = this.getStats().filter((s) => s.phase !== "total");
    if (stats.length === 0) return null;
    return stats.reduce((a, b) => a.pctOfTotal > b.pctOfTotal ? a : b).phase;
  }
}

/**
 * Format tick profiler for TUI display.
 */
export function formatTickProfiler(profiler: DaemonTickProfiler): string[] {
  const stats = profiler.getStats();
  if (stats.length === 0) return ["  Tick profiler: no data (start profiling with tick instrumentation)"];
  const lines: string[] = [];
  const bottleneck = profiler.bottleneck();
  lines.push(`  Tick Profiler (${profiler.profileCount()} ticks, bottleneck: ${bottleneck ?? "none"}):`);
  lines.push(`  ${"Phase".padEnd(12)} ${"Avg".padStart(7)} ${"Max".padStart(7)} ${"% Total".padStart(8)} ${"Count".padStart(6)}`);
  for (const s of stats) {
    const marker = s.phase === bottleneck ? " ←" : "";
    lines.push(`  ${s.phase.padEnd(12)} ${(s.avgMs + "ms").padStart(7)} ${(s.maxMs + "ms").padStart(7)} ${(s.pctOfTotal + "%").padStart(8)} ${String(s.count).padStart(6)}${marker}`);
  }
  return lines;
}
