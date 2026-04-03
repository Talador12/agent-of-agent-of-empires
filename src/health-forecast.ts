// health-forecast.ts — predict fleet health trends from historical data.
// uses linear regression on recent health samples to project future health
// and estimate when an SLA breach might occur.

export interface HealthForecast {
  currentHealth: number;
  trendPerHour: number;      // health points gained/lost per hour
  projectedHealth1h: number;
  projectedHealth4h: number;
  projectedHealth24h: number;
  slaBreachInMs: number;     // ms until health drops below SLA threshold (-1 = never)
  slaBreachLabel: string;
  trend: "improving" | "stable" | "declining";
}

/**
 * Forecast fleet health from a time series of samples.
 * Each sample is { timestamp, health }.
 */
export function forecastHealth(
  samples: Array<{ timestamp: number; health: number }>,
  slaThreshold = 50,
  now = Date.now(),
): HealthForecast | null {
  if (samples.length < 3) return null;

  // simple linear regression: health = slope * time + intercept
  const n = samples.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  const t0 = samples[0].timestamp;

  for (const s of samples) {
    const x = (s.timestamp - t0) / 3_600_000; // hours since first sample
    const y = s.health;
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumX2 += x * x;
  }

  const denom = n * sumX2 - sumX * sumX;
  if (Math.abs(denom) < 0.001) {
    // all samples at same time — can't compute trend
    const current = samples[samples.length - 1].health;
    return {
      currentHealth: current,
      trendPerHour: 0,
      projectedHealth1h: current,
      projectedHealth4h: current,
      projectedHealth24h: current,
      slaBreachInMs: current < slaThreshold ? 0 : -1,
      slaBreachLabel: current < slaThreshold ? "now" : "never",
      trend: "stable",
    };
  }

  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;

  const currentHours = (now - t0) / 3_600_000;
  const current = Math.round(intercept + slope * currentHours);
  const h1 = Math.round(intercept + slope * (currentHours + 1));
  const h4 = Math.round(intercept + slope * (currentHours + 4));
  const h24 = Math.round(intercept + slope * (currentHours + 24));

  // clamp projections to 0-100
  const clamp = (v: number) => Math.max(0, Math.min(100, v));

  let slaBreachMs = -1;
  let slaBreachLabel = "never";
  if (slope < -0.1 && current > slaThreshold) {
    // health is declining — estimate when it crosses threshold
    const hoursToBreak = (slaThreshold - current) / slope; // negative slope, so hoursToBreak > 0 when current > threshold
    if (hoursToBreak > 0) {
      slaBreachMs = Math.round(hoursToBreak * 3_600_000);
      slaBreachLabel = formatDuration(slaBreachMs);
    }
  } else if (current <= slaThreshold) {
    slaBreachMs = 0;
    slaBreachLabel = "now";
  }

  const trend: HealthForecast["trend"] = slope > 0.5 ? "improving" : slope < -0.5 ? "declining" : "stable";

  return {
    currentHealth: clamp(current),
    trendPerHour: Math.round(slope * 10) / 10,
    projectedHealth1h: clamp(h1),
    projectedHealth4h: clamp(h4),
    projectedHealth24h: clamp(h24),
    slaBreachInMs: slaBreachMs,
    slaBreachLabel,
    trend,
  };
}

/**
 * Format health forecast for TUI display.
 */
export function formatHealthForecast(forecast: HealthForecast): string[] {
  const trendIcon = forecast.trend === "improving" ? "📈" : forecast.trend === "declining" ? "📉" : "➡";
  const lines: string[] = [];
  lines.push(`  ${trendIcon} Fleet health forecast (${forecast.trend}, ${forecast.trendPerHour > 0 ? "+" : ""}${forecast.trendPerHour}/hr):`);
  lines.push(`  Now: ${forecast.currentHealth}/100  →  1h: ${forecast.projectedHealth1h}  4h: ${forecast.projectedHealth4h}  24h: ${forecast.projectedHealth24h}`);
  if (forecast.slaBreachInMs === 0) {
    lines.push(`  🔴 SLA breach: NOW`);
  } else if (forecast.slaBreachInMs > 0) {
    lines.push(`  ⚠ SLA breach in: ${forecast.slaBreachLabel}`);
  } else {
    lines.push(`  ✅ No SLA breach projected`);
  }
  return lines;
}

function formatDuration(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  const h = Math.floor(ms / 3_600_000);
  const m = Math.round((ms % 3_600_000) / 60_000);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}
