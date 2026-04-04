// fleet-utilization-forecaster.ts — predict next-day utilization from
// historical patterns. records hourly utilization, computes day-of-week
// patterns, and projects tomorrow's usage curve.

export interface HourlyUtilization {
  hour: number; // 0-23
  dayOfWeek: number; // 0=Sun, 6=Sat
  utilizationPct: number;
}

export interface UtilizationForecast {
  predictedHours: number[]; // 24 predicted utilization % values
  peakHour: number;
  peakUtilPct: number;
  avgUtilPct: number;
  confidence: number; // 0-100 based on data availability
}

/**
 * Utilization forecaster.
 */
export class FleetUtilizationForecaster {
  private history: HourlyUtilization[] = [];
  private maxSamples: number;

  constructor(maxSamples = 500) { this.maxSamples = maxSamples; }

  /** Record an hourly utilization sample. */
  record(hour: number, dayOfWeek: number, utilizationPct: number): void {
    this.history.push({ hour: Math.max(0, Math.min(23, hour)), dayOfWeek: Math.max(0, Math.min(6, dayOfWeek)), utilizationPct: Math.max(0, Math.min(100, utilizationPct)) });
    if (this.history.length > this.maxSamples) this.history = this.history.slice(-this.maxSamples);
  }

  /** Forecast next day's utilization pattern. */
  forecast(targetDayOfWeek: number): UtilizationForecast {
    // filter history to same day of week (or all if insufficient)
    let dayData = this.history.filter((h) => h.dayOfWeek === targetDayOfWeek);
    if (dayData.length < 24) dayData = this.history; // fallback to all data

    if (dayData.length === 0) {
      return { predictedHours: new Array(24).fill(0), peakHour: 0, peakUtilPct: 0, avgUtilPct: 0, confidence: 0 };
    }

    // compute average utilization per hour
    const hourSums = new Array(24).fill(0);
    const hourCounts = new Array(24).fill(0);
    for (const h of dayData) {
      hourSums[h.hour] += h.utilizationPct;
      hourCounts[h.hour]++;
    }

    const predicted = hourSums.map((sum, i) => hourCounts[i] > 0 ? Math.round(sum / hourCounts[i]) : 0);
    const peak = Math.max(...predicted);
    const peakHour = predicted.indexOf(peak);
    const avg = Math.round(predicted.reduce((a, b) => a + b, 0) / 24);
    const confidence = Math.min(90, Math.round((dayData.length / 168) * 90)); // 168 = 1 week of hourly data

    return { predictedHours: predicted, peakHour, peakUtilPct: peak, avgUtilPct: avg, confidence };
  }

  /** Get sample count. */
  sampleCount(): number { return this.history.length; }
}

/**
 * Format forecast for TUI display.
 */
export function formatUtilizationForecast(forecaster: FleetUtilizationForecaster, targetDay: number): string[] {
  const fc = forecaster.forecast(targetDay);
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const lines: string[] = [];
  lines.push(`  Utilization Forecast [${dayNames[targetDay]}] (${fc.confidence}% confidence):`);
  lines.push(`    Peak: ${fc.peakHour}:00 (${fc.peakUtilPct}%) | Avg: ${fc.avgUtilPct}%`);

  // sparkline of predicted hours
  const chars = "▁▂▃▄▅▆▇█";
  const max = Math.max(...fc.predictedHours, 1);
  const spark = fc.predictedHours.map((v) => chars[Math.min(7, Math.round((v / max) * 7))]).join("");
  lines.push(`    00  03  06  09  12  15  18  21`);
  lines.push(`    ${spark}`);

  return lines;
}
