// fleet-anomaly-correlation.ts — correlate anomalies across sessions to
// find root causes. when multiple sessions have anomalies at the same
// time, they likely share a common cause (e.g. shared dependency, infra issue).

export interface AnomalyEvent {
  sessionTitle: string;
  type: string;        // e.g. "cost", "error", "idle", "stuck"
  timestamp: number;
  detail: string;
}

export interface CorrelationCluster {
  timeWindow: { startMs: number; endMs: number };
  sessions: string[];
  anomalyTypes: string[];
  count: number;
  possibleCause: string;
}

/**
 * Correlate anomalies by time proximity.
 * Events within windowMs of each other are considered correlated.
 */
export function correlateAnomalies(events: AnomalyEvent[], windowMs = 60_000): CorrelationCluster[] {
  if (events.length < 2) return [];

  const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp);
  const clusters: CorrelationCluster[] = [];
  let currentCluster: AnomalyEvent[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const last = currentCluster[currentCluster.length - 1];
    if (sorted[i].timestamp - last.timestamp <= windowMs) {
      currentCluster.push(sorted[i]);
    } else {
      if (currentCluster.length >= 2) {
        clusters.push(buildCluster(currentCluster));
      }
      currentCluster = [sorted[i]];
    }
  }
  if (currentCluster.length >= 2) {
    clusters.push(buildCluster(currentCluster));
  }

  return clusters;
}

function buildCluster(events: AnomalyEvent[]): CorrelationCluster {
  const sessions = [...new Set(events.map((e) => e.sessionTitle))];
  const types = [...new Set(events.map((e) => e.type))];
  const start = events[0].timestamp;
  const end = events[events.length - 1].timestamp;

  let cause = "unknown";
  if (sessions.length > 1 && types.length === 1) {
    cause = `fleet-wide ${types[0]} — likely shared infrastructure issue`;
  } else if (sessions.length > 1) {
    cause = `${sessions.length} sessions affected simultaneously — possible shared dependency`;
  } else if (types.length > 1) {
    cause = `multiple anomaly types in ${sessions[0]} — cascading failure`;
  }

  return { timeWindow: { startMs: start, endMs: end }, sessions, anomalyTypes: types, count: events.length, possibleCause: cause };
}

/**
 * Get sessions with the most correlated anomalies.
 */
export function hotCorrelationSessions(clusters: CorrelationCluster[], limit = 5): Array<{ session: string; clusterCount: number }> {
  const counts = new Map<string, number>();
  for (const c of clusters) {
    for (const s of c.sessions) counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([session, clusterCount]) => ({ session, clusterCount }))
    .sort((a, b) => b.clusterCount - a.clusterCount)
    .slice(0, limit);
}

/**
 * Format correlation results for TUI display.
 */
export function formatCorrelations(clusters: CorrelationCluster[]): string[] {
  if (clusters.length === 0) return ["  Anomaly Correlation: no correlated anomalies detected"];
  const lines: string[] = [];
  lines.push(`  Anomaly Correlation (${clusters.length} clusters):`);
  for (const c of clusters.slice(0, 5)) {
    const startTime = new Date(c.timeWindow.startMs).toISOString().slice(11, 19);
    const span = Math.round((c.timeWindow.endMs - c.timeWindow.startMs) / 1000);
    lines.push(`    ${startTime} (${span}s) — ${c.count} events, ${c.sessions.length} sessions [${c.anomalyTypes.join(", ")}]`);
    lines.push(`      Cause: ${c.possibleCause}`);
  }

  const hot = hotCorrelationSessions(clusters, 3);
  if (hot.length > 0) {
    lines.push("    Most correlated: " + hot.map((h) => `${h.session}(${h.clusterCount})`).join(", "));
  }

  return lines;
}
