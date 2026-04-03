import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { forecastHealth, formatHealthForecast } from "./health-forecast.js";

describe("forecastHealth", () => {
  it("returns null with < 3 samples", () => {
    assert.equal(forecastHealth([{ timestamp: 1, health: 80 }]), null);
  });

  it("detects declining health", () => {
    const now = Date.now();
    const samples = [
      { timestamp: now - 3 * 3_600_000, health: 90 },
      { timestamp: now - 2 * 3_600_000, health: 70 },
      { timestamp: now - 1 * 3_600_000, health: 50 },
      { timestamp: now, health: 30 },
    ];
    const forecast = forecastHealth(samples, 50, now);
    assert.ok(forecast);
    assert.equal(forecast.trend, "declining");
    assert.ok(forecast.trendPerHour < 0);
  });

  it("detects improving health", () => {
    const now = Date.now();
    const samples = [
      { timestamp: now - 3 * 3_600_000, health: 30 },
      { timestamp: now - 2 * 3_600_000, health: 50 },
      { timestamp: now - 1 * 3_600_000, health: 70 },
      { timestamp: now, health: 90 },
    ];
    const forecast = forecastHealth(samples, 50, now);
    assert.ok(forecast);
    assert.equal(forecast.trend, "improving");
    assert.ok(forecast.trendPerHour > 0);
    assert.equal(forecast.slaBreachLabel, "never");
  });

  it("detects stable health", () => {
    const now = Date.now();
    const samples = [
      { timestamp: now - 3 * 3_600_000, health: 75 },
      { timestamp: now - 2 * 3_600_000, health: 75 },
      { timestamp: now - 1 * 3_600_000, health: 76 },
      { timestamp: now, health: 74 },
    ];
    const forecast = forecastHealth(samples, 50, now);
    assert.ok(forecast);
    assert.equal(forecast.trend, "stable");
  });

  it("projects SLA breach time when declining", () => {
    const now = Date.now();
    const samples = [
      { timestamp: now - 2 * 3_600_000, health: 80 },
      { timestamp: now - 1 * 3_600_000, health: 65 },
      { timestamp: now, health: 55 },
    ];
    const forecast = forecastHealth(samples, 50, now);
    assert.ok(forecast);
    assert.ok(forecast.slaBreachInMs > 0);
  });

  it("clamps projections to 0-100", () => {
    const now = Date.now();
    const samples = [
      { timestamp: now - 2 * 3_600_000, health: 95 },
      { timestamp: now - 1 * 3_600_000, health: 98 },
      { timestamp: now, health: 99 },
    ];
    const forecast = forecastHealth(samples, 50, now);
    assert.ok(forecast);
    assert.ok(forecast.projectedHealth24h <= 100);
  });
});

describe("formatHealthForecast", () => {
  it("shows trend and projections", () => {
    const now = Date.now();
    const forecast = forecastHealth([
      { timestamp: now - 3_600_000, health: 80 },
      { timestamp: now - 1_800_000, health: 70 },
      { timestamp: now, health: 60 },
    ], 50, now)!;
    const lines = formatHealthForecast(forecast);
    assert.ok(lines.some((l) => l.includes("declining") || l.includes("stable") || l.includes("improving")));
    assert.ok(lines.some((l) => l.includes("1h:")));
  });
});
