// fleet-sla.ts — alert when fleet health drops below a configured SLA threshold.
// tracks fleet health over time and fires alerts when the SLA is breached.

export interface SlaConfig {
  healthThreshold: number;       // minimum fleet health (0-100, default: 50)
  windowTicks: number;           // how many ticks to average over (default: 6)
  alertCooldownTicks: number;    // min ticks between alerts (default: 12)
}

export interface SlaStatus {
  currentHealth: number;
  averageHealth: number;
  threshold: number;
  breached: boolean;
  ticksSinceLastAlert: number;
  shouldAlert: boolean;
}

const DEFAULT_SLA_CONFIG: SlaConfig = {
  healthThreshold: 50,
  windowTicks: 6,
  alertCooldownTicks: 12,
};

/**
 * Track fleet health and detect SLA breaches.
 */
export class FleetSlaMonitor {
  private config: SlaConfig;
  private healthHistory: number[] = [];
  private ticksSinceAlert = 0;
  private totalBreaches = 0;

  constructor(config: Partial<SlaConfig> = {}) {
    this.config = { ...DEFAULT_SLA_CONFIG, ...config };
    this.ticksSinceAlert = this.config.alertCooldownTicks; // allow first alert immediately
  }

  /**
   * Record a fleet health observation and check the SLA.
   */
  recordHealth(fleetHealth: number): SlaStatus {
    this.healthHistory.push(fleetHealth);
    // keep only the window
    while (this.healthHistory.length > this.config.windowTicks) {
      this.healthHistory.shift();
    }
    this.ticksSinceAlert++;

    const avgHealth = this.healthHistory.reduce((a, b) => a + b, 0) / this.healthHistory.length;
    const breached = avgHealth < this.config.healthThreshold;
    const shouldAlert = breached && this.ticksSinceAlert >= this.config.alertCooldownTicks;

    if (shouldAlert) {
      this.ticksSinceAlert = 0;
      this.totalBreaches++;
    }

    return {
      currentHealth: fleetHealth,
      averageHealth: Math.round(avgHealth),
      threshold: this.config.healthThreshold,
      breached,
      ticksSinceLastAlert: this.ticksSinceAlert,
      shouldAlert,
    };
  }

  /** Get total breach count. */
  get breachCount(): number {
    return this.totalBreaches;
  }

  /** Update the SLA threshold. */
  setThreshold(threshold: number): void {
    this.config.healthThreshold = Math.max(0, Math.min(100, threshold));
  }

  /** Format SLA status for TUI display. */
  formatStatus(): string[] {
    if (this.healthHistory.length === 0) return ["  (no health data yet)"];
    const avg = Math.round(this.healthHistory.reduce((a, b) => a + b, 0) / this.healthHistory.length);
    const current = this.healthHistory[this.healthHistory.length - 1];
    const icon = avg >= this.config.healthThreshold ? "✅" : "🔴";
    const lines: string[] = [];
    lines.push(`  ${icon} Fleet SLA: ${avg}/100 avg (threshold: ${this.config.healthThreshold}, current: ${current})`);
    lines.push(`  History: [${this.healthHistory.map((h) => h.toString()).join(", ")}] over last ${this.healthHistory.length} ticks`);
    if (this.totalBreaches > 0) {
      lines.push(`  Breaches: ${this.totalBreaches} total`);
    }
    return lines;
  }
}
