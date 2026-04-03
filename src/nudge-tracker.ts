// nudge-tracker.ts — measure if nudges lead to progress resumption.
// tracks when nudges are sent and whether progress follows within a window.

export interface NudgeRecord {
  sessionTitle: string;
  sentAt: number;
  nudgeText: string;
  progressResumedAt?: number;  // timestamp when progress resumed after nudge
  effective: boolean;           // did progress resume within the window?
}

export interface NudgeEffectivenessReport {
  totalNudges: number;
  effectiveNudges: number;
  ineffectiveNudges: number;
  pendingNudges: number;        // sent recently, still waiting for result
  effectivenessRate: number;    // 0.0-1.0
  avgResponseTimeMs: number;    // avg time from nudge to progress (for effective only)
}

/**
 * Track nudge effectiveness per session.
 */
export class NudgeTracker {
  private records: NudgeRecord[] = [];
  private windowMs: number;       // how long to wait for progress after a nudge

  constructor(windowMs = 30 * 60_000) { // 30min window
    this.windowMs = windowMs;
  }

  /** Record that a nudge was sent. */
  recordNudge(sessionTitle: string, nudgeText: string, now = Date.now()): void {
    this.records.push({ sessionTitle, sentAt: now, nudgeText, effective: false });
  }

  /** Record that a session made progress (call after any task progress event). */
  recordProgress(sessionTitle: string, now = Date.now()): void {
    // find the most recent unanswered nudge for this session
    for (let i = this.records.length - 1; i >= 0; i--) {
      const r = this.records[i];
      if (r.sessionTitle === sessionTitle && !r.progressResumedAt && !r.effective) {
        if (now - r.sentAt <= this.windowMs) {
          r.progressResumedAt = now;
          r.effective = true;
        }
        break; // only resolve the most recent
      }
    }
  }

  /** Finalize expired nudges as ineffective. */
  finalize(now = Date.now()): void {
    for (const r of this.records) {
      if (!r.progressResumedAt && (now - r.sentAt) > this.windowMs) {
        r.effective = false;
      }
    }
  }

  /** Compute effectiveness report. */
  getReport(now = Date.now()): NudgeEffectivenessReport {
    this.finalize(now);
    const effective = this.records.filter((r) => r.effective);
    const ineffective = this.records.filter((r) => !r.effective && (now - r.sentAt) > this.windowMs);
    const pending = this.records.filter((r) => !r.effective && (now - r.sentAt) <= this.windowMs);

    const responseTimes = effective.filter((r) => r.progressResumedAt).map((r) => r.progressResumedAt! - r.sentAt);
    const avgResponseTime = responseTimes.length > 0
      ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length
      : 0;

    const resolved = effective.length + ineffective.length;
    return {
      totalNudges: this.records.length,
      effectiveNudges: effective.length,
      ineffectiveNudges: ineffective.length,
      pendingNudges: pending.length,
      effectivenessRate: resolved > 0 ? effective.length / resolved : 0,
      avgResponseTimeMs: avgResponseTime,
    };
  }

  /** Format report for TUI display. */
  formatReport(now = Date.now()): string[] {
    const r = this.getReport(now);
    if (r.totalNudges === 0) return ["  (no nudges tracked yet)"];
    const rate = Math.round(r.effectivenessRate * 100);
    const avgMin = r.avgResponseTimeMs > 0 ? Math.round(r.avgResponseTimeMs / 60_000) : 0;
    return [
      `  Nudge effectiveness: ${rate}% (${r.effectiveNudges}/${r.effectiveNudges + r.ineffectiveNudges} effective)`,
      `  Total: ${r.totalNudges}  Effective: ${r.effectiveNudges}  Ineffective: ${r.ineffectiveNudges}  Pending: ${r.pendingNudges}`,
      avgMin > 0 ? `  Avg response time: ${avgMin}min` : `  No response time data yet`,
    ];
  }
}
